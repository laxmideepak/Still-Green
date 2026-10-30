"""Start fake Slack, the control server and the daemon for end-to-end tests.

Used by ``tests/test_e2e.py`` and, through ``python tests/e2e/harness.py``, by
the browser test in ``tests/e2e/dashboard.e2e.mjs``. Everything runs on
loopback in a temporary folder.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from fake_slack import FakeSlack  # noqa: E402

CODE = "SG-E2E1-TEST-CODE"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Stack:
    """Fake Slack plus the real control server and daemon as subprocesses."""

    def __init__(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="sg-e2e-")
        root = Path(self.temp.name)
        self.config_dir = root / "config"
        self.state_dir = root / "state"
        self.slack = FakeSlack()
        self.port = free_port()
        self.web: subprocess.Popen[bytes] | None = None
        self.daemon: subprocess.Popen[bytes] | None = None
        self.env = {
            **os.environ,
            "SG_LOCAL_CONFIG_DIR": str(self.config_dir),
            "SG_LOCAL_STATE_DIR": str(self.state_dir),
            "SG_LOCAL_BRIDGE_CODE": CODE,
            "SG_LOCAL_WEB_PORT": str(self.port),
            "PYTHONUNBUFFERED": "1",
        }
        self.daemon_serves_page = False

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _launch(self, mode: str, *extra: str) -> subprocess.Popen[bytes]:
        command = [
            sys.executable,
            str(HERE / "launch.py"),
            mode,
            "--api-base",
            self.slack.api_base,
            "--ws-url",
            self.slack.ws_url,
            *extra,
        ]
        return subprocess.Popen(
            command,
            env=self.env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def start(self, with_daemon: bool = True, daemon_serves_page: bool = False) -> "Stack":
        """Start fake Slack and the daemon.

        By default the control page runs as its own process (``sg-local web``)
        so tests can stop the daemon and still query the page. With
        ``daemon_serves_page`` the daemon serves it, as after ``sg-local start``.
        """
        self.slack.start()
        self.daemon_serves_page = daemon_serves_page
        if not daemon_serves_page:
            self.env["SG_LOCAL_DAEMON_WEB"] = "0"
            self.web = self._launch("web", "--port", str(self.port))
            wait_for(lambda: self.health() is not None, "control server")
        if with_daemon or daemon_serves_page:
            self.start_daemon()
        return self

    def start_daemon(self) -> None:
        self.daemon = self._launch("daemon", "--label", "sg_local.daemon")
        wait_for(lambda: (self.health() or {}).get("daemon"), "daemon")

    def stop_daemon(self) -> None:
        if self.daemon and self.daemon.poll() is None:
            self.daemon.terminate()
            self.daemon.wait(timeout=10)
        self.daemon = None

    def stop(self) -> None:
        self.stop_daemon()
        if self.web and self.web.poll() is None:
            self.web.terminate()
            self.web.wait(timeout=10)
        self.slack.stop()
        self.temp.cleanup()

    # --------------------------------------------------------------- requests

    def health(self) -> dict[str, Any] | None:
        try:
            with urllib.request.urlopen(f"{self.base}/api/health", timeout=2) as response:
                return json.loads(response.read())
        except (OSError, ValueError):
            return None

    def call(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        code: str | None = CODE,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if code:
            request.add_header("Authorization", f"Bearer {code}")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            body = exc.read()
            try:
                return exc.code, json.loads(body or b"{}")
            except ValueError:
                return exc.code, {"raw": body.decode("utf-8", "replace")}

    def state(self) -> dict[str, Any]:
        status, body = self.call("GET", "/api/state")
        assert status == 200, body
        return body


def wait_for(check, what: str, timeout: float = 20.0, interval: float = 0.2) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(interval)
    raise TimeoutError(f"timed out waiting for {what}")


if __name__ == "__main__":
    # Used by the browser test: start everything, print the details, and keep
    # running until stdin closes or the process is stopped.
    stack = Stack().start()
    print(json.dumps({"base": stack.base, "code": CODE}), flush=True)
    try:
        sys.stdin.read()
    except KeyboardInterrupt:
        pass
    finally:
        stack.stop()
