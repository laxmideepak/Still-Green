"""End-to-end tests: real control server + real daemon + a fake Slack.

The control server and daemon run as separate processes, exactly as they do
for a user, in a temporary config folder. Slack is replaced by
``tests/e2e/fake_slack.py`` so no real account is needed.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "e2e"))

from fake_slack import GOOD_XOXC, GOOD_XOXD, TEAM_ID, USER_ID  # noqa: E402
from harness import CODE, Stack, wait_for  # noqa: E402


def workspace(state: dict) -> dict:
    items = state["workspaces"]
    assert len(items) == 1, items
    return items[0]


class EndToEndTest(unittest.TestCase):
    def setUp(self) -> None:
        self.stack = Stack().start()
        self.addCleanup(self.stack.stop)

    def add_workspace(self) -> dict:
        status, body = self.stack.call(
            "POST", "/api/workspaces", {"xoxc": GOOD_XOXC, "xoxd": GOOD_XOXD}
        )
        self.assertEqual(status, 200, body)
        return body

    def wait_status(self, *statuses: str, timeout: float = 20.0) -> dict:
        def check():
            state = self.stack.state()
            items = state["workspaces"]
            return state if items and items[0]["status"] in statuses else None

        return wait_for(check, f"workspace status in {statuses}", timeout=timeout)

    # ------------------------------------------------------------------ flow

    def test_full_presence_flow(self) -> None:
        body = self.add_workspace()
        self.assertEqual(body["team_id"], TEAM_ID)

        # The daemon picks up the new workspace and holds Slack presence.
        state = self.wait_status("active")
        item = workspace(state)
        self.assertTrue(item["connected"])
        self.assertEqual(item["user_id"], USER_ID)
        self.assertGreaterEqual(self.stack.slack.ws_connections, 1)
        self.assertEqual(state["connected_count"], 1)

        # Global pause disconnects; resume reconnects.
        status, _ = self.stack.call("POST", "/api/pause", {"duration": "1h"})
        self.assertEqual(status, 200)
        state = self.wait_status("paused")
        self.assertTrue(state["paused"])
        self.assertFalse(workspace(state)["connected"])

        # A stay-online override wins over the pause.
        status, _ = self.stack.call("POST", "/api/stay", {"duration": "30m"})
        self.assertEqual(status, 200)
        state = self.wait_status("active", "connected")
        self.assertTrue(state["stay_active"])
        status, _ = self.stack.call("POST", "/api/stay", {"cancel": True})
        self.assertEqual(status, 200)
        self.wait_status("paused")

        status, _ = self.stack.call("POST", "/api/resume", {})
        self.assertEqual(status, 200)
        state = self.wait_status("active", "connected")
        self.assertFalse(state["paused"])

        # Pausing one workspace only affects that workspace.
        status, _ = self.stack.call("POST", "/api/pause", {"workspace": TEAM_ID})
        self.assertEqual(status, 200)
        state = self.wait_status("paused")
        self.assertTrue(workspace(state)["paused"])
        self.assertFalse(state["paused"])
        status, _ = self.stack.call("POST", "/api/resume", {"workspace": TEAM_ID})
        self.assertEqual(status, 200)
        self.wait_status("active", "connected")

        # Removing the workspace stops the session and deletes the tokens.
        status, body = self.stack.call("DELETE", f"/api/workspaces/{TEAM_ID}")
        self.assertEqual(status, 200, body)
        wait_for(lambda: not self.stack.state()["workspaces"], "workspace removal")
        saved = (self.stack.config_dir / "config.json").read_text(encoding="utf-8")
        self.assertNotIn(GOOD_XOXC, saved)
        self.assertNotIn(GOOD_XOXD, saved)

    def test_schedule_round_trip(self) -> None:
        payload = {
            "mode": "scheduled",
            "active_days": ["monday", "wednesday"],
            "start_time": "22:00",
            "end_time": "06:00",
            "timezone": "UTC",
        }
        status, body = self.stack.call("POST", "/api/schedule", payload)
        self.assertEqual(status, 200, body)
        schedule = self.stack.state()["schedule"]
        self.assertEqual(schedule["mode"], "scheduled")
        self.assertEqual(schedule["active_days"], ["monday", "wednesday"])
        self.assertEqual((schedule["start_time"], schedule["end_time"]), ("22:00", "06:00"))
        self.assertIsNotNone(schedule["next_change"])

        status, body = self.stack.call("POST", "/api/schedule", {**payload, "timezone": "Not/AZone"})
        self.assertEqual(status, 400, body)
        status, body = self.stack.call("POST", "/api/schedule", {"mode": "always"})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.stack.state()["schedule"]["mode"], "always")

    def test_manual_away_is_left_alone(self) -> None:
        self.add_workspace()
        self.wait_status("active")
        connections = self.stack.slack.ws_connections
        self.stack.slack.presence, self.stack.slack.manual_away = "away", True
        self.wait_status("manual_away")
        self.assertEqual(self.stack.slack.ws_connections, connections)

    def test_auto_away_triggers_reconnect(self) -> None:
        self.add_workspace()
        self.wait_status("active")
        connections = self.stack.slack.ws_connections
        self.stack.slack.presence = "away"
        wait_for(
            lambda: self.stack.slack.ws_connections > connections,
            "reconnect after auto away",
        )
        self.stack.slack.presence = "active"
        self.wait_status("active")

    def test_revoked_tokens_are_reported(self) -> None:
        self.add_workspace()
        self.wait_status("active")
        self.stack.slack.revoked = True
        state = self.wait_status("invalid_token")
        self.assertFalse(workspace(state)["connected"])

    def test_rejected_tokens_are_not_saved(self) -> None:
        status, body = self.stack.call(
            "POST", "/api/workspaces", {"xoxc": "xoxc-wrong", "xoxd": GOOD_XOXD}
        )
        self.assertEqual(status, 400)
        self.assertIn("rejected", body["error"])
        self.assertNotIn("xoxc-wrong", json.dumps(body))
        self.assertEqual(self.stack.state()["workspaces"], [])

    def test_daemon_stop_is_reported(self) -> None:
        self.add_workspace()
        self.wait_status("active")
        self.stack.stop_daemon()
        state = wait_for(
            lambda: (lambda s: s if not s["daemon"]["running"] else None)(self.stack.state()),
            "daemon stopped",
        )
        self.assertFalse(workspace(state)["connected"])

    # -------------------------------------------------------------- security

    def test_tokens_never_leave_the_daemon(self) -> None:
        self.add_workspace()
        self.wait_status("active")
        state_text = json.dumps(self.stack.state())
        log_text = (self.stack.state_dir / "daemon.log").read_text(encoding="utf-8")
        for secret in (GOOD_XOXC, GOOD_XOXD):
            self.assertNotIn(secret, state_text)
            self.assertNotIn(secret, log_text)

    def test_api_needs_the_access_code(self) -> None:
        for code in (None, "SG-WRONG-CODE-0000"):
            status, _ = self.stack.call("GET", "/api/state", code=code)
            self.assertEqual(status, 401)
            status, _ = self.stack.call("POST", "/api/pause", {}, code=code)
            self.assertEqual(status, 401)
        status, _ = self.stack.call("GET", "/api/state", code=CODE)
        self.assertEqual(status, 200)

    def test_unknown_origin_is_refused(self) -> None:
        status, _ = self.stack.call(
            "GET", "/api/state", headers={"Origin": "https://evil.example"}
        )
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
