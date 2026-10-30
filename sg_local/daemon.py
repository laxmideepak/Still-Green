"""Background daemon: keeps the right Slack sessions alive.

Run with ``python -m sg_local.daemon`` (normally started by ``sg-local start``).
It reloads the config when the file changes, honours the schedule, global or
per-workspace pause, temporary "stay online" windows, and writes runtime state
for the CLI.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import logging
import logging.handlers
import os
import signal
import sys
import time
from datetime import datetime, timezone
from typing import Any

from . import config, schedule, state, web
from .slack import PresenceSession

LOGGER = logging.getLogger("sg_local.daemon")
RECONCILE_INTERVAL = 2.0
STATE_WRITE_INTERVAL = 5.0
RESTART_DELAY = 30.0


def setup_logging() -> None:
    config.ensure_dirs()
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler = logging.handlers.RotatingFileHandler(
        config.LOG_PATH,
        maxBytes=1_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)

    # When started by the CLI, stderr already points at the same log file.
    if sys.stderr.isatty():
        stream = logging.StreamHandler()
        stream.setFormatter(formatter)
        root.addHandler(stream)


def _fingerprint(workspace: dict[str, Any]) -> str:
    raw = f"{workspace.get('xoxc', '')}\0{workspace.get('xoxd', '')}".encode()
    return hashlib.sha256(raw).hexdigest()


def _iso_from_epoch(value: float | None) -> str | None:
    if not value:
        return None
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="seconds")


class Daemon:
    def __init__(self) -> None:
        self.stop_event = asyncio.Event()
        self.reload_requested = False
        self.started_at = time.time()
        self.config: dict[str, Any] = config.default_config()
        self.config_mtime: int | None = None
        self.sessions: dict[str, dict[str, Any]] = {}
        # key -> (token fingerprint, message, verified_at of the rejected tokens)
        self.invalid_tokens: dict[str, tuple[str, str, str]] = {}
        self.duplicate_keys: set[str] = set()
        self.control_server: Any = None
        self.invalid_config: dict[str, str] = {}
        self.next_start: dict[str, float] = {}
        self.schedule_active = True
        self.pause_until: str | None = None
        self.stay_until: str | None = None
        self.stay_active = False
        self.paused = False
        self.last_mode_log: str | None = None
        self.last_state_write = 0.0
        self._lock_fd: int | None = None

    # ------------------------------------------------------------ lifecycle

    def acquire_lock(self) -> bool:
        config.ensure_dirs()
        fd = os.open(config.LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o600)
        # `sg-local status` probes the lock for a moment; retry briefly so a
        # probe is not mistaken for a running daemon.
        for attempt in range(20):
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if attempt == 19:
                    os.close(fd)
                    LOGGER.error("another daemon is already running (lock is held)")
                    return False
                time.sleep(0.05)
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.fsync(fd)
        self._lock_fd = fd
        return True

    def release_lock(self) -> None:
        if self._lock_fd is not None:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                os.close(self._lock_fd)
            except OSError:
                pass
            self._lock_fd = None

    def request_stop(self) -> None:
        self.stop_event.set()

    def request_reload(self) -> None:
        self.reload_requested = True

    # ---------------------------------------------------------------- config

    def _current_mtime(self) -> int | None:
        try:
            return config.CONFIG_PATH.stat().st_mtime_ns
        except OSError:
            return None

    def load_config(self, initial: bool = False) -> None:
        old_keys = set(self.sessions)
        try:
            loaded = config.load_config()
        except config.ConfigError as exc:
            LOGGER.error("cannot reload config: %s", exc)
            self.config_mtime = self._current_mtime()
            return

        self.config = loaded
        self.config_mtime = self._current_mtime()
        self.reload_requested = False
        workspaces = loaded.get("workspaces", [])
        summary = schedule.schedule_summary(loaded.get("schedule", {}))
        if initial:
            LOGGER.info(
                "config loaded: %d workspace(s), schedule: %s", len(workspaces), summary
            )
        else:
            LOGGER.info(
                "config reloaded: %d workspace(s), schedule: %s", len(workspaces), summary
            )
        for workspace in workspaces:
            if isinstance(workspace, dict):
                LOGGER.debug("workspace configured: %s", workspace.get("name") or "?")
        removed = old_keys - {config.workspace_key(w) for w in workspaces}
        for key in removed:
            LOGGER.info("workspace %s was removed from config", key)

    # ------------------------------------------------------------- reconcile

    def _reason(
        self,
        workspace: dict[str, Any],
        schedule_active: bool,
        paused: bool,
        stay_active: bool,
    ) -> tuple[bool, str]:
        if workspace.get("paused"):
            return False, "workspace paused"
        if stay_active:
            return True, "stay online"
        if paused:
            return False, "paused"
        if not schedule_active:
            return False, "outside schedule"
        return True, "schedule" if self.config["schedule"].get("mode") == "scheduled" else "always"

    async def reconcile(self) -> None:
        pause = config.read_pause()
        stay = config.read_stay()
        self.paused = pause is not None
        self.pause_until = pause.get("until") if pause else None
        self.stay_until = stay.get("until") if stay else None
        self.stay_active = stay is not None
        self.schedule_active = schedule.is_within_schedule(self.config.get("schedule", {}))

        now = time.monotonic()
        desired_keys: set[str] = set()

        for workspace in self.config.get("workspaces", []):
            if not isinstance(workspace, dict):
                continue
            key = config.workspace_key(workspace)
            if key in desired_keys:
                # Two entries for one team would replace each other's session
                # on every pass; keep the first and report the rest once.
                if key not in self.duplicate_keys:
                    LOGGER.error("workspace %s appears twice in the config; using the first", key)
                    self.duplicate_keys.add(key)
                continue
            desired_keys.add(key)
            valid, message = config.validate_workspace(workspace)
            if not valid:
                if self.invalid_config.get(key) != message:
                    LOGGER.error("workspace %s has invalid config: %s", key, message)
                    self.invalid_config[key] = message
                await self._stop_session(key, "invalid config")
                continue
            self.invalid_config.pop(key, None)

            fingerprint = _fingerprint(workspace)
            verified_at = str(workspace.get("verified_at") or "")
            rejected = self.invalid_tokens.get(key)
            # Re-adding the same tokens updates verified_at, so they are retried.
            if rejected and rejected[0] == fingerprint and rejected[2] == verified_at:
                await self._stop_session(key, "tokens rejected")
                continue
            if rejected:
                self.invalid_tokens.pop(key, None)
                self.next_start.pop(key, None)

            desired, reason = self._reason(
                workspace, self.schedule_active, self.paused, self.stay_active
            )
            entry = self.sessions.get(key)

            if entry and entry["fingerprint"] != fingerprint:
                await self._stop_session(key, "tokens changed")
                entry = None

            if not desired:
                if entry:
                    await self._stop_session(key, reason)
                continue

            if entry and entry["task"].done():
                await self._collect_finished(key, entry)
                entry = self.sessions.get(key)

            if entry is None:
                ready_at = self.next_start.get(key, 0.0)
                if now < ready_at:
                    continue
                self._start_session(workspace)
                continue

            entry["desired"] = True
            entry["reason"] = reason

        # Stop sessions whose workspace disappeared from config.
        for key in list(self.sessions):
            if key not in desired_keys:
                await self._stop_session(key, "removed from config")

        # Clear stale invalid-token records when their workspace is gone.
        configured = {
            config.workspace_key(w)
            for w in self.config.get("workspaces", [])
            if isinstance(w, dict)
        }
        for key in list(self.invalid_tokens):
            if key not in configured:
                self.invalid_tokens.pop(key, None)
        for key in list(self.invalid_config):
            if key not in configured:
                self.invalid_config.pop(key, None)

        mode = self._mode_description()
        if mode != self.last_mode_log:
            LOGGER.info("mode: %s", mode)
            self.last_mode_log = mode

    def _mode_description(self) -> str:
        if self.stay_active:
            return f"stay online until {self.stay_until}"
        if self.paused:
            return f"paused until {self.pause_until or 'resumed'}"
        if self.config.get("schedule", {}).get("mode") == "scheduled":
            state_text = "inside" if self.schedule_active else "outside"
            return f"{state_text} schedule ({schedule.schedule_summary(self.config['schedule'])})"
        return "always on"

    def _start_session(self, workspace: dict[str, Any]) -> None:
        key = config.workspace_key(workspace)
        session = PresenceSession(workspace, LOGGER)
        task = asyncio.create_task(session.run(), name=f"slack-session-{key}")
        self.sessions[key] = {
            "session": session,
            "task": task,
            "fingerprint": _fingerprint(workspace),
            "verified_at": str(workspace.get("verified_at") or ""),
            "desired": True,
            "reason": "starting",
        }
        self.next_start.pop(key, None)
        LOGGER.info("starting session for %s", session.name)
        task.add_done_callback(self._task_done)

    def _task_done(self, task: asyncio.Task[Any]) -> None:
        if task.cancelled():
            return
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return
        if exc is not None:
            LOGGER.error("session task ended unexpectedly: %s", exc)

    async def _collect_finished(self, key: str, entry: dict[str, Any]) -> None:
        task: asyncio.Task[Any] = entry["task"]
        session: PresenceSession = entry["session"]
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            LOGGER.error("session for %s ended with an error: %s", session.name, exc)

        self.sessions.pop(key, None)
        if session.invalid_token:
            self.invalid_tokens[key] = (
                entry["fingerprint"],
                session.last_error or "Slack rejected the stored tokens",
                entry["verified_at"],
            )
            LOGGER.error(
                "tokens for %s were rejected; update them with 'sg-local add'", session.name
            )
        elif not self.stop_event.is_set():
            self.next_start[key] = time.monotonic() + RESTART_DELAY
            LOGGER.warning(
                "session for %s stopped; retrying in %ss", session.name, int(RESTART_DELAY)
            )

    async def _stop_session(self, key: str, reason: str) -> None:
        entry = self.sessions.pop(key, None)
        if entry is None:
            return
        session: PresenceSession = entry["session"]
        task: asyncio.Task[Any] = entry["task"]
        LOGGER.info("stopping session for %s (%s)", session.name, reason)
        try:
            await session.stop()
        except Exception as exc:
            LOGGER.warning("error stopping session for %s: %s", session.name, exc)
        if not task.done():
            try:
                await asyncio.wait_for(task, timeout=8)
            except TimeoutError:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            except (asyncio.CancelledError, Exception):
                pass

    # ---------------------------------------------------------------- state

    def _workspace_state(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for workspace in self.config.get("workspaces", []):
            if not isinstance(workspace, dict):
                continue
            key = config.workspace_key(workspace)
            valid, message = config.validate_workspace(workspace)
            base: dict[str, Any] = {
                "team_id": workspace.get("team_id"),
                "name": workspace.get("name"),
                "user_id": workspace.get("user_id"),
                "paused": bool(workspace.get("paused")),
            }
            entry = self.sessions.get(key)
            if entry:
                snapshot = entry["session"].snapshot()
                snapshot.update(
                    {
                        "desired": entry.get("desired", True),
                        "reason": entry.get("reason", ""),
                    }
                )
                result.append(snapshot)
            elif not valid:
                base.update(
                    {
                        "status": "invalid_config",
                        "connected": False,
                        "last_error": message,
                        "desired": False,
                        "reason": "invalid config",
                        "stats": {},
                    }
                )
                result.append(base)
            elif key in self.invalid_tokens:
                base.update(
                    {
                        "status": "invalid_token",
                        "connected": False,
                        "last_error": self.invalid_tokens[key][1],
                        "desired": False,
                        "reason": "tokens rejected; run 'sg-local add'",
                        "stats": {},
                    }
                )
                result.append(base)
            else:
                desired, reason = self._reason(
                    workspace, self.schedule_active, self.paused, self.stay_active
                )
                if not desired:
                    status = "paused" if "paused" in reason else "scheduled_off"
                elif key in self.next_start:
                    status = "restarting"
                else:
                    status = "stopped"
                base.update(
                    {
                        "status": status,
                        "connected": False,
                        "last_error": None,
                        "desired": desired,
                        "reason": reason,
                        "stats": {},
                    }
                )
                result.append(base)
        return result

    def write_state(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self.last_state_write < STATE_WRITE_INTERVAL:
            return
        self.last_state_write = now
        payload = {
            "version": 1,
            "pid": os.getpid(),
            "running": True,
            "started_at": _iso_from_epoch(self.started_at),
            "updated_at": config.now_iso(),
            "schedule": {
                "mode": self.config.get("schedule", {}).get("mode", "always"),
                "summary": schedule.schedule_summary(self.config.get("schedule", {})),
                "active": self.schedule_active,
            },
            "paused": self.paused,
            "pause_until": self.pause_until,
            "stay_active": self.stay_active,
            "stay_until": self.stay_until,
            "workspaces": self._workspace_state(),
        }
        try:
            state.write_state(payload)
        except OSError as exc:
            LOGGER.warning("could not write state file: %s", exc)

    # ------------------------------------------------------------------- run

    async def run(self) -> int:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, self.request_stop)
            except (NotImplementedError, RuntimeError):
                pass
        if hasattr(signal, "SIGHUP"):
            try:
                loop.add_signal_handler(signal.SIGHUP, self.request_reload)
            except (NotImplementedError, RuntimeError):
                pass

        state.write_pid(os.getpid())
        LOGGER.info("daemon started (pid %s)", os.getpid())
        self.load_config(initial=True)

        try:
            while not self.stop_event.is_set():
                if self.reload_requested or self._current_mtime() != self.config_mtime:
                    self.load_config()
                try:
                    await self.reconcile()
                except Exception as exc:
                    LOGGER.exception("reconcile failed: %s", exc)
                try:
                    self.write_state()
                except Exception as exc:
                    LOGGER.exception("could not write state: %s", exc)
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=RECONCILE_INTERVAL)
                except TimeoutError:
                    pass
        finally:
            LOGGER.info("daemon shutting down")
            try:
                await self.stop_all()
                self.write_final_state()
            finally:
                state.clear_pid(os.getpid())
        return 0

    def write_final_state(self) -> None:
        current = self.config.get("schedule", {})
        try:
            summary = schedule.schedule_summary(current)
        except Exception:
            summary = "invalid schedule"
        final = {
            "version": 1,
            "pid": None,
            "running": False,
            "started_at": _iso_from_epoch(self.started_at),
            "stopped_at": config.now_iso(),
            "updated_at": config.now_iso(),
            "schedule": {
                "mode": current.get("mode", "always"),
                "summary": summary,
                "active": self.schedule_active,
            },
            "paused": self.paused,
            "pause_until": self.pause_until,
            "stay_active": self.stay_active,
            "stay_until": self.stay_until,
            "workspaces": self._workspace_state(),
        }
        try:
            state.write_state(final)
        except OSError:
            pass

    async def stop_all(self) -> None:
        keys = list(self.sessions)
        if keys:
            LOGGER.info("stopping %d session(s)", len(keys))
        for key in keys:
            await self._stop_session(key, "daemon stopping")


def start_control_server() -> Any:
    """Serve the control page on loopback so the dashboard and extension work.

    Set SG_LOCAL_DAEMON_WEB=0 to turn this off (then run ``sg-local web``).
    """
    if os.environ.get("SG_LOCAL_DAEMON_WEB", "1") == "0":
        return None
    try:
        port = web.port_from_env()
        server = web.start_background("127.0.0.1", port)
    except (OSError, config.ConfigError) as exc:
        LOGGER.warning("control page not started: %s", exc)
        return None
    web.load_code()
    LOGGER.info("control page at http://127.0.0.1:%s", server.server_address[1])
    return server


def main() -> int:
    setup_logging()
    daemon = Daemon()
    if not daemon.acquire_lock():
        return 1
    server = start_control_server()
    try:
        return asyncio.run(daemon.run())
    except KeyboardInterrupt:
        return 0
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        daemon.release_lock()


if __name__ == "__main__":
    raise SystemExit(main())
