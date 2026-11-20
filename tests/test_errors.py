"""The error catalogue: real exceptions become plain-English steps."""

from __future__ import annotations

import asyncio
import errno
import io
import json
import socket
import ssl
import unittest
import urllib.error
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest import mock

from websockets.exceptions import InvalidStatus

from sg_local import config, errors
from sg_local.slack import SlackAPIError

CONTRACT_CODES = {
    "tls_untrusted",
    "tls_other",
    "dns_failed",
    "proxy_failed",
    "network_timeout",
    "network_unreachable",
    "slack_auth_rejected",
    "slack_rate_limited",
    "slack_unavailable",
    "port_in_use",
    "daemon_not_running",
    "access_code_wrong",
    "too_many_attempts",
    "config_unreadable",
    "python_too_old",
    "missing_dependency",
}


def invalid_status(code: int) -> InvalidStatus:
    return InvalidStatus(SimpleNamespace(status_code=code))  # type: ignore[arg-type]


def cert_error(message: str = "certificate verify failed: self-signed certificate in certificate chain") -> ssl.SSLCertVerificationError:
    exc = ssl.SSLCertVerificationError(1, f"[SSL: CERTIFICATE_VERIFY_FAILED] {message}")
    exc.verify_message = message.split(": ", 1)[-1]
    return exc


class CatalogueTests(unittest.TestCase):
    def test_contract_codes_are_present(self) -> None:
        self.assertLessEqual(CONTRACT_CODES, set(errors.CATALOGUE))

    def test_every_entry_is_complete_and_short(self) -> None:
        for code, item in errors.CATALOGUE.items():
            with self.subTest(code=code):
                self.assertEqual(set(item), {"title", "message", "action"})
                for field, text in item.items():
                    self.assertTrue(text.strip(), field)
                    self.assertNotIn("\n", text)
                self.assertLessEqual(len(item["title"]), 50)
                self.assertTrue(item["message"].endswith("."))

    def test_never_suggests_turning_off_checks(self) -> None:
        text = json.dumps(errors.CATALOGUE).lower()
        for phrase in ("verify=false", "--insecure", "--trusted-host", "ignore ssl", "disable ssl", "cert_none"):
            self.assertNotIn(phrase, text)
        self.assertIn("Do not turn off security checks", errors.CATALOGUE["tls_untrusted"]["action"])

    def test_tls_untrusted_wording(self) -> None:
        item = errors.explain("tls_untrusted")
        self.assertEqual(item["code"], "tls_untrusted")
        self.assertIn("could not check Slack's security certificate", item["message"])
        self.assertIn("computer's trusted certificates", item["action"])

    def test_unknown_code_falls_back(self) -> None:
        self.assertEqual(errors.explain("no_such_code")["code"], "unknown")
        self.assertEqual(errors.explain(None)["code"], "unknown")
        self.assertEqual(errors.explain(RuntimeError("boom"))["code"], "unknown")

    def test_entries_are_copies(self) -> None:
        item = errors.explain("dns_failed")
        item["title"] = "changed"
        self.assertNotEqual(errors.CATALOGUE["dns_failed"]["title"], "changed")


class ExceptionMappingTests(unittest.TestCase):
    def assertCode(self, exc: object, code: str, **kwargs: object) -> None:
        self.assertEqual(errors.explain(exc, **kwargs)["code"], code)  # type: ignore[arg-type]

    def test_tls(self) -> None:
        self.assertCode(cert_error(), "tls_untrusted")
        self.assertCode(cert_error("certificate verify failed: unable to get local issuer certificate"), "tls_untrusted")
        self.assertCode(cert_error("certificate verify failed: certificate has expired"), "clock_wrong")
        self.assertCode(ssl.SSLError(1, "[SSL: WRONG_VERSION_NUMBER] wrong version number"), "tls_other")
        self.assertCode(ssl.SSLError(1, "[SSL: SSLV3_ALERT_HANDSHAKE_FAILURE] handshake failure"), "tls_other")

    def test_network(self) -> None:
        self.assertCode(socket.gaierror(socket.EAI_NONAME, "nodename nor servname provided"), "dns_failed")
        self.assertCode(ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused"), "network_unreachable")
        self.assertCode(ConnectionRefusedError(errno.ECONNREFUSED, "Connection refused"), "daemon_not_running", local=True)
        self.assertCode(OSError(errno.ENETUNREACH, "Network is unreachable"), "network_unreachable")
        self.assertCode(ConnectionResetError(errno.ECONNRESET, "reset"), "network_unreachable")
        self.assertCode(TimeoutError("timed out"), "network_timeout")
        self.assertCode(asyncio.TimeoutError(), "network_timeout")
        self.assertCode(socket.timeout("timed out"), "network_timeout")
        self.assertCode(OSError("Tunnel connection failed: 407 Proxy Authentication Required"), "proxy_failed")

    def test_urllib_wrapping(self) -> None:
        self.assertCode(urllib.error.URLError(cert_error()), "tls_untrusted")
        self.assertCode(urllib.error.URLError(socket.gaierror(8, "nodename nor servname provided")), "dns_failed")
        self.assertCode(urllib.error.URLError(ConnectionRefusedError(61, "refused")), "network_unreachable")
        self.assertCode(urllib.error.URLError("Tunnel connection failed: 407"), "proxy_failed")
        self.assertCode(urllib.error.URLError("something odd"), "network_unreachable")
        http_error = urllib.error.HTTPError("https://slack.com/api/x", 503, "Unavailable", {}, io.BytesIO())  # type: ignore[arg-type]
        self.assertCode(http_error, "slack_unavailable")
        http_error.close()

    def test_websocket_handshake_status(self) -> None:
        self.assertCode(invalid_status(401), "slack_auth_rejected")
        self.assertCode(invalid_status(403), "slack_auth_rejected")
        self.assertCode(invalid_status(429), "slack_rate_limited")
        self.assertCode(invalid_status(502), "slack_unavailable")
        self.assertCode(invalid_status(407), "proxy_failed")
        self.assertCode(invalid_status(404), "slack_unavailable")

    def test_websocket_proxy_errors(self) -> None:
        proxy_error = type("ProxyError", (Exception,), {})
        invalid_proxy = type("InvalidProxyStatus", (Exception,), {})
        self.assertCode(proxy_error("failed to connect to the proxy"), "proxy_failed")
        self.assertCode(invalid_proxy("407"), "proxy_failed")

    def test_slack_api_errors(self) -> None:
        self.assertCode(SlackAPIError("invalid_auth", token_invalid=True), "slack_auth_rejected")
        self.assertCode(SlackAPIError("token_revoked"), "slack_auth_rejected")
        self.assertCode(SlackAPIError("ratelimited"), "slack_rate_limited")
        self.assertCode(SlackAPIError("Slack HTTP 429", http_status=429), "slack_rate_limited")
        self.assertCode(SlackAPIError("Slack HTTP 500", http_status=500), "slack_unavailable")
        self.assertCode(SlackAPIError("Network timeout contacting Slack", cause=socket.timeout()), "network_timeout")
        self.assertCode(SlackAPIError("Network error: x", cause=cert_error()), "tls_untrusted")
        self.assertCode(SlackAPIError("Network error: x", cause=socket.gaierror(8, "x")), "dns_failed")
        self.assertCode(SlackAPIError("missing_scope"), "unknown")

    def test_chained_exception(self) -> None:
        try:
            try:
                raise cert_error()
            except ssl.SSLError as inner:
                raise RuntimeError("wrapped") from inner
        except RuntimeError as outer:
            self.assertCode(outer, "tls_untrusted")

    def test_local_problems(self) -> None:
        self.assertCode(OSError(errno.EADDRINUSE, "Address already in use"), "port_in_use")
        self.assertCode(ModuleNotFoundError("No module named 'websockets'"), "missing_dependency")
        self.assertCode(config.ConfigError("Cannot read /x/config.json: Expecting value"), "config_unreadable")
        self.assertCode(config.ConfigError("/x is owned by another user; choose a folder you own"), "config_unreadable")

    def test_input_mistakes_keep_their_own_words(self) -> None:
        item = errors.explain(config.ConfigError("Use a duration like 30m, 2h, 1d, or 1w"))
        self.assertEqual(item["code"], "invalid_input")
        self.assertEqual(item["message"], "Use a duration like 30m, 2h, 1d, or 1w")

    def test_explanations_never_repeat_exception_text(self) -> None:
        secret = "xoxc-123-secret"
        for exc in (
            SlackAPIError(f"Network error: {secret}", cause=socket.gaierror(8, secret)),
            OSError(errno.ECONNRESET, secret),
            urllib.error.URLError(secret),
            RuntimeError(secret),
        ):
            with self.subTest(exc=type(exc).__name__):
                self.assertNotIn(secret, json.dumps(errors.explain(exc)))


class TextTests(unittest.TestCase):
    def test_classify_text(self) -> None:
        cases = {
            "SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed')": "tls_untrusted",
            "Failed to establish a new connection: [Errno 8] nodename nor servname provided, or not known": "dns_failed",
            "Temporary failure in name resolution": "dns_failed",
            "ProxyError('Cannot connect to proxy.', OSError('Tunnel connection failed: 407'))": "proxy_failed",
            "Read timed out. (read timeout=15)": "network_timeout",
            "[Errno 48] Address already in use": "port_in_use",
            "ERROR: No matching distribution found for websockets": "missing_dependency",
            "invalid_auth": "slack_auth_rejected",
            "Slack rejected the tokens during a presence check": "slack_auth_rejected",
            "WebSocket handshake failed (HTTP 503)": "slack_unavailable",
            "all fine": "unknown",
        }
        for text, code in cases.items():
            with self.subTest(text=text):
                self.assertEqual(errors.classify_text(text), code)

    def test_install_failure_explanations(self) -> None:
        tls_log = (
            "WARNING: Retrying ... SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] "
            "certificate verify failed: self-signed certificate in certificate chain'))\n"
            "ERROR: No matching distribution found for truststore==0.10.5\n"
        )
        item = errors.explain_install(tls_log)
        self.assertEqual(item["code"], "install_failed")
        self.assertEqual(item["reason"], "tls_untrusted")
        self.assertIn("pypi.org", item["message"])
        self.assertIn("PIP_CERT", item["action"])
        self.assertIn("Do not turn off security checks", item["action"])

        self.assertEqual(errors.explain_install("ERROR: something else")["code"], "install_failed")
        self.assertNotIn("reason", errors.explain_install("ERROR: something else"))
        venv = errors.explain_install("Error: ensurepip is not available")
        self.assertEqual(venv["code"], "venv_unavailable")
        self.assertIn("python3-venv", venv["action"])

    def test_command_line(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(errors.main(["dns_failed"]), 0)
        self.assertIn("Problem: Cannot find Slack on the network", out.getvalue())
        self.assertIn("What to do:", out.getvalue())

        out = io.StringIO()
        with redirect_stdout(out), mock.patch("sys.stdin", io.StringIO("Temporary failure in name resolution")):
            errors.main(["--install"])
        self.assertIn("could not look up the address of pypi.org", out.getvalue())

        out = io.StringIO()
        with redirect_stdout(out), mock.patch("sys.stdin", io.StringIO("nothing useful")):
            errors.main(["--text", "--default", "install_failed"])
        self.assertIn("Could not install", out.getvalue())


if __name__ == "__main__":
    unittest.main()
