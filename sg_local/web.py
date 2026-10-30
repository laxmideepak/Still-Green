"""Local control surface for the presence daemon.

The server binds to loopback by default and serves two things: a small control
page (``sg_local/static``) and a JSON API used by that page, the hosted
dashboard and the capture extension.

Security model:

* Only Slack is contacted for token verification; the control surface never
  sends credentials to the hosted dashboard.
* The access code is stored in ``bridge.json`` with mode 0600, or supplied with
  ``SG_LOCAL_BRIDGE_CODE``. It is required by state and mutation endpoints.
* Token values are never returned by the API, written to logs, or included in
  error messages.
* The ``Host`` header must name this machine, so a DNS-rebinding page cannot
  talk to the server as if it were its own site.
* CORS headers are sent only on ``/api`` responses and only to an allowlist of
  origins. The control page, which contains the access code, is never readable
  from another origin.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import re
import secrets
import socket
import threading
import time
from collections import deque
from functools import lru_cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import Any
from urllib.parse import unquote, urlparse, urlsplit

from . import __version__, config, schedule, state
from .slack import SlackAPIError, SlackClient, redact

BRIDGE_PATH = config.CONFIG_DIR / "bridge.json"
DEFAULT_PORT = 8765
MAX_BODY = 64 * 1024
REQUEST_TIMEOUT = 15
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DASHBOARD_ORIGINS = ("https://stillgreen.vercel.app",)
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
WILDCARD_HOSTS = frozenset({"0.0.0.0", "::"})
LOG_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (\w+) (?:\[([^\]]*)\] )?(.*)$"
)
# Dashes that sneak in when a code is copied from chat or a document.
_DASHES = str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2212": "-"})


# --------------------------------------------------------------------- bridge


def generate_code() -> str:
    groups = ["".join(secrets.choice(CODE_ALPHABET) for _ in range(4)) for _ in range(3)]
    return "SG-" + "-".join(groups)


def normalize_code(value: str) -> str:
    """Canonical form for comparing codes: dashes unified, no spaces, upper case.

    The dashboard and extension apply the same rules before sending a code.
    """
    return re.sub(r"\s+", "", value.translate(_DASHES)).upper()


def env_code() -> str:
    return (os.environ.get("SG_LOCAL_BRIDGE_CODE") or "").strip()


def _write_code(code: str) -> str:
    config.ensure_dirs()
    config.atomic_write(
        BRIDGE_PATH,
        json.dumps({"code": code, "created_at": config.now_iso()}, indent=2) + "\n",
    )
    return code


def load_code(create: bool = True) -> str:
    if env_code():
        return env_code()
    if BRIDGE_PATH.exists():
        try:
            payload = json.loads(BRIDGE_PATH.read_text(encoding="utf-8"))
            code = str(payload.get("code") or "")
            if code:
                return code
        except (OSError, json.JSONDecodeError):
            pass
    return _write_code(generate_code()) if create else ""


def rotate_code() -> str:
    if env_code():
        raise config.ConfigError(
            "SG_LOCAL_BRIDGE_CODE is set; change it in the environment instead"
        )
    return _write_code(generate_code())


def port_from_env() -> int:
    raw = os.environ.get("SG_LOCAL_WEB_PORT") or str(DEFAULT_PORT)
    try:
        port = int(raw)
    except ValueError:
        raise config.ConfigError("SG_LOCAL_WEB_PORT must be a port number") from None
    if not 0 <= port <= 65535:
        raise config.ConfigError("SG_LOCAL_WEB_PORT must be between 0 and 65535")
    return port


def _env_list(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip().rstrip("/").lower() for item in raw.split(",") if item.strip()]


def origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True  # same-origin fetch or a non-browser client
    origin = origin.rstrip("/").lower()
    if origin in DASHBOARD_ORIGINS or origin in _env_list("SG_LOCAL_WEB_ORIGIN"):
        return True
    parsed = urlparse(origin)
    if parsed.scheme in {"http", "https"} and (parsed.hostname or "") in LOOPBACK_HOSTS:
        return True
    if (
        os.environ.get("SG_LOCAL_ALLOW_EXTENSIONS", "1") == "1"
        and parsed.scheme in {"chrome-extension", "moz-extension"}
    ):
        # Unpacked extensions get a random ID, so the scheme is the allowlist
        # entry. The access code remains the actual credential.
        return True
    return False


def host_allowed(host_header: str | None, bound_host: str) -> bool:
    """Is ``Host`` a name for this server (and not a rebound attacker domain)?"""
    try:
        name = (urlsplit(f"//{host_header or ''}").hostname or "").lower()
    except ValueError:
        return False
    if not name:
        return False
    if name in LOOPBACK_HOSTS:
        return True
    extra = _env_list("SG_LOCAL_WEB_HOSTS")
    if name in extra:
        return True
    # A server bound to the network is reached by its LAN or public name;
    # without an explicit list, accept any name there.
    return bound_host not in LOOPBACK_HOSTS and not extra


class FailureThrottle:
    """Refuse a client for a while after too many wrong access codes.

    Matters once the server is reachable from the internet (``sg-local
    cloud``). Clients are told apart by ``client_key``, which sees through a
    trusted proxy, so one visitor's wrong codes never lock out another.
    """

    def __init__(self, limit: int = 10, window: float = 60.0, max_keys: int = 10_000) -> None:
        self.limit = limit
        self.window = window
        self.max_keys = max_keys
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> int:
        times = self._failures.get(key)
        if not times:
            return 0
        while times and now - times[0] > self.window:
            times.popleft()
        if not times:
            del self._failures[key]
        return len(times)

    def blocked(self, key: str) -> bool:
        with self._lock:
            return self._recent(key, time.monotonic()) >= self.limit

    def fail(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            if key not in self._failures and len(self._failures) >= self.max_keys:
                # Forget clients whose failures have all expired, then, if
                # still full, the ones that failed longest ago.
                self._failures = {
                    k: v for k, v in self._failures.items() if v and now - v[-1] <= self.window
                }
                while len(self._failures) >= self.max_keys:
                    del self._failures[next(iter(self._failures))]
            self._failures.setdefault(key, deque()).append(now)


def client_key(peer: str, headers: Any) -> str:
    """The address to rate-limit: the real visitor when behind a trusted proxy.

    Forwarding headers are only believed when SG_LOCAL_TRUSTED_PROXY names
    the proxy in front ("caddy" in docker-compose.yml, "fly" in fly.toml), and
    only the header that proxy itself sets; otherwise anyone could pick their
    own key.
    """
    address = peer
    proxy = os.environ.get("SG_LOCAL_TRUSTED_PROXY", "").lower()
    if proxy == "fly":
        address = (headers.get("Fly-Client-IP") or "").strip() or peer
    elif proxy == "caddy":
        # Caddy adds the address it saw as the last X-Forwarded-For entry.
        address = (headers.get("X-Forwarded-For") or "").split(",")[-1].strip() or peer
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return address
    if parsed.version == 6:
        # One IPv6 user usually owns a whole /64.
        return str(ipaddress.ip_network(f"{parsed}/64", strict=False))
    return str(parsed)


THROTTLE = FailureThrottle()


# --------------------------------------------------------------------- helpers


def _runtime() -> tuple[int | None, dict[str, Any] | None]:
    pid = state.daemon_pid()
    runtime = state.read_state()
    if runtime and pid and runtime.get("pid") not in (None, pid):
        runtime = None
    return pid, runtime


def _safe_workspace(
    workspace: dict[str, Any], live: dict[str, Any] | None, daemon_running: bool
) -> dict[str, Any]:
    live = live or {}
    paused = bool(workspace.get("paused"))
    if live:
        status = str(live.get("status") or "starting")
        connected = bool(live.get("connected"))
        reason = str(live.get("reason") or "")
        last_error = live.get("last_error")
        stats = live.get("stats") or {}
    elif not daemon_running:
        status = "paused" if paused else "daemon_stopped"
        connected = False
        reason = "daemon not running"
        last_error = None
        stats = {}
    else:
        status = "starting"
        connected = False
        reason = "waiting for the daemon"
        last_error = None
        stats = {}
    return {
        "team_id": str(workspace.get("team_id") or ""),
        "name": str(workspace.get("name") or workspace.get("team_id") or "Workspace"),
        "user_id": str(workspace.get("user_id") or ""),
        "paused": paused,
        "status": status,
        "connected": connected,
        "reason": reason,
        "last_presence": live.get("last_presence"),
        "last_error": redact(str(last_error)) if last_error else None,
        "stats": stats if isinstance(stats, dict) else {},
        "added_at": workspace.get("added_at"),
    }


def _tone(level: str, message: str) -> str:
    lowered = message.lower()
    if "presence is active" in lowered or "connected to slack websocket" in lowered:
        return "green"
    if (
        "presence is away" in lowered
        or "reconnect" in lowered
        or "rejected" in lowered
        or "error" in lowered
        or level in {"WARNING", "ERROR", "CRITICAL"}
    ):
        return "amber"
    return "muted"


def _activity(limit: int = 30) -> list[dict[str, Any]]:
    lines = state.tail_log(500).splitlines()
    events: list[dict[str, Any]] = []
    for line in lines:
        match = LOG_RE.match(line)
        if not match:
            continue
        date, clock, level, workspace, message = match.groups()
        if level == "DEBUG":
            continue
        events.append(
            {
                "date": date,
                "time": clock[:5],
                "workspace": workspace or "",
                "text": redact(message),
                "tone": _tone(level, message),
                "level": level,
            }
        )
    return list(reversed(events[-limit:]))


def build_state() -> dict[str, Any]:
    config_error = None
    try:
        cfg = config.load_config()
    except config.ConfigError as exc:
        cfg = config.default_config()
        config_error = str(exc)
    pid, runtime = _runtime()
    runtime_workspaces = {
        str(item.get("team_id")): item
        for item in (runtime or {}).get("workspaces", [])
        if isinstance(item, dict)
    }
    workspaces = [
        _safe_workspace(workspace, runtime_workspaces.get(str(workspace.get("team_id"))), bool(pid))
        for workspace in cfg.get("workspaces", [])
        if isinstance(workspace, dict)
    ]
    current_schedule = cfg.get("schedule", {})
    try:
        active = schedule.is_within_schedule(current_schedule)
        boundary = schedule.next_boundary(current_schedule)
        summary = schedule.schedule_summary(current_schedule)
    except Exception:
        active, boundary, summary = True, None, "invalid schedule"
    active_workspaces = sum(1 for item in workspaces if item["connected"] and item["status"] == "active")
    # The pause/stay files are the source of truth: they change the moment a
    # request writes them, while the daemon's state file lags a few seconds.
    pause = config.read_pause()
    stay = config.read_stay()
    return {
        "ok": True,
        "app": "stillgreen",
        "version": __version__,
        "server_time": config.now_iso(),
        "config_error": config_error,
        "daemon": {
            "running": bool(pid),
            "pid": pid,
            "started_at": (runtime or {}).get("started_at"),
            "updated_at": (runtime or {}).get("updated_at"),
            "stopped_at": (runtime or {}).get("stopped_at"),
        },
        "schedule": {
            **{key: current_schedule.get(key) for key in ("mode", "active_days", "start_time", "end_time", "timezone")},
            "summary": summary,
            "active": active,
            "next_change": boundary.isoformat(timespec="seconds") if boundary else None,
        },
        "paused": pause is not None,
        "pause_until": (pause or {}).get("until"),
        "stay_active": stay is not None,
        "stay_until": (stay or {}).get("until"),
        "workspaces": workspaces,
        "connected_count": active_workspaces,
        "activity": _activity(),
    }


# ------------------------------------------------------------------ mutations
#
# Every change goes through config.update_config, which holds a file lock and
# refuses to touch a config file it cannot read.


def update_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    mode = str(payload.get("mode") or "").strip()
    if mode not in {"always", "scheduled"}:
        raise config.ConfigError("mode must be 'always' or 'scheduled'")

    def change(cfg: dict[str, Any]) -> None:
        current = cfg.get("schedule", {})
        if mode == "always":
            updated = {
                "mode": "always",
                "active_days": current.get("active_days") or list(config.DAY_NAMES[:5]),
                "start_time": current.get("start_time") or "09:00",
                "end_time": current.get("end_time") or "17:00",
                "timezone": payload.get("timezone") or current.get("timezone") or "local",
            }
            schedule.resolve_timezone(updated["timezone"])
        else:
            updated = schedule.make_schedule(
                payload.get("active_days"),
                payload.get("start_time") or "09:00",
                payload.get("end_time") or "17:00",
                payload.get("timezone") or "local",
            )
        cfg["schedule"] = updated

    config.update_config(change)
    return build_state()


def _set_workspace_paused(query: str, paused: bool) -> None:
    def change(cfg: dict[str, Any]) -> None:
        _, workspace = config.find_workspace(cfg, query)
        workspace["paused"] = paused
        if paused:
            workspace["paused_at"] = config.now_iso()
        else:
            workspace.pop("paused_at", None)

    config.update_config(change)


def set_pause(payload: dict[str, Any]) -> dict[str, Any]:
    workspace_query = str(payload.get("workspace") or "").strip()
    duration = str(payload.get("duration") or "").strip()
    if workspace_query:
        if duration:
            raise config.ConfigError("a workspace pause lasts until resume; leave out the duration")
        _set_workspace_paused(workspace_query, True)
        return build_state()
    until = config.now_plus(duration) if duration else None
    config.write_pause(until)
    return build_state()


def set_resume(payload: dict[str, Any]) -> dict[str, Any]:
    workspace_query = str(payload.get("workspace") or "").strip()
    if workspace_query:
        _set_workspace_paused(workspace_query, False)
        return build_state()
    config.clear_pause()

    def change(cfg: dict[str, Any]) -> None:
        for workspace in cfg.get("workspaces", []):
            if workspace.get("paused"):
                workspace["paused"] = False
                workspace.pop("paused_at", None)

    config.update_config(change)
    return build_state()


def set_stay(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("cancel"):
        config.clear_stay()
        return build_state()
    duration = str(payload.get("duration") or "").strip()
    if not duration:
        raise config.ConfigError("duration is required")
    config.write_stay(config.now_plus(duration))
    return build_state()


def verify_tokens(xoxc: str, xoxd: str) -> dict[str, Any]:
    """Check a token pair with Slack's auth.test; raise ConfigError if refused."""
    if not xoxc.startswith("xoxc-"):
        raise config.ConfigError("the xoxc token must start with 'xoxc-'")
    if not xoxd.startswith("xoxd-"):
        raise config.ConfigError("the xoxd cookie must start with 'xoxd-'")
    try:
        return SlackClient(xoxc, xoxd).auth_test()
    except SlackAPIError as exc:
        if exc.token_invalid:
            raise config.ConfigError("Slack rejected these tokens; capture both values again") from None
        raise config.ConfigError(f"could not verify the tokens: {redact(exc.error, xoxc, xoxd)}") from None
    except Exception as exc:
        raise config.ConfigError(redact(f"could not reach Slack: {exc}", xoxc, xoxd)) from None


def add_workspace(payload: dict[str, Any]) -> dict[str, Any]:
    xoxc = config.clean_xoxc(str(payload.get("xoxc") or ""))
    xoxd = config.clean_xoxd(str(payload.get("xoxd") or ""))
    # Verify before taking the config lock: auth.test is a network call.
    identity = verify_tokens(xoxc, xoxd)
    name = str(payload.get("name") or "").strip()
    workspace = config.update_config(
        lambda cfg: config.upsert_workspace(cfg, identity, xoxc, xoxd, name)
    )
    return {"ok": True, "team_id": workspace["team_id"], "name": workspace["name"], "state": build_state()}


def remove_workspace(query: str) -> dict[str, Any]:
    def change(cfg: dict[str, Any]) -> dict[str, Any]:
        index, workspace = config.find_workspace(cfg, query)
        del cfg["workspaces"][index]
        return workspace

    workspace = config.update_config(change)
    return {"ok": True, "removed": workspace.get("name") or query, "state": build_state()}


# -------------------------------------------------------------------- handler


class Handler(BaseHTTPRequestHandler):
    server_version = "Stillgreen"
    sys_version = ""
    # Applied to the socket: a slow or half-sent request cannot hold a thread.
    timeout = REQUEST_TIMEOUT

    def log_message(self, fmt: str, *args: Any) -> None:
        # Never let a token or query string reach a platform log.
        print(f"[web] {redact(fmt % args)}")

    # ---------------------------------------------------------------- headers

    def _cors(self, *, any_origin: bool = False) -> None:
        origin = self.headers.get("Origin")
        if origin and (any_origin or origin_allowed(origin)):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def _json(self, payload: Any, status: int = 200, *, any_origin: bool = False) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self._cors(any_origin=any_origin)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._json({"ok": False, "error": redact(message)}, status)

    def _static(self, name: str, content_type: str, *, page: bool = False, body: str | None = None) -> None:
        # No CORS headers here: the control page holds the access code and must
        # never be readable from another origin.
        raw = (body if body is not None else _static_file(name)).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if page:
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
            )
            self.send_header("Referrer-Policy", "no-referrer")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(raw)

    # ------------------------------------------------------------------- auth

    def _authorized(self) -> bool:
        code = load_code(create=False)
        header = self.headers.get("Authorization", "")
        if not code or not header.lower().startswith("bearer "):
            return False
        supplied = header[7:].strip()
        try:
            # HTTP headers arrive as latin-1; undo that for a UTF-8 value.
            supplied = supplied.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        supplied = normalize_code(supplied)
        # Compare bytes: compare_digest refuses non-ASCII str input.
        return bool(supplied) and hmac.compare_digest(
            supplied.encode("utf-8"), normalize_code(code).encode("utf-8")
        )

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise config.ConfigError("request body is too large")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise config.ConfigError("request body must be JSON") from None
        if not isinstance(payload, dict):
            raise config.ConfigError("request body must be a JSON object")
        return payload

    def _host_ok(self) -> bool:
        if host_allowed(self.headers.get("Host"), self.server.server_address[0]):
            return True
        self._error(HTTPStatus.MISDIRECTED_REQUEST, "unknown host name")
        return False

    def _guard(self) -> bool:
        if not origin_allowed(self.headers.get("Origin")):
            # Readable by that origin so the dashboard can explain the fix;
            # the response carries no data.
            self._json(
                {"ok": False, "error": "origin is not allowed; add it to SG_LOCAL_WEB_ORIGIN on the daemon"},
                HTTPStatus.FORBIDDEN,
                any_origin=True,
            )
            return False
        client = client_key(self.client_address[0], self.headers)
        if THROTTLE.blocked(client):
            self._error(HTTPStatus.TOO_MANY_REQUESTS, "too many wrong access codes; wait a minute")
            return False
        if not self._authorized():
            THROTTLE.fail(client)
            self._error(HTTPStatus.UNAUTHORIZED, "access code is required")
            return False
        return True

    def _run(self, action: Any) -> None:
        try:
            self._json(action())
        except config.ConfigError as exc:
            self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    # -------------------------------------------------------------------- GET

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._host_ok():
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        if urlparse(self.path).path.startswith("/api/"):
            # Let every preflight through; _guard then refuses unknown
            # origins with a readable 403 instead of an opaque network error.
            self._cors(any_origin=True)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._host_ok():
            return
        path = urlparse(self.path).path
        if path in {"/", "/connect"}:
            embed = self._embed_code()
            self._static("index.html", "text/html; charset=utf-8", page=True,
                         body=render_page(load_code() if embed else "", embed))
        elif path == "/app.css":
            self._static("app.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self._static("app.js", "text/javascript; charset=utf-8")
        elif path == "/favicon.svg":
            self._static("favicon.svg", "image/svg+xml")
        elif path == "/api/health":
            pid, _ = _runtime()
            self._json(
                {
                    "ok": True,
                    "app": "stillgreen",
                    "version": __version__,
                    "daemon": bool(pid),
                    "auth": "bridge-code",
                }
            )
        elif path == "/api/state":
            if self._guard():
                self._run(build_state)
        else:
            self._error(HTTPStatus.NOT_FOUND, "not found")

    # ------------------------------------------------------------------- POST

    def do_POST(self) -> None:  # noqa: N802
        if not self._host_ok():
            return
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        if not self._guard():
            return
        routes = {
            "/api/schedule": update_schedule,
            "/api/pause": set_pause,
            "/api/resume": set_resume,
            "/api/stay": set_stay,
            "/api/workspaces": add_workspace,
        }
        if path == "/api/code/rotate":
            # Browsers may rotate only from the local page itself.
            if self.headers.get("Origin") and not self._same_origin():
                self._error(HTTPStatus.FORBIDDEN, "rotate the code from the local page")
                return
            self._run(lambda: {"ok": True, "code": rotate_code()})
        elif path in routes:
            self._run(lambda: routes[path](self._body()))
        else:
            self._error(HTTPStatus.NOT_FOUND, "not found")

    # ----------------------------------------------------------------- DELETE

    def do_DELETE(self) -> None:  # noqa: N802
        if not self._host_ok():
            return
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        if not self._guard():
            return
        match = re.fullmatch(r"/api/workspaces/([^/]+)/?", path)
        if not match:
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        self._run(lambda: remove_workspace(unquote(match.group(1))))

    # ------------------------------------------------------------------ misc

    def _same_origin(self) -> bool:
        origin = (self.headers.get("Origin") or "").rstrip("/")
        host = self.headers.get("Host") or ""
        return bool(origin) and origin in {f"http://{host}", f"https://{host}"}

    def _embed_code(self) -> bool:
        """Put the code in the page only for a direct visit on this machine."""
        if os.environ.get("SG_LOCAL_EMBED_CODE", "auto").lower() in {"0", "false", "no"}:
            return False
        if self.server.server_address[0] not in LOOPBACK_HOSTS:
            return False
        if self.headers.get("X-Forwarded-For") or self.headers.get("Forwarded"):
            return False  # reached through a proxy or tunnel
        host = (urlsplit(f"//{self.headers.get('Host') or ''}").hostname or "").lower()
        return host in LOOPBACK_HOSTS


# ---------------------------------------------------------------------- server


class ControlServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ControlServer6(ControlServer):
    address_family = socket.AF_INET6


def make_server(host: str, port: int) -> ControlServer:
    server_class = ControlServer6 if ":" in host else ControlServer
    return server_class((host, port), Handler)


def start_background(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> ControlServer:
    """Serve on a daemon thread; used by the presence daemon itself."""
    server = make_server(host, port)
    thread = threading.Thread(target=server.serve_forever, name="control-server", daemon=True)
    thread.start()
    return server


def serve(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> None:
    server = make_server(host, port)
    display_host = "127.0.0.1" if host in WILDCARD_HOSTS else host
    if ":" in display_host:
        display_host = f"[{display_host}]"
    print(f"Stillgreen control page: http://{display_host}:{port}")
    if host in LOOPBACK_HOSTS:
        print(f"Access code: {load_code()}")
    else:
        print("The access code is not printed here; read it with: sg-local web --show-code")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


# ------------------------------------------------------------------ local page


@lru_cache(maxsize=None)
def _static_file(name: str) -> str:
    return (resources.files(__package__) / "static" / name).read_text(encoding="utf-8")


def render_page(code: str, embed: bool) -> str:
    bootstrap = json.dumps({"code": code, "embed": embed}).replace("<", "\\u003c")
    return _static_file("index.html").replace("__BOOTSTRAP__", bootstrap)
