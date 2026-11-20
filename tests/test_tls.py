"""TLS: every connection checks certificates, and extra trusted ones can be added.

The tests make a private certificate authority and a server certificate for
127.0.0.1 with the ``openssl`` command (skipped where it is missing), then
run a small HTTPS server and a WSS server on loopback. No network access.
"""

from __future__ import annotations

import http.server
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import websockets

from sg_local import errors, slack, tls

OPENSSL = shutil.which("openssl")
CERT_ENV = ("SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE")


def _openssl(*args: str, cwd: Path) -> None:
    subprocess.run([OPENSSL or "openssl", *args], cwd=cwd, check=True, capture_output=True)


def make_certificates(folder: Path) -> dict[str, Path]:
    """A test CA and a 127.0.0.1 server certificate signed by it."""
    (folder / "server.ext").write_text(
        "basicConstraints=critical,CA:FALSE\n"
        "keyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
        "subjectAltName=IP:127.0.0.1,DNS:localhost\n",
        encoding="utf-8",
    )
    (folder / "ca.ext").write_text(
        "basicConstraints=critical,CA:TRUE\n"
        "keyUsage=critical,keyCertSign,cRLSign\n"
        "subjectKeyIdentifier=hash\n",
        encoding="utf-8",
    )
    _openssl("genrsa", "-out", "ca.key", "2048", cwd=folder)
    _openssl("req", "-new", "-key", "ca.key", "-subj", "/CN=Stillgreen Test CA", "-out", "ca.csr", cwd=folder)
    _openssl(
        "x509", "-req", "-in", "ca.csr", "-signkey", "ca.key", "-days", "30", "-sha256",
        "-extfile", "ca.ext", "-out", "ca.crt", cwd=folder,
    )
    _openssl("genrsa", "-out", "server.key", "2048", cwd=folder)
    _openssl("req", "-new", "-key", "server.key", "-subj", "/CN=127.0.0.1", "-out", "server.csr", cwd=folder)
    _openssl(
        "x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
        "-CAcreateserial", "-days", "30", "-sha256", "-extfile", "server.ext",
        "-out", "server.crt", cwd=folder,
    )
    return {"ca": folder / "ca.crt", "cert": folder / "server.crt", "key": folder / "server.key"}


class _SlackHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        body = json.dumps({"ok": True, "team_id": "T1", "user_id": "U1"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST

    def log_message(self, format: str, *args: object) -> None:
        pass


def _no_cert_env() -> Any:
    """Run with none of the certificate environment variables set."""
    clean = {key: value for key, value in os.environ.items() if key not in CERT_ENV}
    return mock.patch.dict(os.environ, clean, clear=True)


class ContextTests(unittest.TestCase):
    def test_context_always_verifies(self) -> None:
        with _no_cert_env():
            context = tls.create_ssl_context()
        self.assertIsInstance(context, ssl.SSLContext)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_fallback_context_always_verifies(self) -> None:
        with _no_cert_env(), mock.patch.object(tls, "_truststore", return_value=None):
            context = tls.create_ssl_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_uses_truststore_when_installed(self) -> None:
        try:
            import truststore
        except ImportError:
            self.skipTest("truststore is not installed (it needs Python 3.10+)")
        with _no_cert_env():
            context = tls.create_ssl_context()
        self.assertIsInstance(context, truststore.SSLContext)
        self.assertEqual(tls.trust_source()["source"], "system")

    def test_slack_client_uses_the_helper(self) -> None:
        sentinel = ssl.create_default_context()
        with mock.patch.object(slack, "create_ssl_context", return_value=sentinel):
            client = slack.SlackClient("xoxc-a", "xoxd-b")
        self.assertIs(client.ssl_context, sentinel)

    def test_trust_source_lists_extra_files_not_contents(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as handle:
            handle.write("not a certificate")
        self.addCleanup(os.unlink, handle.name)
        with _no_cert_env(), mock.patch.dict(os.environ, {"REQUESTS_CA_BUNDLE": handle.name}):
            info = tls.trust_source()
            # An unreadable extra file is skipped, never fatal.
            context = tls.create_ssl_context()
        self.assertEqual(info["extra_files"], [handle.name])
        self.assertTrue(context.check_hostname)

    def test_no_switch_turns_verification_off(self) -> None:
        source = Path(tls.__file__).read_text(encoding="utf-8")
        self.assertNotIn("CERT_NONE", source)
        self.assertNotIn("check_hostname = False", source)


@unittest.skipUnless(OPENSSL, "the openssl command is needed to make test certificates")
class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        cls.certs = make_certificates(Path(cls.temp.name))
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cls.certs["cert"], cls.certs["key"])
        cls.server_context = server_context
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SlackHandler)
        cls.httpd.socket = server_context.wrap_socket(cls.httpd.socket, server_side=True)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.temp.cleanup()

    def _client(self) -> slack.SlackClient:
        return slack.SlackClient("xoxc-secret-token", "xoxd-secret-cookie", "U1")

    def _api(self) -> Any:
        return mock.patch.object(slack, "API_BASE", f"https://127.0.0.1:{self.port}/api")

    def test_untrusted_certificate_is_rejected(self) -> None:
        with _no_cert_env():
            context = tls.create_ssl_context()
        import socket

        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                with context.wrap_socket(raw, server_hostname="127.0.0.1"):
                    pass

    def test_untrusted_certificate_is_rejected_without_truststore(self) -> None:
        import socket

        with _no_cert_env(), mock.patch.object(tls, "_truststore", return_value=None):
            context = tls.create_ssl_context()
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as raw:
            with self.assertRaises(ssl.SSLCertVerificationError):
                with context.wrap_socket(raw, server_hostname="127.0.0.1"):
                    pass

    def test_slack_client_reports_untrusted_certificate_in_plain_english(self) -> None:
        with _no_cert_env(), self._api():
            client = self._client()
            with self.assertRaises(slack.SlackAPIError) as caught:
                client.auth_test()
        self.assertIsInstance(caught.exception.cause, ssl.SSLCertVerificationError)
        info = errors.explain(caught.exception)
        self.assertEqual(info["code"], "tls_untrusted")
        self.assertIn("Do not turn off security checks", info["action"])
        for secret in ("xoxc-secret-token", "xoxd-secret-cookie"):
            self.assertNotIn(secret, str(caught.exception))
            self.assertNotIn(secret, json.dumps(info))

    def test_company_certificate_from_ssl_cert_file_is_trusted(self) -> None:
        with _no_cert_env(), mock.patch.dict(os.environ, {"SSL_CERT_FILE": str(self.certs["ca"])}), self._api():
            client = self._client()
            result = client.auth_test()
        self.assertEqual(result["team_id"], "T1")

    def test_company_certificate_from_requests_ca_bundle_without_truststore(self) -> None:
        with _no_cert_env(), mock.patch.dict(
            os.environ, {"REQUESTS_CA_BUNDLE": str(self.certs["ca"])}
        ), mock.patch.object(tls, "_truststore", return_value=None), self._api():
            result = self._client().auth_test()
        self.assertTrue(result["ok"])

    def test_macos_keychain_certificates_are_used_without_truststore(self) -> None:
        pem = self.certs["ca"].read_text(encoding="utf-8")
        fake = subprocess.CompletedProcess(args=[], returncode=0, stdout=pem, stderr="")
        tls._macos_keychain_pem.cache_clear()
        self.addCleanup(tls._macos_keychain_pem.cache_clear)
        with _no_cert_env(), mock.patch.object(tls, "_truststore", return_value=None), mock.patch.object(
            tls, "_on_macos", return_value=True
        ), mock.patch.object(tls.os.path, "exists", return_value=True), mock.patch.object(
            tls.subprocess, "run", return_value=fake
        ) as run, self._api():
            result = self._client().auth_test()
        self.assertTrue(result["ok"])
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(["/usr/bin/security", "find-certificate", "-a", "-p", tls.SYSTEM_ROOTS_KEYCHAIN], commands)


class MinimumVersionTests(unittest.TestCase):
    def test_old_tls_is_turned_off_where_a_minimum_cannot_be_set(self) -> None:
        class OldContext(ssl.SSLContext):
            @property
            def minimum_version(self) -> Any:  # type: ignore[override]
                return ssl.TLSVersion.MINIMUM_SUPPORTED

            @minimum_version.setter
            def minimum_version(self, value: Any) -> None:
                raise ValueError("unsupported protocol")

        context = tls._require_verification(OldContext(ssl.PROTOCOL_TLS_CLIENT))
        for flag in ("OP_NO_TLSv1", "OP_NO_TLSv1_1"):
            self.assertTrue(context.options & getattr(ssl, flag), flag)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_minimum_is_tls_1_2(self) -> None:
        with _no_cert_env(), mock.patch.object(tls, "_truststore", return_value=None):
            context = tls.create_ssl_context()
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)


@unittest.skipUnless(OPENSSL, "the openssl command is needed to make test certificates")
class MacKeychainTrustTests(unittest.TestCase):
    """Python 3.9 on a Mac: which keychain certificates count as trusted."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        (root / "a").mkdir()
        (root / "b").mkdir()
        cls.apple_root = make_certificates(root / "a")["ca"].read_text(encoding="utf-8")
        cls.company = make_certificates(root / "b")["ca"].read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def setUp(self) -> None:
        tls._macos_keychain_pem.cache_clear()
        self.addCleanup(tls._macos_keychain_pem.cache_clear)

    @staticmethod
    def sha1(pem: str) -> str:
        import hashlib

        return hashlib.sha1(ssl.PEM_cert_to_DER_cert(pem)).hexdigest().upper()

    def keychains(self, admin: dict | None = None, system: dict | None = None) -> Any:
        """Fake ``security``: the two keychains and the trust settings."""
        calls: list[list[str]] = []

        def run(args: list[str], **_: Any) -> subprocess.CompletedProcess:
            calls.append(list(args))
            if args[1] == "find-certificate":
                pem = {tls.SYSTEM_ROOTS_KEYCHAIN: self.apple_root, tls.ADMIN_KEYCHAIN: self.company}[args[-1]]
                return subprocess.CompletedProcess(args, 0, stdout=pem, stderr="")
            settings = {"-d": admin, "-s": system}[args[2]]
            if settings is None:
                return subprocess.CompletedProcess(args, 1, stdout="", stderr="No Trust Settings were found.")
            import plistlib

            Path(args[3]).write_bytes(plistlib.dumps({"trustList": settings, "trustVersion": 1}))
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

        patches = [
            mock.patch.object(tls, "_on_macos", return_value=True),
            mock.patch.object(tls.os.path, "exists", return_value=True),
            mock.patch.object(tls.subprocess, "run", side_effect=run),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return calls

    def test_apple_roots_are_used_but_not_untrusted_system_keychain_certificates(self) -> None:
        self.keychains(admin=None)
        pem = tls._macos_keychain_pem()
        self.assertIn(self.apple_root.strip(), pem)
        self.assertNotIn(self.company.strip(), pem)

    def test_admin_always_trust_for_ssl_is_used(self) -> None:
        ssl_policy = bytes.fromhex("2A864886F763640103")  # 1.2.840.113635.100.1.3
        for settings in (
            [],
            [{"kSecTrustSettingsPolicy": ssl_policy, "kSecTrustSettingsResult": 1}],
            [{"kSecTrustSettingsPolicyName": "sslServer", "kSecTrustSettingsResult": 2}],
        ):
            with self.subTest(settings=settings):
                tls._macos_keychain_pem.cache_clear()
                self.keychains(admin={self.sha1(self.company): {"trustSettings": settings}})
                self.assertIn(self.company.strip(), tls._macos_keychain_pem())

    def test_never_trust_and_other_policies_are_not_used(self) -> None:
        smime = bytes.fromhex("2A864886F763640108")  # 1.2.840.113635.100.1.8 (S/MIME)
        for settings in (
            [{"kSecTrustSettingsResult": 3}],
            [{"kSecTrustSettingsPolicy": smime, "kSecTrustSettingsResult": 1}],
            [{"kSecTrustSettingsResult": 4}],
        ):
            with self.subTest(settings=settings):
                tls._macos_keychain_pem.cache_clear()
                self.keychains(admin={self.sha1(self.company): {"trustSettings": settings}})
                self.assertNotIn(self.company.strip(), tls._macos_keychain_pem())

    def test_apple_root_marked_never_trust_is_dropped(self) -> None:
        self.keychains(admin={self.sha1(self.apple_root): {"trustSettings": [{"kSecTrustSettingsResult": 3}]}})
        self.assertNotIn(self.apple_root.strip(), tls._macos_keychain_pem())

    def test_keychains_are_read_once_and_loaded_in_one_call(self) -> None:
        calls = self.keychains(admin={self.sha1(self.company): {"trustSettings": []}})
        with _no_cert_env(), mock.patch.object(tls, "_truststore", return_value=None):
            for _ in range(3):
                tls.create_ssl_context()
            reads = len(calls)
            with mock.patch.object(ssl.SSLContext, "load_verify_locations") as load:
                tls.create_ssl_context()
        self.assertEqual(len(calls), reads)
        self.assertLessEqual(reads, 4)
        cadata_calls = [call for call in load.call_args_list if call.kwargs.get("cadata")]
        self.assertEqual(len(cadata_calls), 1)
        self.assertIn(self.company.strip(), cadata_calls[0].kwargs["cadata"])


@unittest.skipUnless(OPENSSL, "the openssl command is needed to make test certificates")
class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.certs = make_certificates(Path(self.temp.name))
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(self.certs["cert"], self.certs["key"])

        async def handler(ws: object) -> None:
            await ws.send(json.dumps({"type": "hello"}))  # type: ignore[attr-defined]

        self.server = await websockets.serve(handler, "127.0.0.1", 0, ssl=server_context)
        self.port = next(iter(self.server.sockets)).getsockname()[1]

    async def asyncTearDown(self) -> None:
        self.server.close()
        await self.server.wait_closed()
        self.temp.cleanup()

    async def test_wss_rejects_untrusted_certificate(self) -> None:
        with _no_cert_env():
            context = tls.create_ssl_context()
        with self.assertRaises(ssl.SSLCertVerificationError) as caught:
            await websockets.connect(f"wss://127.0.0.1:{self.port}/", ssl=context, open_timeout=5)
        self.assertEqual(errors.explain(caught.exception)["code"], "tls_untrusted")

    async def test_wss_accepts_company_certificate(self) -> None:
        with _no_cert_env(), mock.patch.dict(os.environ, {"SSL_CERT_FILE": str(self.certs["ca"])}):
            context = tls.create_ssl_context()
        ws = await websockets.connect(f"wss://127.0.0.1:{self.port}/", ssl=context, open_timeout=5)
        try:
            self.assertEqual(json.loads(await ws.recv())["type"], "hello")
        finally:
            await ws.close()

    async def test_presence_session_passes_the_context_to_websockets(self) -> None:
        session = slack.PresenceSession(
            {"name": "T", "team_id": "T1", "user_id": "U1", "xoxc": "xoxc-a", "xoxd": "xoxd-b"}
        )
        with mock.patch.object(
            slack.websockets, "connect", mock.AsyncMock(side_effect=OSError("stop"))
        ) as connect:
            self.assertFalse(await session._connect())
        self.assertIs(connect.call_args.kwargs["ssl"], session.client.ssl_context)
        self.assertTrue(connect.call_args.args[0].startswith("wss://"))


if __name__ == "__main__":
    unittest.main()
