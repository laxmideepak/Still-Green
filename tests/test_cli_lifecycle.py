"""Uninstall, removal tips, plain-English CLI errors, doctor and daemon status fields."""

from __future__ import annotations

import asyncio
import errno
import json
import os
import stat
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from sg_local import cli, config, daemon, diagnostics, launchd, state, web
from test_cli import TempConfig, workspace


def offline_checks() -> mock._patch:
    """Doctor without touching the network: a fixed, passing probe."""
    return mock.patch.multiple(
        diagnostics,
        probe_slack=mock.Mock(return_value={"stage": "done", "error": None, "proxy": None, "tls_version": "TLSv1.3", "date": None}),
        check_dns=mock.Mock(return_value=diagnostics._check("dns", "pass", "Found slack.com.")),
        proxy_for=mock.Mock(return_value=None),
    )


class UninstallTests(TempConfig):
    def setUp(self) -> None:
        super().setUp()
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        web.load_code()
        config.LOG_PATH.write_text("log\n", encoding="utf-8")
        self.stop = mock.patch.object(state, "stop_daemon", return_value=(True, "daemon stopped (pid 99)"))
        self.stop_mock = self.stop.start()
        self.addCleanup(self.stop.stop)

    def test_yes_deletes_everything_and_explains_the_last_steps(self) -> None:
        with mock.patch.object(launchd, "installed", return_value=True), \
                mock.patch.object(launchd, "uninstall", return_value=(True, "removed plist")) as removed:
            code, out, err = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 0, err)
        removed.assert_called_once()
        self.stop_mock.assert_called_once()
        self.assertFalse(config.CONFIG_DIR.exists())
        self.assertFalse(config.STATE_DIR.exists())
        # It said what it would delete, and what the person must still do.
        self.assertIn(str(config.CONFIG_DIR), out)
        self.assertIn(str(config.STATE_DIR), out)
        self.assertIn("bridge.json", out)
        self.assertIn(str(launchd.PLIST_PATH), out)
        self.assertIn("chrome://extensions", out)
        self.assertIn("Sign out of all other sessions", out)
        self.assertIn(str(config.PROJECT_ROOT), out)

    def test_launchd_is_left_alone_when_not_installed_off_macos(self) -> None:
        with mock.patch.object(cli.sys, "platform", "linux"), \
                mock.patch.object(launchd, "installed", return_value=False), \
                mock.patch.object(launchd, "uninstall") as removed:
            code, out, _ = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 0)
        removed.assert_not_called()
        self.assertNotIn("launchd", out)

    def test_asks_for_the_word_delete(self) -> None:
        with mock.patch.object(launchd, "installed", return_value=False), mock.patch.object(cli.sys, "platform", "linux"):
            for answer in ("yes", "", "nope"):
                with mock.patch("builtins.input", return_value=answer):
                    code, out, _ = self.run_cli("uninstall")
                self.assertEqual(code, 1)
                self.assertIn("Nothing was deleted", out)
                self.assertTrue(config.CONFIG_PATH.exists())
            with mock.patch("builtins.input", side_effect=EOFError):
                code, out, _ = self.run_cli("uninstall")
            self.assertEqual(code, 1)
            self.assertIn("--yes", out)
            self.stop_mock.assert_not_called()
            with mock.patch("builtins.input", return_value="DELETE"):
                code, _, err = self.run_cli("uninstall")
        self.assertEqual(code, 0, err)
        self.assertFalse(config.CONFIG_DIR.exists())

    def test_nothing_is_deleted_when_the_daemon_cannot_be_stopped(self) -> None:
        self.stop_mock.return_value = (False, "not allowed")
        with mock.patch.object(launchd, "installed", return_value=False), mock.patch.object(cli.sys, "platform", "linux"):
            code, _, err = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("nothing else was deleted", err)
        self.assertTrue(config.CONFIG_PATH.exists())

    def test_refuses_to_delete_the_home_folder(self) -> None:
        with mock.patch.object(config, "CONFIG_DIR", Path.home()), mock.patch.object(launchd, "installed", return_value=False):
            code, _, err = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 1)
        self.assertIn("nothing was deleted", err)
        self.stop_mock.assert_not_called()


    def test_only_stillgreen_files_are_deleted_and_other_files_are_kept(self) -> None:
        (config.STATE_DIR / "daemon.log.2").write_text("old log\n", encoding="utf-8")
        (config.STATE_DIR / "network.json").write_text("{}\n", encoding="utf-8")
        (config.CONFIG_DIR / ".config.json.ab12cd34").write_text("tmp", encoding="utf-8")
        (config.CONFIG_DIR / "notes.txt").write_text("mine", encoding="utf-8")
        (config.STATE_DIR / "photos").mkdir()
        (config.STATE_DIR / "photos" / "cat.jpg").write_text("meow", encoding="utf-8")
        with mock.patch.object(launchd, "installed", return_value=False), mock.patch.object(cli.sys, "platform", "linux"):
            code, out, err = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 0, err)
        # Stillgreen's own files are gone ...
        for name in ("config.json", "bridge.json", ".config.json.ab12cd34", ".config.lock"):
            self.assertFalse((config.CONFIG_DIR / name).exists(), name)
        for name in ("daemon.log", "daemon.log.2", "network.json"):
            self.assertFalse((config.STATE_DIR / name).exists(), name)
        # ... other files and folders, and the folders holding them, stay.
        self.assertEqual((config.CONFIG_DIR / "notes.txt").read_text(encoding="utf-8"), "mine")
        self.assertTrue((config.STATE_DIR / "photos" / "cat.jpg").exists())
        self.assertIn("notes.txt", out)
        self.assertIn("photos", out)
        self.assertIn("kept the folder", out)

    def test_a_link_is_removed_but_not_followed(self) -> None:
        outside = Path(self.temp.name) / "outside.json"
        outside.write_text("keep me", encoding="utf-8")
        (config.STATE_DIR / "stay.json").symlink_to(outside)
        with mock.patch.object(launchd, "installed", return_value=False), mock.patch.object(cli.sys, "platform", "linux"):
            code, _, err = self.run_cli("uninstall", "--yes")
        self.assertEqual(code, 0, err)
        self.assertFalse(os.path.lexists(config.STATE_DIR / "stay.json"))
        self.assertEqual(outside.read_text(encoding="utf-8"), "keep me")

    def test_refuses_shared_and_program_folders(self) -> None:
        home = Path(self.temp.name) / "home"
        for name in (".config", ".local/state", "Documents", "Library"):
            (home / name).mkdir(parents=True)
        program = config.PROJECT_ROOT
        cases = [
            home / ".config",
            home / ".local",
            home / ".local" / "state",
            home / "Documents",
            home / "Library",
            Path("/etc"),
            program / "sg_local",
            program,
        ]
        with mock.patch.dict(os.environ, {"HOME": str(home)}):
            for folder in cases:
                with self.subTest(folder=str(folder)):
                    self.assertIsNotNone(cli._unsafe_to_delete(folder))
                    with mock.patch.object(config, "STATE_DIR", folder), \
                            mock.patch.object(launchd, "installed", return_value=False), \
                            mock.patch.object(cli.sys, "platform", "linux"):
                        code, _, err = self.run_cli("uninstall", "--yes")
                    self.assertEqual(code, 1)
                    self.assertIn("nothing was deleted", err)
            # A Stillgreen folder of its own is fine.
            self.assertIsNone(cli._unsafe_to_delete(home / ".config" / "slack-green-local"))
        self.stop_mock.assert_not_called()
        self.assertTrue(config.CONFIG_PATH.exists())

    def test_refuses_a_folder_that_is_a_link(self) -> None:
        real = Path(self.temp.name) / "real"
        real.mkdir()
        link = Path(self.temp.name) / "link"
        link.symlink_to(real, target_is_directory=True)
        self.assertIn("symbolic link", cli._unsafe_to_delete(link) or "")


class RemoveTipTests(TempConfig):
    def test_remove_explains_how_to_revoke_the_session(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        code, out, _ = self.run_cli("remove", "Acme")
        self.assertEqual(code, 0)
        self.assertIn("Removed Acme", out)
        self.assertIn("Sign out of all other sessions", out)
        self.assertNotIn("xoxc-", config.CONFIG_PATH.read_text(encoding="utf-8"))


class PlainErrorTests(TempConfig):
    def test_settings_mistake_keeps_exit_code_2(self) -> None:
        code, _, err = self.run_cli("remove", "Nobody")
        self.assertEqual(code, 2)
        self.assertIn("Problem: That value is not valid", err)
        self.assertIn("no workspace matches", err)
        self.assertIn("What to do:", err)

    def test_unexpected_exception_becomes_plain_words(self) -> None:
        busy = OSError(errno.EADDRINUSE, "Address already in use")
        # build_parser looks cmd_list up when main() runs, so the patch applies.
        with mock.patch.object(cli, "cmd_list", side_effect=busy), mock.patch.dict(os.environ, {"SG_LOCAL_DEBUG": ""}):
            code, _, err = self.run_cli("list")
        self.assertEqual(code, 1)
        self.assertIn("Problem: The port is already in use", err)
        self.assertNotIn("Traceback", err)

    def test_slack_errors_while_adding_are_explained(self) -> None:
        error = config.ConfigError("x", code="dns_failed")
        with mock.patch.object(cli.getpass, "getpass", side_effect=["xoxc-1-secret", "xoxd-2-secret"]), \
                mock.patch.object(cli.web, "verify_tokens", side_effect=error):
            code, _, err = self.run_cli("add")
        self.assertEqual(code, 2)
        self.assertIn("Cannot find Slack on the network", err)
        self.assertNotIn("secret", err)

    def test_help_does_not_promise_green(self) -> None:
        text = cli.build_parser().format_help()
        self.assertIn("Slack decides your final status", text)
        for word in ("guarantee", "always green", "slack.green"):
            self.assertNotIn(word, text.lower())


class DoctorTests(TempConfig):
    def test_doctor_lists_every_check_and_keeps_exit_codes(self) -> None:
        with offline_checks():
            code, out, _ = self.run_cli("doctor")
        self.assertEqual(code, 0, out)
        for label in diagnostics.LABELS.values():
            self.assertIn(label, out)
        self.assertIn("Slack decides your final status", out)
        config.CONFIG_PATH.write_text("{ broken", encoding="utf-8")
        with offline_checks():
            code, out, _ = self.run_cli("doctor")
        self.assertEqual(code, 1)
        self.assertIn("[fail] Settings file", out)
        self.assertIn("What to do:", out)

    def test_doctor_report_is_private_and_redacted(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        code_value = web.load_code()
        config.LOG_PATH.write_text(f"2026-11-20 10:00:00 INFO xoxc-T1 d=xoxd-x {code_value}\n", encoding="utf-8")
        target = Path(self.temp.name) / "report.txt"
        with offline_checks():
            code, out, _ = self.run_cli("doctor", "--report", str(target))
        self.assertEqual(code, 0, out)
        self.assertIn("Saved a diagnostics report", out)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        text = target.read_text(encoding="utf-8")
        for secret in ("xoxc-T1", "xoxd-x", code_value):
            self.assertNotIn(secret, text)

    def test_offline_doctor_makes_no_network_call(self) -> None:
        with mock.patch.object(diagnostics, "probe_slack", side_effect=AssertionError("network")):
            code, out, _ = self.run_cli("doctor", "--offline")
        self.assertEqual(code, 0, out)
        self.assertIn("[skip] Secure connection to Slack", out)

    def test_check_tokens_uses_plain_words(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace()]})
        from sg_local.slack import SlackAPIError

        with offline_checks(), mock.patch.object(cli.SlackClient, "auth_test", side_effect=SlackAPIError("invalid_auth", token_invalid=True)):
            code, out, _ = self.run_cli("doctor", "--check-tokens")
        self.assertEqual(code, 1)
        self.assertIn("Slack signed you out", out)


class StatusTests(TempConfig):
    def test_status_shows_login_presence_and_problems(self) -> None:
        config.save_config({**config.default_config(), "workspaces": [workspace(), workspace("T2", name="Two")]})
        verified = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat(timespec="seconds")
        state.write_state({
            "pid": os.getpid(), "started_at": verified, "updated_at": datetime.now(timezone.utc).isoformat(),
            "workspaces": [
                {"team_id": "T1", "status": "active", "connected": True, "auth": "ok", "presence": "active", "presence_verified_at": verified},
                {"team_id": "T2", "status": "error", "connected": False, "auth": "unknown", "last_error": "x", "last_error_code": "tls_untrusted"},
            ],
        })
        with mock.patch.object(state, "daemon_pid", return_value=os.getpid()):
            code, out, _ = self.run_cli("status")
        self.assertEqual(code, 0)
        self.assertIn("LOGIN", out)
        self.assertIn("SLACK SHOWS", out)
        self.assertIn("2m 0s ago", out.replace("1m 59s ago", "2m 0s ago").replace("2m 1s ago", "2m 0s ago"))
        self.assertIn("Security certificate not trusted", out)
        self.assertIn("Slack decides your final status", out)


class UpdateNoticeTests(TempConfig):
    def runtime(self, build: str) -> None:
        state.write_state({"pid": os.getpid(), "build": build, "started_at": datetime.now(timezone.utc).isoformat()})

    def test_build_id_is_stable_and_short(self) -> None:
        self.assertEqual(state.build_id(), state.build_id())
        self.assertEqual(len(state.build_id()), 16)
        self.assertFalse(state.update_pending({}))
        self.assertFalse(state.update_pending(None))
        # A daemon from before build fingerprints is older than any build.
        self.assertTrue(state.update_pending({"pid": 4242, "running": True, "workspaces": []}))
        self.assertFalse(state.update_pending({"build": state.build_id()}))
        self.assertTrue(state.update_pending({"build": "0000000000000000"}))

    def test_status_start_and_doctor_say_restart_after_an_update(self) -> None:
        self.runtime("0000000000000000")
        with mock.patch.object(state, "daemon_pid", return_value=os.getpid()), \
                mock.patch.object(cli, "_daemon_running", return_value=os.getpid()):
            _, status_out, _ = self.run_cli("status")
            code, start_out, _ = self.run_cli("start")
            daemon_check = diagnostics.check_daemon()
        self.assertEqual(code, 0)
        self.assertIn("Run ./sg-local restart to finish the update", status_out)
        self.assertIn("Run ./sg-local restart to finish the update", start_out)
        self.assertEqual(daemon_check["status"], "warn")
        self.assertIn("restart", daemon_check["action"])

    def test_no_notice_when_the_daemon_runs_the_current_files(self) -> None:
        self.runtime(state.build_id())
        with mock.patch.object(state, "daemon_pid", return_value=os.getpid()), \
                mock.patch.object(cli, "_daemon_running", return_value=os.getpid()):
            _, out, _ = self.run_cli("status")
            check = diagnostics.check_daemon()
        self.assertNotIn("finish the update", out)
        self.assertEqual(check["status"], "pass")

    def test_schedule_commands_remember_that_hours_were_chosen(self) -> None:
        self.assertNotIn("saved_at", config.load_config()["schedule"])
        self.run_cli("schedule", "always")
        self.assertTrue(config.load_config()["schedule"]["saved_at"])
        self.run_cli("schedule", "set", "--days", "mon-fri")
        self.assertTrue(config.load_config()["schedule"]["saved_at"])

    def test_help_describes_the_action_not_a_promise(self) -> None:
        parser = cli.build_parser()
        text = parser.format_help()
        stay = next(action for action in parser._subparsers._group_actions[0].choices.items() if action[0] == "stay")[1]
        stay_help = stay.format_help()
        for words in (text, stay_help):
            self.assertNotIn("stay online", words.lower())
        self.assertIn("keep helping", stay_help)


class FakeSession:
    def __init__(self, workspace: dict, logger: object = None) -> None:
        self.name = workspace["name"]
        self.team_id = workspace["team_id"]
        self.invalid_token = False
        self.last_error = None
        self.auth = "ok"
        self.presence_verified_at = time.time()
        self.slack_ok_at = time.time()
        self.slack_fail_at = None
        self.slack_fail_code = None

    async def run(self) -> None:
        # Runs until stop(), like the real session (otherwise stopping waits
        # out the daemon's 8 s timeout). stop() can come before run() starts.
        self._stopped = asyncio.Event()
        if getattr(self, "_stop_requested", False):
            return
        await self._stopped.wait()

    async def stop(self) -> None:
        self._stop_requested = True
        stopped = getattr(self, "_stopped", None)
        if stopped is not None:
            stopped.set()

    def snapshot(self) -> dict:
        return {"team_id": self.team_id, "status": "active", "connected": True, "auth": self.auth, "presence": "active"}


class DaemonStateTests(TempConfig):
    def test_state_file_has_the_new_fields_and_keeps_verification(self) -> None:
        bad = {**workspace("T2", name="Broken"), "xoxd": ""}
        config.save_config({**config.default_config(), "workspaces": [workspace(), bad]})

        async def run() -> dict:
            supervisor = daemon.Daemon()
            supervisor.load_config(initial=True)
            await supervisor.reconcile()
            supervisor.write_state(force=True)
            payload = state.read_state()
            await supervisor.stop_all()
            supervisor.write_final_state()
            return payload

        with mock.patch.object(daemon, "PresenceSession", FakeSession):
            live = asyncio.run(run())
        by_team = {item["team_id"]: item for item in live["workspaces"]}
        self.assertEqual(by_team["T1"]["auth"], "ok")
        self.assertIsNotNone(by_team["T1"]["presence_verified_at"])
        self.assertEqual(by_team["T2"]["last_error_code"], "workspace_invalid")
        self.assertTrue(live["slack"]["reachable"])
        final = state.read_state()
        verified = {item["team_id"]: item for item in final["workspaces"]}["T1"]["presence_verified_at"]
        self.assertEqual(verified, by_team["T1"]["presence_verified_at"])
        # A new daemon remembers the last confirmation from the state file.
        memory = daemon._previous_memory()
        self.assertEqual(memory["T1"]["presence_verified_at"], verified)
        self.assertEqual(memory["T1"]["auth"], "ok")

    def test_slack_health_follows_the_latest_attempt(self) -> None:
        async def make() -> daemon.Daemon:
            # Python 3.9 needs an event loop to make the daemon's asyncio.Event.
            return daemon.Daemon()

        supervisor = asyncio.run(make())
        self.assertEqual(supervisor.slack_health()["reachable"], None)
        session = SimpleNamespace(auth="unknown", presence_verified_at=None, slack_ok_at=100.0, slack_fail_at=200.0, slack_fail_code="dns_failed")
        supervisor._remember("T1", session)
        health = supervisor.slack_health()
        self.assertEqual((health["reachable"], health["code"]), (False, "dns_failed"))
        supervisor._remember("T1", SimpleNamespace(slack_ok_at=300.0, slack_fail_at=None))
        self.assertTrue(supervisor.slack_health()["reachable"])
        self.assertEqual(json.loads(json.dumps(supervisor.slack_health()))["code"], None)
