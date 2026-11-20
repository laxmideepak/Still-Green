"""The control API's plain-English errors, clear status fields and diagnostics."""

from __future__ import annotations

import errno
import json
import os
import ssl
from datetime import datetime, timedelta, timezone
from unittest import mock

from sg_local import config, diagnostics, errors, state, web
from sg_local.slack import SlackAPIError
from test_web import WebTestCase

ENTRY_KEYS = {"code", "title", "message", "action"}
DASHBOARD = "https://stillgreen.vercel.app"


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def saved_workspace(team: str = "T1", name: str = "Acme") -> dict:
    return {"name": name, "team_id": team, "user_id": "U1", "xoxc": "xoxc-secret-token", "xoxd": "xoxd-secret-cookie"}


class ErrorBodyTests(WebTestCase):
    def assertErrorCode(self, body: dict, code: str) -> None:
        self.assertFalse(body["ok"])
        self.assertTrue(body["error"])
        self.assertEqual(body["error_code"], code)
        self.assertEqual(set(body["error_info"]), ENTRY_KEYS)
        self.assertEqual(body["error_info"]["code"], code)

    def test_missing_or_wrong_code(self) -> None:
        status, body, _ = self.request("/api/state")
        self.assertEqual(status, 401)
        self.assertErrorCode(body, "access_code_wrong")
        self.assertIn("--show-code", body["error_info"]["action"])

    def test_too_many_attempts(self) -> None:
        for _ in range(10):
            self.request("/api/state", code="SG-WRON-GCOD-E000")
        status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 429)
        self.assertErrorCode(body, "too_many_attempts")

    def test_not_found_and_bad_input(self) -> None:
        status, body, _ = self.request("/api/nothing", code=self.code)
        self.assertEqual(status, 404)
        self.assertErrorCode(body, "not_found")
        self.write_config()
        status, body, _ = self.request(
            "/api/schedule", method="POST", code=self.code,
            body={"mode": "scheduled", "active_days": ["monday"], "start_time": "09:00", "end_time": "17:00", "timezone": "Not/AZone"},
        )
        self.assertEqual(status, 400)
        self.assertErrorCode(body, "invalid_input")
        self.assertIn("timezone", body["error_info"]["message"].lower())

    def test_unreadable_config_is_explained(self) -> None:
        config.CONFIG_PATH.write_text("{ broken", encoding="utf-8")
        status, body, _ = self.request("/api/pause", method="POST", code=self.code, body={"workspace": "T1"})
        self.assertEqual(status, 400)
        self.assertErrorCode(body, "config_unreadable")

    def test_untrusted_certificate_while_adding_a_workspace(self) -> None:
        error = SlackAPIError("Network error: certificate verify failed", cause=ssl.SSLCertVerificationError(1, "certificate verify failed"))
        with mock.patch.object(web.SlackClient, "auth_test", side_effect=error):
            status, body, _ = self.request(
                "/api/workspaces", method="POST", code=self.code,
                body={"xoxc": "xoxc-secret-token", "xoxd": "xoxd-secret-cookie"},
            )
        self.assertEqual(status, 400)
        self.assertErrorCode(body, "tls_untrusted")
        self.assertIn("Do not turn off security checks", body["error"])
        self.assertNotIn("secret", json.dumps(body))

    def test_rejected_tokens_while_adding_a_workspace(self) -> None:
        with mock.patch.object(web.SlackClient, "auth_test", side_effect=SlackAPIError("invalid_auth", token_invalid=True)):
            status, body, _ = self.request(
                "/api/workspaces", method="POST", code=self.code,
                body={"xoxc": "xoxc-secret-token", "xoxd": "xoxd-secret-cookie"},
            )
        self.assertEqual(status, 400)
        self.assertErrorCode(body, "slack_auth_rejected")
        self.assertIn("rejected", body["error"])

    def test_unexpected_failure_uses_the_catalogue_words(self) -> None:
        with mock.patch.object(web, "build_state", side_effect=OSError(errno.ECONNRESET, "Connection reset by xoxc-leak")):
            status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 500)
        self.assertErrorCode(body, "network_unreachable")
        self.assertNotIn("xoxc-leak", json.dumps(body))


class StateFieldTests(WebTestCase):
    def runtime(self, pid: int | None, items: list[dict], **extra: object) -> mock._patch:
        state.write_state({"version": 1, "pid": pid, "running": bool(pid), "workspaces": items, **extra})
        return mock.patch.object(web.state, "daemon_pid", return_value=pid)

    def get_state(self) -> dict:
        status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 200, body)
        return body

    def test_running_workspace_reports_auth_presence_and_verification(self) -> None:
        self.write_config([saved_workspace()])
        verified = iso(datetime.now(timezone.utc) - timedelta(minutes=1))
        item = {
            "team_id": "T1", "status": "active", "connected": True, "auth": "ok",
            "presence": "active", "presence_verified_at": verified, "last_error": None,
        }
        with self.runtime(os.getpid(), [item]):
            body = self.get_state()
        ws = body["workspaces"][0]
        self.assertEqual((ws["auth"], ws["presence"], ws["presence_verified_at"]), ("ok", "active", verified))
        self.assertIsNone(ws["last_error_info"])
        self.assertTrue(body["health"]["daemon"])

    def test_errors_carry_a_catalogue_entry(self) -> None:
        self.write_config([saved_workspace(), saved_workspace("T2", "Two"), saved_workspace("T3", "Three")])
        items = [
            {"team_id": "T1", "status": "error", "connected": False, "last_error": "[Errno 8] nodename nor servname", "last_error_code": "dns_failed"},
            # Older daemons saved only the text: it is classified from that.
            {"team_id": "T2", "status": "error", "connected": False, "last_error": "Network error: CERTIFICATE_VERIFY_FAILED"},
            {"team_id": "T3", "status": "invalid_token", "connected": False, "last_error": "Slack rejected", "last_error_code": "slack_auth_rejected", "auth": "rejected"},
        ]
        with self.runtime(os.getpid(), items):
            body = self.get_state()
        infos = {ws["team_id"]: ws["last_error_info"] for ws in body["workspaces"]}
        self.assertEqual(infos["T1"]["code"], "dns_failed")
        self.assertEqual(infos["T2"]["code"], "tls_untrusted")
        self.assertEqual(infos["T3"]["code"], "slack_auth_rejected")
        for info in infos.values():
            self.assertEqual(set(info), ENTRY_KEYS)
        by_team = {ws["team_id"]: ws for ws in body["workspaces"]}
        self.assertEqual(by_team["T3"]["auth"], "rejected")
        self.assertEqual(by_team["T1"]["presence"], "unknown")

    def test_stopped_daemon_keeps_only_what_is_still_true(self) -> None:
        self.write_config([saved_workspace()])
        verified = iso(datetime.now(timezone.utc) - timedelta(hours=2))
        item = {"team_id": "T1", "status": "stopped", "connected": False, "auth": "ok", "presence": "active", "presence_verified_at": verified}
        with self.runtime(None, [item]):
            body = self.get_state()
        ws = body["workspaces"][0]
        self.assertEqual((ws["auth"], ws["presence"]), ("unknown", "unknown"))
        self.assertEqual(ws["presence_verified_at"], verified)
        self.assertFalse(body["health"]["daemon"])

    def test_new_fields_exist_without_a_daemon_state(self) -> None:
        self.write_config([saved_workspace()])
        with mock.patch.object(web.state, "daemon_pid", return_value=None):
            body = self.get_state()
        ws = body["workspaces"][0]
        self.assertEqual(
            {key: ws[key] for key in ("auth", "presence", "presence_verified_at", "last_error_info")},
            {"auth": "unknown", "presence": "unknown", "presence_verified_at": None, "last_error_info": None},
        )
        self.assertEqual(body["health"], {"daemon": False, "slack_reachable": None, "checked_at": None, "slack_error_code": None})

    def test_health_uses_the_newest_of_daemon_traffic_and_diagnostics(self) -> None:
        self.write_config([])
        older = iso(datetime.now(timezone.utc) - timedelta(minutes=5))
        newer = iso(datetime.now(timezone.utc) - timedelta(seconds=5))
        slack = {"reachable": True, "checked_at": older, "code": None}
        config.atomic_write(diagnostics.network_cache_path(), json.dumps({"reachable": False, "checked_at": newer, "code": "tls_untrusted"}))
        with self.runtime(os.getpid(), [], slack=slack):
            health = self.get_state()["health"]
        self.assertEqual(health, {"daemon": True, "slack_reachable": False, "checked_at": newer, "slack_error_code": "tls_untrusted"})
        slack = {"reachable": True, "checked_at": iso(datetime.now(timezone.utc)), "code": None}
        with self.runtime(os.getpid(), [], slack=slack):
            health = self.get_state()["health"]
        self.assertTrue(health["slack_reachable"])

    def test_state_never_calls_slack(self) -> None:
        self.write_config([saved_workspace()])
        with mock.patch.object(diagnostics, "probe_slack", side_effect=AssertionError("network")), \
                mock.patch.object(web.SlackClient, "_request", side_effect=AssertionError("network")):
            self.get_state()


class LifecycleStateTests(WebTestCase):
    def get_state(self) -> dict:
        status, body, _ = self.request("/api/state", code=self.code)
        self.assertEqual(status, 200, body)
        return body

    def test_update_pending_and_autostart_are_reported(self) -> None:
        self.write_config()
        state.write_state({"pid": os.getpid(), "build": "0000000000000000", "workspaces": []})
        with mock.patch.object(state, "daemon_pid", return_value=os.getpid()):
            body = self.get_state()
        self.assertTrue(body["daemon"]["update_pending"])
        self.assertIn("autostart", body)
        self.assertEqual(set(body["autostart"]), {"supported", "enabled", "command", "note"})
        state.write_state({"pid": os.getpid(), "build": state.build_id(), "workspaces": []})
        with mock.patch.object(state, "daemon_pid", return_value=os.getpid()):
            self.assertFalse(self.get_state()["daemon"]["update_pending"])

    def test_autostart_on_macos_and_elsewhere(self) -> None:
        with mock.patch.object(web.sys, "platform", "darwin"), mock.patch.object(web.launchd, "installed", return_value=False):
            off = web.autostart_status()
        self.assertEqual((off["supported"], off["enabled"], off["command"]), (True, False, "./sg-local install-launchd"))
        with mock.patch.object(web.sys, "platform", "darwin"), mock.patch.object(web.launchd, "installed", return_value=True):
            on = web.autostart_status()
        self.assertEqual((on["enabled"], on["command"]), (True, "./sg-local uninstall-launchd"))
        with mock.patch.object(web.sys, "platform", "linux"):
            other = web.autostart_status()
        self.assertEqual((other["supported"], other["enabled"], other["command"]), (False, None, None))
        self.assertIn("Only built in on macOS", other["note"])

    def test_schedule_saved_only_after_the_person_chooses(self) -> None:
        self.write_config()
        self.assertFalse(self.get_state()["schedule"]["saved"])
        status, _, _ = self.request("/api/schedule", method="POST", code=self.code, body={"mode": "always"})
        self.assertEqual(status, 200)
        self.assertTrue(self.get_state()["schedule"]["saved"])


class DiagnosticsApiTests(WebTestCase):
    def offline(self) -> mock._patch:
        # No test may reach slack.com: the probe and the name lookup are faked.
        return mock.patch.multiple(
            diagnostics,
            probe_slack=mock.Mock(return_value={"stage": "tls", "error": ssl.SSLCertVerificationError(1, "certificate verify failed"), "proxy": None, "tls_version": None, "date": None}),
            proxy_for=mock.Mock(return_value=None),
            check_dns=mock.Mock(return_value=diagnostics._check("dns", "pass", "Found slack.com.")),
        )

    def test_diagnostics_need_the_code(self) -> None:
        for path in ("/api/diagnostics", "/api/diagnostics/report"):
            status, body, _ = self.request(path)
            self.assertEqual(status, 401)
            self.assertEqual(body["error_code"], "access_code_wrong")

    def test_diagnostics_json(self) -> None:
        self.write_config([saved_workspace()])
        with self.offline():
            status, body, headers = self.request("/api/diagnostics", code=self.code, origin=DASHBOARD)
        self.assertEqual(status, 200, body)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), DASHBOARD)
        ids = [check["id"] for check in body["checks"]]
        self.assertEqual(ids, list(diagnostics.CHECK_IDS))
        tls = next(check for check in body["checks"] if check["id"] == "tls")
        self.assertEqual((tls["status"], tls["code"]), ("fail", "tls_untrusted"))
        self.assertTrue(body["generated_at"])
        self.assertNotIn("secret", json.dumps(body))

    def test_report_is_a_redacted_text_attachment(self) -> None:
        self.write_config([saved_workspace()])
        config.LOG_PATH.write_text(
            f"2026-11-20 10:00:00 INFO code {self.code} token=xoxc-secret-token d=xoxd-secret-cookie\n",
            encoding="utf-8",
        )
        with self.offline():
            status, body, headers = self.request("/api/diagnostics/report", code=self.code, origin=DASHBOARD)
        self.assertEqual(status, 200)
        self.assertIsInstance(body, str)
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="stillgreen-diagnostics.txt"')
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), DASHBOARD)
        self.assertIn("Content-Disposition", headers.get("Access-Control-Expose-Headers", ""))
        for secret in (self.code, "xoxc-secret-token", "xoxd-secret-cookie", "secret"):
            self.assertNotIn(secret, body)
        self.assertIn("Secure connection to Slack", body)
        self.assertIn("Do not turn off security checks", body)

    def test_report_reuses_the_last_run_and_busy_is_429(self) -> None:
        diagnostics.clear_cache()
        self.addCleanup(diagnostics.clear_cache)
        self.write_config([saved_workspace()])
        with self.offline():
            status, _, _ = self.request("/api/diagnostics", code=self.code, origin=DASHBOARD)
            self.assertEqual(status, 200)
            calls = diagnostics.probe_slack.call_count
            status, _, _ = self.request("/api/diagnostics/report", code=self.code, origin=DASHBOARD)
            self.assertEqual(status, 200)
            status, _, _ = self.request("/api/diagnostics", code=self.code, origin=DASHBOARD)
            self.assertEqual(status, 200)
            # Neither the report nor the second look contacted Slack again.
            self.assertEqual(diagnostics.probe_slack.call_count, calls)
        with mock.patch.object(diagnostics, "cached_checks", side_effect=diagnostics.DiagnosticsBusy("busy")):
            for path in ("/api/diagnostics?fresh=1", "/api/diagnostics/report"):
                status, body, _ = self.request(path, code=self.code, origin=DASHBOARD)
                self.assertEqual(status, 429)
                self.assertEqual(body["error_code"], "diagnostics_busy")
                self.assertEqual(body["error_info"]["title"], "Already checking")

    def test_fresh_asks_for_a_new_run_within_limits(self) -> None:
        with mock.patch.object(diagnostics, "cached_checks", return_value={"generated_at": "x", "checks": []}) as cached:
            self.request("/api/diagnostics?fresh=1", code=self.code, origin=DASHBOARD)
            self.assertEqual(cached.call_args.kwargs["max_age"], diagnostics.FRESH_SECONDS)
            self.request("/api/diagnostics", code=self.code, origin=DASHBOARD)
            self.assertEqual(cached.call_args.kwargs["max_age"], diagnostics.CACHE_SECONDS)

    def test_unknown_origin_cannot_read_diagnostics(self) -> None:
        status, body, headers = self.request("/api/diagnostics/report", code=self.code, origin="https://evil.example")
        self.assertEqual(status, 403)
        self.assertEqual(body["error_code"], "origin_not_allowed")


class CatalogueAdditionTests(WebTestCase):
    def test_new_codes_are_in_the_catalogue(self) -> None:
        for code in ("invalid_input", "workspace_invalid", "origin_not_allowed", "host_not_allowed", "not_found"):
            self.assertEqual(errors.entry(code)["code"], code)

    def test_config_error_can_name_its_code(self) -> None:
        self.assertEqual(errors.explain(config.ConfigError("x", code="dns_failed"))["code"], "dns_failed")
        self.assertEqual(errors.explain(config.ConfigError("bad value"))["code"], "invalid_input")
