"""Daemon process management and runtime state files."""

from __future__ import annotations

import fcntl
import functools
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from . import config

DAEMON_MARKER = "sg_local.daemon"


UPDATE_MESSAGE = "Stillgreen was updated after it started. Run ./sg-local restart to finish the update."


@functools.lru_cache(maxsize=1)
def build_id() -> str:
    """A short fingerprint of the program files and requirements.lock.

    The daemon saves the one it started with; when the files on disk change
    (after ``git pull``), the CLI and the pages can say "restart to finish the
    update". Read once per process, so a running daemon keeps its own.
    """
    digest = hashlib.sha256()
    package = Path(__file__).resolve().parent
    files = sorted(package.glob("*.py")) + sorted((package / "static").glob("*"))
    files.append(config.PROJECT_ROOT / "requirements.lock")
    for path in files:
        try:
            data = path.read_bytes()
        except OSError:
            continue
        digest.update(path.name.encode("utf-8") + b"\0" + data + b"\0")
    return digest.hexdigest()[:16]


def update_pending(runtime: dict[str, Any] | None) -> bool:
    """Is the running daemon older than the program files on disk?

    A daemon's state with a pid but no build comes from a version older than
    build fingerprints (before 0.1.0's November 2026 updates), so it is older
    too. Treating it as current left such a daemon serving the new page files
    with its old code, and the control page stayed blank.
    """
    if not runtime:
        return False
    running = str(runtime.get("build") or "")
    if not running:
        return bool(runtime.get("pid"))
    return running != build_id()


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def read_state() -> dict[str, Any] | None:
    return read_json(config.STATE_PATH)


def write_state(payload: dict[str, Any]) -> None:
    config.ensure_dirs()
    config.atomic_write(config.STATE_PATH, json.dumps(payload, indent=2, sort_keys=False) + "\n")


def _is_zombie(pid: int) -> bool:
    """A process that has exited but was not yet collected by its parent.

    Linux shows this in /proc. Elsewhere (macOS) ``ps`` reports the state;
    if neither is available this says False.
    """
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="ascii", errors="replace")
    except OSError:
        pass
    else:
        # Format: "pid (name) state ..."; the name may contain spaces or ")".
        fields = stat.rpartition(")")[2].split()
        return bool(fields) and fields[0] == "Z"
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "stat="],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.stdout.strip().startswith("Z")


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A stopped daemon whose parent has not collected it yet is not running.
    return not _is_zombie(pid)


def _command_line(pid: int) -> str:
    # Linux (including slim containers without `ps`): read /proc directly.
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        if raw:
            return raw.replace(b"\0", b" ").decode("utf-8", "replace").strip()
    except OSError:
        pass
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip()


def _looks_like_daemon(pid: int) -> bool:
    command = _command_line(pid)
    if not command:
        # ps unavailable: don't kill a live PID we cannot inspect.
        return False
    return DAEMON_MARKER in command


def read_pid() -> int | None:
    try:
        raw = config.PID_PATH.read_text(encoding="utf-8").strip()
        return int(raw)
    except (OSError, ValueError):
        return None


def write_pid(pid: int) -> None:
    config.ensure_dirs()
    config.atomic_write(config.PID_PATH, f"{pid}\n")


def clear_pid(only_if: int | None = None) -> None:
    current = read_pid()
    if only_if is not None and current != only_if:
        return
    try:
        config.PID_PATH.unlink()
    except OSError:
        pass


def lock_held() -> bool:
    """Return True when a daemon holds the exclusive lifetime lock."""
    if not config.LOCK_PATH.exists():
        return False
    try:
        fd = os.open(config.LOCK_PATH, os.O_RDWR)
    except OSError:
        return False
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
    finally:
        os.close(fd)
    return False


def daemon_pid() -> int | None:
    """PID of a live daemon, or None. Stale/unrelated PIDs are ignored."""
    pid = read_pid()
    if pid and pid_alive(pid) and _looks_like_daemon(pid):
        return pid
    return None


def status_label() -> str:
    pid = daemon_pid()
    if pid:
        return f"running (pid {pid})"
    if lock_held():
        return "starting or stopping (lock held)"
    if read_pid():
        return "not running (stale PID file)"
    return "not running"


def start_daemon() -> tuple[bool, str]:
    config.ensure_dirs()
    pid = daemon_pid()
    if pid:
        return False, f"daemon is already running (pid {pid})"
    if lock_held():
        return False, "another daemon is starting; try again in a moment"

    with open(config.LOG_PATH, "ab") as log_file:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", DAEMON_MARKER],
                cwd=str(config.PROJECT_ROOT),
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=log_file,
                start_new_session=True,
                close_fds=True,
                env=env,
            )
        except OSError as exc:
            return False, f"could not launch daemon: {exc}"

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        pid = daemon_pid()
        if pid and lock_held():
            return True, f"daemon started (pid {pid})"
        code = process.poll()
        if code is not None:
            return False, f"daemon exited with status {code}; see: {config.LOG_PATH}"
        time.sleep(0.1)

    return False, f"daemon did not become ready; see: {config.LOG_PATH}"


def stop_daemon(timeout: float = 20.0) -> tuple[bool, str]:
    pid = daemon_pid()
    if not pid:
        if lock_held():
            return False, "daemon lock is held but its PID is unavailable; run 'doctor'"
        if read_pid():
            clear_pid()
            return True, "daemon was not running (removed stale PID file)"
        return True, "daemon is not running"

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        clear_pid(pid)
        return True, "daemon had already stopped"
    except PermissionError as exc:
        return False, f"not allowed to stop pid {pid}: {exc}"

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not pid_alive(pid):
            clear_pid(pid)
            return True, f"daemon stopped (pid {pid})"
        time.sleep(0.2)

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError as exc:
        return False, f"daemon did not stop and could not be killed: {exc}"
    time.sleep(0.2)
    clear_pid(pid)
    if pid_alive(pid):
        return False, f"daemon (pid {pid}) is still alive after SIGKILL"
    return True, f"daemon force-stopped (pid {pid})"


def tail_log(lines: int = 80) -> str:
    if not config.LOG_PATH.exists():
        return ""
    try:
        content = config.LOG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(content.splitlines()[-lines:])
