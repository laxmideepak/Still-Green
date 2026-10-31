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


class Stack:
    """Fake Slack plus the real control server and daemon as subprocesses."""

    def __init__(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="sg-e2e-")
        root = Path(self.temp.name)
        self.config_dir = root / "config"
        self.state_dir = root / "state"
        self.slack = FakeSlack()
        self.port = 0  # set by start(), from the socket it binds
        self.listener: socket.socket | None = None
        self.web: subprocess.Popen[bytes] | None = None
        self.daemon: subprocess.Popen[bytes] | None = None
        self.log_dir = root / "logs"
        self.log_dir.mkdir()
        self.env = {
            **os.environ,
            "SG_LOCAL_CONFIG_DIR": str(self.config_dir),
            "SG_LOCAL_STATE_DIR": str(self.state_dir),
            "SG_LOCAL_BRIDGE_CODE": CODE,
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
        pass_fds: tuple[int, ...] = ()
        if self.listener is not None:
            # The server that serves the page takes over the bound socket.
            command += ["--listen-fd", str(self.listener.fileno())]
            pass_fds = (self.listener.fileno(),)
        # Keep the output so a process that dies at start can be explained.
        with open(self.log_dir / f"{mode}.log", "ab") as log:
            process = subprocess.Popen(
                command,
                env=self.env,
                stdout=log,
                stderr=subprocess.STDOUT,
                pass_fds=pass_fds,
            )
        if self.listener is not None:
            self.listener.close()
            self.listener = None
        return process

    def _bind_page_port(self, host: str) -> None:
        """Bind and listen on a free port now, and hand the socket to the server.

        Picking a free port and letting the server bind it later is racy:
        anything that binds port 0 in between, such as fake Slack, can get the
        same port, and the server then fails with "address already in use".
        """
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        listener = socket.socket(family, socket.SOCK_STREAM)
        listener.bind((host, 0))
        listener.listen(64)
        self.listener = listener
        self.port = listener.getsockname()[1]
        self.env["SG_LOCAL_WEB_PORT"] = str(self.port)

    def _running(self, process: subprocess.Popen[bytes] | None, name: str) -> None:
        if process is not None and process.poll() is not None:
            raise RuntimeError(
                f"the {name} process exited with code {process.returncode}\n{self.output()}"
            )

    def output(self) -> str:
        """The last lines each subprocess printed, for failure messages."""
        parts = []
        for log in sorted(self.log_dir.glob("*.log")):
            lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
            parts.append(f"--- {log.name} ---\n" + "\n".join(lines[-40:]))
        return "\n".join(parts)

    def start(
        self,
        with_daemon: bool = True,
        daemon_serves_page: bool = False,
        extra_env: dict[str, str] | None = None,
    ) -> "Stack":
        """Start fake Slack and the daemon.

        By default the control page runs as its own process (``sg-local web``)
        so tests can stop the daemon and still query the page. With
        ``daemon_serves_page`` the daemon serves it, as after ``sg-local start``.
        """
        try:
            self._start(with_daemon, daemon_serves_page, extra_env)
        except Exception as exc:
            output = self.output()
            self.stop()
            raise RuntimeError(f"the test stack did not start: {exc}\n{output}") from exc
        return self

    def _start(
        self,
        with_daemon: bool,
        daemon_serves_page: bool,
        extra_env: dict[str, str] | None,
    ) -> None:
        self.slack.start()
        self.env.update(extra_env or {})
        self.daemon_serves_page = daemon_serves_page
        if daemon_serves_page:
            self._bind_page_port(self.env.get("SG_LOCAL_DAEMON_WEB_HOST") or "127.0.0.1")
        else:
            self.env["SG_LOCAL_DAEMON_WEB"] = "0"
            self._bind_page_port("127.0.0.1")
            self.web = self._launch("web", "--port", str(self.port))
            wait_for(
                lambda: self._running(self.web, "control server") or self.health() is not None,
                "control server",
            )
        if with_daemon or daemon_serves_page:
            self.start_daemon()

    def start_daemon(self) -> None:
        self.daemon = self._launch("daemon", "--label", "sg_local.daemon")
        wait_for(
            lambda: self._running(self.daemon, "daemon") or (self.health() or {}).get("daemon"),
            "daemon",
        )

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
        if self.listener is not None:
            self.listener.close()
            self.listener = None
        self.slack.stop()
        self.temp.cleanup()

    # --------------------------------------------------------------- requests

    def health(self) -> dict[str, Any] | None:
        try:
            with urllib.request.urlopen(f"{self.base}/api/health", timeout=2) as response:
                body = json.loads(response.read())
        except (OSError, ValueError):
            return None
        # Only our control server counts, not whatever else might answer.
        return body if isinstance(body, dict) and body.get("app") == "stillgreen" else None

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
