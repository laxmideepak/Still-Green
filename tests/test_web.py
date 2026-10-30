"""Tests for the local/cloud control surface."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from sg_local import config, state, web


class WebTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.config_dir = root / "config"
        self.state_dir = root / "state"
        self.patches = [
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
            mock.patch.dict(os.environ, {"SG_LOCAL_BRIDGE_CODE": ""}, clear=False),
        ]
        for patch in self.patches:
            patch.start()
        config.ensure_dirs()
        self.code = web.load_code()
        self.server = web.make_server("127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        for patch in reversed(self.patches):
            patch.stop()
        self.temp.cleanup()

    def request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict | None = None,
        code: str | None = None,
        origin: str | None = None,
    ) -> tuple[int, dict | str, dict[str, str]]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}
        if code is not None:
            headers["Authorization"] = f"Bearer {code}"
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(
            self.base + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                raw = response.read().decode()
                return response.status, self._decode(raw), dict(response.headers)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            return exc.code, self._decode(raw), dict(exc.headers)

    @staticmethod
    def _decode(raw: str) -> dict | str:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    def write_config(self, workspaces: list[dict] | None = None) -> None:
        cfg = config.default_config()
        cfg["workspaces"] = workspaces or []
        config.save_config(cfg)


class AuthTests(WebTestCase):
    def test_health_is_public(self) -> None:
        status, body, _ = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["app"], "stillgreen")

    def test_state_requires_code(self) -> None:
        status, body, _ = self.request("/api/state")
        self.assertEqual(status, 401)
        self.assertFalse(body["ok"])

    def test_state_accepts_code(self) -> None:
        self.write_config()
        status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["workspaces"], [])

    def test_bad_code_is_rejected(self) -> None:
        status, _, _ = self.request("/api/state", code="SG-WRONG-WRONG-WRONG")
        self.assertEqual(status, 401)

    def test_cors_allows_vercel_and_localhost(self) -> None:
        status, _, headers = self.request(
            "/api/health", origin="https://stillgreen-demo.vercel.app"
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            headers.get("Access-Control-Allow-Origin"),
            "https://stillgreen-demo.vercel.app",
        )
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")

        status, _, headers = self.request("/api/health", origin="http://localhost:3000")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:3000")

    def test_cors_rejects_unknown_origin(self) -> None:
        status, _, headers = self.request("/api/health", origin="https://example.com")
        self.assertEqual(status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_unknown_origin_cannot_mutate_even_with_code(self) -> None:
        status, body, _ = self.request(
            "/api/pause",
            method="POST",
            body={"duration": "1h"},
            code=self.code,
            origin="https://example.com",
        )
        self.assertEqual(status, 403)
        self.assertIn("origin", body["error"])


class StateTests(WebTestCase):
    def test_state_never_contains_tokens(self) -> None:
        self.write_config(
            [
                {
                    "name": "Fieldwork",
                    "team_id": "T123",
                    "user_id": "U123",
                    "xoxc": "xoxc-secret-value",
                    "xoxd": "xoxd-secret-value",
                }
            ]
        )
        status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 200)
        rendered = json.dumps(body)
        self.assertNotIn("xoxc-secret-value", rendered)
        self.assertNotIn("xoxd-secret-value", rendered)
        self.assertEqual(body["workspaces"][0]["name"], "Fieldwork")
        self.assertEqual(body["workspaces"][0]["status"], "daemon_stopped")

    def test_schedule_update(self) -> None:
        status, body, _ = self.request(
            "/api/schedule",
            method="POST",
            code=self.code,
            body={
                "mode": "scheduled",
                "active_days": ["monday", "tuesday"],
                "start_time": "08:30",
                "end_time": "16:45",
                "timezone": "UTC",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["schedule"]["mode"], "scheduled")
        self.assertEqual(body["schedule"]["start_time"], "08:30")
        saved = config.load_config()
        self.assertEqual(saved["schedule"]["active_days"], ["monday", "tuesday"])

    def test_schedule_rejects_bad_timezone(self) -> None:
        status, body, _ = self.request(
            "/api/schedule",
            method="POST",
            code=self.code,
            body={"mode": "scheduled", "timezone": "Mars/Olympus"},
        )
        self.assertEqual(status, 400)
        self.assertIn("timezone", body["error"])

    def test_pause_and_resume(self) -> None:
        status, body, _ = self.request(
            "/api/pause", method="POST", code=self.code, body={"duration": "1h"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["paused"])
        self.assertIsNotNone(config.read_pause())

        status, body, _ = self.request(
            "/api/resume", method="POST", code=self.code, body={}
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["paused"])
        self.assertIsNone(config.read_pause())

    def test_stay_override(self) -> None:
        status, body, _ = self.request(
            "/api/stay", method="POST", code=self.code, body={"duration": "30m"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["stay_active"])
        until = datetime.fromisoformat(body["stay_until"])
        self.assertGreater(until, datetime.now(timezone.utc))

        status, body, _ = self.request(
            "/api/stay", method="POST", code=self.code, body={"cancel": True}
        )
        self.assertEqual(status, 200)
        self.assertFalse(body["stay_active"])

    def test_add_workspace_verifies_and_stores_tokens(self) -> None:
        with mock.patch.object(web, "SlackClient") as client:
            client.return_value.auth_test.return_value = {
                "ok": True,
                "team_id": "T999",
                "user_id": "U999",
                "team": "Acme",
            }
            status, body, _ = self.request(
                "/api/workspaces",
                method="POST",
                code=self.code,
                body={"xoxc": "xoxc-abc", "xoxd": "xoxd-def"},
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["name"], "Acme")
        saved = config.load_config()["workspaces"][0]
        self.assertEqual(saved["xoxc"], "xoxc-abc")
        self.assertEqual(saved["xoxd"], "xoxd-def")
        self.assertNotIn("xoxc", json.dumps(body))

    def test_add_workspace_rejects_bad_prefix(self) -> None:
        status, body, _ = self.request(
            "/api/workspaces",
            method="POST",
            code=self.code,
            body={"xoxc": "nope", "xoxd": "xoxd-def"},
        )
        self.assertEqual(status, 400)
        self.assertIn("xoxc", body["error"])

    def test_remove_workspace(self) -> None:
        self.write_config(
            [
                {
                    "name": "Fieldwork",
                    "team_id": "T123",
                    "user_id": "U123",
                    "xoxc": "xoxc-abc",
                    "xoxd": "xoxd-def",
                }
            ]
        )
        status, body, _ = self.request(
            "/api/workspaces/T123", method="DELETE", code=self.code
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["removed"], "Fieldwork")
        self.assertEqual(config.load_config()["workspaces"], [])


class PageTests(unittest.TestCase):
    def test_page_embeds_code_only_when_requested(self) -> None:
        embedded = web.render_page("SG-TEST-CODE", True)
        self.assertIn("SG-TEST-CODE", embedded)
        bare = web.render_page("", False)
        self.assertNotIn("SG-TEST-CODE", bare)
        self.assertIn("Enter the access code", bare)

    def test_page_has_no_inline_scripts(self) -> None:
        page = web.render_page("", False)
        self.assertNotIn("<script>", page)
        self.assertIn('src="/app.js"', page)

    def test_code_shape(self) -> None:
        code = web.generate_code()
        self.assertRegex(code, r"^SG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$")

    def test_origin_rules(self) -> None:
        with mock.patch.dict(os.environ, {"SG_LOCAL_WEB_ORIGIN": "https://stillgreen.app"}):
            self.assertTrue(web.origin_allowed("https://stillgreen.app"))
            self.assertTrue(web.origin_allowed("http://localhost:3010"))
            self.assertTrue(web.origin_allowed("https://demo.vercel.app"))
            self.assertFalse(web.origin_allowed("https://evil.example"))

    def test_extension_origins(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SG_LOCAL_ALLOW_EXTENSIONS", None)
            self.assertTrue(
                web.origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop")
            )
            self.assertFalse(web.origin_allowed("https://evil.example"))

        with mock.patch.dict(os.environ, {"SG_LOCAL_ALLOW_EXTENSIONS": "0"}):
            self.assertFalse(
                web.origin_allowed("chrome-extension://abcdefghijklmnopabcdefghijklmnop")
            )


if __name__ == "__main__":
    unittest.main()
