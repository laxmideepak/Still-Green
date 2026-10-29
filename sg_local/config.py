"""Configuration, paths, and small utilities for slack-green-local.

Everything sensitive lives under the user's home directory:
  ~/.config/slack-green-local/config.json  (mode 0600)
  ~/.local/state/slack-green-local/        (runtime state and logs)

No values are sent anywhere except Slack itself.
"""

from __future__ import annotations

import json
import os
import re
import stat
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

APP_NAME = "slack-green-local"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else default


CONFIG_DIR = _env_path("SG_LOCAL_CONFIG_DIR", Path.home() / ".config" / APP_NAME)
STATE_DIR = _env_path("SG_LOCAL_STATE_DIR", Path.home() / ".local" / "state" / APP_NAME)

CONFIG_PATH = CONFIG_DIR / "config.json"
STATE_PATH = STATE_DIR / "state.json"
PID_PATH = STATE_DIR / "daemon.pid"
LOCK_PATH = STATE_DIR / "daemon.lock"
LOG_PATH = STATE_DIR / "daemon.log"
PAUSE_PATH = STATE_DIR / "pause.json"
STAY_PATH = STATE_DIR / "stay.json"

DAY_NAMES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]

DEFAULT_SCHEDULE: dict[str, Any] = {
    "mode": "always",
    "active_days": list(DAY_NAMES[:5]),
    "start_time": "09:00",
    "end_time": "17:00",
    "timezone": "local",
}


class ConfigError(Exception):
    """Raised for invalid configuration or user input."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_config() -> dict[str, Any]:
    return {
        "version": 1,
        "schedule": dict(DEFAULT_SCHEDULE),
        "workspaces": [],
    }


def ensure_dirs() -> None:
    for path in (CONFIG_DIR, STATE_DIR):
        path.mkdir(parents=True, exist_ok=True)
        try:
            path.chmod(0o700)
        except OSError:
            pass


def atomic_write(path: Path, data: str, mode: int = 0o600) -> None:
    """Write text atomically and set restrictive permissions before renaming."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def load_config(path: Path | None = None) -> dict[str, Any]:
    path = path or CONFIG_PATH
    if not path.exists():
        return default_config()

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Cannot read {path}: {exc}") from None

    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a JSON object")

    config = default_config()
    config["version"] = raw.get("version", 1)

    schedule = dict(DEFAULT_SCHEDULE)
    if isinstance(raw.get("schedule"), dict):
        schedule.update(raw["schedule"])
    config["schedule"] = schedule

    workspaces = raw.get("workspaces")
    if isinstance(workspaces, list):
        config["workspaces"] = [w for w in workspaces if isinstance(w, dict)]
    else:
        config["workspaces"] = []

    return config


def save_config(config: dict[str, Any], path: Path | None = None) -> None:
    ensure_dirs()
    path = path or CONFIG_PATH
    atomic_write(path, json.dumps(config, indent=2, sort_keys=False) + "\n")


def config_security(path: Path | None = None) -> tuple[bool, str]:
    path = path or CONFIG_PATH
    if not path.exists():
        return True, "not created yet"
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        return False, f"{path} has mode {mode:04o}; expected 0600"
    return True, f"{path} has mode {mode:04o}"


def clean_xoxc(value: str) -> str:
    text = (value or "").strip().strip('"').strip("'")
    if text.lower().startswith("authorization:"):
        text = text.split(":", 1)[1].strip()
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    match = re.search(r"xoxc-[A-Za-z0-9._%+\-]+", text)
    if match:
        text = match.group(0)
    return text.strip().strip('"').strip("'")


def clean_xoxd(value: str) -> str:
    text = (value or "").strip().strip('"').strip("'")
    if text.lower().startswith("cookie:"):
        text = text.split(":", 1)[1].strip()
    match = re.search(r"(?:^|;\s*)d=([^;]+)", text)
    if match:
        text = match.group(1).strip()
    match = re.search(r"xoxd-[A-Za-z0-9._%+\-]+", text)
    if match:
        text = match.group(0)
    return text.strip().strip('"').strip("'")


def validate_workspace(workspace: dict[str, Any]) -> tuple[bool, str]:
    for field in ("name", "team_id", "user_id", "xoxc", "xoxd"):
        if not isinstance(workspace.get(field), str) or not workspace[field].strip():
            return False, f"workspace field {field!r} is missing"
    if not workspace["xoxc"].startswith("xoxc-"):
        return False, "xoxc token should start with 'xoxc-'"
    if not workspace["xoxd"].startswith("xoxd-"):
        return False, "xoxd cookie should start with 'xoxd-'"
    return True, ""


def workspace_key(workspace: dict[str, Any]) -> str:
    return str(workspace.get("team_id") or workspace.get("name") or "unknown")


def token_summary(token: str) -> str:
    return f"set (len {len(token)})"


def parse_duration(value: str) -> timedelta:
    """Parse 30m, 2h, 1d, 1w (and seconds)."""
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smhdw])\s*", value or "", re.I)
    if not match:
        raise ConfigError("Use a duration like 30m, 2h, 1d, or 1w")
    amount = float(match.group(1))
    unit = match.group(2).lower()
    seconds = amount * {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
    if seconds <= 0:
        raise ConfigError("Duration must be greater than zero")
    return timedelta(seconds=seconds)


def _read_timestamped(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    until = payload.get("until")
    if until:
        try:
            deadline = datetime.fromisoformat(str(until))
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if deadline <= datetime.now(timezone.utc):
                path.unlink(missing_ok=True)
                return None
        except ValueError:
            return None
    return payload


def write_pause(until: datetime | None, reason: str = "manual") -> None:
    ensure_dirs()
    payload = {
        "until": until.astimezone(timezone.utc).isoformat(timespec="seconds") if until else None,
        "reason": reason,
        "created_at": now_iso(),
    }
    atomic_write(PAUSE_PATH, json.dumps(payload) + "\n")


def read_pause() -> dict[str, Any] | None:
    return _read_timestamped(PAUSE_PATH)


def clear_pause() -> None:
    PAUSE_PATH.unlink(missing_ok=True)


def write_stay(until: datetime) -> None:
    ensure_dirs()
    payload = {
        "until": until.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "created_at": now_iso(),
    }
    atomic_write(STAY_PATH, json.dumps(payload) + "\n")


def read_stay() -> dict[str, Any] | None:
    return _read_timestamped(STAY_PATH)


def clear_stay() -> None:
    STAY_PATH.unlink(missing_ok=True)
