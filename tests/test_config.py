"""Unit tests for config helpers and expiry logic."""

from __future__ import annotations

import stat
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from sg_local import config


class TokenCleaningTests(unittest.TestCase):
    def test_xoxc_plain(self) -> None:
        self.assertEqual(config.clean_xoxc(" xoxc-123-abc "), "xoxc-123-abc")

    def test_xoxc_from_authorization_header(self) -> None:
        self.assertEqual(
            config.clean_xoxc("Authorization: Bearer xoxc-123-abc"),
            "xoxc-123-abc",
        )

    def test_xoxc_from_url(self) -> None:
        self.assertEqual(
            config.clean_xoxc("wss://wss-primary.slack.com/?token=xoxc-123-abc"),
            "xoxc-123-abc",
        )

    def test_xoxd_plain(self) -> None:
        self.assertEqual(config.clean_xoxd("xoxd-abc%2Fdef"), "xoxd-abc%2Fdef")

    def test_xoxd_from_cookie_header(self) -> None:
        self.assertEqual(
            config.clean_xoxd("Cookie: d=xoxd-abc%2Fdef; other=value"),
            "xoxd-abc%2Fdef",
        )

    def test_xoxd_with_quotes(self) -> None:
        self.assertEqual(config.clean_xoxd('"xoxd-abc"'), "xoxd-abc")


class ValidationTests(unittest.TestCase):
    def workspace(self, **overrides: str) -> dict:
        base = {
            "name": "Example",
            "team_id": "T123",
            "user_id": "U123",
            "xoxc": "xoxc-123",
            "xoxd": "xoxd-123",
        }
        base.update(overrides)
        return base

    def test_valid(self) -> None:
        ok, message = config.validate_workspace(self.workspace())
        self.assertTrue(ok, message)

    def test_missing_field(self) -> None:
        workspace = self.workspace()
        del workspace["user_id"]
        ok, message = config.validate_workspace(workspace)
        self.assertFalse(ok)
        self.assertIn("user_id", message)

    def test_wrong_prefix(self) -> None:
        ok, message = config.validate_workspace(self.workspace(xoxc="xoxp-123"))
        self.assertFalse(ok)
        self.assertIn("xoxc-", message)

    def test_duration(self) -> None:
        self.assertEqual(config.parse_duration("30m"), timedelta(minutes=30))
        self.assertEqual(config.parse_duration("2h"), timedelta(hours=2))
        self.assertEqual(config.parse_duration("1d"), timedelta(days=1))
        self.assertEqual(config.parse_duration("1w"), timedelta(weeks=1))
        with self.assertRaises(config.ConfigError):
            config.parse_duration("tomorrow")
        with self.assertRaises(config.ConfigError):
            config.parse_duration("0m")


class PermissionTests(unittest.TestCase):
    def test_secure_and_insecure_modes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.json"
            path.write_text("{}", encoding="utf-8")
            path.chmod(0o600)
            ok, message = config.config_security(path)
            self.assertTrue(ok, message)
            path.chmod(0o644)
            ok, message = config.config_security(path)
            self.assertFalse(ok)
            self.assertIn("0600", message)


class ExpiringStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.pause_patch = mock.patch.object(config, "PAUSE_PATH", root / "pause.json")
        self.stay_patch = mock.patch.object(config, "STAY_PATH", root / "stay.json")
        self.dirs_patch = mock.patch.object(config, "ensure_dirs", lambda: None)
        self.pause_patch.start()
        self.stay_patch.start()
        self.dirs_patch.start()

    def tearDown(self) -> None:
        self.pause_patch.stop()
        self.stay_patch.stop()
        self.dirs_patch.stop()
        self.temp.cleanup()

    def test_pause_indefinite(self) -> None:
        config.write_pause(None)
        payload = config.read_pause()
        self.assertIsNotNone(payload)
        self.assertIsNone(payload["until"])
        config.clear_pause()
        self.assertIsNone(config.read_pause())

    def test_pause_expiry(self) -> None:
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        config.write_pause(past)
        self.assertIsNone(config.read_pause())
        # Readers leave the file alone, so they never race a new pause.
        self.assertTrue(config.PAUSE_PATH.exists())
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        config.write_pause(future)
        self.assertIsNotNone(config.read_pause())

    def test_pause_future(self) -> None:
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        config.write_pause(future)
        payload = config.read_pause()
        self.assertIsNotNone(payload)
        self.assertIn("until", payload)

    def test_stay_round_trip(self) -> None:
        future = datetime.now(timezone.utc) + timedelta(minutes=30)
        config.write_stay(future)
        payload = config.read_stay()
        self.assertIsNotNone(payload)
        config.clear_stay()
        self.assertIsNone(config.read_stay())


class ConfigFileTests(unittest.TestCase):
    def test_load_default_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            cfg = config.load_config(Path(temp) / "missing.json")
            self.assertEqual(cfg["schedule"]["mode"], "always")
            self.assertEqual(cfg["workspaces"], [])

    def test_round_trip_and_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.json"
            with mock.patch.object(config, "ensure_dirs", lambda: None):
                config.save_config(
                    {
                        "version": 1,
                        "schedule": {
                            "mode": "scheduled",
                            "active_days": ["monday"],
                            "start_time": "09:00",
                            "end_time": "17:00",
                            "timezone": "UTC",
                        },
                        "workspaces": [],
                    },
                    path,
                )
            loaded = config.load_config(path)
            self.assertEqual(loaded["schedule"]["mode"], "scheduled")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_invalid_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "config.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(config.ConfigError):
                config.load_config(path)


if __name__ == "__main__":
    unittest.main()
