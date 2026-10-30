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
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[int, dict | str, dict[str, str]]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json", **(extra_headers or {})}
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

    def test_cors_allows_dashboard_and_localhost(self) -> None:
        status, _, headers = self.request("/api/health", origin="https://stillgreen.vercel.app")
        self.assertEqual(status, 200)
        self.assertEqual(
            headers.get("Access-Control-Allow-Origin"), "https://stillgreen.vercel.app"
        )
        self.assertEqual(headers.get("Access-Control-Allow-Private-Network"), "true")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)

        # Anyone can deploy to vercel.app, so other subdomains are not trusted.
        status, _, headers = self.request("/api/health", origin="https://evil.vercel.app")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

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
            self.assertTrue(web.origin_allowed("https://stillgreen.vercel.app"))
            self.assertFalse(web.origin_allowed("https://demo.vercel.app"))
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


class SecurityTests(WebTestCase):
    """Regression tests for the control server's security checks."""

    def test_page_code_is_not_readable_cross_origin(self) -> None:
        for origin in ("https://evil.vercel.app", "http://localhost:3000", "chrome-extension://x"):
            status, page, headers = self.request("/", origin=origin)
            self.assertEqual(status, 200)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
            self.assertIn(self.code, page)  # visible only to a same-origin visit

    def test_foreign_host_is_refused(self) -> None:
        # A DNS-rebinding page reaches 127.0.0.1 under its own host name.
        port = self.server.server_address[1]
        host = {"Host": f"rebind.attacker.example:{port}"}
        status, page, _ = self.request("/", extra_headers=host)
        self.assertEqual(status, 421)
        self.assertNotIn(self.code, str(page))
        status, _, _ = self.request("/api/state", code=self.code, extra_headers=host)
        self.assertEqual(status, 421)
        status, _, _ = self.request("/api/state", code=self.code, extra_headers={"Host": f"localhost:{port}"})
        self.assertEqual(status, 200)

    def test_code_is_not_embedded_behind_a_proxy(self) -> None:
        status, page, _ = self.request("/", extra_headers={"X-Forwarded-For": "203.0.113.9"})
        self.assertEqual(status, 200)
        self.assertNotIn(self.code, page)

    def test_extra_hosts_can_be_allowed(self) -> None:
        with mock.patch.dict(os.environ, {"SG_LOCAL_WEB_HOSTS": "box.lan"}):
            self.assertTrue(web.host_allowed("box.lan:8765", "127.0.0.1"))
            self.assertFalse(web.host_allowed("other.lan", "127.0.0.1"))
        self.assertTrue(web.host_allowed("[::1]:8765", "127.0.0.1"))
        self.assertFalse(web.host_allowed("", "127.0.0.1"))

    def test_non_ascii_code_is_a_clean_401(self) -> None:
        status, _, _ = self.request("/api/state", code="SG-\u00e9\u00e9")
        self.assertEqual(status, 401)

    def test_unicode_dashes_in_code_are_accepted(self) -> None:
        pasted = self.code.replace("-", "\u2013")
        request = urllib.request.Request(
            self.base + "/api/state",
            headers={"Authorization": ("Bearer " + pasted).encode("utf-8").decode("latin-1")},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 200)

    def test_rotate_is_refused_from_another_origin(self) -> None:
        status, _, _ = self.request(
            "/api/code/rotate", method="POST", code=self.code, body={},
            origin="https://stillgreen.vercel.app",
        )
        self.assertEqual(status, 403)
        self.assertEqual(web.load_code(create=False), self.code)


class DataSafetyTests(WebTestCase):
    def test_corrupt_config_is_never_overwritten(self) -> None:
        config.CONFIG_PATH.write_text('{"workspaces": [{"team_id": "T1"', encoding="utf-8")
        before = config.CONFIG_PATH.read_text(encoding="utf-8")
        for path, body in (
            ("/api/schedule", {"mode": "always"}),
            ("/api/resume", {}),
            ("/api/pause", {"workspace": "T1"}),
        ):
            status, payload, _ = self.request(path, method="POST", code=self.code, body=body)
            self.assertEqual(status, 400, payload)
            self.assertIn("Cannot read", payload["error"])
        self.assertEqual(config.CONFIG_PATH.read_text(encoding="utf-8"), before)
        status, state_body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 200)
        self.assertIn("Cannot read", state_body["config_error"])

    def test_concurrent_adds_keep_every_workspace(self) -> None:
        import time as _time

        def slow_auth(xoxc: str, xoxd: str) -> dict:
            _time.sleep(0.2)
            team = xoxc.split("-")[-1]
            return {"ok": True, "team_id": team, "user_id": "U" + team, "team": team}

        with mock.patch.object(web, "verify_tokens", side_effect=slow_auth):
            threads = [
                threading.Thread(
                    target=self.request,
                    args=("/api/workspaces",),
                    kwargs={"method": "POST", "code": self.code,
                            "body": {"xoxc": f"xoxc-T{i}", "xoxd": "xoxd-x"}},
                )
                for i in range(5)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        teams = sorted(w["team_id"] for w in config.load_config()["workspaces"])
        self.assertEqual(teams, [f"T{i}" for i in range(5)])

    def test_mutation_response_shows_the_new_pause_and_stay(self) -> None:
        # Even when the daemon's state file still says otherwise.
        state.write_state({"pid": 1, "paused": False, "stay_active": False, "workspaces": []})
        with mock.patch.object(state, "daemon_pid", return_value=1):
            _, body, _ = self.request("/api/pause", method="POST", code=self.code, body={"duration": "1h"})
            self.assertTrue(body["paused"])
            _, body, _ = self.request("/api/stay", method="POST", code=self.code, body={"duration": "30m"})
            self.assertTrue(body["stay_active"])
            _, body, _ = self.request("/api/resume", method="POST", code=self.code, body={})
            self.assertFalse(body["paused"])

    def test_bad_inputs_are_400_not_500(self) -> None:
        for path, body in (
            ("/api/schedule", {"mode": "scheduled", "active_days": []}),
            ("/api/schedule", {"mode": "scheduled", "active_days": 123}),
            ("/api/schedule", {"mode": "scheduled", "start_time": 900}),
            ("/api/schedule", {"mode": "scheduled", "start_time": "09:00", "end_time": "09:00"}),
            ("/api/pause", {"duration": "99999999999w"}),
            ("/api/stay", {"duration": "400d"}),
        ):
            status, payload, _ = self.request(path, method="POST", code=self.code, body=body)
            self.assertEqual(status, 400, (path, body, payload))

    def test_delete_only_removes_by_exact_route(self) -> None:
        self.write_config([{"name": "A", "team_id": "T1", "user_id": "U1",
                            "xoxc": "xoxc-a", "xoxd": "xoxd-a"}])
        status, _, _ = self.request("/api/workspaces/T1/:pause", method="DELETE", code=self.code)
        self.assertEqual(status, 404)
        self.assertEqual(len(config.load_config()["workspaces"]), 1)

    def test_daemon_level_log_lines_reach_the_activity_feed(self) -> None:
        config.LOG_PATH.write_text(
            "2026-10-30 10:00:00 ERROR tokens for Acme were rejected; update them\n"
            "2026-10-30 10:00:01 INFO mode: paused until resumed\n"
            "2026-10-30 10:00:02 INFO [Acme] connected to Slack WebSocket (initial)\n",
            encoding="utf-8",
        )
        events = web._activity()
        self.assertEqual([e["tone"] for e in events], ["green", "muted", "amber"])
        self.assertEqual(events[2]["workspace"], "")


if __name__ == "__main__":
    unittest.main()
