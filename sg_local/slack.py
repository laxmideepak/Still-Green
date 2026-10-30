"""Slack Web API client and the presence-keeping WebSocket session.

Only Slack hosts are contacted:

* ``https://slack.com/api/*`` for token verification and presence checks
* ``wss://wss-primary.slack.com/`` for the presence connection

Tokens are passed in the same places the Slack web client uses: the
``Authorization: Bearer`` header plus the ``d`` cookie for HTTP, and the
``token`` query parameter plus the ``d`` cookie for the WebSocket. They are
never written to logs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

API_BASE = "https://slack.com/api"
WS_URL = "wss://wss-primary.slack.com/?token={token}"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
ORIGIN = "https://app.slack.com"

TOKEN_INVALID_ERRORS = frozenset(
    {"invalid_auth", "not_authed", "token_expired", "token_revoked", "account_inactive"}
)

_TOKEN_RE = re.compile(r"xox[abcdeoprs]-[^\s\"'&;]+", re.IGNORECASE)


def redact(text: str, *secrets: str) -> str:
    """Remove anything token-shaped from a message before logging it."""
    cleaned = text or ""
    for secret in secrets:
        if secret:
            cleaned = cleaned.replace(secret, "[redacted-token]")
    return _TOKEN_RE.sub("[redacted-token]", cleaned)


class SlackAPIError(Exception):
    """A Slack Web API returned ``ok: false`` or an HTTP error."""

    def __init__(self, error: str, token_invalid: bool = False) -> None:
        super().__init__(error)
        self.error = error
        self.token_invalid = token_invalid


def get_http_headers(xoxc: str, xoxd: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {xoxc}",
        "Cookie": f"d={xoxd}",
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Origin": ORIGIN,
        "Referer": "https://app.slack.com/",
    }


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Slack API calls never redirect; following one would forward the token."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        raise SlackAPIError(f"unexpected redirect from Slack (HTTP {code})")


class SlackClient:
    """Small synchronous Slack Web API client.

    The daemon calls these methods in a worker thread so the async
    WebSocket loop never blocks.
    """

    def __init__(self, xoxc: str, xoxd: str, user_id: str = "") -> None:
        self._xoxc = xoxc
        self._xoxd = xoxd
        self.user_id = user_id
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect()
        )

    def _read_json(self, response: Any) -> dict[str, Any]:
        raw = response.read(2_000_000)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise SlackAPIError("Slack returned an unreadable response") from None
        if not isinstance(payload, dict):
            raise SlackAPIError("Slack returned an unexpected response")
        return payload

    def _request(
        self, method: str, params: dict[str, str] | None = None, *, get: bool = False
    ) -> dict[str, Any]:
        params = params or {}
        headers = get_http_headers(self._xoxc, self._xoxd)
        url = f"{API_BASE}/{method}"
        body = None
        if get:
            if params:
                url = f"{url}?{urllib.parse.urlencode(params)}"
        else:
            body = urllib.parse.urlencode(params).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"

        request = urllib.request.Request(url, data=body, headers=headers, method="POST" if body else "GET")
        try:
            with self._opener.open(request, timeout=20) as response:
                payload = self._read_json(response)
        except urllib.error.HTTPError as exc:
            try:
                payload = self._read_json(exc)
            except SlackAPIError:
                raise SlackAPIError(f"Slack HTTP {exc.code}") from None
        except urllib.error.URLError as exc:
            reason = redact(str(exc.reason), self._xoxc, self._xoxd)
            raise SlackAPIError(f"Network error: {reason}") from None
        except TimeoutError:
            raise SlackAPIError("Network timeout contacting Slack") from None

        if not payload.get("ok"):
            error = str(payload.get("error") or "unknown_error")
            raise SlackAPIError(error, token_invalid=error in TOKEN_INVALID_ERRORS)
        return payload

    def auth_test(self) -> dict[str, Any]:
        return self._request("auth.test")

    def get_presence(self, user_id: str = "") -> dict[str, Any]:
        params = {"user": user_id or self.user_id}
        return self._request("users.getPresence", {k: v for k, v in params.items() if v}, get=True)

    def set_presence(self, presence: str = "auto") -> dict[str, Any]:
        return self._request("users.setPresence", {"presence": presence})


def presence_kind(data: dict[str, Any] | None) -> str:
    """Classify a users.getPresence response."""
    if not data or not data.get("ok"):
        return "unknown"
    if data.get("presence") == "active":
        return "active"
    if data.get("presence") == "away":
        if data.get("manual_away"):
            return "manual_away"
        if data.get("auto_away"):
            return "auto_away"
        return "away"
    return "unknown"


class PresenceSession:
    """Maintain one workspace's presence with a Slack WebSocket.

    Slack keeps the web client "active" while its WebSocket is connected.
    The connection is kept alive with periodic JSON pings, and a ``tickle``
    event simulates the activity the web client sends on mouse input.
    Because Slack may still mark a user away after a while, presence is polled
    over HTTP; a reconnect usually resets it to active.
    """

    PING_INTERVAL = 30.0
    TICKLE_INTERVAL = 300.0
    PRESENCE_INTERVAL = 60.0
    LOOP_INTERVAL = 0.5
    RECONNECT_MIN = 5.0
    RECONNECT_MAX = 60.0
    # A connection that drops sooner than this counts as a failed attempt, so
    # a server that accepts and then closes is retried with backoff.
    STABLE_AFTER = 60.0
    KEEPALIVE = 20.0
    INITIAL_AWAY_RECONNECTS = 5
    AWAY_RECONNECT_EVERY = 5

    def __init__(
        self,
        workspace: dict[str, Any],
        logger: logging.Logger | None = None,
    ) -> None:
        self.name = str(workspace.get("name") or workspace.get("team_id") or "workspace")
        self.team_id = str(workspace.get("team_id") or "")
        self.user_id = str(workspace.get("user_id") or "")
        self.client = SlackClient(
            str(workspace.get("xoxc") or ""),
            str(workspace.get("xoxd") or ""),
            self.user_id,
        )
        self.log = logger or logging.getLogger("sg_local.slack")

        self.status = "starting"
        self.invalid_token = False
        self.last_error: str | None = None
        self.started_at: float | None = None
        self.connected_at: float | None = None
        self.last_presence: str | None = None

        self.ping_count = 0
        self.tickle_count = 0
        self.presence_checks = 0
        self.connections = 0
        self.reconnects = 0
        self.away_count = 0

        self._ws: Any = None
        self._reader_task: asyncio.Task[Any] | None = None
        self._stop_event = asyncio.Event()
        self._last_ping = 0.0
        self._last_tickle = 0.0
        self._last_presence_check = 0.0
        self._reconnect_delay = self.RECONNECT_MIN
        self._server_disconnect = False

    # ------------------------------------------------------------------ utils

    def _log(self, level: int, message: str, *args: Any) -> None:
        self.log.log(level, "[%s] " + message, self.name, *args)

    def _safe(self, exc: BaseException) -> str:
        return redact(str(exc), self.client._xoxc, self.client._xoxd)

    async def _sleep(self, seconds: float) -> bool:
        """Sleep unless stopped; returns True when a stop was requested."""
        if seconds <= 0:
            return self._stop_event.is_set()
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=seconds)
            return True
        except TimeoutError:
            return False

    # ------------------------------------------------------------------- run

    async def run(self) -> None:
        self.started_at = self.started_at or time.time()
        self._log(logging.INFO, "starting presence session")
        try:
            while not self._stop_event.is_set():
                if self._ws is None and self.connected_at is not None:
                    lived = time.time() - self.connected_at
                    self.connected_at = None
                    if lived < self.STABLE_AFTER:
                        delay = self._reconnect_delay
                        self._reconnect_delay = min(delay * 2, self.RECONNECT_MAX)
                        self._log(logging.WARNING, "connection lasted %ss; retrying in %ss", int(lived), int(delay))
                        if await self._sleep(delay):
                            break
                    else:
                        self._reconnect_delay = self.RECONNECT_MIN
                if self._ws is None:
                    if not await self._connect():
                        if self.invalid_token or self._stop_event.is_set():
                            break
                        delay = self._reconnect_delay
                        self._log(
                            logging.WARNING,
                            "connection failed; retrying in %ss%s",
                            int(delay),
                            f" ({self.last_error})" if self.last_error else "",
                        )
                        if await self._sleep(delay):
                            break
                        self._reconnect_delay = min(delay * 2, self.RECONNECT_MAX)
                        continue

                if (
                    self.connected_at is not None
                    and time.time() - self.connected_at >= self.STABLE_AFTER
                ):
                    self._reconnect_delay = self.RECONNECT_MIN
                await self._maybe_ping()
                await self._maybe_tickle()
                await self._maybe_check_presence()
                if self._server_disconnect:
                    self._server_disconnect = False
                    await self._drop_ws("Slack disconnect event")
                if await self._sleep(self.LOOP_INTERVAL):
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # keep the daemon alive, report the failure
            self.last_error = self._safe(exc)
            self.status = "error"
            self._log(logging.ERROR, "session error: %s", self.last_error)
        finally:
            await self._close()
            if self.status not in {"invalid_token", "error"}:
                self.status = "stopped"
            self._log(logging.INFO, "presence session stopped (%s)", self.status)

    async def stop(self) -> None:
        self._stop_event.set()
        await self._close()

    def _mark_invalid(self, message: str) -> None:
        if self.invalid_token:
            return
        self.invalid_token = True
        self.status = "invalid_token"
        self.last_error = message
        self._log(logging.ERROR, "%s", message)
        self._stop_event.set()

    async def _tokens_rejected(self) -> bool:
        """Confirm a refused handshake with auth.test before giving up.

        A proxy, captive portal or Slack edge error can also answer 4xx; only
        a token error from the API means the tokens are really bad.
        """
        try:
            await asyncio.to_thread(self.client.auth_test)
        except SlackAPIError as exc:
            return exc.token_invalid
        except Exception:
            return False
        return False

    # ------------------------------------------------------------- websocket

    async def _connect(self) -> bool:
        url = WS_URL.format(token=self.client._xoxc)
        try:
            ws = await websockets.connect(
                url,
                origin=ORIGIN,
                additional_headers={"Cookie": f"d={self.client._xoxd}"},
                user_agent_header=USER_AGENT,
                # Protocol pings detect a dead socket after sleep or a
                # network change; the JSON pings below are what Slack expects.
                ping_interval=self.KEEPALIVE,
                ping_timeout=self.KEEPALIVE,
                open_timeout=12,
                close_timeout=5,
                max_size=4 * 1024 * 1024,
                max_queue=128,
            )
        except InvalidStatus as exc:
            code = getattr(exc.response, "status_code", 0)
            if 400 <= code < 500 and code != 429 and await self._tokens_rejected():
                self._mark_invalid(
                    f"Slack rejected the WebSocket handshake (HTTP {code}); "
                    "the xoxc/xoxd tokens are invalid or expired"
                )
            else:
                self.last_error = f"WebSocket handshake failed (HTTP {code})"
                self.status = "error"
                self._log(logging.WARNING, "%s", self.last_error)
            return False
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.last_error = self._safe(exc)
            self.status = "error"
            self._log(logging.WARNING, "WebSocket connection failed: %s", self.last_error)
            return False

        self._ws = ws
        self.connections += 1
        if self.connections > 1:
            self.reconnects += 1
        self.connected_at = time.time()
        self.status = "connected"
        self._last_ping = time.time()
        self._last_tickle = time.time()
        self._last_presence_check = time.time()
        self._log(
            logging.INFO,
            "connected to Slack WebSocket (%s)",
            "reconnect" if self.reconnects else "initial",
        )
        self._reader_task = asyncio.create_task(
            self._reader(ws), name=f"slack-reader-{self.team_id or self.name}"
        )
        return True

    async def _reader(self, ws: Any) -> None:
        try:
            async for raw in ws:
                if isinstance(raw, bytes):
                    try:
                        raw = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                if len(raw) > 4 * 1024 * 1024:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict):
                    self._handle_message(message)
        except asyncio.CancelledError:
            raise
        except ConnectionClosed as exc:
            if not self._stop_event.is_set():
                self._log(
                    logging.WARNING,
                    "WebSocket closed (code %s); will reconnect",
                    getattr(exc, "code", "?"),
                )
                self.status = "reconnecting"
        except Exception as exc:
            if not self._stop_event.is_set():
                self.last_error = self._safe(exc)
                self._log(logging.WARNING, "WebSocket reader error: %s", self.last_error)
                self.status = "reconnecting"
        finally:
            if self._ws is ws:
                self._ws = None

    def _handle_message(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "hello":
            self._log(logging.INFO, "received hello from Slack")
        elif kind == "presence_change" and message.get("user") == self.user_id:
            presence = str(message.get("presence") or "unknown")
            self.last_presence = presence
            if presence == "active":
                self.status = "active"
            elif presence == "away":
                self.status = "away"
            self._log(logging.DEBUG, "presence event: %s", presence)
        elif kind in {"disconnect", "goodbye"}:
            self._log(logging.WARNING, "Slack asked the client to reconnect")
            self.status = "reconnecting"
            self._server_disconnect = True

    async def _close(self) -> None:
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass
        reader = self._reader_task
        self._reader_task = None
        if reader is not None and reader is not asyncio.current_task():
            reader.cancel()
            try:
                await reader
            except (asyncio.CancelledError, Exception):
                pass

    async def _drop_ws(self, reason: str) -> None:
        self._log(logging.INFO, "reconnecting to reset presence (%s)", reason)
        self.status = "reconnecting"
        self.connected_at = None  # a deliberate reconnect is not a failure
        await self._close()
        await self._sleep(2)

    # --------------------------------------------------------------- actions

    async def _maybe_ping(self) -> None:
        if self._ws is None or time.time() - self._last_ping < self.PING_INTERVAL:
            return
        try:
            await self._ws.send(json.dumps({"id": int(time.time() * 1000), "type": "ping"}))
            self.ping_count += 1
            self._last_ping = time.time()
        except Exception as exc:
            self.last_error = self._safe(exc)
            self._log(logging.WARNING, "ping failed: %s", self.last_error)
            await self._close()

    async def _maybe_tickle(self) -> None:
        if self._ws is None or time.time() - self._last_tickle < self.TICKLE_INTERVAL:
            return
        try:
            await self._ws.send(
                json.dumps(
                    {
                        "type": "tickle",
                        "reason": "mousedown",
                        "id": int(time.time() * 1000) + 1,
                    }
                )
            )
            self.tickle_count += 1
            self._last_tickle = time.time()
            self._log(logging.DEBUG, "sent activity tickle")
        except Exception as exc:
            self.last_error = self._safe(exc)
            self._log(logging.WARNING, "tickle failed: %s", self.last_error)
            await self._close()

    async def _maybe_check_presence(self) -> None:
        now = time.time()
        if now - self._last_presence_check < self.PRESENCE_INTERVAL:
            return
        self._last_presence_check = now

        try:
            data = await asyncio.to_thread(self.client.get_presence, self.user_id)
        except SlackAPIError as exc:
            if exc.token_invalid:
                self._mark_invalid("Slack rejected the tokens during a presence check")
                return
            self.last_error = str(exc)
            self._log(logging.WARNING, "presence check failed: %s", exc)
            return
        except Exception as exc:
            self.last_error = self._safe(exc)
            self._log(logging.WARNING, "presence check failed: %s", self.last_error)
            return

        self.presence_checks += 1
        kind = presence_kind(data)
        changed = kind != self.last_presence
        self.last_presence = kind

        if kind == "active":
            self.away_count = 0
            self.status = "active"
            if changed:
                self._log(logging.INFO, "presence is active")
        elif kind == "manual_away":
            self.away_count = 0
            self.status = "manual_away"
            if changed:
                self._log(logging.INFO, "presence is manually away; leaving it alone")
        elif kind in {"away", "auto_away"}:
            self.away_count += 1
            self.status = kind
            if changed or self.away_count == 1:
                self._log(logging.INFO, "presence is %s; reconnecting to reset it", kind)
            if self._should_reconnect_for_away():
                await self._drop_ws(kind)
        else:
            if changed:
                self._log(logging.WARNING, "presence state unknown: %r", data)

    def _should_reconnect_for_away(self) -> bool:
        if self.away_count <= self.INITIAL_AWAY_RECONNECTS:
            return True
        return self.away_count % self.AWAY_RECONNECT_EVERY == 0

    # -------------------------------------------------------------- reporting

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        return {
            "team_id": self.team_id,
            "name": self.name,
            "status": self.status,
            "connected": self._ws is not None,
            "invalid_token": self.invalid_token,
            "last_error": self.last_error,
            "last_presence": self.last_presence,
            "started_at": _iso(self.started_at),
            "connected_at": _iso(self.connected_at),
            "uptime_seconds": int(now - self.started_at) if self.started_at else 0,
            "stats": {
                "pings": self.ping_count,
                "tickles": self.tickle_count,
                "presence_checks": self.presence_checks,
                "connections": self.connections,
                "reconnects": self.reconnects,
            },
        }


def _iso(timestamp: float | None) -> str | None:
    if not timestamp:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="seconds")
