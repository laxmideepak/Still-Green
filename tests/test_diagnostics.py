"""Diagnostics: every check, with the network mocked or on loopback only.

No test here contacts slack.com. The TLS tests run a small TLS server on
127.0.0.1 with a test certificate (made with the ``openssl`` command, skipped
where it is missing), and the proxy tests run a tiny fake proxy.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import ssl
import stat
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock

from sg_local import config, diagnostics, state, web
from test_tls import CERT_ENV, OPENSSL, make_certificates

XOXC = "xoxc-1111-diag-secret-token"
XOXD = "xoxd-diag%2Fsecret%3Dcookie"
CODE = "SG-ABCD-EFGH-JKMN"


def workspace(team: str = "T1", name: str = "Acme", **extra: Any) -> dict:
    return {"name": name, "team_id": team, "user_id": "U1", "xoxc": XOXC, "xoxd": XOXD, **extra}


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def no_cert_env() -> Any:
    clean = {key: value for key, value in os.environ.items() if key not in CERT_ENV}
    return mock.patch.dict(os.environ, clean, clear=True)


class TempDirs(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.config_dir, self.state_dir = root / "config", root / "state"
        patches = [
            mock.patch.multiple(
                config,
                CONFIG_DIR=self.config_dir,
                STATE_DIR=self.state_dir,
                CONFIG_PATH=self.config_dir / "config.json",
                STATE_PATH=self.state_dir / "state.json",
                PID_PATH=self.state_dir / "daemon.pid",
                LOCK_PATH=self.state_dir / "daemon.lock",
                LOG_PATH=self.state_dir / "daemon.log",
                PAUSE_PATH=self.state_dir / "pause.json",
                STAY_PATH=self.state_dir / "stay.json",
            ),
            mock.patch.object(web, "BRIDGE_PATH", self.config_dir / "bridge.json"),
            mock.patch.dict(os.environ, {"SG_LOCAL_BRIDGE_CODE": ""}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.temp.cleanup)
        config.ensure_dirs()

    def save(self, *workspaces: dict) -> None:
        config.save_config({**config.default_config(), "workspaces": list(workspaces)})

    def runtime(self, pid: int | None, workspaces: list[dict], **extra: Any) -> Any:
        state.write_state({"pid": pid, "running": bool(pid), "workspaces": workspaces, **extra})
        return mock.patch.object(state, "daemon_pid", return_value=pid)


def probe(stage: str = "done", error: BaseException | None = None, date: str | None = None, proxy: str | None = None) -> dict:
    return {"stage": stage, "error": error, "proxy": proxy, "tls_version": "TLSv1.3" if stage in {"http", "done"} else None, "date": date}


def cert_error(message: str = "self-signed certificate in certificate chain") -> ssl.SSLCertVerificationError:
    exc = ssl.SSLCertVerificationError(1, f"[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: {message}")
    exc.verify_message = message
    return exc


class ContractTests(TempDirs):
    def test_every_contract_check_runs_in_order(self) -> None:
        result = diagnostics.run_checks(network=False)
        self.assertEqual(
            [check["id"] for check in result["checks"]],
            ["python", "daemon", "config", "permissions", "dns", "tls", "proxy", "clock", "workspaces", "presence"],
        )
        for check in result["checks"]:
            with self.subTest(check=check["id"]):
                self.assertIn(check["status"], {"pass", "warn", "fail", "skip"})
                self.assertTrue(check["label"])
                self.assertIsInstance(check["detail"], str)
                self.assertIsInstance(check["action"], str)
                if check["status"] in {"warn", "fail"}:
                    self.assertTrue(check["action"], check)
        self.assertIsNotNone(config.parse_iso(result["generated_at"]))

    def test_network_checks_with_a_working_connection(self) -> None:
        date = format_datetime(datetime.now(timezone.utc), usegmt=True)
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.1", 443))]
        with mock.patch.object(diagnostics, "probe_slack", return_value=probe(date=date)), \
                mock.patch.object(diagnostics, "proxy_for", return_value=None), \
                mock.patch.object(diagnostics.socket, "getaddrinfo", return_value=addresses), \
                mock.patch.dict(os.environ, {name: "" for name in diagnostics.PROXY_VARIABLES}):
            checks = {c["id"]: c for c in diagnostics.run_checks()["checks"]}
        self.assertEqual(checks["dns"]["status"], "pass")
        self.assertEqual(checks["tls"]["status"], "pass")
        self.assertIn("TLSv1.3", checks["tls"]["detail"])
        self.assertEqual(checks["clock"]["status"], "pass")
        self.assertEqual(checks["proxy"]["status"], "skip")
        # The result is kept for the health summary in /api/state.
        cached = diagnostics.load_network_result()
        self.assertTrue(cached["reachable"])


class LocalCheckTests(TempDirs):
    def test_python_check(self) -> None:
        check = diagnostics.check_python()
        self.assertEqual(check["status"], "pass" if sys.version_info >= (3, 10) else "warn")
        with mock.patch.object(diagnostics, "sys", SimpleNamespace(version_info=(3, 8, 10))):
            check = diagnostics.check_python()
        self.assertEqual((check["status"], check["code"]), ("fail", "python_too_old"))

    def test_python_39_warns_about_company_certificates(self) -> None:
        with mock.patch.object(diagnostics, "sys", SimpleNamespace(version_info=(3, 9, 6))):
            check = diagnostics.check_python()
        self.assertEqual(check["status"], "warn")
        self.assertIn("Company certificates may not be trusted with Python 3.9", check["detail"])
        self.assertIn("Install Python 3.10 or newer, then delete the .venv folder", check["action"])

    def test_untrusted_certificate_without_truststore_gives_the_python_advice(self) -> None:
        probe = {"stage": "tls", "error": ssl.SSLCertVerificationError(1, "certificate verify failed"), "proxy": None}
        with mock.patch.object(diagnostics.tls, "_truststore", return_value=None), \
                mock.patch.object(diagnostics, "sys", SimpleNamespace(version_info=(3, 9, 6), platform=sys.platform)):
            check = diagnostics.check_tls(probe)
        self.assertEqual(check["code"], "tls_untrusted")
        self.assertIn("Python 3.9", check["detail"])
        self.assertIn("Install Python 3.10 or newer", check["action"])
        self.assertIn("Do not turn off security checks", check["action"])

    def test_missing_websockets_is_explained(self) -> None:
        with mock.patch.dict("sys.modules", {"websockets": None}):
            check = diagnostics.check_python()
        self.assertEqual((check["status"], check["code"]), ("fail", "missing_dependency"))

    def test_daemon_check(self) -> None:
        with mock.patch.object(state, "daemon_pid", return_value=4321):
            self.assertEqual(diagnostics.check_daemon()["status"], "pass")
        with mock.patch.object(state, "daemon_pid", return_value=None), \
                mock.patch.object(state, "lock_held", return_value=False):
            check = diagnostics.check_daemon()
        self.assertEqual((check["status"], check["code"]), ("warn", "daemon_not_running"))
        self.assertIn("./sg-local start", check["action"])

    def test_config_checks(self) -> None:
        check, _ = diagnostics.check_config()
        self.assertEqual(check["status"], "warn")  # not made yet
        self.save(workspace())
        check, cfg = diagnostics.check_config()
        self.assertEqual(check["status"], "pass")
        self.assertEqual(len(cfg["workspaces"]), 1)
        config.CONFIG_PATH.write_text("{ broken", encoding="utf-8")
        check, cfg = diagnostics.check_config()
        self.assertEqual((check["status"], check["code"]), ("fail", "config_unreadable"))
        self.assertEqual(cfg["workspaces"], [])

    def test_permissions(self) -> None:
        self.save(workspace())
        self.assertEqual(diagnostics.check_permissions()["status"], "pass")
        config.STATE_DIR.chmod(0o755)
        check = diagnostics.check_permissions()
        self.assertEqual(check["status"], "warn")
        self.assertIn("chmod 700", check["action"])
        config.CONFIG_PATH.chmod(0o644)
        check = diagnostics.check_permissions()
        self.assertEqual(check["status"], "fail")
        self.assertIn("chmod 600", check["action"])
        self.assertIn("0644", check["detail"])

    def test_chmod_command_is_safe_to_paste(self) -> None:
        home = Path(self.temp.name) / "My Home"
        odd = home / "My Stuff; rm -rf x"
        odd.mkdir(parents=True)
        secret = odd / "config.json"
        secret.write_text("{}", encoding="utf-8")
        secret.chmod(0o644)
        bridge = odd / "bridge.json"
        with mock.patch.dict(os.environ, {"HOME": str(home)}), \
                mock.patch.multiple(config, CONFIG_DIR=odd, CONFIG_PATH=secret):
            check = diagnostics.check_permissions()
        self.assertEqual(check["status"], "fail")
        command = check["action"].removeprefix("Run: ")
        self.assertEqual(command, "chmod 600 \"$HOME\"/'My Stuff; rm -rf x/config.json'")
        # The shell turns it back into exactly one argument: the file.
        words = subprocess.run(
            ["/bin/sh", "-c", "printf '%s\\n' " + command.removeprefix("chmod 600 ")],
            env={"HOME": str(home), "PATH": os.environ.get("PATH", "")}, capture_output=True, text=True,
        ).stdout.splitlines()
        self.assertEqual(words, [str(secret)])
        self.assertFalse(bridge.exists())
        outside = Path(self.temp.name) / "other place" / "config.json"
        self.assertEqual(diagnostics._shell_path(outside), "'" + str(outside) + "'")

    def test_workspaces(self) -> None:
        self.assertEqual(diagnostics.check_workspaces(config.default_config())["status"], "warn")
        cfg = {**config.default_config(), "workspaces": [workspace()]}
        check = diagnostics.check_workspaces(cfg)
        self.assertEqual(check["status"], "pass")
        self.assertIn("Acme", check["detail"])
        broken = {**config.default_config(), "workspaces": [{**workspace(), "xoxd": ""}]}
        check = diagnostics.check_workspaces(broken)
        self.assertEqual((check["status"], check["code"]), ("fail", "workspace_invalid"))
        runtime = {"workspaces": [{"team_id": "T1", "auth": "rejected", "status": "invalid_token"}]}
        check = diagnostics.check_workspaces(cfg, runtime)
        self.assertEqual((check["status"], check["code"]), ("fail", "slack_auth_rejected"))
        for text in (check["detail"], check["action"]):
            self.assertNotIn(XOXC, text)

    def test_presence_confirmed_in_the_last_ten_minutes(self) -> None:
        now = datetime.now(timezone.utc)
        cfg = {**config.default_config(), "workspaces": [workspace()]}
        fresh = {"started_at": iso(now - timedelta(hours=1)), "workspaces": [
            {"team_id": "T1", "desired": True, "presence": "active", "presence_verified_at": iso(now - timedelta(minutes=3))}
        ]}
        self.assertEqual(diagnostics.check_presence(cfg, 1, fresh, now)["status"], "pass")
        stale = {"started_at": iso(now - timedelta(hours=1)), "workspaces": [
            {"team_id": "T1", "desired": True, "presence": "away", "presence_verified_at": iso(now - timedelta(minutes=30))}
        ]}
        check = diagnostics.check_presence(cfg, 1, stale, now)
        self.assertEqual(check["status"], "warn")
        self.assertIn("Slack decides your final status", check["action"])
        never = {"started_at": iso(now - timedelta(seconds=30)), "workspaces": [{"team_id": "T1", "desired": True}]}
        self.assertIn("Wait two minutes", diagnostics.check_presence(cfg, 1, never, now)["action"])
        manual = {"workspaces": [{"team_id": "T1", "desired": True, "presence": "manual_away"}]}
        self.assertIn("set yourself away", diagnostics.check_presence(cfg, 1, manual, now)["detail"])
        off = {"workspaces": [{"team_id": "T1", "desired": False}]}
        self.assertEqual(diagnostics.check_presence(cfg, 1, off, now)["status"], "skip")
        self.assertEqual(diagnostics.check_presence(cfg, None, fresh, now)["status"], "skip")
        self.assertEqual(diagnostics.check_presence(config.default_config(), 1, fresh, now)["status"], "skip")


class NetworkCheckTests(TempDirs):
    def test_dns_failure(self) -> None:
        with mock.patch.object(diagnostics.socket, "getaddrinfo", side_effect=socket.gaierror(-2, "Name or service not known")):
            check = diagnostics.check_dns()
            self.assertEqual((check["status"], check["code"]), ("fail", "dns_failed"))
            # Behind a proxy the proxy looks the name up, so it is only a warning.
            self.assertEqual(diagnostics.check_dns(proxy="http://proxy:3128")["status"], "warn")

    def test_dns_has_a_time_limit(self) -> None:
        def slow(*args: Any, **kwargs: Any) -> list:
            time.sleep(2)
            return []

        started = time.monotonic()
        with mock.patch.object(diagnostics.socket, "getaddrinfo", side_effect=slow):
            check = diagnostics.check_dns(timeout=0.2)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual((check["status"], check["code"]), ("fail", "network_timeout"))

    def test_untrusted_certificate_is_reported_clearly(self) -> None:
        check = diagnostics.check_tls(probe("tls", cert_error()))
        self.assertEqual((check["status"], check["code"]), ("fail", "tls_untrusted"))
        self.assertIn("self-signed certificate", check["detail"])
        self.assertIn("Certificates come from", check["detail"])
        self.assertIn("Do not turn off security checks", check["action"])

    def test_expired_certificate_points_at_the_clock(self) -> None:
        error = cert_error("certificate has expired")
        self.assertEqual(diagnostics.check_tls(probe("tls", error))["code"], "clock_wrong")
        self.assertEqual(diagnostics.check_clock(probe("tls", error))["code"], "clock_wrong")

    def test_connection_failures(self) -> None:
        check = diagnostics.check_tls(probe("connect", ConnectionRefusedError(111, "Connection refused")))
        self.assertEqual((check["status"], check["code"]), ("fail", "network_unreachable"))
        check = diagnostics.check_tls(probe("connect", socket.timeout("timed out")))
        self.assertEqual(check["code"], "network_timeout")
        self.assertEqual(diagnostics.check_tls(probe("proxy", OSError("x")))["status"], "skip")

    def test_clock_skew(self) -> None:
        now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)

        def at(offset: timedelta) -> dict:
            return probe(date=format_datetime(now - offset, usegmt=True))

        self.assertEqual(diagnostics.check_clock(at(timedelta(seconds=4)), now)["status"], "pass")
        check = diagnostics.check_clock(at(timedelta(minutes=2)), now)
        self.assertEqual(check["status"], "warn")
        self.assertIn("2 minutes ahead of", check["detail"])
        check = diagnostics.check_clock(at(timedelta(hours=-3)), now)
        self.assertEqual((check["status"], check["code"]), ("fail", "clock_wrong"))
        self.assertIn("behind", check["detail"])
        self.assertEqual(diagnostics.check_clock(probe("connect", OSError("x")))["status"], "skip")

    def test_proxy_check(self) -> None:
        with mock.patch.dict(os.environ, {name: "" for name in diagnostics.PROXY_VARIABLES}):
            self.assertEqual(diagnostics.check_proxy(probe())["status"], "skip")
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": "http://proxy.example:3128"}):
            self.assertEqual(diagnostics.check_proxy(probe(proxy="http://proxy.example:3128"))["status"], "pass")
            # NO_PROXY: set, but not used for slack.com.
            self.assertEqual(diagnostics.check_proxy(probe())["status"], "pass")
            failed = diagnostics.check_proxy(
                probe("proxy", diagnostics.ProxyConnectError("the proxy wants a user name and password (HTTP 407)"), proxy="http://proxy.example:3128")
            )
        self.assertEqual((failed["status"], failed["code"]), ("fail", "proxy_failed"))
        self.assertIn("407", failed["detail"])

    def test_proxy_address_never_shows_a_password(self) -> None:
        shown = diagnostics.proxy_display("http://alice:hunter2@proxy.example:3128")
        self.assertEqual(shown, "http://proxy.example:3128")


class FakeProxy:
    """Answers one CONNECT with ``reply`` and records what it was sent."""

    def __init__(self, reply: bytes) -> None:
        self.reply = reply
        self.received = b""
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        try:
            conn, _ = self.server.accept()
        except OSError:
            return
        with conn:
            conn.settimeout(5)
            while b"\r\n\r\n" not in self.received:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                self.received += chunk
            conn.sendall(self.reply)

    def close(self) -> None:
        self.server.close()
        self.thread.join(timeout=5)


class ProxyProbeTests(TempDirs):
    def test_proxy_that_wants_a_login(self) -> None:
        proxy = FakeProxy(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
        self.addCleanup(proxy.close)
        url = f"http://alice:hunter2@127.0.0.1:{proxy.port}"
        with mock.patch.object(diagnostics, "proxy_for", return_value=url):
            result = diagnostics.probe_slack(timeout=3)
        self.assertEqual(result["stage"], "proxy")
        self.assertNotIn("hunter2", result["proxy"])
        proxy.thread.join(timeout=5)
        self.assertTrue(proxy.received.startswith(b"CONNECT slack.com:443 HTTP/1.1"))
        self.assertIn(b"Proxy-Authorization: Basic", proxy.received)
        with mock.patch.dict(os.environ, {"HTTPS_PROXY": url}):
            check = diagnostics.check_proxy(result)
        self.assertEqual(check["code"], "proxy_failed")
        self.assertNotIn("hunter2", json.dumps(check))

    def test_proxy_that_is_not_there(self) -> None:
        with socket.socket() as spare:
            spare.bind(("127.0.0.1", 0))
            port = spare.getsockname()[1]
        with mock.patch.object(diagnostics, "proxy_for", return_value=f"http://127.0.0.1:{port}"):
            result = diagnostics.probe_slack(timeout=3)
        self.assertEqual(result["stage"], "proxy")
        self.assertIn("could not connect to the proxy", str(result["error"]))


class _TLSServer:
    """A one-request-at-a-time TLS server on 127.0.0.1 that records requests."""

    def __init__(self, cert: Path, key: Path) -> None:
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(cert, key)
        self.requests: list[bytes] = []
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(5)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        while True:
            try:
                raw, _ = self.server.accept()
            except OSError:
                return
            try:
                raw.settimeout(5)
                with self.context.wrap_socket(raw, server_side=True) as conn:
                    data = b""
                    while b"\r\n\r\n" not in data:
                        chunk = conn.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                    self.requests.append(data)
                    date = format_datetime(datetime.now(timezone.utc), usegmt=True)
                    conn.sendall(f"HTTP/1.1 200 OK\r\nDate: {date}\r\nContent-Length: 0\r\n\r\n".encode())
            except (OSError, ssl.SSLError):
                pass
            finally:
                raw.close()

    def close(self) -> None:
        self.server.close()
        self.thread.join(timeout=5)


@unittest.skipUnless(OPENSSL, "the openssl command is needed to make test certificates")
class TLSProbeTests(TempDirs):
    @classmethod
    def setUpClass(cls) -> None:
        cls.certs_dir = tempfile.TemporaryDirectory()
        cls.certs = make_certificates(Path(cls.certs_dir.name))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.certs_dir.cleanup()

    def setUp(self) -> None:
        super().setUp()
        self.server = _TLSServer(self.certs["cert"], self.certs["key"])
        self.addCleanup(self.server.close)
        self.save(workspace())

    def test_untrusted_server_is_reported_as_tls_untrusted(self) -> None:
        with no_cert_env(), mock.patch.object(diagnostics, "proxy_for", return_value=None):
            result = diagnostics.probe_slack("localhost", self.server.port, timeout=3)
        self.assertEqual(result["stage"], "tls")
        check = diagnostics.check_tls(result)
        self.assertEqual((check["status"], check["code"]), ("fail", "tls_untrusted"))

    def test_trusted_server_works_and_no_login_is_sent(self) -> None:
        env = {"SSL_CERT_FILE": str(self.certs["ca"])}
        with no_cert_env(), mock.patch.dict(os.environ, env), mock.patch.object(diagnostics, "proxy_for", return_value=None):
            result = diagnostics.probe_slack("localhost", self.server.port, timeout=3)
        self.assertIsNone(result["error"])
        self.assertEqual(result["stage"], "done")
        self.assertTrue(result["date"])
        self.assertEqual(diagnostics.check_tls(result)["status"], "pass")
        self.assertEqual(diagnostics.check_clock(result)["status"], "pass")
        sent = b"".join(self.server.requests)
        self.assertTrue(sent.startswith(b"HEAD /api/api.test HTTP/1.1"))
        for secret in (XOXC.encode(), XOXD.encode(), b"Cookie", b"Authorization", b"token"):
            self.assertNotIn(secret, sent)


class SlowNetworkTests(TempDirs):
    def test_a_slow_sender_cannot_stretch_the_read_past_the_deadline(self) -> None:
        left, right = socket.socketpair()
        self.addCleanup(left.close)
        self.addCleanup(right.close)
        stop = threading.Event()

        def drip() -> None:
            while not stop.is_set():
                try:
                    right.sendall(b"x")
                except OSError:
                    return
                time.sleep(0.05)

        threading.Thread(target=drip, daemon=True).start()
        self.addCleanup(stop.set)
        started = time.monotonic()
        with self.assertRaises(socket.timeout):
            diagnostics._read_head(left, limit=10**9, deadline=diagnostics._Deadline(0.5))
        self.assertLess(time.monotonic() - started, 3)

    def test_probe_has_one_overall_deadline(self) -> None:
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        self.addCleanup(server.close)
        port = server.getsockname()[1]
        with mock.patch.object(diagnostics, "proxy_for", return_value=None):
            started = time.monotonic()
            # The server accepts but never answers the TLS handshake.
            result = diagnostics.probe_slack("127.0.0.1", port, timeout=5, total=0.6)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(result["stage"], "tls")
        self.assertEqual(diagnostics.errors.classify(result["error"]), "network_timeout")

    def test_a_hanging_lookup_is_not_started_twice(self) -> None:
        release = threading.Event()
        calls = []

        def hang() -> None:
            calls.append(1)
            release.wait(5)

        self.addCleanup(release.set)
        for _ in range(3):
            with self.assertRaises(socket.timeout):
                diagnostics._with_timeout(hang, 0.05, key="hang.example")
        self.assertEqual(len(calls), 1)


class CacheTests(TempDirs):
    def setUp(self) -> None:
        super().setUp()
        diagnostics.clear_cache()
        self.addCleanup(diagnostics.clear_cache)

    def test_one_run_at_a_time_and_callers_share_it(self) -> None:
        started = threading.Event()
        finish = threading.Event()
        runs = []

        def slow_run(network: bool = True) -> dict:
            runs.append(1)
            started.set()
            finish.wait(5)
            return {"generated_at": "now", "checks": []}

        results = []
        with mock.patch.object(diagnostics, "run_checks", side_effect=slow_run):
            threads = [threading.Thread(target=lambda: results.append(diagnostics.cached_checks())) for _ in range(5)]
            for thread in threads:
                thread.start()
            started.wait(5)
            time.sleep(0.2)
            finish.set()
            for thread in threads:
                thread.join(5)
            self.assertEqual(len(runs), 1)
            self.assertEqual(len(results), 5)
            # Within the cache time, nothing runs again ...
            diagnostics.cached_checks()
            self.assertEqual(len(runs), 1)
            # ... and a "fresh" request still waits a few seconds.
            diagnostics.cached_checks(max_age=diagnostics.FRESH_SECONDS)
            self.assertEqual(len(runs), 1)
            diagnostics.cached_checks(max_age=0)
            self.assertEqual(len(runs), 2)

    def test_busy_when_a_run_takes_too_long(self) -> None:
        started = threading.Event()
        finish = threading.Event()

        def slow_run(network: bool = True) -> dict:
            started.set()
            finish.wait(5)
            return {"generated_at": "now", "checks": []}

        with mock.patch.object(diagnostics, "run_checks", side_effect=slow_run):
            first = threading.Thread(target=diagnostics.cached_checks)
            first.start()
            started.wait(5)
            with self.assertRaises(diagnostics.DiagnosticsBusy):
                diagnostics.cached_checks(wait=0.1)
            finish.set()
            first.join(5)


class ReportTests(TempDirs):
    def test_report_never_contains_a_token_code_or_cookie(self) -> None:
        self.save(workspace(), workspace("T2", "Other", xoxc="xoxc-2222-other-token", xoxd="xoxd-other-cookie"))
        web._write_code(CODE)
        log_lines = [
            f"2026-11-20 10:00:00 INFO [Acme] connected with token={XOXC}&x=1",
            f"2026-11-20 10:00:01 WARNING [Acme] Cookie: d={XOXD}; d-s=123",
            "2026-11-20 10:00:02 WARNING [Acme] header Authorization: Bearer xoxc-9999-leaked",
            f"2026-11-20 10:00:03 INFO access code {CODE} and {CODE.lower()}",
            "2026-11-20 10:00:04 INFO wss://wss-primary.slack.com/?token=abc123notprefixed",
            "2026-11-20 10:00:05 INFO proxy http://bob:pa55word@proxy.example:3128 failed",
            "2026-11-20 10:00:06 INFO SG-WXYZ-2345-6789 old code",
            "2026-11-20 10:00:07 INFO raw cookie d=xoxd-raw%2Bvalue in text",
        ]
        config.LOG_PATH.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
        result = diagnostics.run_checks(network=False)
        text = diagnostics.report_text(result)
        for secret in (
            XOXC, XOXD, "xoxd-diag", "xoxc-2222", "xoxd-other", "xoxc-9999", CODE, CODE.lower(),
            "abc123notprefixed", "pa55word", "SG-WXYZ-2345-6789", "xoxd-raw", "d-s=123",
        ):
            self.assertNotIn(secret, text)
        self.assertIn("[redacted", text)
        self.assertIn("Stillgreen diagnostics report", text)
        self.assertIn("Operating system:", text)
        self.assertIn("[pass] Python" if sys.version_info >= (3, 10) else "[warn] Python", text)
        self.assertNotIn(str(Path.home()) + "/", text.replace("~/", ""))

    def test_custom_access_code_from_the_environment_is_removed(self) -> None:
        custom = "my-long-custom-bridge-code-42"
        with mock.patch.dict(os.environ, {"SG_LOCAL_BRIDGE_CODE": custom}):
            config.LOG_PATH.write_text(f"2026-11-20 10:00:00 INFO using {custom}\n", encoding="utf-8")
            text = diagnostics.report_text(diagnostics.run_checks(network=False))
        self.assertNotIn(custom, text)

    def test_damaged_settings_file_still_keeps_its_tokens_out(self) -> None:
        token = "xoxc-5555-corrupt-token-value"
        cookie = "xoxd-corrupt%2Fcookie%3Dvalue"
        bare = "plain-cookie-without-prefix-777"
        config.CONFIG_PATH.write_text(
            '{"workspaces": [{"name": "Acme", "xoxc": "%s", "xoxd": "%s"}, {"d": "%s"}' % (token, cookie, bare),
            encoding="utf-8",
        )
        config.LOG_PATH.write_text(
            "\n".join([
                f"2026-11-20 10:00:00 WARNING [Acme] saw {token} somewhere",
                f"2026-11-20 10:00:01 WARNING [Acme] cookie value {cookie}",
                "2026-11-20 10:00:02 WARNING [Acme] cookie part " + cookie.removeprefix("xoxd-"),
                f"2026-11-20 10:00:03 WARNING [Acme] value {bare} seen",
                '2026-11-20 10:00:04 WARNING [Acme] "xoxd": "' + cookie.removeprefix("xoxd-") + '"',
            ]) + "\n",
            encoding="utf-8",
        )
        result = diagnostics.run_checks(network=False)
        self.assertEqual(next(c for c in result["checks"] if c["id"] == "config")["status"], "fail")
        text = diagnostics.report_text(result)
        for secret in (token, cookie, cookie.removeprefix("xoxd-"), "corrupt%2Fcookie", bare, "5555-corrupt"):
            self.assertNotIn(secret, text)
        self.assertNotIn(token, json.dumps(result))

    def test_short_access_code_from_the_environment_is_removed(self) -> None:
        with mock.patch.dict(os.environ, {"SG_LOCAL_BRIDGE_CODE": "q7"}):
            config.LOG_PATH.write_text("2026-11-20 10:00:00 INFO code is q7 today\n", encoding="utf-8")
            text = diagnostics.report_text(diagnostics.run_checks(network=False))
        self.assertNotIn(" q7 ", text)
        self.assertIn("Stillgreen diagnostics report", text)  # ordinary words are left alone

    def test_check_text_goes_through_the_redactor(self) -> None:
        leaky = diagnostics._check("workspaces", "warn", "boom token=xoxc-7777-leak d=xoxd-leak", "Bearer abc.def")
        with mock.patch.object(diagnostics, "check_workspaces", return_value=leaky):
            result = diagnostics.run_checks(network=False)
        text = json.dumps(result)
        for secret in ("xoxc-7777-leak", "xoxd-leak", "abc.def"):
            self.assertNotIn(secret, text)

    def test_redaction_helpers(self) -> None:
        cleaned = diagnostics.redact_report("token=abc&d=xoxd-zzz Bearer xyz SG-AAAA-BBBB-CCCC", secrets=[])
        for secret in ("abc", "xoxd-zzz", "xyz", "SG-AAAA-BBBB-CCCC"):
            self.assertNotIn(secret, cleaned)


if __name__ == "__main__":
    unittest.main()
