"""Command-line interface for slack-green-local."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import stat
import sys
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__, config, diagnostics, errors, launchd, schedule, state, web
from .slack import SlackClient

HONESTY_NOTE = (
    "Stillgreen keeps a Slack connection open the way the Slack web app does. "
    "Slack decides your final status."
)

REVOKE_TIP = """To make sure the saved Slack login can no longer be used:
  - Sign out of Slack in the browser you captured it from, or
  - In Slack, open Account settings (https://slack.com/account/settings) and
    click "Sign out of all other sessions". Do this from the Slack app or
    another browser, not from the browser you captured the login from."""

TOKEN_HELP = """\
How to get the two Slack values
--------------------------------
Use the Slack web app in a desktop browser (not the desktop app):

1. Open your workspace at https://app.slack.com and sign in.
2. Open DevTools (Cmd+Option+I on macOS), select Network, and reload.
   Find the xoxc token using either network path:
     - Filter by "api", open a request such as client.boot or
       users.getPresence, and look in Payload/Form Data for "token".
     - Or filter by "WS", open wss-primary.slack.com, and copy the
       token=xoxc-... value from the Request URL (stop at "&").
   Newer Slack builds may not keep the token in localStorage. If yours
   still does, this also works in the Console:
     JSON.parse(localStorage.localConfig_v2).teams
3. In DevTools, open Application > Cookies > https://app.slack.com
   and copy the value of the cookie named "d" (starts with xoxd-).
   It is HttpOnly, so document.cookie will not show it.

The tokens are read with hidden input, verified against Slack, and stored
only in your local config file with mode 0600. Treat them like a password:
they grant access to your Slack account.
"""


def _eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def _fail(message: str) -> int:
    _eprint(f"error: {message}")
    return 1


def _print_problem(exc: BaseException, *, local: bool = False) -> None:
    """Explain an exception in plain words (from sg_local.errors)."""
    info = errors.explain(exc, local=local)
    _eprint(errors.format_text(info))
    # Stillgreen's own words for a settings problem say which file or value;
    # for an unknown problem the redacted text is the only clue.
    own_words = isinstance(exc, config.ConfigError) and not getattr(exc, "code", None)
    if (own_words and info["code"] != "invalid_input") or info["code"] == "unknown":
        detail = diagnostics.redact_report(str(exc), secrets=[])
        if detail:
            _eprint(f"Details: {detail}")


def _explain_from_log() -> None:
    """After a failed start, explain a known problem found in the log."""
    code = errors.classify_text(state.tail_log(15), default="")
    if code:
        _eprint(errors.format_text(errors.entry(code)))


def _workspaces(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    return [w for w in cfg.get("workspaces", []) if isinstance(w, dict)]


def _table(headers: list[str], rows: list[list[str]]) -> None:
    if not rows:
        return
    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))
    print("  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)))


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = config.parse_iso(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _human_duration(seconds: float) -> str:
    total = max(0, int(seconds))
    days, remainder = divmod(total, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, secs = divmod(remainder, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def _until_text(value: Any, empty: str = "until resumed") -> str:
    parsed = _parse_iso(value)
    if not parsed:
        return empty
    remaining = (parsed - datetime.now(timezone.utc)).total_seconds()
    local = parsed.astimezone().strftime("%Y-%m-%d %H:%M %Z")
    if remaining <= 0:
        return f"expired at {local}"
    return f"until {local} ({_human_duration(remaining)} left)"


def _next_change(cfg: dict[str, Any]) -> str:
    boundary = schedule.next_boundary(cfg.get("schedule", {}))
    if not boundary:
        return ""
    return boundary.strftime("%a %Y-%m-%d %H:%M %Z")


def _daemon_running() -> int | None:
    return state.daemon_pid()


def _wait_for_daemon(timeout: float = 15.0) -> int | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pid = state.daemon_pid()
        if pid:
            return pid
        time.sleep(0.2)
    return None


# --------------------------------------------------------------------- add


def cmd_add(args: argparse.Namespace) -> int:
    print("Add a Slack workspace")
    print(f"Config: {config.CONFIG_PATH}")
    print()
    try:
        xoxc = config.clean_xoxc(getpass.getpass("Slack xoxc token (hidden): "))
        xoxd = config.clean_xoxd(getpass.getpass("Slack xoxd cookie (hidden): "))
    except (EOFError, KeyboardInterrupt):
        _eprint("\nCancelled.")
        return 1

    if not xoxc and not xoxd:
        return _fail("no tokens entered")

    print("Verifying with Slack...")
    identity = web.verify_tokens(xoxc, xoxd)
    workspace = config.update_config(
        lambda cfg: config.upsert_workspace(cfg, identity, xoxc, xoxd, args.name or "")
    )
    team_id, user_id = workspace["team_id"], workspace["user_id"]
    print()
    print(f"Added {workspace['name']} (team {team_id}, user {user_id}).")
    print("Tokens verified and stored locally; values were not printed.")
    if _daemon_running():
        print("The running daemon will pick up the change automatically.")
    else:
        print("Next: ./sg-local start")
    return 0


# -------------------------------------------------------------------- list


def cmd_list(_: argparse.Namespace) -> int:
    cfg = config.load_config()
    summary = schedule.schedule_summary(cfg["schedule"])
    print(f"Schedule: {summary}")
    print(f"Config:   {config.CONFIG_PATH}")
    print()

    workspaces = _workspaces(cfg)
    if not workspaces:
        print("No workspaces yet. Run: ./sg-local add")
        return 0

    pid = _daemon_running()
    runtime = state.read_state() if pid else None
    live = {
        str(entry.get("team_id")): entry
        for entry in (runtime or {}).get("workspaces", [])
        if isinstance(entry, dict)
    }
    rows: list[list[str]] = []
    for workspace in workspaces:
        team_id = str(workspace.get("team_id") or "?")
        entry = live.get(team_id, {})
        if pid:
            status = str(entry.get("status") or "starting") if runtime else "starting"
        else:
            status = "daemon stopped"
        rows.append(
            [
                str(workspace.get("name") or "?"),
                team_id,
                str(workspace.get("user_id") or "?"),
                status,
                "yes" if workspace.get("paused") else "no",
            ]
        )
    _table(["NAME", "TEAM", "USER", "STATUS", "PAUSED"], rows)
    return 0


# ------------------------------------------------------------------ remove


def cmd_remove(args: argparse.Namespace) -> int:
    def change(cfg: dict[str, Any]) -> dict[str, Any]:
        index, workspace = config.find_workspace(cfg, args.workspace)
        del cfg["workspaces"][index]
        return workspace

    workspace = config.update_config(change)
    name = workspace.get("name") or workspace.get("team_id")
    print(f"Removed {name}. Its saved Slack login was deleted from this computer.")
    if _daemon_running():
        print("The daemon will stop that workspace's session within a few seconds.")
    print()
    print(REVOKE_TIP)
    return 0


# ---------------------------------------------------------------- schedule


def _print_schedule_detail(cfg: dict[str, Any]) -> None:
    current = cfg["schedule"]
    print(f"Schedule: {schedule.schedule_summary(current)}")
    active = schedule.is_within_schedule(current)
    print(f"Now:      {'active' if active else 'inactive'}")
    if current.get("mode") == "scheduled":
        nxt = _next_change(cfg)
        if nxt:
            print(f"Next change: {nxt}")
    print(f"Timezone: {current.get('timezone', 'local')}")


def cmd_schedule(args: argparse.Namespace) -> int:
    action = getattr(args, "schedule_action", None) or "show"

    if action == "show":
        _print_schedule_detail(config.load_config())
        return 0

    if action == "always":
        config.update_config(lambda cfg: cfg["schedule"].update(mode="always", saved_at=config.now_iso()))
        print("Schedule set to always on.")
        if _daemon_running():
            print("The daemon will apply it within a few seconds.")
        return 0

    if action == "set":
        if not any(
            [
                args.days is not None,
                args.start is not None,
                args.end is not None,
                args.timezone_value is not None,
            ]
        ):
            return _fail("pass --days, --start, --end, or --timezone (or use 'schedule show')")

        def change(cfg: dict[str, Any]) -> dict[str, Any]:
            current = cfg["schedule"]
            currently_scheduled = current.get("mode") == "scheduled"
            days = args.days
            if days is None:
                days = current.get("active_days") if currently_scheduled else "weekdays"
            start = args.start or (current.get("start_time") if currently_scheduled else None) or "09:00"
            end = args.end or (current.get("end_time") if currently_scheduled else None) or "17:00"
            tz = args.timezone_value or current.get("timezone") or "local"
            cfg["schedule"] = {**schedule.make_schedule(days, start, end, tz), "saved_at": config.now_iso()}
            return cfg["schedule"]

        updated = config.update_config(change)
        print(f"Schedule set: {schedule.schedule_summary(updated)}")
        print(f"Now: {'active' if schedule.is_within_schedule(updated) else 'inactive'}")
        if _daemon_running():
            print("The daemon will apply it within a few seconds.")
        return 0

    return _fail(f"unknown schedule action {action!r}")


# ---------------------------------------------------------- daemon control


def _update_note(pid: int | None) -> None:
    """Say so when the running daemon is older than the files on disk."""
    runtime = state.read_state() if pid else None
    if runtime and runtime.get("pid") in (None, pid) and state.update_pending(runtime):
        print(state.UPDATE_MESSAGE)


def cmd_start(_: argparse.Namespace) -> int:
    pid = _daemon_running()
    if pid:
        print(f"Daemon is already running (pid {pid}).")
        _update_note(pid)
        return 0

    if launchd.loaded():
        ok, message = launchd.kickstart()
        print(message)
        if not ok:
            return 1
        pid = _wait_for_daemon()
    else:
        ok, message = state.start_daemon()
        print(message)
        if not ok:
            _explain_from_log()
            return 1
        pid = _wait_for_daemon()

    if not pid:
        _explain_from_log()
        return _fail(f"daemon is not running; check: {config.LOG_PATH}")

    cfg = config.load_config()
    print(f"Daemon running (pid {pid}).")
    print(f"Schedule: {schedule.schedule_summary(cfg['schedule'])}")
    if not schedule.is_within_schedule(cfg["schedule"]):
        nxt = _next_change(cfg)
        print("Currently outside the schedule; sessions will start at the next window"
              + (f" ({nxt})." if nxt else "."))
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    ok, message = state.stop_daemon()
    print(message)
    if ok and launchd.loaded():
        print("The launchd job is still installed and will start the daemon at next login.")
    return 0 if ok else 1


def cmd_restart(_: argparse.Namespace) -> int:
    if launchd.loaded():
        ok, message = launchd.kickstart()
        print(message)
        if not ok:
            return 1
        pid = _wait_for_daemon()
    else:
        ok, message = state.stop_daemon()
        if not ok:
            _eprint(message)
            return 1
        ok, message = state.start_daemon()
        print(message)
        if not ok:
            _explain_from_log()
            return 1
        pid = _wait_for_daemon()

    if not pid:
        _explain_from_log()
        return _fail(f"daemon is not running; check: {config.LOG_PATH}")
    print(f"Daemon running (pid {pid}).")
    return 0


# ------------------------------------------------------------------ status


def cmd_status(_: argparse.Namespace) -> int:
    cfg = config.load_config()
    pid = _daemon_running()
    runtime = state.read_state()
    print(f"Daemon:   {state.status_label()}")

    if pid and runtime and runtime.get("pid") not in (None, pid):
        runtime = None
    if pid and runtime and state.update_pending(runtime):
        print(f"Update:   {state.UPDATE_MESSAGE}")

    if pid and runtime:
        started = _parse_iso(runtime.get("started_at"))
        if started:
            uptime = (datetime.now(timezone.utc) - started).total_seconds()
            print(f"Uptime:   {_human_duration(uptime)}")
        updated = _parse_iso(runtime.get("updated_at"))
        if updated:
            age = (datetime.now(timezone.utc) - updated).total_seconds()
            if age > 30:
                print(f"Warning:  runtime state is {_human_duration(age)} old")
    elif runtime and not pid and runtime.get("stopped_at"):
        print(f"Last stop: {runtime.get('stopped_at')}")

    print(f"Schedule: {schedule.schedule_summary(cfg['schedule'])} "
          f"({'active' if schedule.is_within_schedule(cfg['schedule']) else 'inactive'})")

    pause = None
    stay = None
    if runtime and pid:
        pause = runtime.get("pause_until") if runtime.get("paused") else None
        stay = runtime.get("stay_until") if runtime.get("stay_active") else None
        if runtime.get("paused"):
            print(f"Pause:    {_until_text(pause)}")
    else:
        pause_file = config.read_pause()
        stay_file = config.read_stay()
        if pause_file:
            pause = pause_file.get("until")
            print(f"Pause:    {_until_text(pause)}")
        if stay_file:
            stay = stay_file.get("until")
            print(f"Stay:     {_until_text(stay)}")

    if pid and runtime and runtime.get("stay_active"):
        print(f"Stay:     {_until_text(stay)}")

    print()
    workspaces = _workspaces(cfg)
    if not workspaces:
        print("No workspaces configured. Run: ./sg-local add")
        print(f"Config: {config.CONFIG_PATH}")
        return 0

    live = {
        str(entry.get("team_id")): entry
        for entry in (runtime or {}).get("workspaces", [])
        if isinstance(entry, dict)
    }
    rows: list[list[str]] = []
    problems: list[tuple[str, dict[str, str]]] = []
    for workspace in workspaces:
        team_id = str(workspace.get("team_id") or "?")
        name = str(workspace.get("name") or "?")
        entry = live.get(team_id, {})
        # Login and Slack status are only known while the daemon runs; a
        # rejected login stays rejected until it is captured again.
        login = str(entry.get("auth") or "unknown")
        presence = str(entry.get("presence") or "unknown")
        confirmed = _ago(entry.get("presence_verified_at"))
        if pid and runtime:
            status_text = str(entry.get("status") or "starting")
            detail = str(entry.get("reason") or "")
            if entry.get("last_error"):
                code = entry.get("last_error_code") or errors.classify_text(str(entry["last_error"]))
                info = errors.entry(str(code))
                detail = info["title"]
                problems.append((name, info))
            stats = entry.get("stats") or {}
            if stats and entry.get("connected") and not entry.get("last_error"):
                detail = (
                    f"pings={stats.get('pings', 0)} tickles={stats.get('tickles', 0)} "
                    f"checks={stats.get('presence_checks', 0)} "
                    f"reconnects={stats.get('reconnects', 0)}"
                )
            if not entry.get("connected"):
                presence = "unknown"
        elif pid:
            status_text = "starting"
            detail = "waiting for daemon state"
            presence = "unknown"
        else:
            status_text = "stopped" if not workspace.get("paused") else "paused"
            detail = "daemon not running"
            login = "rejected" if login == "rejected" else "unknown"
            presence = "unknown"
        rows.append([name, team_id, status_text, login, presence.replace("_", " "), confirmed, detail])
    _table(["NAME", "TEAM", "STATUS", "LOGIN", "SLACK SHOWS", "LAST CONFIRMED", "DETAIL"], rows)
    if pid and runtime and not runtime.get("workspaces"):
        print("Runtime state has no workspace entries yet; waiting for the daemon.")
    for name, info in problems:
        print()
        print(f"{name}: {info['title']}")
        print(f"  {info['message']}")
        print(f"  What to do: {info['action']}")
    print()
    print(HONESTY_NOTE)
    print("LAST CONFIRMED is the last time Slack itself said you were active.")
    print(f"Config: {config.CONFIG_PATH}")
    return 0


def _ago(value: Any) -> str:
    moment = _parse_iso(value)
    if not moment:
        return "never"
    seconds = (datetime.now(timezone.utc) - moment).total_seconds()
    if seconds < 60:
        return "just now"
    return f"{_human_duration(seconds)} ago"


# ---------------------------------------------------------- pause / resume


def cmd_pause(args: argparse.Namespace) -> int:
    if args.workspace:
        if args.duration:
            return _fail("--for is for a global pause; a per-workspace pause lasts until resume")

        def change(cfg: dict[str, Any]) -> dict[str, Any]:
            _, workspace = config.find_workspace(cfg, args.workspace)
            workspace["paused"] = True
            workspace["paused_at"] = config.now_iso()
            return workspace

        workspace = config.update_config(change)
        print(f"Paused {workspace.get('name') or workspace.get('team_id')}.")
        if _daemon_running():
            print("The daemon will stop that session within a few seconds.")
        return 0

    until = config.now_plus(args.duration) if args.duration else None
    config.write_pause(until)
    print(f"Presence paused {_until_text(until.isoformat() if until else None)}.")
    if _daemon_running():
        print("The daemon will disconnect sessions within a few seconds.")
    stay = config.read_stay()
    if stay:
        print(f"Note: an active stay-online window overrides pause until {stay.get('until')}.")
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    if args.workspace:
        def resume_one(cfg: dict[str, Any]) -> tuple[dict[str, Any], bool]:
            _, workspace = config.find_workspace(cfg, args.workspace)
            was_paused = bool(workspace.get("paused"))
            workspace["paused"] = False
            workspace.pop("paused_at", None)
            return workspace, was_paused

        workspace, was_paused = config.update_config(resume_one)
        label = workspace.get("name") or workspace.get("team_id")
        print(f"Resumed {label}." if was_paused else f"{label} is not paused.")
        return 0

    config.clear_pause()

    def resume_all(cfg: dict[str, Any]) -> list[str]:
        names = []
        for workspace in _workspaces(cfg):
            if workspace.get("paused"):
                workspace["paused"] = False
                workspace.pop("paused_at", None)
                names.append(str(workspace.get("name") or workspace.get("team_id")))
        return names

    changed = config.update_config(resume_all)
    print("Resumed." if changed else "Global pause cleared.")
    if changed:
        print(f"Also resumed: {', '.join(changed)}")
    if config.read_stay():
        print("Note: a stay-online window is still active.")
    return 0


def cmd_stay(args: argparse.Namespace) -> int:
    if args.cancel:
        if args.duration or args.until:
            return _fail("pass a duration, --until or --cancel, not more than one")
        config.clear_stay()
        print("Stay-online window cleared.")
        return 0
    if args.duration and args.until:
        return _fail("pass either a duration or --until, not both")
    if not args.duration and not args.until:
        return _fail("pass a duration, e.g. 'sg-local stay 2h', or a time: 'sg-local stay --until 17:00'")
    until = config.parse_until(args.until) if args.until else config.now_plus(args.duration)
    config.write_stay(until)
    print(f"Staying online {_until_text(until.isoformat())} (overrides pause and schedule).")
    if not _daemon_running():
        print("Daemon is not running. Run: ./sg-local start")
    return 0


# ------------------------------------------------------------------ doctor


DOCTOR_MARKS = {"pass": "[ok]  ", "warn": "[warn]", "fail": "[fail]", "skip": "[skip]"}


def cmd_doctor(args: argparse.Namespace) -> int:
    failures = 0
    warnings = 0
    try:
        config.ensure_dirs()
    except config.ConfigError:
        pass  # the permission and settings checks below explain it

    def line(status: str, label: str, detail: str = "", action: str = "") -> None:
        nonlocal failures, warnings
        if status == "fail":
            failures += 1
        elif status == "warn":
            warnings += 1
        print(f"{DOCTOR_MARKS.get(status, '[info]')} {label}" + (f" - {detail}" if detail else ""))
        if action and status in {"warn", "fail"}:
            print(f"       What to do: {action}")

    print("Stillgreen doctor")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    if not args.offline:
        print("Checking the connection to Slack (no login is sent)...")
    result = diagnostics.run_checks(network=not args.offline)
    for check in result["checks"]:
        line(check["status"], check["label"], check["detail"], check.get("action", ""))

    try:
        cfg = config.load_config()
    except config.ConfigError:
        cfg = config.default_config()
    cfg_ok, cfg_message = schedule.validate_schedule(cfg.get("schedule", {}))
    if cfg_ok:
        line("pass", "Schedule", schedule.schedule_summary(cfg["schedule"]))
    else:
        line("fail", "Schedule", cfg_message, "Set it again with ./sg-local schedule set, or use ./sg-local schedule always.")

    if sys.platform == "darwin":
        if launchd.installed() and launchd.loaded():
            line("pass", "Start at login", str(launchd.PLIST_PATH))
        elif launchd.installed():
            line("warn", "Start at login", "installed but not loaded", "Run ./sg-local install-launchd again.")
        else:
            print("[info] Start at login is not set up (optional: ./sg-local install-launchd)")
        print("[info] Stillgreen stops while the Mac sleeps. To stay connected, keep the Mac awake or use a server.")

    if args.check_tokens:
        workspaces = _workspaces(cfg)
        if not workspaces:
            line("warn", "Token check", "no workspaces to check", "Add one with ./sg-local add.")
        for workspace in workspaces:
            valid, _ = config.validate_workspace(workspace)
            if not valid:
                continue
            name = workspace.get("name") or workspace.get("team_id")
            client = SlackClient(
                str(workspace["xoxc"]), str(workspace["xoxd"]), str(workspace["user_id"])
            )
            try:
                identity = client.auth_test()
                if str(identity.get("team_id")) != str(workspace.get("team_id")):
                    line("warn", f"Token check: {name}", "the login belongs to a different workspace", "Add it again with ./sg-local add.")
                elif str(identity.get("user_id")) != str(workspace.get("user_id")):
                    line("warn", f"Token check: {name}", "the login belongs to a different person", "Add it again with ./sg-local add.")
                else:
                    line("pass", f"Token check: {name}", "Slack accepts the saved login")
            except Exception as exc:
                info = errors.explain(exc)
                status = "fail" if info["code"] == "slack_auth_rejected" else "warn"
                line(status, f"Token check: {name}", f"{info['title']}. {info['message']}", info["action"])

    if args.report:
        target = Path(args.report).expanduser()
        try:
            text = diagnostics.report_text(result)
            config.atomic_write(target, text, mode=0o600)
        except OSError as exc:
            print()
            _print_problem(exc)
            return 1
        print()
        print(f"Saved a diagnostics report to {target}")
        print("It has no tokens, cookies or access codes. Read it before you share it.")

    print()
    print(HONESTY_NOTE)
    if failures:
        print(f"Result: {failures} problem(s), {warnings} warning(s).")
        return 1
    print(f"Result: all checks passed ({warnings} warning(s)).")
    return 0


# -------------------------------------------------------------------- logs


def cmd_logs(args: argparse.Namespace) -> int:
    lines = max(1, int(args.lines))
    if not config.LOG_PATH.exists():
        if not args.follow:
            return _fail(f"no log file yet at {config.LOG_PATH}")
        print(f"Waiting for {config.LOG_PATH} ...")
    else:
        text = state.tail_log(lines)
        if text:
            print(text)

    if not args.follow:
        return 0

    path = config.LOG_PATH
    current = None
    try:
        while True:
            if not path.exists():
                time.sleep(0.5)
                continue
            if current is None:
                current = open(path, "r", encoding="utf-8", errors="replace")
                current.seek(0, os.SEEK_END)
            line = current.readline()
            if line:
                print(line, end="", flush=True)
                continue
            try:
                inode = path.stat().st_ino
            except OSError:
                inode = None
            if inode is not None and os.fstat(current.fileno()).st_ino != inode:
                current.close()
                current = None
                continue
            time.sleep(0.5)
    except KeyboardInterrupt:
        print()
        return 0
    finally:
        if current is not None:
            current.close()


# ------------------------------------------------------------------- web


def _control_page_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
            return json.loads(response.read()).get("app") == "stillgreen"
    except (OSError, ValueError):
        return False


def _code_accepted(port: int, code: str) -> bool:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/state", headers={"Authorization": f"Bearer {code}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status == 200
    except (OSError, ValueError):
        return False


def cmd_web(args: argparse.Namespace) -> int:
    """Show or serve the control page. Local mode is loopback-only by default."""
    config.ensure_dirs()
    host = args.host or os.environ.get("SG_LOCAL_WEB_HOST", "127.0.0.1")
    port = args.port if args.port is not None else web.port_from_env()
    if args.show_code:
        print(web.load_code())
        return 0
    loopback = host in web.LOOPBACK_HOSTS
    if not loopback and _weak_env_code():
        return _fail(WEAK_CODE_MESSAGE)
    if not loopback and _control_page_up(port):
        return _fail(
            f"the background daemon already serves port {port} on this machine; "
            "pick another --port, or start the daemon with SG_LOCAL_DAEMON_WEB=0"
        )
    if args.daemon and not state.daemon_pid():
        if not loopback:
            # This command serves the page itself; keep the daemon off the port.
            os.environ["SG_LOCAL_DAEMON_WEB"] = "0"
        ok, message = state.start_daemon()
        print(message)
        if not ok:
            return 1
        deadline = time.monotonic() + 8
        while loopback and time.monotonic() < deadline and not _control_page_up(port):
            time.sleep(0.2)

    url = f"http://127.0.0.1:{port}"
    if loopback and _control_page_up(port):
        # The background daemon already serves the page on this port.
        code = web.load_code()
        print(f"Stillgreen control page: {url}")
        print(f"Access code: {code}")
        print("It is served by the background daemon; stop it with: ./sg-local stop")
        if not _code_accepted(port, code):
            _eprint(
                "warning: the running daemon does not accept this code. It was started "
                "with different settings (for example SG_LOCAL_BRIDGE_CODE); restart it "
                "from this shell with: ./sg-local restart"
            )
        if args.open:
            webbrowser.open(url)
        return 0

    web.load_code()
    if not loopback:
        print(f"Listening on {host}:{port}. Anyone who can reach that address can try the code.")
    if args.open:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    web.serve(host, port)
    return 0


WEAK_CODE_MESSAGE = (
    "SG_LOCAL_BRIDGE_CODE is too short for a server on the network: use at least "
    "16 random characters, or unset it to use a generated code"
)


def _weak_env_code() -> bool:
    # A generated code (SG-XXXX-XXXX-XXXX, about 60 random bits) is fine; a
    # hand-picked one must be long enough to resist guessing.
    code = web.env_code()
    return bool(code) and len(code) < 16


def _drop_root_privileges() -> None:
    """In the container, fix volume ownership as root, then run as the app user.

    Some hosts (Fly.io) mount a fresh root-owned volume at /data that the
    unprivileged user cannot write. The image sets SG_LOCAL_RUN_AS, so every
    `sg-local` command started as root (the container itself, `docker exec`,
    `fly ssh console`) hands its files to that user and drops root.
    """
    name = os.environ.get("SG_LOCAL_RUN_AS")
    if not name or os.getuid() != 0:
        return
    import pwd

    user = pwd.getpwnam(name)
    for folder in {config.CONFIG_DIR.parent, config.CONFIG_DIR, config.STATE_DIR.parent, config.STATE_DIR}:
        folder.mkdir(parents=True, exist_ok=True)
        for path in [folder, *folder.iterdir()]:
            if path.is_symlink():
                continue
            os.chown(path, user.pw_uid, user.pw_gid)
    os.setgroups([])
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
    os.environ["HOME"] = user.pw_dir


def cmd_cloud(args: argparse.Namespace) -> int:
    """Run the daemon and its control page for a server or container.

    The page listens on all interfaces (put HTTPS in front of it), logs go to
    the console, and the access code is never printed.
    """
    if _weak_env_code():
        return _fail(WEAK_CODE_MESSAGE)
    if args.port is not None:
        port = args.port
    elif os.environ.get("PORT"):
        # The port hosts such as Fly.io, Render and Railway route traffic to.
        try:
            port = int(os.environ["PORT"])
        except ValueError:
            return _fail("PORT must be a port number")
    else:
        port = web.port_from_env()
    config.ensure_dirs()
    created = not web.load_code(create=False)
    web.load_code()
    if created:
        print("A new access code was created. Read it with: sg-local web --show-code", flush=True)
    env = {
        **os.environ,
        # Only this command makes the daemon listen beyond this machine.
        "SG_LOCAL_DAEMON_WEB_HOST": args.host,
        "SG_LOCAL_WEB_PORT": str(port),
        "SG_LOCAL_DAEMON_WEB": "1",
        "SG_LOCAL_LOG_STDOUT": "1",
        "PYTHONUNBUFFERED": "1",
    }
    # Replace this process with the daemon, so the container's main process is
    # the daemon itself and is recognised as one (see state.DAEMON_MARKER).
    # Start from the program folder: "-m" puts the current folder first on
    # the module search path, so never let it be some other folder.
    os.chdir(config.PROJECT_ROOT)
    os.execve(sys.executable, [sys.executable, "-m", state.DAEMON_MARKER], env)
    return 0  # not reached


# ---------------------------------------------------------------- launchd


def cmd_install_launchd(_: argparse.Namespace) -> int:
    if sys.platform != "darwin":
        return _fail("launchd is only available on macOS")
    config.ensure_dirs()
    pid = _daemon_running()
    if pid:
        ok, message = state.stop_daemon()
        print(message)
        if not ok:
            return 1
    ok, message = launchd.install(sys.executable)
    print(message)
    if not ok:
        return 1
    pid = _wait_for_daemon()
    if pid:
        print(f"Auto-start installed; daemon running (pid {pid}).")
    else:
        print(f"Auto-start installed, but the daemon is not running yet. Check: {config.LOG_PATH}")
    print("It will start automatically at login. Uninstall with: ./sg-local uninstall-launchd")
    return 0


def cmd_uninstall_launchd(_: argparse.Namespace) -> int:
    if sys.platform != "darwin":
        return _fail("launchd is only available on macOS")
    ok, message = launchd.uninstall()
    print(message)
    if not ok:
        return 1
    print("Auto-start removed. Your tokens and config were left in place.")
    return 0


# --------------------------------------------------------------- uninstall


# The files Stillgreen writes. uninstall deletes only these (never a whole
# folder it was pointed at), then removes the folder if it is empty.
CONFIG_FILES = ("config.json", "bridge.json", ".config.lock")
STATE_FILES = (
    "state.json",
    "daemon.pid",
    "daemon.lock",
    "daemon.log",
    "pause.json",
    "stay.json",
    "network.json",
)
# Rotated logs (daemon.log.1 ...) and the temporary files atomic_write makes
# next to each file (".config.json.k3j_x9a2").
_ROTATED_LOG = re.compile(r"^daemon\.log\.\d{1,3}$")


def _is_temp_of(name: str, known: tuple[str, ...]) -> bool:
    return any(
        name.startswith(f".{base}.") and re.fullmatch(r"[A-Za-z0-9_]{6,16}", name[len(base) + 2:])
        for base in known
    )


def _stillgreen_file(name: str, known: tuple[str, ...]) -> bool:
    if name in known or _is_temp_of(name, known):
        return True
    return "daemon.log" in known and bool(_ROTATED_LOG.match(name))


def _shared_folders() -> set[Path]:
    """Folders other programs use too. Never treat one as Stillgreen's own."""
    home = Path.home()
    names = [
        "", ".config", ".local", ".local/state", ".local/share", ".cache", "Library",
        "Library/Application Support", "Library/Preferences", "Library/LaunchAgents",
        "Documents", "Desktop", "Downloads", ".ssh",
    ]
    shared = {(home / name) for name in names}
    shared |= {Path(p) for p in ("/", "/etc", "/tmp", "/var", "/var/tmp", "/usr", "/opt", "/private", "/private/tmp", "/Users", "/home")}
    resolved = set()
    for path in shared:
        resolved.add(path)
        try:
            resolved.add(path.resolve())
        except OSError:
            pass
    return resolved


def _unsafe_to_delete(path: Path) -> str | None:
    """Why Stillgreen must not delete files in ``path``, or None.

    Guards against odd settings such as SG_LOCAL_CONFIG_DIR=$HOME.
    """
    try:
        resolved = path.resolve()
    except OSError as exc:
        return f"cannot check {path}: {exc}"
    if path.is_symlink():
        return f"{path} is a symbolic link"
    home = Path.home().resolve()
    if resolved == Path(resolved.anchor) or resolved == home or resolved in home.parents:
        return f"{path} is not a Stillgreen folder"
    if resolved in _shared_folders() or path in _shared_folders():
        return f"{path} is a shared folder that other programs use"
    program = config.PROJECT_ROOT.resolve()
    if resolved == program or resolved in program.parents or program in resolved.parents:
        return f"{path} holds the Stillgreen program"
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError as exc:
        return f"cannot check {path}: {exc.strerror or exc}"
    if not stat.S_ISDIR(info.st_mode):
        return f"{path} is not a folder"
    if info.st_uid != os.getuid():
        return f"{path} belongs to another user"
    return None


def _remove_stillgreen_files(folder: Path, known: tuple[str, ...]) -> tuple[list[str], list[str]]:
    """Delete Stillgreen's own files in ``folder``, then the folder if empty.

    Returns (problems, names left in place). Links are removed as links and
    never followed; other folders inside are never entered.
    """
    problems: list[str] = []
    try:
        names = sorted(os.listdir(folder))
    except OSError as exc:
        return [f"could not read {folder}: {exc.strerror or exc}"], []
    left: list[str] = []
    for name in names:
        target = folder / name
        if not _stillgreen_file(name, known):
            left.append(name)
            continue
        try:
            info = os.lstat(target)
        except FileNotFoundError:
            continue
        except OSError as exc:
            problems.append(f"could not check {target}: {exc.strerror or exc}")
            continue
        if stat.S_ISDIR(info.st_mode):
            left.append(name)
            continue
        try:
            os.unlink(target)
        except OSError as exc:
            problems.append(f"could not delete {target}: {exc.strerror or exc}")
    if not left and not problems:
        try:
            os.rmdir(folder)
        except OSError as exc:
            problems.append(f"could not delete {folder}: {exc.strerror or exc}")
    return problems, left


def cmd_uninstall(args: argparse.Namespace) -> int:
    folders = [
        (config.CONFIG_DIR, "your saved Slack logins (config.json) and the access code (bridge.json)"),
        (config.STATE_DIR, "logs, status, and pause and stay settings"),
    ]
    agent = sys.platform == "darwin" or launchd.installed()
    print("This removes Stillgreen's data from this computer:")
    print()
    for path, what in folders:
        print(f"  - {path}")
        print(f"      {what}")
    if agent:
        print(f"  - {launchd.PLIST_PATH}")
        print("      the login item that starts Stillgreen when you log in (launchd agent)")
    print()
    print("Stillgreen is stopped first if it is running.")
    print(f"The program folder is not deleted: {config.PROJECT_ROOT}")
    print("The browser extension is not removed: do that in Chrome (steps below).")
    print()

    for path, _ in folders:
        problem = _unsafe_to_delete(path)
        if problem:
            return _fail(f"{problem}; nothing was deleted. Delete Stillgreen's files by hand.")

    if not args.yes:
        try:
            answer = input('Type "delete" to remove all of this: ')
        except EOFError:
            answer = ""
        if answer.strip().lower() != "delete":
            print("Nothing was deleted.")
            if not answer:
                print("To confirm without typing, run: ./sg-local uninstall --yes")
            return 1

    if agent:
        ok, message = launchd.uninstall()
        print(f"Login item: {message}")
        if not ok:
            return _fail("could not remove the login item; nothing else was deleted")
    ok, message = state.stop_daemon()
    print(f"Stillgreen: {message}")
    if not ok:
        return _fail("could not stop Stillgreen; nothing else was deleted. Stop it and try again.")

    failed = False
    for path, known in ((config.CONFIG_DIR, CONFIG_FILES), (config.STATE_DIR, STATE_FILES)):
        if not os.path.lexists(path):
            print(f"Already gone: {path}")
            continue
        problems, left = _remove_stillgreen_files(path, known)
        for problem in problems:
            failed = True
            _eprint(f"error: {problem}")
        if left:
            print(f"Deleted Stillgreen's files in {path}, but kept the folder.")
            print("  These files were not made by Stillgreen, so they were left in place:")
            for name in left[:20]:
                print(f"    {name}")
            if len(left) > 20:
                print(f"    ... and {len(left) - 20} more")
        elif not problems:
            print(f"Deleted: {path}")

    print()
    if web.env_code():
        print("Note: SG_LOCAL_BRIDGE_CODE is set in your environment. Remove it there too.")
    print("Last steps, which Stillgreen cannot do for you:")
    print("  1. Remove the browser extension: open chrome://extensions and click Remove")
    print("     on Stillgreen.")
    print("  2. " + REVOKE_TIP.replace("\n", "\n     "))
    print(f"  3. To remove the program too, delete this folder: {config.PROJECT_ROOT}")
    return 1 if failed else 0


# -------------------------------------------------------------------- main


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sg-local",
        description=(
            "Stillgreen keeps a Slack connection open the way the Slack web app does,\n"
            "so Slack can show you as active. Slack decides your final status;\n"
            "Stillgreen cannot promise it."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Your Slack login is stored only in the local settings file. Nothing is\n"
            "sent anywhere except Slack. Use this only on workspaces where you have\n"
            "permission; your employer's rules may not allow it.\n"
            "Something wrong? Run: ./sg-local doctor"
        ),
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command")

    add = sub.add_parser(
        "add",
        help="add or update a workspace (hidden token prompt)",
        description="Verify and store Slack tokens for one workspace.",
        epilog=TOKEN_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add.add_argument("--name", help="optional display name for this workspace")
    add.set_defaults(func=cmd_add)

    list_cmd = sub.add_parser("list", help="list configured workspaces")
    list_cmd.set_defaults(func=cmd_list)

    remove = sub.add_parser("remove", help="remove a workspace by name or team ID")
    remove.add_argument("workspace", help="workspace name or team ID")
    remove.set_defaults(func=cmd_remove)

    sched = sub.add_parser("schedule", help="show or change the presence schedule")
    sched_sub = sched.add_subparsers(dest="schedule_action")
    sched_sub.add_parser("show", help="show the schedule")
    sched_sub.add_parser("always", help="help all the time (no schedule)")
    sched_set = sched_sub.add_parser("set", help="set a weekly schedule")
    sched_set.add_argument(
        "--days",
        help="days, e.g. 'mon-fri', 'weekdays', 'weekends', or 'mon,wed,fri'",
    )
    sched_set.add_argument("--start", help="start time, 24-hour HH:MM (default 09:00)")
    sched_set.add_argument("--end", help="end time, 24-hour HH:MM (default 17:00)")
    sched_set.add_argument(
        "--timezone",
        dest="timezone_value",
        help="IANA timezone (America/New_York) or 'local' (default)",
    )
    sched.set_defaults(func=cmd_schedule)

    start = sub.add_parser("start", help="start the background daemon")
    start.set_defaults(func=cmd_start)
    stop = sub.add_parser("stop", help="stop the background daemon")
    stop.set_defaults(func=cmd_stop)
    restart = sub.add_parser("restart", help="restart the background daemon")
    restart.set_defaults(func=cmd_restart)
    status = sub.add_parser(
        "status", help="show the service, schedule, login and Slack status of each workspace"
    )
    status.set_defaults(func=cmd_status)

    pause = sub.add_parser("pause", help="pause presence (globally or one workspace)")
    pause.add_argument("--for", dest="duration", metavar="DURATION", help="e.g. 30m, 2h, 1d")
    pause.add_argument("--workspace", help="pause only this workspace until resume")
    pause.set_defaults(func=cmd_pause)

    resume = sub.add_parser("resume", help="resume presence")
    resume.add_argument("--workspace", help="resume only this workspace")
    resume.set_defaults(func=cmd_resume)

    stay = sub.add_parser(
        "stay", help="keep helping you look active for a while, even when paused or outside your schedule"
    )
    stay.add_argument("duration", nargs="?", help="e.g. 30m, 2h, 1d, 1w")
    stay.add_argument("--until", metavar="HH:MM", help="keep helping until this time today, e.g. 17:00")
    stay.add_argument("--cancel", action="store_true", help="cancel an active stay window")
    stay.set_defaults(func=cmd_stay)

    doctor = sub.add_parser(
        "doctor",
        help="check settings, the connection to Slack, and status; explain any problem",
    )
    doctor.add_argument(
        "--check-tokens",
        action="store_true",
        help="also check each saved login with Slack (sends the login to Slack only)",
    )
    doctor.add_argument(
        "--report",
        metavar="FILE",
        help="save a report to share when you ask for help (no tokens, cookies or access codes)",
    )
    doctor.add_argument(
        "--offline",
        action="store_true",
        help="skip the checks that contact Slack",
    )
    doctor.set_defaults(func=cmd_doctor)

    web_cmd = sub.add_parser(
        "web",
        help="open or serve the local control page (status, schedule, add workspace)",
    )
    web_cmd.add_argument("--host", default=os.environ.get("SG_LOCAL_WEB_HOST", "127.0.0.1"))
    web_cmd.add_argument("--port", type=int, default=None, help="port (default 8765 or SG_LOCAL_WEB_PORT)")
    web_cmd.add_argument("--daemon", action="store_true", help="start the background daemon, which serves the page")
    web_cmd.add_argument("--open", action="store_true", help="open the control surface in a browser")
    web_cmd.add_argument("--show-code", action="store_true", help="print the access code and exit")
    web_cmd.set_defaults(func=cmd_web)

    cloud = sub.add_parser(
        "cloud",
        help="run the daemon and control page on a server or in a container (put HTTPS in front)",
    )
    cloud.add_argument("--host", default=os.environ.get("SG_LOCAL_WEB_HOST", "0.0.0.0"))
    cloud.add_argument("--port", type=int, default=None, help="port (default $PORT, then SG_LOCAL_WEB_PORT, then 8765)")
    cloud.set_defaults(func=cmd_cloud)

    logs = sub.add_parser("logs", help="show or follow the daemon log")
    logs.add_argument("-n", "--lines", type=int, default=80, help="lines to show (default 80)")
    logs.add_argument("-f", "--follow", action="store_true", help="follow new log lines")
    logs.set_defaults(func=cmd_logs)

    install = sub.add_parser("install-launchd", help="auto-start the daemon at macOS login")
    install.set_defaults(func=cmd_install_launchd)
    uninstall = sub.add_parser(
        "uninstall-launchd", help="remove macOS login auto-start"
    )
    uninstall.set_defaults(func=cmd_uninstall_launchd)

    remove_all = sub.add_parser(
        "uninstall",
        help="stop Stillgreen and delete its settings, saved logins, logs and login item",
    )
    remove_all.add_argument("--yes", action="store_true", help='do not ask; delete at once (no "delete" prompt)')
    remove_all.set_defaults(func=cmd_uninstall)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        _drop_root_privileges()
    except (KeyError, OSError) as exc:
        return _fail(f"could not switch to the app user: {exc}")
    if not getattr(args, "command", None):
        parser.print_help()
        return 0
    try:
        return int(args.func(args))
    except config.ConfigError as exc:
        _print_problem(exc)
        return 2
    except KeyboardInterrupt:
        _eprint("interrupted")
        return 130
    except BrokenPipeError:
        return 0
    except Exception as exc:
        if os.environ.get("SG_LOCAL_DEBUG"):
            raise
        _print_problem(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
