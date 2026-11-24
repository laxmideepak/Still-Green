"""Health checks that explain, in plain words, what works and what does not.

Used by ``sg-local doctor``, ``GET /api/diagnostics`` and the diagnostics
report (``sg-local doctor --report FILE`` and ``GET /api/diagnostics/report``).

Each check returns::

    {"id": "tls", "label": "Secure connection to Slack", "status": "fail",
     "detail": "...", "action": "...", "code": "tls_untrusted"}

``status`` is "pass", "warn", "fail" or "skip". ``code`` (an error-catalogue
code, see sg_local.errors) is only there when the check found a known problem.

Rules for the network checks:

* They only contact slack.com (and the proxy, if one is set), with a short
  timeout for each step.
* They never send tokens, cookies or the access code. The one HTTP request is
  an anonymous ``HEAD /api/api.test``, used to read Slack's clock.
* Certificates are always checked, with the same trust settings the daemon
  uses (sg_local.tls). There is no way to turn that off.
"""

from __future__ import annotations

import base64
import copy
import email.utils
import json
import os
import platform
import re
import shlex
import socket
import ssl
import stat
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import __version__, config, errors, state, tls
from .slack import redact

SLACK_HOST = "slack.com"
SLACK_PORT = 443
TIMEOUT = 5.0
# All the steps of the connection test together never take longer than this.
PROBE_DEADLINE = 15.0
# The pages reuse a diagnostics run this recent instead of starting another.
CACHE_SECONDS = 30.0
# Presence counts as confirmed when Slack said "active" this recently.
PRESENCE_FRESH_SECONDS = 600
# Bigger clock differences break secure connections and Slack logins.
CLOCK_WARN_SECONDS = 60
CLOCK_FAIL_SECONDS = 300
PROXY_VARIABLES = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy")

# Python 3.9 cannot use the computer's own certificate store (truststore needs
# 3.10), so a company certificate may not be trusted.
OLD_PYTHON_TRUST = "Company certificates may not be trusted with Python 3.9."
OLD_PYTHON_ACTION = (
    "Install Python 3.10 or newer, then delete the .venv folder in the Stillgreen "
    "folder and run ./sg-local again."
)

LABELS = {
    "python": "Python",
    "daemon": "Stillgreen service",
    "config": "Settings file",
    "permissions": "File permissions",
    "dns": "Find Slack on the network",
    "tls": "Secure connection to Slack",
    "proxy": "Proxy",
    "clock": "Computer clock",
    "workspaces": "Workspaces",
    "presence": "Slack status confirmed",
}
CHECK_IDS = tuple(LABELS)


def network_cache_path() -> Path:
    return config.STATE_DIR / "network.json"


def _check(
    check_id: str,
    status: str,
    detail: str,
    action: str = "",
    code: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": check_id,
        "label": LABELS[check_id],
        "status": status,
        "detail": detail,
        "action": action if status in {"warn", "fail"} else "",
    }
    if code and status in {"warn", "fail"}:
        item["code"] = code
    return item


def _problem(check_id: str, status: str, code: str, detail: str | None = None) -> dict[str, Any]:
    """A check result that uses the catalogue's words for ``code``."""
    info = errors.entry(code)
    return _check(check_id, status, detail or info["message"], info["action"], info["code"])


def _home(text: str) -> str:
    """Show the home folder as ~ so a shared report does not name the user."""
    home = str(Path.home())
    return text.replace(home, "~") if home and home != "/" else text


def _shell_path(path: Path) -> str:
    """A path that is safe to paste into a shell, with the home folder as "$HOME".

    "$HOME" (not ~) keeps working inside quotes, so a folder name with spaces
    or other odd characters stays one argument.
    """
    text = str(path)
    home = str(Path.home())
    if home and home != "/" and text.startswith(home.rstrip("/") + "/"):
        rest = text[len(home.rstrip("/")) + 1:]
        return '"$HOME"/' + shlex.quote(rest)
    return shlex.quote(text)


def _chmod_command(mode: str, paths: list[Path]) -> str:
    return f"chmod {mode} " + " ".join(_shell_path(path) for path in paths)


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


# ----------------------------------------------------------------- local checks


def check_python() -> dict[str, Any]:
    version = platform.python_version()
    if sys.version_info < (3, 9):
        return _problem("python", "fail", "python_too_old", f"This is Python {version}. Stillgreen needs 3.9 or newer.")
    try:
        import websockets
    except ImportError:
        return _problem("python", "fail", "missing_dependency", f"Python {version}, but the websockets package is missing.")
    ws_version = str(getattr(websockets, "__version__", "unknown"))
    try:
        major = int(ws_version.split(".")[0])
    except ValueError:
        major = 0
    if major < 14:
        return _problem(
            "python", "fail", "missing_dependency",
            f"Python {version}, but websockets {ws_version} is too old (14 or newer is needed).",
        )
    if sys.version_info < (3, 10):
        return _check(
            "python", "warn",
            f"Python {version} with websockets {ws_version}. {OLD_PYTHON_TRUST}",
            OLD_PYTHON_ACTION,
        )
    return _check("python", "pass", f"Python {version} with websockets {ws_version}.")


def check_daemon() -> dict[str, Any]:
    pid = state.daemon_pid()
    if pid:
        runtime = state.read_state() or {}
        if runtime.get("pid") in (None, pid) and state.update_pending(runtime):
            return _check(
                "daemon", "warn",
                f"Stillgreen is running (process {pid}), but it still runs the version from before the last update.",
                "Run ./sg-local restart to finish the update.",
            )
        return _check("daemon", "pass", f"Stillgreen is running (process {pid}).")
    if state.lock_held():
        return _check(
            "daemon", "warn",
            "Stillgreen is starting or stopping.",
            "Wait a few seconds and check again. If this stays, run ./sg-local restart.",
        )
    info = errors.entry("daemon_not_running")
    return _check("daemon", "warn", "Stillgreen is not running.", info["action"], "daemon_not_running")


def check_config() -> tuple[dict[str, Any], dict[str, Any]]:
    """The config check, and the config itself (defaults when unreadable)."""
    if not config.CONFIG_PATH.exists():
        return (
            _check(
                "config", "warn",
                "There is no settings file yet. Stillgreen makes it when you add a workspace.",
                "Add a workspace: click Capture from Slack in the Stillgreen extension, or run ./sg-local add.",
            ),
            config.default_config(),
        )
    try:
        cfg = config.load_config()
    except config.ConfigError as exc:
        return _problem("config", "fail", "config_unreadable", _home(redact(str(exc)))), config.default_config()
    return _check("config", "pass", f"The settings file can be read ({_home(str(config.CONFIG_PATH))})."), cfg


def _mode_problem(path: Path, wanted: int) -> str | None:
    """Why ``path`` is not private enough, or None when it is fine."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError as exc:
        return f"{_home(str(path))} cannot be checked ({exc.strerror or exc})"
    if stat.S_ISLNK(info.st_mode):
        return f"{_home(str(path))} is a symbolic link"
    if info.st_uid != os.getuid():
        return f"{_home(str(path))} belongs to another user"
    mode = stat.S_IMODE(info.st_mode)
    if mode & 0o077:
        return f"{_home(str(path))} has mode {mode:04o}; it should be {wanted:04o}"
    return None


def check_permissions() -> dict[str, Any]:
    # Files that hold secrets must be private; a folder open to others is a
    # smaller problem, because the files inside are still private.
    bridge = config.CONFIG_DIR / "bridge.json"
    secret_files = [(config.CONFIG_PATH, 0o600), (bridge, 0o600)]
    folders = [(config.CONFIG_DIR, 0o700), (config.STATE_DIR, 0o700)]
    bad_files = [p for p in (_mode_problem(path, mode) for path, mode in secret_files) if p]
    bad_folders = [p for p in (_mode_problem(path, mode) for path, mode in folders) if p]
    if bad_files:
        targets = [path for path, mode in secret_files if _mode_problem(path, mode)]
        return _check(
            "permissions", "fail",
            "Other people on this computer may be able to read your saved Slack login: "
            + "; ".join(bad_files) + ".",
            f"Run: {_chmod_command('600', targets)}",
        )
    if bad_folders:
        targets = [path for path, mode in folders if _mode_problem(path, mode)]
        return _check(
            "permissions", "warn",
            "A Stillgreen folder is open to other people on this computer: " + "; ".join(bad_folders) + ".",
            f"Run: {_chmod_command('700', targets)}",
        )
    return _check("permissions", "pass", "Your settings and saved logins can only be read by you.")


# --------------------------------------------------------------- network checks


# A name lookup that did not finish in time keeps running in its thread
# (getaddrinfo cannot be stopped). Never start a second one for the same name
# while it runs, so a hanging name service cannot pile up threads.
_LOOKUP_GUARD = threading.Lock()
_LOOKUP_THREADS: dict[str, threading.Thread] = {}


def _with_timeout(function: Any, timeout: float, key: str = "") -> Any:
    """Run ``function`` in a thread and give up after ``timeout`` seconds.

    getaddrinfo has no timeout of its own. Only one thread per ``key`` runs
    at a time: while an earlier one still hangs, this fails at once.
    """
    outcome: dict[str, Any] = {}

    def target() -> None:
        try:
            outcome["value"] = function()
        except BaseException as exc:  # handed back to the caller
            outcome["error"] = exc

    with _LOOKUP_GUARD:
        earlier = _LOOKUP_THREADS.get(key)
        if earlier is not None and earlier.is_alive():
            raise socket.timeout("an earlier name lookup has not finished")
        worker = threading.Thread(target=target, name="diagnostics-lookup", daemon=True)
        _LOOKUP_THREADS[key] = worker
        worker.start()
    worker.join(max(0.0, timeout))
    if worker.is_alive():
        raise socket.timeout("timed out")
    if "error" in outcome:
        raise outcome["error"]
    return outcome.get("value")


class _Deadline:
    """One time limit for a whole network check, shared by every step."""

    def __init__(self, seconds: float) -> None:
        self.end = time.monotonic() + seconds

    def left(self, cap: float | None = None) -> float:
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise socket.timeout("timed out")
        return min(remaining, cap) if cap is not None else remaining


def _connect(host: str, port: int, timeout: float, deadline: _Deadline | None = None) -> socket.socket:
    """socket.create_connection, but the name lookup has a time limit too."""
    deadline = deadline or _Deadline(timeout)
    try:
        # An IP address needs no lookup, so no thread either.
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, flags=socket.AI_NUMERICHOST)
    except socket.gaierror:
        addresses = _with_timeout(
            lambda: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM), deadline.left(timeout), key=host
        )
    last: BaseException | None = None
    for family, kind, proto, _, address in addresses or []:
        sock = socket.socket(family, kind, proto)
        try:
            sock.settimeout(deadline.left(timeout))
            sock.connect(address)
            return sock
        except OSError as exc:
            last = exc
            sock.close()
    raise last or OSError(f"no address found for {host}")


def proxy_for(host: str = SLACK_HOST) -> str | None:
    """The proxy Stillgreen's connections to ``host`` go through, if any."""
    proxies = urllib.request.getproxies()
    proxy = proxies.get("https") or proxies.get("all")
    if not proxy:
        return None
    try:
        if urllib.request.proxy_bypass(host):
            return None
    except Exception:
        pass
    return proxy


def proxy_display(proxy: str) -> str:
    """A proxy address without any user name or password."""
    parsed = urllib.parse.urlsplit(proxy if "://" in proxy else f"http://{proxy}")
    host = parsed.hostname or "?"
    if ":" in host:
        host = f"[{host}]"
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{host}{port}"


def proxy_variables() -> list[str]:
    """Names (not values) of the proxy settings found in the environment."""
    return [name for name in PROXY_VARIABLES if os.environ.get(name)]


class ProxyConnectError(OSError):
    """The proxy refused or failed the CONNECT request. Not a secret."""


def _read_head(sock: socket.socket, limit: int = 16384, deadline: _Deadline | None = None) -> bytes:
    """Read an HTTP head. A slow sender cannot stretch this past the deadline."""
    deadline = deadline or _Deadline(TIMEOUT)
    data = b""
    while b"\r\n\r\n" not in data and len(data) < limit:
        sock.settimeout(deadline.left(TIMEOUT))
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    return data


def _connect_via_proxy(
    proxy: str, host: str, port: int, timeout: float, deadline: _Deadline | None = None
) -> socket.socket:
    parsed = urllib.parse.urlsplit(proxy if "://" in proxy else f"http://{proxy}")
    scheme = (parsed.scheme or "http").lower()
    if scheme not in {"http", "https"}:
        raise ProxyConnectError(f"Stillgreen cannot test a {scheme} proxy")
    proxy_host = parsed.hostname or ""
    proxy_port = parsed.port or (443 if scheme == "https" else 80)
    deadline = deadline or _Deadline(timeout)
    try:
        sock = _connect(proxy_host, proxy_port, timeout, deadline)
    except OSError as exc:
        raise ProxyConnectError(f"could not connect to the proxy ({exc.strerror or type(exc).__name__})") from exc
    try:
        if scheme == "https":
            sock.settimeout(deadline.left(timeout))
            sock = tls.create_ssl_context().wrap_socket(sock, server_hostname=proxy_host)
        lines = [f"CONNECT {host}:{port} HTTP/1.1", f"Host: {host}:{port}"]
        if parsed.username:
            # The proxy's own login, from the proxy setting; only sent to the proxy.
            raw = f"{urllib.parse.unquote(parsed.username)}:{urllib.parse.unquote(parsed.password or '')}"
            lines.append("Proxy-Authorization: Basic " + base64.b64encode(raw.encode()).decode())
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
        head = _read_head(sock, deadline=deadline)
        first = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        match = re.match(r"HTTP/\d(?:\.\d)?\s+(\d{3})", first)
        if not match:
            raise ProxyConnectError("the proxy gave an answer Stillgreen does not understand")
        status = int(match.group(1))
        if status == 407:
            raise ProxyConnectError("the proxy wants a user name and password (HTTP 407)")
        if status != 200:
            raise ProxyConnectError(f"the proxy refused the connection to Slack (HTTP {status})")
    except BaseException:
        sock.close()
        raise
    return sock


def probe_slack(
    host: str = SLACK_HOST, port: int = SLACK_PORT, timeout: float = TIMEOUT, total: float = PROBE_DEADLINE
) -> dict[str, Any]:
    """Open one verified TLS connection to Slack and read its clock.

    Returns ``{"stage", "error", "proxy", "tls_version", "date"}``. ``stage``
    is the step that was running when it stopped: "proxy", "connect", "tls",
    "http" or "done". No token, cookie or code is ever sent. Each step waits
    at most ``timeout`` seconds, and all of them together at most ``total``.
    """
    result: dict[str, Any] = {"stage": "connect", "error": None, "proxy": None, "tls_version": None, "date": None}
    proxy = proxy_for(host)
    deadline = _Deadline(total)
    sock: Any = None
    try:
        if proxy:
            result["proxy"] = proxy_display(proxy)
            result["stage"] = "proxy"
            sock = _connect_via_proxy(proxy, host, port, timeout, deadline)
        else:
            sock = _connect(host, port, timeout, deadline)
        result["stage"] = "tls"
        sock.settimeout(deadline.left(timeout))
        sock = tls.create_ssl_context().wrap_socket(sock, server_hostname=host)
        result["tls_version"] = sock.version()
        result["stage"] = "http"
        request = (
            f"HEAD /api/api.test HTTP/1.1\r\nHost: {host}\r\n"
            "User-Agent: Stillgreen-diagnostics\r\nAccept: */*\r\nConnection: close\r\n\r\n"
        )
        sock.settimeout(deadline.left(timeout))
        sock.sendall(request.encode("ascii"))
        head = _read_head(sock, deadline=deadline).decode("latin-1", "replace")
        match = re.search(r"^date:\s*(.+?)\s*$", head, re.I | re.M)
        if match:
            result["date"] = match.group(1)
        result["stage"] = "done"
    except Exception as exc:
        result["error"] = exc
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
    return result


def _reason(exc: BaseException) -> str:
    """A short, safe description of a network error."""
    if isinstance(exc, ssl.SSLCertVerificationError):
        return str(getattr(exc, "verify_message", "") or "the certificate could not be checked")
    if isinstance(exc, ProxyConnectError):
        return str(exc)
    if isinstance(exc, socket.gaierror):
        return "the name could not be looked up"
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "no answer in time"
    if isinstance(exc, OSError) and exc.strerror:
        return exc.strerror.lower()
    return type(exc).__name__


def check_dns(host: str = SLACK_HOST, timeout: float = TIMEOUT, proxy: str | None = None) -> dict[str, Any]:
    try:
        addresses = _with_timeout(
            lambda: socket.getaddrinfo(host, SLACK_PORT, type=socket.SOCK_STREAM), timeout, key=host
        )
    except Exception as exc:
        code = "network_timeout" if isinstance(exc, (socket.timeout, TimeoutError)) else "dns_failed"
        if proxy:
            # The proxy looks the name up for us, so this may not matter.
            return _check(
                "dns", "warn",
                f"This computer cannot look up {host} itself ({_reason(exc)}), "
                "but your proxy may do it for you. See the proxy check.",
                errors.entry("dns_failed")["action"],
                "dns_failed",
            )
        return _problem("dns", "fail", code, f"Stillgreen could not look up {host} ({_reason(exc)}).")
    count = len({item[4][0] for item in addresses or []})
    return _check("dns", "pass", f"Found {host} ({_plural(count, 'address', 'addresses')}).")


def _trust_text() -> str:
    trust = tls.trust_source()
    extra = trust["extra_files"] + trust["extra_dirs"]
    text = trust["label"]
    if extra:
        text += ", plus " + ", ".join(_home(path) for path in extra)
    return text


def check_tls(probe: dict[str, Any]) -> dict[str, Any]:
    stage, exc = probe["stage"], probe["error"]
    trust = _trust_text()
    if stage in {"http", "done"}:
        version = probe.get("tls_version") or "TLS"
        return _check(
            "tls", "pass",
            f"Secure connection to {SLACK_HOST} works ({version}). Certificates come from: {trust}.",
        )
    if stage == "proxy":
        return _check("tls", "skip", "Not tested, because the proxy did not work. See the proxy check.")
    code = errors.classify(exc) if exc is not None else "unknown"
    if stage == "tls":
        if code not in {"tls_untrusted", "clock_wrong"}:
            code = code if code in errors.NETWORK_CODES else "tls_other"
        info = errors.entry(code)
        detail = f"{info['message']} Reason: {_reason(exc)}. Certificates come from: {trust}."
        action = info["action"]
        if code == "tls_untrusted" and not tls.trust_source()["truststore"]:
            # Without truststore, the computer's own certificate store is not used.
            detail += f" {OLD_PYTHON_TRUST}" if sys.version_info < (3, 10) else ""
            action = f"{OLD_PYTHON_ACTION} {action}"
        return _check("tls", "fail", detail, action, code)
    # Could not even open a connection to Slack.
    if code not in errors.NETWORK_CODES:
        code = "network_unreachable"
    info = errors.entry(code)
    return _check(
        "tls", "fail",
        f"Could not connect to {SLACK_HOST} ({_reason(exc)}), so the secure connection was not tested.",
        info["action"], code,
    )


def check_proxy(probe: dict[str, Any]) -> dict[str, Any]:
    names = proxy_variables()
    if not names:
        return _check("proxy", "skip", "No proxy is set. Stillgreen connects to Slack directly.")
    if not probe.get("proxy"):
        return _check(
            "proxy", "pass",
            f"A proxy is set ({', '.join(names)}), but {SLACK_HOST} is reached directly (NO_PROXY).",
        )
    where = probe["proxy"]
    if probe["stage"] == "proxy":
        info = errors.entry("proxy_failed")
        return _check(
            "proxy", "fail",
            f"The proxy at {where} did not work: {_reason(probe['error'])}.",
            info["action"], "proxy_failed",
        )
    return _check("proxy", "pass", f"Stillgreen reached {SLACK_HOST} through the proxy at {where} ({', '.join(names)}).")


def check_clock(probe: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    exc = probe.get("error")
    if exc is not None and errors.classify(exc) == "clock_wrong":
        return _problem("clock", "fail", "clock_wrong")
    if not probe.get("date"):
        return _check("clock", "skip", "Not tested, because Slack could not be reached.")
    try:
        server = email.utils.parsedate_to_datetime(probe["date"])
    except (TypeError, ValueError):
        return _check("clock", "skip", "Slack's time could not be read.")
    if server.tzinfo is None:
        server = server.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    skew = (current - server).total_seconds()
    size = abs(int(skew))
    direction = "ahead of" if skew > 0 else "behind"
    if size >= CLOCK_FAIL_SECONDS:
        info = errors.entry("clock_wrong")
        return _check(
            "clock", "fail",
            f"Your computer's clock is {_human(size)} {direction} Slack's clock.",
            info["action"], "clock_wrong",
        )
    if size >= CLOCK_WARN_SECONDS:
        return _check(
            "clock", "warn",
            f"Your computer's clock is {_human(size)} {direction} Slack's clock.",
            errors.entry("clock_wrong")["action"], "clock_wrong",
        )
    return _check("clock", "pass", "Your computer's clock matches Slack's clock.")


def _human(seconds: int) -> str:
    if seconds >= 3600:
        return _plural(round(seconds / 3600), "hour", "hours")
    if seconds >= 60:
        return _plural(round(seconds / 60), "minute", "minutes")
    return _plural(seconds, "second", "seconds")


# ------------------------------------------------------------ workspace checks


def _runtime() -> tuple[int | None, dict[str, Any]]:
    pid, runtime = state.live_runtime()
    return pid, runtime or {}


def _live(runtime: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("team_id")): item
        for item in runtime.get("workspaces") or []
        if isinstance(item, dict)
    }


def check_workspaces(cfg: dict[str, Any], runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    workspaces = [w for w in cfg.get("workspaces", []) if isinstance(w, dict)]
    if not workspaces:
        return _check(
            "workspaces", "warn",
            "No Slack workspaces are saved yet.",
            "Sign in at app.slack.com in Chrome, then click Capture from Slack in the "
            "Stillgreen extension (or run ./sg-local add).",
        )
    names = lambda items: ", ".join(str(w.get("name") or w.get("team_id") or "?") for w in items)  # noqa: E731
    invalid = [w for w in workspaces if not config.validate_workspace(w)[0]]
    if invalid:
        info = errors.entry("workspace_invalid")
        return _check("workspaces", "fail", f"{info['message']} Workspace: {names(invalid)}.", info["action"], info["code"])
    live = _live(runtime or {})
    rejected = [
        w for w in workspaces
        if (live.get(str(w.get("team_id"))) or {}).get("auth") == "rejected"
        or (live.get(str(w.get("team_id"))) or {}).get("status") == "invalid_token"
    ]
    if rejected:
        info = errors.entry("slack_auth_rejected")
        return _check(
            "workspaces", "fail",
            f"Slack did not accept the saved login for: {names(rejected)}.",
            info["action"], info["code"],
        )
    teams = [str(w.get("team_id") or "") for w in workspaces]
    duplicates = sorted({team for team in teams if team and teams.count(team) > 1})
    if duplicates:
        return _check(
            "workspaces", "warn",
            f"A workspace is saved twice ({', '.join(duplicates)}). Stillgreen uses the first one.",
            "Remove the extra copy with ./sg-local remove, then add it again.",
        )
    return _check("workspaces", "pass", f"{_plural(len(workspaces), 'workspace', 'workspaces')} saved: {names(workspaces)}.")


def _age_seconds(value: Any, now: datetime) -> float | None:
    if not value:
        return None
    try:
        moment = config.parse_iso(str(value))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (now - moment).total_seconds()


def check_presence(
    cfg: dict[str, Any], pid: int | None, runtime: dict[str, Any], now: datetime | None = None
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    workspaces = [w for w in cfg.get("workspaces", []) if isinstance(w, dict)]
    if not workspaces:
        return _check("presence", "skip", "No workspaces to check.")
    if not pid:
        return _check("presence", "skip", "Not checked, because Stillgreen is not running.")
    live = _live(runtime)
    wanted = [
        (w, live.get(str(w.get("team_id"))) or {})
        for w in workspaces
        if not w.get("paused") and (live.get(str(w.get("team_id"))) or {}).get("desired", True)
    ]
    if not wanted:
        return _check("presence", "skip", "Paused or outside your schedule, so there is nothing to confirm now.")
    confirmed, manual, missing = [], [], []
    for workspace, item in wanted:
        name = str(workspace.get("name") or workspace.get("team_id") or "?")
        age = _age_seconds(item.get("presence_verified_at"), now)
        if item.get("presence") == "manual_away" or item.get("status") == "manual_away":
            manual.append(name)
        elif age is not None and age <= PRESENCE_FRESH_SECONDS:
            confirmed.append(name)
        else:
            missing.append(name)
    if not manual and not missing:
        return _check(
            "presence", "pass",
            f"In the last 10 minutes Slack showed you as active in: {', '.join(confirmed)}.",
        )
    started_age = _age_seconds(runtime.get("started_at"), now)
    parts = []
    if missing:
        parts.append(f"Slack has not shown you as active in the last 10 minutes in: {', '.join(missing)}.")
    if manual:
        parts.append(f"You set yourself away in: {', '.join(manual)}. Stillgreen leaves that alone.")
    if missing and started_age is not None and started_age < 120:
        action = "Stillgreen started a moment ago. Wait two minutes and check again."
    elif missing:
        action = (
            "Look at the other checks for a problem. Stillgreen keeps a Slack connection open "
            "the way the web app does, but Slack decides your final status."
        )
    else:
        action = "To show as active again, set yourself as active in Slack."
    return _check("presence", "warn", " ".join(parts), action)


# --------------------------------------------------------------------- running


def save_network_result(tls_check: dict[str, Any], when: str) -> None:
    """Remember whether Slack was reachable, for the health summary."""
    if tls_check["status"] == "skip":
        return
    payload = {
        "reachable": tls_check["status"] == "pass",
        "checked_at": when,
        "code": tls_check.get("code"),
    }
    try:
        if config.STATE_DIR.is_dir():
            config.atomic_write(network_cache_path(), json.dumps(payload) + "\n")
    except OSError:
        pass


def load_network_result() -> dict[str, Any] | None:
    payload = state.read_json(network_cache_path())
    if not payload or not isinstance(payload.get("reachable"), bool):
        return None
    return payload


def run_checks(network: bool = True) -> dict[str, Any]:
    """Run every check. ``network=False`` skips the ones that contact Slack."""
    generated_at = config.now_iso()
    config_check, cfg = check_config()
    pid, runtime = _runtime()
    checks = [check_python(), check_daemon(), config_check, check_permissions()]
    if network:
        proxy = proxy_for(SLACK_HOST)
        checks.append(check_dns(proxy=proxy))
        probe = probe_slack()
        tls_check = check_tls(probe)
        if proxy and probe.get("proxy") and tls_check["status"] == "pass" and checks[-1]["status"] != "pass":
            # The proxy found Slack for us, so the local lookup does not matter.
            checks[-1] = _check("dns", "pass", f"Your proxy finds {SLACK_HOST} for this computer.")
        checks += [tls_check, check_proxy(probe), check_clock(probe)]
        save_network_result(tls_check, generated_at)
    else:
        for check_id in ("dns", "tls", "proxy", "clock"):
            checks.append(_check(check_id, "skip", "Not checked (network checks were turned off)."))
    checks.append(check_workspaces(cfg, runtime))
    checks.append(check_presence(cfg, pid, runtime))
    # A last safety net: no check may ever show a token, cookie or code, even
    # one that someday puts an error's own text in its words.
    for check in checks:
        for field in ("detail", "action"):
            if check.get(field):
                check[field] = redact_report(check[field], secrets=[])
    return {"generated_at": generated_at, "checks": checks}


class DiagnosticsBusy(Exception):
    """Another diagnostics run is still going, and waiting for it took too long."""

    code = "diagnostics_busy"


_RUN_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {}
FRESH_SECONDS = 5.0


def cached_checks(max_age: float = CACHE_SECONDS, wait: float = PROBE_DEADLINE + 2 * TIMEOUT) -> dict[str, Any]:
    """run_checks() for the web pages: one run at a time, and a short cache.

    A caller that arrives during a run waits for it and gets the same result.
    A result newer than ``max_age`` seconds is reused instead of contacting
    Slack again. Raises DiagnosticsBusy if a run takes longer than ``wait``.
    """
    key = (str(config.CONFIG_DIR), str(config.STATE_DIR))

    def recent() -> dict[str, Any] | None:
        entry = _CACHE.get("entry")
        if entry and entry["key"] == key and time.monotonic() - entry["at"] < max_age:
            return copy.deepcopy(entry["result"])
        return None

    result = recent()
    if result is not None:
        return result
    if not _RUN_LOCK.acquire(timeout=wait):
        raise DiagnosticsBusy("diagnostics are already running")
    try:
        result = recent()  # the run we waited for may have just finished
        if result is not None:
            return result
        result = run_checks()
        _CACHE["entry"] = {"key": key, "at": time.monotonic(), "result": copy.deepcopy(result)}
        return result
    finally:
        _RUN_LOCK.release()


def clear_cache() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------------- report

_SG_CODE_RE = re.compile(r"\bSG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b", re.I)
_REDACTIONS = (
    (re.compile(r"(token=)[^\s&\"';,]+", re.I), r"\1[redacted]"),
    (re.compile(r"((?:^|[\s;,\"'])(?:d|d-s|lc|b)=)[^\s;&\"',]+", re.I), r"\1[redacted]"),
    (re.compile(r"((?:set-)?cookie\s*[:=]\s*)[^\r\n]+", re.I), r"\1[redacted]"),
    (re.compile(r"((?:proxy-)?authorization\s*[:=]\s*)[^\r\n]+", re.I), r"\1[redacted]"),
    (re.compile(r"(bearer\s+)[^\s\"']+", re.I), r"\1[redacted]"),
    (re.compile(r"((?:access[ _-]?)?code\s*[:=]\s*)[^\s\"',]+", re.I), r"\1[redacted]"),
    # user:password@ in a URL, for example a proxy address
    (re.compile(r"(://)[^/\s@:]+(?::[^/\s@]*)?@"), r"\1[redacted]@"),
)


# Token-like values in a settings file that cannot be read as JSON: the
# value of any "xoxc"/"xoxd"/"token"/"cookie" field, and anything that looks
# like a Slack token.
_RAW_SECRET_RES = (
    re.compile(r'"(?:xoxc|xoxd|token|cookie|d)"\s*:\s*"((?:[^"\\]|\\.){4,})"', re.I),
    re.compile(r"xox[a-z]-[A-Za-z0-9%._+/=\-]{4,}", re.I),
)


def _secrets_in_raw_config() -> list[str]:
    """Token-like values in config.json, read as plain text.

    Used when the file is damaged and cannot be parsed, which is exactly when
    people ask for help and share a report.
    """
    try:
        raw = config.CONFIG_PATH.read_bytes()[:2_000_000].decode("utf-8", "replace")
    except OSError:
        return []
    found: list[str] = []
    for pattern in _RAW_SECRET_RES:
        for match in pattern.finditer(raw):
            value = match.group(1) if pattern.groups else match.group(0)
            found.append(value)
            for prefix in ("xoxc-", "xoxd-"):
                # The part after the prefix, in case a log line has only that.
                if value.lower().startswith(prefix) and len(value) > len(prefix) + 4:
                    found.append(value[len(prefix):])
    return found


def _known_secrets() -> list[str]:
    """Every token, cookie and access code Stillgreen knows about."""
    from . import web  # local import: web imports this module

    secrets: list[str] = []
    for code in (web.env_code(), web.load_code(create=False)):
        if code:
            secrets += [code, web.normalize_code(code)]
    values: list[str] = []
    try:
        cfg = config.load_config()
    except config.ConfigError:
        cfg = config.default_config()
        values += _secrets_in_raw_config()
    for workspace in cfg.get("workspaces", []):
        if isinstance(workspace, dict):
            for field in ("xoxc", "xoxd"):
                value = str(workspace.get(field) or "")
                if value:
                    values.append(value)
    for value in values:
        secrets += [value, urllib.parse.unquote(value), urllib.parse.quote(value, safe="")]
    return [secret for secret in secrets if secret.strip()]


def _replace_secret(text: str, secret: str) -> str:
    if len(secret) >= 4:
        return text.replace(secret, "[redacted]")
    # A very short code would match inside ordinary words; only replace it
    # where it stands on its own.
    pattern = r"(?<![A-Za-z0-9])" + re.escape(secret) + r"(?![A-Za-z0-9])"
    return re.sub(pattern, "[redacted]", text)


def redact_report(text: str, secrets: list[str] | None = None) -> str:
    """Remove tokens, cookies, access codes and the user's home folder."""
    known = sorted(set(secrets if secrets is not None else _known_secrets()), key=len, reverse=True)
    cleaned = text or ""
    for secret in known:
        cleaned = _replace_secret(cleaned, secret)
    cleaned = redact(cleaned)
    for pattern, replacement in _REDACTIONS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = _SG_CODE_RE.sub("[redacted-code]", cleaned)
    return _home(cleaned)


def _os_text() -> str:
    if sys.platform == "darwin":
        release = platform.mac_ver()[0]
        return f"macOS {release or '?'} ({platform.machine()})"
    return f"{platform.system()} {platform.release()} ({platform.machine()})"


def _package_version(name: str) -> str:
    try:
        module = __import__(name)
    except ImportError:
        return "not installed"
    return str(getattr(module, "__version__", "installed"))


def report_text(result: dict[str, Any] | None = None, log_lines: int = 100) -> str:
    """The redacted diagnostics report as plain text.

    Pass the result of a run that just happened (the web page passes the
    cached one), so the report does not contact Slack again.
    """
    result = result or run_checks()
    pid, runtime = _runtime()
    lines = [
        "Stillgreen diagnostics report",
        "=============================",
        f"Made: {result['generated_at']}",
        "This report has no tokens, cookies or access codes. Read it before you share it.",
        "",
        f"Stillgreen:        {__version__}",
        f"Python:            {platform.python_version()} ({platform.python_implementation()})",
        f"websockets:        {_package_version('websockets')}",
        f"truststore:        {_package_version('truststore')}",
        f"Operating system:  {_os_text()}",
        f"Certificates:      {_trust_text()}",
        f"Proxy settings:    {', '.join(proxy_variables()) or 'none'}",
        f"Stillgreen folder: {config.PROJECT_ROOT}",
        f"Settings folder:   {config.CONFIG_DIR}",
        f"State folder:      {config.STATE_DIR}",
        f"Service:           {state.status_label()}",
    ]
    proxy = proxy_for(SLACK_HOST)
    if proxy:
        lines.append(f"Proxy for Slack:   {proxy_display(proxy)}")
    live = runtime.get("workspaces") or []
    if live:
        lines += ["", "Workspaces", "----------"]
        for item in live:
            if not isinstance(item, dict):
                continue
            lines.append(
                f"- {item.get('name') or item.get('team_id')}: status {item.get('status')}, "
                f"login {item.get('auth', 'unknown')}, presence {item.get('presence', 'unknown')}, "
                f"last confirmed active {item.get('presence_verified_at') or 'never'}"
                + (f", problem {item.get('last_error_code')}" if item.get("last_error_code") else "")
            )
    lines += ["", "Checks", "------"]
    for check in result["checks"]:
        lines.append(f"[{check['status']}] {check['label']}: {check['detail']}")
        if check.get("action"):
            lines.append(f"       What to do: {check['action']}")
    lines += ["", f"Recent log lines (last {log_lines})", "-------------------------------"]
    log = state.tail_log(log_lines)
    lines.append(log if log else "(no log yet)")
    return redact_report("\n".join(lines) + "\n")
