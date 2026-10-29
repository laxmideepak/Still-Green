"""Optional macOS launchd auto-start support."""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Any

from . import config

LABEL = "com.slackgreenlocal.daemon"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def _uid() -> int:
    return os.getuid()


def _domain() -> str:
    return f"gui/{_uid()}"


def build_plist(python: str | None = None) -> dict[str, Any]:
    environment = {
        "PYTHONUNBUFFERED": "1",
        "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    }
    # Preserve non-default config/state locations if the user installed with
    # custom environment variables.
    defaults = {
        "SG_LOCAL_CONFIG_DIR": str(Path.home() / ".config" / "slack-green-local"),
        "SG_LOCAL_STATE_DIR": str(Path.home() / ".local" / "state" / "slack-green-local"),
    }
    for name, default in defaults.items():
        value = os.environ.get(name)
        if value and value != default:
            environment[name] = value

    return {
        "Label": LABEL,
        "ProgramArguments": [python or sys.executable, "-m", "sg_local.daemon"],
        "WorkingDirectory": str(config.PROJECT_ROOT),
        "EnvironmentVariables": environment,
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ProcessType": "Background",
        "ThrottleInterval": 10,
        "StandardOutPath": str(config.LOG_PATH),
        "StandardErrorPath": str(config.LOG_PATH),
    }


def installed() -> bool:
    return PLIST_PATH.exists()


def loaded() -> bool:
    try:
        result = subprocess.run(
            ["launchctl", "print", f"{_domain()}/{LABEL}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _run(*args: str) -> tuple[bool, str]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        return False, detail or f"{args[0]} failed ({result.returncode})"
    return True, (result.stdout or "").strip()


def install(python: str | None = None) -> tuple[bool, str]:
    config.ensure_dirs()
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = plistlib.dumps(build_plist(python), fmt=plistlib.FMT_XML)
    try:
        PLIST_PATH.write_bytes(payload)
        PLIST_PATH.chmod(0o644)
    except OSError as exc:
        return False, f"could not write {PLIST_PATH}: {exc}"

    # Remove any previous registration so the new plist is picked up.
    _run("launchctl", "bootout", f"{_domain()}/{LABEL}")
    ok, message = _run("launchctl", "bootstrap", _domain(), str(PLIST_PATH))
    if not ok:
        ok, message = _run("launchctl", "load", "-w", str(PLIST_PATH))
    if not ok:
        return False, f"plist written to {PLIST_PATH}, but launchctl failed: {message}"
    return True, f"installed and loaded {PLIST_PATH}"


def uninstall() -> tuple[bool, str]:
    _run("launchctl", "bootout", f"{_domain()}/{LABEL}")
    if PLIST_PATH.exists():
        try:
            PLIST_PATH.unlink()
        except OSError as exc:
            return False, f"could not remove {PLIST_PATH}: {exc}"
        return True, f"removed {PLIST_PATH}"
    return True, "launchd job was not installed"


def kickstart() -> tuple[bool, str]:
    ok, message = _run("launchctl", "kickstart", "-k", f"{_domain()}/{LABEL}")
    if ok:
        return True, "launchd job restarted"
    return False, message
