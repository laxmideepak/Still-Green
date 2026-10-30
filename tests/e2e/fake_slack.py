"""A tiny stand-in for Slack, used only by the end-to-end tests.

It answers the three Web API methods the daemon calls (``auth.test``,
``users.getPresence``, ``users.setPresence``) and accepts the presence
WebSocket. Only the token pair below is accepted, so tests can also check how
rejected tokens are handled.

Run it on its own with ``python tests/e2e/fake_slack.py`` to print the ports.
"""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import websockets

GOOD_XOXC = "xoxc-e2e-good-token"
GOOD_XOXD = "xoxd-e2e-good-cookie"
TEAM_ID = "T0E2E0001"
TEAM_NAME = "E2E Workspace"
USER_ID = "U0E2E0001"


class FakeSlack:
    """Starts an HTTP API and a WebSocket server on free loopback ports."""

    def __init__(self) -> None:
        self.presence = "active"
        self.manual_away = False
        self.revoked = False  # set True to make Slack reject the tokens
        self.calls: list[str] = []
        self.ws_connections = 0
        self.ws_messages: list[dict] = []
        self.http_port = 0
        self.ws_port = 0
        self._http: ThreadingHTTPServer | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws_stop: asyncio.Future | None = None
        self._threads: list[threading.Thread] = []

    # ------------------------------------------------------------------ auth

    def _authorized(self, authorization: str, cookie: str) -> bool:
        return (
            not self.revoked
            and authorization == f"Bearer {GOOD_XOXC}"
            and f"d={GOOD_XOXD}" in cookie
        )

    # ------------------------------------------------------------------- http

    def _make_handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:  # keep test output quiet
                pass

            def _reply(self, payload: dict) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _handle(self) -> None:
                method = urlparse(self.path).path.rsplit("/", 1)[-1]
                fake.calls.append(method)
                if not fake._authorized(
                    self.headers.get("Authorization", ""), self.headers.get("Cookie", "")
                ):
                    self._reply({"ok": False, "error": "invalid_auth"})
                    return
                if method == "auth.test":
                    self._reply(
                        {
                            "ok": True,
                            "team": TEAM_NAME,
                            "team_id": TEAM_ID,
                            "user_id": USER_ID,
                            "user": "e2e",
                            "url": "https://e2e.slack.com/",
                        }
                    )
                elif method == "users.getPresence":
                    self._reply(
                        {
                            "ok": True,
                            "presence": fake.presence,
                            "manual_away": fake.manual_away,
                            "auto_away": fake.presence == "away" and not fake.manual_away,
                        }
                    )
                elif method == "users.setPresence":
                    length = int(self.headers.get("Content-Length") or 0)
                    params = parse_qs(self.rfile.read(length).decode("utf-8"))
                    if params.get("presence", ["auto"])[0] == "away":
                        fake.presence, fake.manual_away = "away", True
                    else:
                        fake.presence, fake.manual_away = "active", False
                    self._reply({"ok": True})
                else:
                    self._reply({"ok": False, "error": "unknown_method"})

            do_GET = _handle
            do_POST = _handle

        return Handler

    # -------------------------------------------------------------- websocket

    async def _ws_handler(self, ws) -> None:
        request = ws.request
        token = parse_qs(urlparse(request.path).query).get("token", [""])[0]
        cookie = request.headers.get("Cookie", "")
        if token != GOOD_XOXC or f"d={GOOD_XOXD}" not in cookie:
            await ws.close(code=4001, reason="invalid_auth")
            return
        self.ws_connections += 1
        await ws.send(json.dumps({"type": "hello"}))
        await ws.send(json.dumps({"type": "presence_change", "user": USER_ID, "presence": "active"}))
        async for raw in ws:
            try:
                message = json.loads(raw)
            except (TypeError, ValueError):
                continue
            self.ws_messages.append(message)
            if message.get("type") == "ping":
                await ws.send(json.dumps({"type": "pong", "reply_to": message.get("id")}))

    async def _ws_reject(self, connection, request):
        token = parse_qs(urlparse(request.path).query).get("token", [""])[0]
        if self.revoked or token != GOOD_XOXC:
            return connection.respond(401, "invalid_auth\n")
        return None

    def _run_ws(self, ready: threading.Event) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)

        async def main() -> None:
            self._ws_stop = loop.create_future()
            async with websockets.serve(
                self._ws_handler, "127.0.0.1", 0, process_request=self._ws_reject
            ) as server:
                self.ws_port = server.sockets[0].getsockname()[1]
                ready.set()
                await self._ws_stop

        loop.run_until_complete(main())
        loop.close()

    # -------------------------------------------------------------- lifecycle

    def start(self) -> "FakeSlack":
        self._http = ThreadingHTTPServer(("127.0.0.1", 0), self._make_handler())
        self._http.daemon_threads = True
        self.http_port = self._http.server_address[1]
        http_thread = threading.Thread(target=self._http.serve_forever, daemon=True)
        http_thread.start()
        ready = threading.Event()
        ws_thread = threading.Thread(target=self._run_ws, args=(ready,), daemon=True)
        ws_thread.start()
        if not ready.wait(10):
            raise RuntimeError("fake Slack WebSocket server did not start")
        self._threads = [http_thread, ws_thread]
        return self

    def stop(self) -> None:
        if self._http:
            self._http.shutdown()
            self._http.server_close()
        if self._loop and self._ws_stop and not self._ws_stop.done():
            self._loop.call_soon_threadsafe(self._ws_stop.set_result, None)
        for thread in self._threads:
            thread.join(timeout=5)

    @property
    def api_base(self) -> str:
        return f"http://127.0.0.1:{self.http_port}/api"

    @property
    def ws_url(self) -> str:
        return f"ws://127.0.0.1:{self.ws_port}/?token={{token}}"


if __name__ == "__main__":
    import time

    fake = FakeSlack().start()
    print(json.dumps({"api_base": fake.api_base, "ws_url": fake.ws_url}), flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        fake.stop()
