"""Command-line interface for slack-green-local."""

from __future__ import annotations

import argparse
import getpass
import os
import stat
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any

from . import __version__, config, launchd, schedule, state, web
from .slack import SlackAPIError, SlackClient, redact

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


def _workspaces(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    return [w for w in cfg.get("workspaces", []) if isinstance(w, dict)]


def _find_workspace(cfg: dict[str, Any], query: str) -> tuple[int, dict[str, Any]]:
    text = query.strip()
    workspaces = _workspaces(cfg)
    for index, workspace in enumerate(workspaces):
        if str(workspace.get("team_id", "")).lower() == text.lower():
            return index, workspace
    matches = [
        (index, workspace)
        for index, workspace in enumerate(workspaces)
        if str(workspace.get("name", "")).lower() == text.lower()
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        ids = ", ".join(str(workspace.get("team_id")) for _, workspace in matches)
        raise config.ConfigError(
            f"workspace name {query!r} is ambiguous ({ids}); use the team ID"
        )
    raise config.ConfigError(f"no workspace matches {query!r}")


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
        parsed = datetime.fromisoformat(str(value))
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
    if not xoxc.startswith("xoxc-"):
        return _fail("the first value does not look like an xoxc- token")
    if not xoxd.startswith("xoxd-"):
        return _fail("the second value does not look like an xoxd- cookie")

    print("Verifying with Slack...")
    client = SlackClient(xoxc, xoxd)
    try:
        identity = client.auth_test()
    except SlackAPIError as exc:
        if exc.token_invalid:
            return _fail(f"Slack rejected these tokens ({exc.error})")
        return _fail(f"could not verify tokens: {exc.error}")
    except Exception as exc:
        return _fail(f"could not verify tokens: {redact(str(exc), xoxc, xoxd)}")

    team_id = str(identity.get("team_id") or "")
    user_id = str(identity.get("user_id") or "")
    team_name = str(identity.get("team") or identity.get("url") or team_id)
    if not team_id or not user_id:
        return _fail("Slack did not return a team/user identity")

    cfg = config.load_config()
    workspace = {
        "name": args.name or team_name,
        "team_id": team_id,
        "user_id": user_id,
        "xoxc": xoxc,
        "xoxd": xoxd,
        "added_at": config.now_iso(),
    }
    for index, existing in enumerate(_workspaces(cfg)):
        if str(existing.get("team_id")) == team_id:
            workspace["added_at"] = existing.get("added_at") or workspace["added_at"]
            workspace["paused"] = bool(existing.get("paused"))
            cfg["workspaces"][index] = workspace
            break
    else:
        cfg.setdefault("workspaces", []).append(workspace)

    config.save_config(cfg)
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
    cfg = config.load_config()
    index, workspace = _find_workspace(cfg, args.workspace)
    name = workspace.get("name") or workspace.get("team_id")
    del cfg["workspaces"][index]
    config.save_config(cfg)
    print(f"Removed {name}.")
    if _daemon_running():
        print("The daemon will stop that workspace's session within a few seconds.")
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
    cfg = config.load_config()

    if action == "show":
        _print_schedule_detail(cfg)
        return 0

    if action == "always":
        cfg["schedule"]["mode"] = "always"
        config.save_config(cfg)
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

        current = cfg["schedule"]
        currently_scheduled = current.get("mode") == "scheduled"
        days = args.days
        if days is None:
            days = current.get("active_days") if currently_scheduled else "weekdays"
        start = args.start or (current.get("start_time") if currently_scheduled else None) or "09:00"
        end = args.end or (current.get("end_time") if currently_scheduled else None) or "17:00"
        tz = args.timezone_value or current.get("timezone") or "local"
        cfg["schedule"] = schedule.make_schedule(days, start, end, tz)
        config.save_config(cfg)
        print(f"Schedule set: {schedule.schedule_summary(cfg['schedule'])}")
        print(f"Now: {'active' if schedule.is_within_schedule(cfg['schedule']) else 'inactive'}")
        if _daemon_running():
            print("The daemon will apply it within a few seconds.")
        return 0

    return _fail(f"unknown schedule action {action!r}")


# ---------------------------------------------------------- daemon control


def cmd_start(_: argparse.Namespace) -> int:
    pid = _daemon_running()
    if pid:
        print(f"Daemon is already running (pid {pid}).")
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
            return 1
        pid = _wait_for_daemon()

    if not pid:
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
            return 1
        pid = _wait_for_daemon()

    if not pid:
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
    for workspace in workspaces:
        team_id = str(workspace.get("team_id") or "?")
        entry = live.get(team_id, {})
        if pid and runtime:
            status_text = str(entry.get("status") or "starting")
            detail = str(entry.get("reason") or "")
            if entry.get("last_error"):
                detail = redact(str(entry["last_error"]))
            stats = entry.get("stats") or {}
            if stats and entry.get("connected"):
                detail = (
                    f"pings={stats.get('pings', 0)} tickles={stats.get('tickles', 0)} "
                    f"checks={stats.get('presence_checks', 0)} "
                    f"reconnects={stats.get('reconnects', 0)}"
                )
        elif pid:
            status_text = "starting"
            detail = "waiting for daemon state"
        else:
            status_text = "stopped" if not workspace.get("paused") else "paused"
            detail = "daemon not running"
        rows.append(
            [
                str(workspace.get("name") or "?"),
                team_id,
                status_text,
                detail,
            ]
        )
    _table(["NAME", "TEAM", "STATUS", "DETAIL"], rows)
    if pid and runtime and not runtime.get("workspaces"):
        print("Runtime state has no workspace entries yet; waiting for the daemon.")
    print()
    print(f"Config: {config.CONFIG_PATH}")
    return 0


# ---------------------------------------------------------- pause / resume


def cmd_pause(args: argparse.Namespace) -> int:
    cfg = config.load_config()
    if args.workspace:
        if args.duration:
            return _fail("--for is for a global pause; a per-workspace pause lasts until resume")
        _, workspace = _find_workspace(cfg, args.workspace)
        workspace["paused"] = True
        workspace["paused_at"] = config.now_iso()
        config.save_config(cfg)
        print(f"Paused {workspace.get('name') or workspace.get('team_id')}.")
        if _daemon_running():
            print("The daemon will stop that session within a few seconds.")
        return 0

    until = None
    if args.duration:
        delta = config.parse_duration(args.duration)
        until = datetime.now(timezone.utc) + delta
    config.write_pause(until)
    print(f"Presence paused {_until_text(until.isoformat() if until else None)}.")
    if _daemon_running():
        print("The daemon will disconnect sessions within a few seconds.")
    stay = config.read_stay()
    if stay:
        print(f"Note: an active stay-online window overrides pause until {stay.get('until')}.")
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    cfg = config.load_config()
    if args.workspace:
        _, workspace = _find_workspace(cfg, args.workspace)
        if not workspace.get("paused"):
            print(f"{workspace.get('name') or workspace.get('team_id')} is not paused.")
            return 0
        workspace["paused"] = False
        workspace.pop("paused_at", None)
        config.save_config(cfg)
        print(f"Resumed {workspace.get('name') or workspace.get('team_id')}.")
        return 0

    config.clear_pause()
    changed = []
    for workspace in _workspaces(cfg):
        if workspace.get("paused"):
            workspace["paused"] = False
            workspace.pop("paused_at", None)
            changed.append(str(workspace.get("name") or workspace.get("team_id")))
    if changed:
        config.save_config(cfg)
    print("Resumed." if changed else "Global pause cleared.")
    if changed:
        print(f"Also resumed: {', '.join(changed)}")
    if config.read_stay():
        print("Note: a stay-online window is still active.")
    return 0


def cmd_stay(args: argparse.Namespace) -> int:
    if args.cancel:
        if args.duration:
            return _fail("pass either a duration or --cancel, not both")
        config.clear_stay()
        print("Stay-online window cleared.")
        return 0
    if not args.duration:
        return _fail("pass a duration, e.g. 'sg-local stay 2h' (or --cancel)")
    delta = config.parse_duration(args.duration)
    until = datetime.now(timezone.utc) + delta
    config.write_stay(until)
    print(f"Staying online {_until_text(until.isoformat())} (overrides pause and schedule).")
    if not _daemon_running():
        print("Daemon is not running. Run: ./sg-local start")
    return 0


# ------------------------------------------------------------------ doctor


def cmd_doctor(args: argparse.Namespace) -> int:
    failures = 0
    warnings = 0
    config.ensure_dirs()

    def ok(label: str, detail: str = "") -> None:
        print(f"[ok]   {label}" + (f" - {detail}" if detail else ""))

    def warn(label: str, detail: str = "") -> None:
        nonlocal warnings
        warnings += 1
        print(f"[warn] {label}" + (f" - {detail}" if detail else ""))

    def fail(label: str, detail: str = "") -> None:
        nonlocal failures
        failures += 1
        print(f"[fail] {label}" + (f" - {detail}" if detail else ""))

    print("slack-green-local doctor")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    if sys.version_info >= (3, 11):
        ok("Python version")
    else:
        fail("Python version", "3.11 or newer is required")

    try:
        import websockets

        version = getattr(websockets, "__version__", "unknown")
        major = int(str(version).split(".")[0])
        if major >= 12:
            ok("websockets", version)
        else:
            fail("websockets", f"{version}; version 12 or newer is required")
    except Exception as exc:
        fail("websockets", redact(str(exc)))

    if config.CONFIG_PATH.exists():
        good, message = config.config_security()
        if good:
            ok("config permissions", message)
        else:
            fail("config permissions", f"{message} (run: chmod 600 {config.CONFIG_PATH})")
    else:
        warn("config file", f"not created yet ({config.CONFIG_PATH}); run './sg-local add'")

    try:
        cfg = config.load_config()
        ok("config file", str(config.CONFIG_PATH))
    except config.ConfigError as exc:
        fail("config file", str(exc))
        cfg = config.default_config()

    cfg_ok, cfg_message = schedule.validate_schedule(cfg.get("schedule", {}))
    if cfg_ok:
        ok("schedule", schedule.schedule_summary(cfg["schedule"]))
    else:
        fail("schedule", cfg_message)

    workspaces = _workspaces(cfg)
    if not workspaces:
        warn("workspaces", "none configured; run './sg-local add'")
    else:
        seen: list[str] = []
        for workspace in workspaces:
            valid, message = config.validate_workspace(workspace)
            name = workspace.get("name") or workspace.get("team_id") or "workspace"
            if valid:
                ok(f"workspace {name}", f"team {workspace.get('team_id')}")
            else:
                fail(f"workspace {name}", message)
            team_id = str(workspace.get("team_id") or "")
            if team_id:
                seen.append(team_id)
        duplicates = sorted({team for team in seen if seen.count(team) > 1})
        if duplicates:
            warn("duplicate workspaces", ", ".join(duplicates))

    mode = stat.S_IMODE(config.STATE_DIR.stat().st_mode)
    if mode & 0o077:
        warn("state directory permissions", f"{mode:04o}; expected 0700")
    else:
        ok("state directory permissions", f"{mode:04o}")

    if os.access(config.STATE_DIR, os.W_OK) and os.access(config.CONFIG_DIR, os.W_OK):
        ok("storage writable")
    else:
        fail("storage writable", f"check {config.CONFIG_DIR} and {config.STATE_DIR}")

    pid = state.daemon_pid()
    if pid:
        ok("daemon", f"running (pid {pid})")
    elif state.lock_held():
        warn("daemon", "lock is held but PID is unavailable; try stopping it")
    else:
        warn("daemon", "not running; use './sg-local start'")

    if sys.platform == "darwin":
        if launchd.installed() and launchd.loaded():
            ok("launchd auto-start", str(launchd.PLIST_PATH))
        elif launchd.installed():
            warn("launchd auto-start", "plist exists but is not loaded; reinstall it")
        else:
            print("[info] launchd auto-start is not installed (optional)")
        print("[info] macOS sleep pauses the daemon; for 24/7 presence keep the Mac awake or use a server")

    if args.check_tokens:
        if not workspaces:
            warn("token check", "no workspaces to check")
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
                    warn(f"token check: {name}", "token belongs to a different team than configured")
                elif str(identity.get("user_id")) != str(workspace.get("user_id")):
                    warn(f"token check: {name}", "token belongs to a different user than configured")
                else:
                    ok(f"token check: {name}", "tokens are valid")
            except SlackAPIError as exc:
                if exc.token_invalid:
                    fail(f"token check: {name}", f"Slack rejected the tokens ({exc.error})")
                else:
                    warn(f"token check: {name}", f"could not verify ({exc.error})")
            except Exception as exc:
                warn(f"token check: {name}", f"could not verify ({redact(str(exc))})")

    print()
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


def cmd_web(args: argparse.Namespace) -> int:
    """Serve the control surface. Local mode is loopback-only by default."""
    config.ensure_dirs()
    host = args.host or os.environ.get("SG_LOCAL_WEB_HOST", "127.0.0.1")
    port = int(args.port or os.environ.get("SG_LOCAL_WEB_PORT", web.DEFAULT_PORT))
    if args.show_code:
        print(web.load_code())
        return 0
    if args.daemon and not state.daemon_pid():
        ok, message = state.start_daemon()
        print(message)
        if not ok:
            return 1
    code = web.load_code()
    if host not in {"127.0.0.1", "::1", "localhost"}:
        print(f"Listening on {host}:{port}. Anyone who can reach that address can try the code.")
        print("Access code: set SG_LOCAL_BRIDGE_CODE, or read it with --show-code.")
        if not os.environ.get("SG_LOCAL_BRIDGE_CODE"):
            print(f"Generated code (stored in {web.BRIDGE_PATH}): {code}")
    if args.open:
        threading.Timer(0.7, lambda: __import__("webbrowser").open(f"http://127.0.0.1:{port}")).start()
    web.serve(host, port)
    return 0


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


# -------------------------------------------------------------------- main


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sg-local",
        description="Self-hosted, personal Slack presence daemon (slack.green-style).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Your tokens are stored only in the local config file. Nothing is sent\n"
            "anywhere except Slack. Use this only on workspaces where you have\n"
            "permission; automating presence may violate your employer's policy."
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
    sched_sub.add_parser("always", help="keep presence on all the time")
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
    status = sub.add_parser("status", help="show daemon, schedule, and workspace status")
    status.set_defaults(func=cmd_status)

    pause = sub.add_parser("pause", help="pause presence (globally or one workspace)")
    pause.add_argument("--for", dest="duration", metavar="DURATION", help="e.g. 30m, 2h, 1d")
    pause.add_argument("--workspace", help="pause only this workspace until resume")
    pause.set_defaults(func=cmd_pause)

    resume = sub.add_parser("resume", help="resume presence")
    resume.add_argument("--workspace", help="resume only this workspace")
    resume.set_defaults(func=cmd_resume)

    stay = sub.add_parser("stay", help="stay online for a while, overriding pause/schedule")
    stay.add_argument("duration", nargs="?", help="e.g. 30m, 2h, 1d, 1w")
    stay.add_argument("--cancel", action="store_true", help="cancel an active stay window")
    stay.set_defaults(func=cmd_stay)

    doctor = sub.add_parser("doctor", help="check configuration and runtime health")
    doctor.add_argument(
        "--check-tokens",
        action="store_true",
        help="verify each workspace's tokens with Slack (network call)",
    )
    doctor.set_defaults(func=cmd_doctor)

    web_cmd = sub.add_parser(
        "web",
        help="serve the local control surface (status, schedule, add workspace)",
    )
    web_cmd.add_argument("--host", default=os.environ.get("SG_LOCAL_WEB_HOST", "127.0.0.1"))
    web_cmd.add_argument("--port", type=int, default=int(os.environ.get("SG_LOCAL_WEB_PORT", web.DEFAULT_PORT)))
    web_cmd.add_argument("--daemon", action="store_true", help="start the presence daemon first")
    web_cmd.add_argument("--open", action="store_true", help="open the control surface in a browser")
    web_cmd.add_argument("--show-code", action="store_true", help="print the access code and exit")
    web_cmd.set_defaults(func=cmd_web)

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

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 0
    try:
        return int(args.func(args))
    except config.ConfigError as exc:
        _eprint(f"error: {exc}")
        return 2
    except KeyboardInterrupt:
        _eprint("interrupted")
        return 130
    except BrokenPipeError:
        return 0
    except Exception as exc:
        if os.environ.get("SG_LOCAL_DEBUG"):
            raise
        _eprint(f"error: {redact(str(exc))}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
