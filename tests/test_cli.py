"""Tests for the command-line interface and the daemon's reconcile loop."""

from __future__ import annotations

import asyncio
import io
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from sg_local import cli, config, daemon


def workspace(team: str = "T1", user: str = "U1", name: str = "Acme") -> dict:
    return {"name": name, "team_id": team, "user_id": user, "xoxc": f"xoxc-{team}", "xoxd": "xoxd-x"}


class TempConfig(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        config_dir, state_dir = root / "config", root / "state"
        patch = mock.patch.multiple(
            config,
            CONFIG_DIR=config_dir,
            STATE_DIR=state_dir,
            CONFIG_PATH=config_dir / "config.json",
            STATE_PATH=state_dir / "state.json",
            PID_PATH=state_dir / "daemon.pid",
            LOCK_PATH=state_dir / "daemon.lock",
            LOG_PATH=state_dir / "daemon.log",
            PAUSE_PATH=state_dir / "pause.json",
            STAY_PATH=state_dir / "stay.json",
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.temp.cleanup)
        config.ensure_dirs()

    def run_cli(self, *argv: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()


class CliTests(TempConfig):
    def test_pause_for_writes_a_timed_pause(self) -> None:
        code, out, _ = self.run_cli("pause", "--for", "1h")
        self.assertEqual(code, 0)
        self.assertIsNotNone(config.read_pause()["until"])
        self.assertIn("paused", out)

    def test_pause_rejects_bad_and_huge_durations(self) -> None:
        for value in ("banana", "99999999w"):
            code, _, err = self.run_cli("pause", "--for", value)
            self.assertEqual(code, 2, err)
            self.assertIsNone(config.read_pause())

    def test_workspace_pause_cannot_have_a_duration(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        code, _, _ = self.run_cli("pause", "--workspace", "Acme", "--for", "1h")
        self.assertEqual(code, 1)
        self.assertFalse(config.load_config()["workspaces"][0].get("paused"))

    def test_pause_and_resume_one_workspace(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        self.assertEqual(self.run_cli("pause", "--workspace", "acme")[0], 0)
        self.assertTrue(config.load_config()["workspaces"][0]["paused"])
        code, out, _ = self.run_cli("resume", "--workspace", "T1")
        self.assertEqual(code, 0)
        self.assertIn("Resumed Acme", out)
        self.assertFalse(config.load_config()["workspaces"][0]["paused"])

    def test_ambiguous_name_is_refused(self) -> None:
        config.save_config(
            {**config.default_config(), "workspaces": [workspace("T1"), workspace("T2", "U2")]}
        )
        code, _, err = self.run_cli("remove", "Acme")
        self.assertEqual(code, 2)
        self.assertIn("ambiguous", err)
        self.assertEqual(len(config.load_config()["workspaces"]), 2)

    def test_schedule_set_and_always(self) -> None:
        code, _, _ = self.run_cli("schedule", "set", "--days", "mon-fri", "--start", "22:00", "--end", "06:00")
        self.assertEqual(code, 0)
        saved = config.load_config()["schedule"]
        self.assertEqual((saved["mode"], saved["start_time"], saved["end_time"]), ("scheduled", "22:00", "06:00"))
        self.assertEqual(self.run_cli("schedule", "always")[0], 0)
        self.assertEqual(config.load_config()["schedule"]["mode"], "always")

    def test_corrupt_config_is_reported_not_replaced(self) -> None:
        config.CONFIG_PATH.write_text("{not json", encoding="utf-8")
        code, _, err = self.run_cli("schedule", "always")
        self.assertEqual(code, 2)
        self.assertIn("Cannot read", err)
        self.assertEqual(config.CONFIG_PATH.read_text(encoding="utf-8"), "{not json")

    def test_add_keeps_added_at_and_pause_when_tokens_are_replaced(self) -> None:
        existing = {**workspace(), "paused": True, "added_at": "2026-01-01T00:00:00+00:00"}
        config.save_config({**config.default_config(), "workspaces": [existing]})
        identity = {"ok": True, "team_id": "T1", "user_id": "U1", "team": "Acme"}
        with mock.patch.object(cli.getpass, "getpass", side_effect=["xoxc-new", "xoxd-new"]), \
                mock.patch.object(cli.web, "verify_tokens", return_value=identity):
            code, out, _ = self.run_cli("add")
        self.assertEqual(code, 0)
        self.assertNotIn("xoxc-new", out)
        saved = config.load_config()["workspaces"][0]
        self.assertEqual(saved["xoxc"], "xoxc-new")
        self.assertTrue(saved["paused"])
        self.assertEqual(saved["added_at"], "2026-01-01T00:00:00+00:00")
        self.assertIn("verified_at", saved)

    def test_bad_port_env_only_affects_web(self) -> None:
        with mock.patch.dict(os.environ, {"SG_LOCAL_WEB_PORT": "abc"}):
            self.assertEqual(self.run_cli("list")[0], 0)
            code, _, err = self.run_cli("web")
            self.assertEqual(code, 2)
            self.assertIn("SG_LOCAL_WEB_PORT", err)

    def test_network_mode_needs_a_strong_code(self) -> None:
        with mock.patch.dict(os.environ, {"SG_LOCAL_BRIDGE_CODE": "short"}):
            code, _, err = self.run_cli("web", "--host", "0.0.0.0")
        self.assertEqual(code, 1)
        self.assertIn("strong code", err)


class FakeSession:
    started: list[str] = []

    def __init__(self, workspace: dict, logger: object = None) -> None:
        self.name = workspace["name"]
        self.invalid_token = False
        self.last_error = None
        FakeSession.started.append(workspace["user_id"])

    async def run(self) -> None:
        await asyncio.sleep(3600)

    async def stop(self) -> None:
        pass

    def snapshot(self) -> dict:
        return {"status": "active"}


class ReconcileTests(TempConfig):
    def test_duplicate_team_ids_do_not_flap(self) -> None:
        cfg = {**config.default_config(), "workspaces": [workspace("T1", "U1"), workspace("T1", "U2")]}
        config.save_config(cfg)
        FakeSession.started = []

        async def run() -> None:
            supervisor = daemon.Daemon()
            supervisor.load_config(initial=True)
            for _ in range(5):
                await supervisor.reconcile()
            await supervisor.stop_all()

        with mock.patch.object(daemon, "PresenceSession", FakeSession):
            asyncio.run(run())
        self.assertEqual(FakeSession.started, ["U1"])


if __name__ == "__main__":
    unittest.main()
