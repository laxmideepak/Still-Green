"""Local and cloud control surface for the presence daemon.

The server binds to loopback by default. In cloud mode it binds to ``0.0.0.0``
behind the platform's TLS proxy and requires an access code for every API call.

Security model:

* Only Slack is contacted for token verification; the control surface never
  sends credentials to the hosted dashboard.
* The access code is stored in ``bridge.json`` with mode 0600, or supplied with
  ``SG_LOCAL_BRIDGE_CODE``. It is required by state and mutation endpoints.
* Token values are never returned by the API, written to logs, or included in
  error messages.
* CORS is an allowlist. The hosted dashboard needs the access code as well, so
  an unknown origin cannot read or change anything.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import threading
import webbrowser
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import __version__, config, schedule, state
from .slack import SlackAPIError, SlackClient, redact

BRIDGE_PATH = config.CONFIG_DIR / "bridge.json"
DEFAULT_PORT = 8765
MAX_BODY = 64 * 1024
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LOG_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (\w+) \[([^\]]*)\] (.*)$")


# --------------------------------------------------------------------- bridge


def generate_code() -> str:
    groups = ["".join(secrets.choice(CODE_ALPHABET) for _ in range(4)) for _ in range(3)]
    return "SG-" + "-".join(groups)


def load_code(create: bool = True) -> str:
    env_code = (os.environ.get("SG_LOCAL_BRIDGE_CODE") or "").strip()
    if env_code:
        return env_code
    if BRIDGE_PATH.exists():
        try:
            payload = json.loads(BRIDGE_PATH.read_text(encoding="utf-8"))
            code = str(payload.get("code") or "")
            if code:
                return code
        except (OSError, json.JSONDecodeError):
            pass
    if not create:
        return ""
    code = generate_code()
    config.ensure_dirs()
    config.atomic_write(
        BRIDGE_PATH,
        json.dumps({"code": code, "created_at": config.now_iso()}, indent=2) + "\n",
    )
    return code


def rotate_code() -> str:
    if (os.environ.get("SG_LOCAL_BRIDGE_CODE") or "").strip():
        raise config.ConfigError(
            "SG_LOCAL_BRIDGE_CODE is set; rotate it in the deployment environment instead"
        )
    code = generate_code()
    config.ensure_dirs()
    config.atomic_write(
        BRIDGE_PATH,
        json.dumps({"code": code, "created_at": config.now_iso()}, indent=2) + "\n",
    )
    return code


def _configured_origins() -> list[str]:
    raw = os.environ.get("SG_LOCAL_WEB_ORIGIN", "")
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


def origin_allowed(origin: str | None) -> bool:
    if not origin:
        return True  # same-origin fetch or a non-browser client
    origin = origin.rstrip("/")
    allowed = _configured_origins()
    if origin in allowed:
        return True
    parsed = urlparse(origin)
    host = (parsed.hostname or "").lower()
    if parsed.scheme in {"http", "https"} and host in {"localhost", "127.0.0.1", "::1"}:
        return True
    if (
        os.environ.get("SG_LOCAL_ALLOW_VERCEL", "1") == "1"
        and parsed.scheme == "https"
        and host.endswith(".vercel.app")
    ):
        return True
    return False


# --------------------------------------------------------------------- helpers


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_error(message: str, *secrets_: str) -> str:
    return redact(message, *secrets_)


def _read_config() -> dict[str, Any]:
    try:
        return config.load_config()
    except config.ConfigError:
        return config.default_config()


def _runtime() -> tuple[int | None, dict[str, Any] | None]:
    pid = state.daemon_pid()
    runtime = state.read_state()
    if runtime and pid and runtime.get("pid") not in (None, pid):
        runtime = None
    return pid, runtime


def _find_workspace(cfg: dict[str, Any], query: str) -> tuple[int, dict[str, Any]]:
    text = (query or "").strip().lower()
    for index, workspace in enumerate(cfg.get("workspaces", [])):
        if not isinstance(workspace, dict):
            continue
        if str(workspace.get("team_id", "")).lower() == text:
            return index, workspace
    for index, workspace in enumerate(cfg.get("workspaces", [])):
        if isinstance(workspace, dict) and str(workspace.get("name", "")).lower() == text:
            return index, workspace
    raise config.ConfigError(f"no workspace matches {query!r}")


def _safe_workspace(
    workspace: dict[str, Any], live: dict[str, Any] | None, daemon_running: bool
) -> dict[str, Any]:
    live = live or {}
    paused = bool(workspace.get("paused"))
    if live:
        status = str(live.get("status") or "starting")
        connected = bool(live.get("connected"))
        reason = str(live.get("reason") or "")
        last_error = live.get("last_error")
        stats = live.get("stats") or {}
    elif not daemon_running:
        status = "paused" if paused else "daemon_stopped"
        connected = False
        reason = "daemon not running"
        last_error = None
        stats = {}
    else:
        status = "starting"
        connected = False
        reason = "waiting for the daemon"
        last_error = None
        stats = {}
    return {
        "team_id": str(workspace.get("team_id") or ""),
        "name": str(workspace.get("name") or workspace.get("team_id") or "Workspace"),
        "user_id": str(workspace.get("user_id") or ""),
        "paused": paused,
        "status": status,
        "connected": connected,
        "reason": reason,
        "last_presence": live.get("last_presence"),
        "last_error": _safe_error(str(last_error)) if last_error else None,
        "stats": stats if isinstance(stats, dict) else {},
        "added_at": workspace.get("added_at"),
    }


def _activity(limit: int = 30) -> list[dict[str, Any]]:
    if not config.LOG_PATH.exists():
        return []
    try:
        lines = config.LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    events: list[dict[str, Any]] = []
    for line in lines[-500:]:
        match = LOG_RE.match(line)
        if not match:
            continue
        date, clock, level, workspace, message = match.groups()
        lowered = message.lower()
        tone = "muted"
        if "presence is active" in lowered or "connected to slack websocket" in lowered:
            tone = "green"
        elif "presence is away" in lowered or "reconnect" in lowered:
            tone = "amber"
        elif "rejected" in lowered or "error" in lowered or level in {"ERROR", "CRITICAL"}:
            tone = "amber"
        elif "starting presence session" in lowered or "mode:" in lowered:
            tone = "muted"
        events.append(
            {
                "date": date,
                "time": clock[:5],
                "workspace": workspace,
                "text": _safe_error(message),
                "tone": tone,
                "level": level,
            }
        )
    return list(reversed(events[-limit:]))


def build_state() -> dict[str, Any]:
    cfg = _read_config()
    pid, runtime = _runtime()
    runtime_workspaces = {
        str(item.get("team_id")): item
        for item in (runtime or {}).get("workspaces", [])
        if isinstance(item, dict)
    }
    workspaces = [
        _safe_workspace(workspace, runtime_workspaces.get(str(workspace.get("team_id"))), bool(pid))
        for workspace in cfg.get("workspaces", [])
        if isinstance(workspace, dict)
    ]
    current_schedule = cfg.get("schedule", {})
    try:
        active = schedule.is_within_schedule(current_schedule)
        boundary = schedule.next_boundary(current_schedule)
        summary = schedule.schedule_summary(current_schedule)
    except Exception:
        active, boundary, summary = True, None, "invalid schedule"
    active_workspaces = sum(1 for item in workspaces if item["connected"] and item["status"] == "active")
    return {
        "ok": True,
        "app": "stillgreen",
        "version": __version__,
        "server_time": _iso_now(),
        "daemon": {
            "running": bool(pid),
            "pid": pid,
            "started_at": (runtime or {}).get("started_at"),
            "updated_at": (runtime or {}).get("updated_at"),
            "stopped_at": (runtime or {}).get("stopped_at"),
        },
        "schedule": {
            **{key: current_schedule.get(key) for key in ("mode", "active_days", "start_time", "end_time", "timezone")},
            "summary": summary,
            "active": active,
            "next_change": boundary.isoformat(timespec="seconds") if boundary else None,
        },
        "paused": bool((runtime or {}).get("paused")) if pid else bool(config.read_pause()),
        "pause_until": (runtime or {}).get("pause_until") if pid else (config.read_pause() or {}).get("until"),
        "stay_active": bool((runtime or {}).get("stay_active")) if pid else bool(config.read_stay()),
        "stay_until": (runtime or {}).get("stay_until") if pid else (config.read_stay() or {}).get("until"),
        "workspaces": workspaces,
        "connected_count": active_workspaces,
        "activity": _activity(),
    }


# ------------------------------------------------------------------ mutations


def update_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    mode = str(payload.get("mode") or "").strip()
    if mode not in {"always", "scheduled"}:
        raise config.ConfigError("mode must be 'always' or 'scheduled'")
    cfg = _read_config()
    current = cfg.get("schedule", {})
    if mode == "always":
        updated = {
            "mode": "always",
            "active_days": current.get("active_days") or list(config.DAY_NAMES[:5]),
            "start_time": current.get("start_time") or "09:00",
            "end_time": current.get("end_time") or "17:00",
            "timezone": payload.get("timezone") or current.get("timezone") or "local",
        }
        schedule.resolve_timezone(updated["timezone"])
    else:
        updated = schedule.make_schedule(
            payload.get("active_days") or "weekdays",
            payload.get("start_time") or "09:00",
            payload.get("end_time") or "17:00",
            payload.get("timezone") or "local",
        )
    cfg["schedule"] = updated
    config.save_config(cfg)
    return build_state()


def set_pause(payload: dict[str, Any]) -> dict[str, Any]:
    cfg = _read_config()
    workspace_query = str(payload.get("workspace") or "").strip()
    if workspace_query:
        index, workspace = _find_workspace(cfg, workspace_query)
        workspace["paused"] = True
        workspace["paused_at"] = config.now_iso()
        cfg["workspaces"][index] = workspace
        config.save_config(cfg)
        return build_state()
    duration = str(payload.get("duration") or "").strip()
    until = None
    if duration:
        until = datetime.now(timezone.utc) + config.parse_duration(duration)
    config.write_pause(until)
    return build_state()


def set_resume(payload: dict[str, Any]) -> dict[str, Any]:
    cfg = _read_config()
    workspace_query = str(payload.get("workspace") or "").strip()
    if workspace_query:
        index, workspace = _find_workspace(cfg, workspace_query)
        workspace["paused"] = False
        workspace.pop("paused_at", None)
        cfg["workspaces"][index] = workspace
        config.save_config(cfg)
        return build_state()
    config.clear_pause()
    changed = False
    for index, workspace in enumerate(cfg.get("workspaces", [])):
        if isinstance(workspace, dict) and workspace.get("paused"):
            workspace["paused"] = False
            workspace.pop("paused_at", None)
            cfg["workspaces"][index] = workspace
            changed = True
    if changed:
        config.save_config(cfg)
    return build_state()


def set_stay(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("cancel"):
        config.clear_stay()
        return build_state()
    duration = str(payload.get("duration") or "").strip()
    if not duration:
        raise config.ConfigError("duration is required")
    until = datetime.now(timezone.utc) + config.parse_duration(duration)
    config.write_stay(until)
    return build_state()


def add_workspace(payload: dict[str, Any]) -> dict[str, Any]:
    xoxc = config.clean_xoxc(str(payload.get("xoxc") or ""))
    xoxd = config.clean_xoxd(str(payload.get("xoxd") or ""))
    if not xoxc.startswith("xoxc-"):
        raise config.ConfigError("the xoxc token must start with 'xoxc-'")
    if not xoxd.startswith("xoxd-"):
        raise config.ConfigError("the xoxd cookie must start with 'xoxd-'")
    client = SlackClient(xoxc, xoxd)
    try:
        identity = client.auth_test()
    except SlackAPIError as exc:
        if exc.token_invalid:
            raise config.ConfigError("Slack rejected these tokens; capture both values again") from None
        raise config.ConfigError(f"could not verify the tokens: {exc.error}") from None
    except Exception as exc:
        raise config.ConfigError(_safe_error(f"could not reach Slack: {exc}", xoxc, xoxd)) from None

    team_id = str(identity.get("team_id") or "")
    user_id = str(identity.get("user_id") or "")
    if not team_id or not user_id:
        raise config.ConfigError("Slack did not return a team and user identity")
    team_name = str(identity.get("team") or identity.get("url") or team_id)
    cfg = _read_config()
    workspace = {
        "name": str(payload.get("name") or team_name),
        "team_id": team_id,
        "user_id": user_id,
        "xoxc": xoxc,
        "xoxd": xoxd,
        "added_at": config.now_iso(),
    }
    for index, existing in enumerate(cfg.get("workspaces", [])):
        if isinstance(existing, dict) and str(existing.get("team_id")) == team_id:
            workspace["added_at"] = existing.get("added_at") or workspace["added_at"]
            workspace["paused"] = bool(existing.get("paused"))
            cfg["workspaces"][index] = workspace
            break
    else:
        cfg.setdefault("workspaces", []).append(workspace)
    config.save_config(cfg)
    return {"ok": True, "team_id": team_id, "name": workspace["name"], "state": build_state()}


def remove_workspace(team_id: str) -> dict[str, Any]:
    cfg = _read_config()
    index, workspace = _find_workspace(cfg, team_id)
    del cfg["workspaces"][index]
    config.save_config(cfg)
    return {"ok": True, "removed": workspace.get("name") or team_id, "state": build_state()}


def set_workspace_pause(team_id: str, paused: bool) -> dict[str, Any]:
    return set_pause({"workspace": team_id}) if paused else set_resume({"workspace": team_id})


# -------------------------------------------------------------------- handler


class Handler(BaseHTTPRequestHandler):
    server_version = "Stillgreen"
    sys_version = ""

    def log_message(self, fmt: str, *args: Any) -> None:
        # Never let a token or query string reach a platform log.
        message = fmt % args
        print(f"[web] {_safe_error(message)}")

    # ---------------------------------------------------------------- headers

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")

    def _json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._json({"ok": False, "error": _safe_error(message)}, status)

    def _html(self, body: str, status: int = 200) -> None:
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _asset(self, body: str, content_type: str) -> None:
        raw = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    # ------------------------------------------------------------------- auth

    def _authorized(self) -> bool:
        code = load_code(create=False)
        if not code:
            return False
        header = self.headers.get("Authorization", "")
        if header.lower().startswith("bearer "):
            supplied = header[7:].strip()
        else:
            supplied = ""
        return bool(supplied) and hmac.compare_digest(supplied, code)

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise config.ConfigError("request body is too large")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise config.ConfigError("request body must be JSON") from None
        if not isinstance(payload, dict):
            raise config.ConfigError("request body must be a JSON object")
        return payload

    def _guard(self) -> bool:
        if not origin_allowed(self.headers.get("Origin")):
            self._error(HTTPStatus.FORBIDDEN, "origin is not allowed")
            return False
        if not self._authorized():
            self._error(HTTPStatus.UNAUTHORIZED, "access code is required")
            return False
        return True

    # -------------------------------------------------------------------- GET

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/", "/connect"}:
            code = load_code()
            embed = self._embed_code()
            self._html(render_page(code if embed else "", embed))
            return
        if path == "/app.css":
            self._asset(PAGE_CSS, "text/css; charset=utf-8")
            return
        if path == "/app.js":
            self._asset(PAGE_JS, "text/javascript; charset=utf-8")
            return
        if path == "/favicon.svg":
            self._asset(FAVICON, "image/svg+xml")
            return
        if path == "/api/health":
            pid, _ = _runtime()
            self._json(
                {
                    "ok": True,
                    "app": "stillgreen",
                    "version": __version__,
                    "daemon": bool(pid),
                    "auth": "bridge-code",
                }
            )
            return
        if path == "/api/state":
            if not self._guard():
                return
            self._json(build_state())
            return
        if path == "/api/code":
            # Only meaningful over loopback; cloud deployments do not embed the
            # code and the endpoint still requires the code.
            if not self._guard():
                return
            self._json({"ok": True, "code": load_code(create=False)})
            return
        self._error(HTTPStatus.NOT_FOUND, "not found")

    # ------------------------------------------------------------------- POST

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        if not self._guard():
            return
        try:
            payload = self._body()
            if path == "/api/schedule":
                self._json(update_schedule(payload))
            elif path == "/api/pause":
                self._json(set_pause(payload))
            elif path == "/api/resume":
                self._json(set_resume(payload))
            elif path == "/api/stay":
                self._json(set_stay(payload))
            elif path == "/api/workspaces":
                self._json(add_workspace(payload))
            elif path == "/api/code/rotate":
                if self.headers.get("Origin") and not self._same_origin():
                    self._error(HTTPStatus.FORBIDDEN, "rotate the code from the local page")
                    return
                self._json({"ok": True, "code": rotate_code()})
            else:
                self._error(HTTPStatus.NOT_FOUND, "not found")
        except config.ConfigError as exc:
            self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, _safe_error(str(exc)))

    # ----------------------------------------------------------------- DELETE

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            self._error(HTTPStatus.NOT_FOUND, "not found")
            return
        if not self._guard():
            return
        try:
            match = re.fullmatch(r"/api/workspaces/([^/]+)/?(:?pause|resume)?", path)
            if not match:
                self._error(HTTPStatus.NOT_FOUND, "not found")
                return
            from urllib.parse import unquote

            team_id = unquote(match.group(1))
            action = match.group(2) or ""
            if action == "pause":
                self._json(set_workspace_pause(team_id, True))
            elif action == "resume":
                self._json(set_workspace_pause(team_id, False))
            else:
                self._json(remove_workspace(team_id))
        except config.ConfigError as exc:
            self._error(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, _safe_error(str(exc)))

    # ------------------------------------------------------------------ misc

    def _same_origin(self) -> bool:
        origin = (self.headers.get("Origin") or "").rstrip("/")
        host = self.headers.get("Host") or ""
        return bool(origin) and origin in {f"http://{host}", f"https://{host}"}

    def _embed_code(self) -> bool:
        """Embed the code only on a loopback-only server."""
        return os.environ.get("SG_LOCAL_EMBED_CODE", "auto").lower() not in {
            "0",
            "false",
            "no",
        } and self.server.server_address[0] in {"127.0.0.1", "::1", "localhost"}


# ---------------------------------------------------------------------- server


class ControlServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(host: str, port: int) -> ControlServer:
    return ControlServer((host, port), Handler)


def serve(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> None:
    server = make_server(host, port)
    display_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    print(f"Stillgreen control surface: http://{display_host}:{port}")
    if host in {"0.0.0.0", "::"}:
        print("Cloud mode: put this behind HTTPS and set SG_LOCAL_WEB_ORIGIN to your dashboard.")
        print("The access code is in SG_LOCAL_BRIDGE_CODE or bridge.json; it is not printed here.")
    else:
        print(f"Access code: {load_code()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


# ------------------------------------------------------------------ local page


def render_page(code: str, embed: bool) -> str:
    bootstrap = json.dumps({"code": code, "embed": embed}).replace("<", "\\u003c")
    return PAGE_HTML.replace("__BOOTSTRAP__", bootstrap)


PAGE_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stillgreen — local control</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<header class="top">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"><i></i></span><span>Stillgreen</span></a>
  <span class="tag">Control surface</span>
</header>
<main id="main">
  <section class="login" id="login" hidden>
    <p class="eyebrow"><span></span> Cloud mode</p>
    <h1>Enter the access code.</h1>
    <p>This control surface is reachable from the network, so it is locked. The code is in your deployment's <code>SG_LOCAL_BRIDGE_CODE</code> secret or <code>bridge.json</code>.</p>
    <form id="loginForm">
      <label for="accessCode">Access code</label>
      <div class="inline"><input id="accessCode" name="code" autocomplete="current-password" spellcheck="false" placeholder="SG-XXXX-XXXX-XXXX" required><button class="primary" type="submit">Unlock</button></div>
      <p class="error" id="loginError" role="alert"></p>
    </form>
  </section>

  <div id="app" hidden>
    <section class="hero">
      <div>
        <p class="eyebrow"><span id="statusDot"></span> <span id="statusText">Connecting…</span></p>
        <h1>Your green dot,<br><em>handled.</em></h1>
        <p class="lede">This page runs next to the presence daemon. Tokens are entered here and never sent to the hosted dashboard.</p>
      </div>
      <div class="codeCard">
        <span>Dashboard access code</span>
        <strong id="bridgeCode">••••</strong>
        <div class="row">
          <button class="ghost" id="copyCode" type="button">Copy code</button>
          <button class="ghost" id="rotateCode" type="button">Rotate</button>
        </div>
        <p>Paste this into the hosted dashboard's <b>Connect</b> dialog.</p>
      </div>
    </section>

    <section class="grid">
      <article class="card span2">
        <div class="cardHead"><div><p class="kicker">Workspaces</p><h2>Connected Slack accounts</h2></div><button class="primary" id="addToggle" type="button">Add workspace</button></div>
        <div id="workspaceList" class="list"></div>
        <form id="addForm" class="addForm" hidden>
          <div class="formHead"><h3>Add a workspace</h3><button class="ghost" type="button" id="addClose">Close</button></div>
          <p class="hint">Open the target workspace at <code>app.slack.com</code>, then copy the two values from DevTools. They go only to this daemon.</p>
          <div class="field"><label for="xoxc">xoxc token</label><input id="xoxc" name="xoxc" type="password" autocomplete="off" spellcheck="false" placeholder="xoxc-…" required></div>
          <div class="field"><label for="xoxd">xoxd cookie</label><input id="xoxd" name="xoxd" type="password" autocomplete="off" spellcheck="false" placeholder="xoxd-…" required></div>
          <div class="field"><label for="name">Display name <span>(optional)</span></label><input id="name" name="name" placeholder="Fieldwork"></div>
          <details class="help"><summary>Where do I find these?</summary><ol><li>Open DevTools → Network, filter <code>api</code>, open a <code>client.boot</code> request, and copy <code>token</code> from the payload — it starts with <code>xoxc-</code>.</li><li>DevTools → Application → Cookies → <code>https://app.slack.com</code> → copy the <code>d</code> cookie, which starts with <code>xoxd-</code>.</li><li>Both values must come from the same signed-in browser session.</li></ol></details>
          <p class="error" id="addError" role="alert"></p>
          <button class="primary" type="submit" id="addSubmit">Verify &amp; save</button>
        </form>
      </article>

      <article class="card">
        <p class="kicker">Now</p>
        <h2 id="modeTitle">Loading</h2>
        <p id="modeDetail" class="muted"></p>
        <dl class="facts">
          <div><dt>Daemon</dt><dd id="daemonState">—</dd></div>
          <div><dt>Online</dt><dd id="onlineCount">—</dd></div>
          <div><dt>Next change</dt><dd id="nextChange">—</dd></div>
        </dl>
        <div class="actions">
          <button class="ghost" data-action="pause">Pause 1h</button>
          <button class="ghost" data-action="resume">Resume</button>
          <button class="ghost" data-action="stay">Stay 1h</button>
        </div>
      </article>

      <article class="card span2">
        <div class="cardHead"><div><p class="kicker">Schedule</p><h2>Weekly window</h2></div><span class="pill" id="scheduleSummary">—</span></div>
        <form id="scheduleForm">
          <div class="segmented" role="group" aria-label="Schedule mode">
            <button type="button" data-mode="always">Always on</button>
            <button type="button" data-mode="scheduled">Scheduled</button>
          </div>
          <div class="days" id="dayPicker"></div>
          <div class="timeGrid">
            <div class="field"><label for="startTime">Start</label><input id="startTime" type="time" value="09:00"></div>
            <div class="field"><label for="endTime">End</label><input id="endTime" type="time" value="17:00"></div>
            <div class="field"><label for="timezone">Timezone</label><input id="timezone" value="local" spellcheck="false"></div>
          </div>
          <div class="formFoot"><p class="hint">Overnight windows are supported. Times use the daemon's timezone unless you name an IANA zone.</p><button class="primary" type="submit">Save schedule</button></div>
        </form>
      </article>

      <article class="card span2">
        <div class="cardHead"><div><p class="kicker">Activity</p><h2>What the daemon is doing</h2></div><span class="pill" id="activityCount">—</span></div>
        <ol class="log" id="activity"></ol>
      </article>
    </section>
    <p class="foot">Stillgreen is a personal tool. Automating presence may violate your workspace policy. <a href="https://github.com/laxmideepak/slack" target="_blank" rel="noreferrer">Source</a></p>
  </div>
</main>
<script id="bootstrap" type="application/json">__BOOTSTRAP__</script>
<script src="/app.js"></script>
</body>
</html>
"""


PAGE_CSS = r"""
:root {
  --ink: #10241b;
  --ink-soft: #3d5547;
  --paper: #f1f6ed;
  --paper-deep: #e5eddf;
  --line: rgba(16, 36, 27, 0.15);
  --green: #0b7a4b;
  --green-bright: #2eb67d;
  --amber: #a8641a;
  --red: #a33a2c;
  --radius: 18px;
  --display: "Bricolage Grotesque", "Avenir Next", "Segoe UI", sans-serif;
  --body: "Instrument Sans", "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--paper); color: var(--ink); }
body { margin: 0; font-family: var(--body); font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
a { color: var(--green); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; background: rgba(16, 36, 27, 0.07); padding: 0.12em 0.35em; border-radius: 5px; }
.grain { position: fixed; inset: 0; pointer-events: none; opacity: 0.35; background-image: radial-gradient(rgba(16,36,27,0.08) 0.5px, transparent 0.5px); background-size: 5px 5px; z-index: 9; mix-blend-mode: multiply; }
.top { display: flex; align-items: center; gap: 18px; max-width: 1120px; margin: 0 auto; padding: 26px 28px 8px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-family: var(--display); font-weight: 700; font-size: 1.05rem; letter-spacing: -0.02em; }
.mark { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--ink); display: grid; place-items: center; }
.mark i { width: 9px; height: 9px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px rgba(46, 182, 125, 0.18); }
.tag { margin-left: auto; font-size: 0.72rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-soft); }
main { max-width: 1120px; margin: 0 auto; padding: 10px 28px 56px; position: relative; z-index: 1; }
.eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
.eyebrow span { width: 8px; height: 8px; border-radius: 50%; background: var(--green-bright); box-shadow: 0 0 0 4px rgba(46, 182, 125, 0.14); }
h1, h2, h3 { font-family: var(--display); letter-spacing: -0.035em; margin: 0; }
h1 { font-size: clamp(2.6rem, 6vw, 4.6rem); line-height: 0.96; }
h1 em { font-style: normal; color: var(--green); }
h2 { font-size: 1.35rem; }
h3 { font-size: 1.1rem; }
.hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.8fr); gap: 40px; align-items: end; padding: 58px 0 34px; }
.lede { max-width: 54ch; color: var(--ink-soft); font-size: 1.05rem; margin: 18px 0 0; }
.codeCard { background: var(--ink); color: var(--paper); border-radius: var(--radius); padding: 22px; box-shadow: 0 18px 50px rgba(16, 36, 27, 0.18); }
.codeCard > span { font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(241, 246, 237, 0.62); }
.codeCard strong { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.15rem; letter-spacing: 0.08em; margin: 10px 0 16px; color: #b9f0d4; word-break: break-all; }
.codeCard p { margin: 12px 0 0; color: rgba(241, 246, 237, 0.72); font-size: 0.8rem; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.card { background: rgba(255, 255, 255, 0.52); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset; }
.span2 { grid-column: span 2; }
.cardHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.kicker { margin: 0 0 5px; font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-soft); }
.pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 11px; font-size: 0.75rem; color: var(--ink-soft); background: rgba(255,255,255,0.5); }
button { font: inherit; cursor: pointer; }
.primary, .ghost { border-radius: 999px; padding: 10px 16px; border: 1px solid transparent; font-weight: 600; font-size: 0.86rem; transition: transform 0.15s ease, background 0.15s ease; }
.primary { background: var(--ink); color: var(--paper); }
.primary:hover { background: var(--green); }
.ghost { background: transparent; border-color: var(--line); color: var(--ink); }
.ghost:hover { background: rgba(16, 36, 27, 0.06); }
button:disabled { opacity: 0.55; cursor: wait; }
.list { display: grid; gap: 8px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; align-items: center; padding: 14px 0; border-top: 1px solid var(--line); }
.workspace:first-child { border-top: 0; }
.who { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--paper-deep); color: var(--green); font-family: var(--display); font-weight: 700; border: 1px solid rgba(11, 122, 75, 0.3); flex: 0 0 auto; }
.workspace.online .avatar { box-shadow: 0 0 0 3px rgba(46, 182, 125, 0.2); }
.who strong { display: block; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who span { display: block; color: var(--ink-soft); font-size: 0.78rem; }
.status { display: inline-flex; align-items: center; gap: 6px; font-size: 0.76rem; color: var(--ink-soft); text-transform: capitalize; }
.status i { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); }
.status[data-state="active"] i, .status[data-state="connected"] i { background: var(--green-bright); box-shadow: 0 0 0 3px rgba(46, 182, 125, 0.16); }
.status[data-state="manual_away"] i, .status[data-state="paused"] i, .status[data-state="daemon_stopped"] i { background: #9aa79f; }
.wsActions { display: flex; gap: 4px; }
.wsActions button { border: 0; background: transparent; color: var(--ink-soft); padding: 5px 7px; border-radius: 6px; font-size: 0.75rem; }
.wsActions button:hover { background: rgba(16, 36, 27, 0.07); color: var(--ink); }
.wsActions button.danger:hover { color: var(--red); background: rgba(163, 58, 44, 0.08); }
.facts { margin: 18px 0; display: grid; gap: 10px; }
.facts div { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 9px; border-bottom: 1px solid var(--line); }
.facts dt { color: var(--ink-soft); font-size: 0.8rem; }
.facts dd { margin: 0; font-weight: 600; text-align: right; font-size: 0.84rem; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; }
.muted { color: var(--ink-soft); font-size: 0.9rem; }
.segmented { display: inline-flex; padding: 3px; border: 1px solid var(--line); border-radius: 999px; margin-bottom: 16px; background: rgba(255,255,255,0.4); }
.segmented button { border: 0; background: transparent; color: var(--ink-soft); padding: 7px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
.segmented button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
.days { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 14px; }
.days button { border: 1px solid var(--line); background: transparent; color: var(--ink-soft); border-radius: 999px; padding: 6px 10px; font-size: 0.76rem; }
.days button[aria-pressed="true"] { background: rgba(11, 122, 75, 0.12); border-color: rgba(11, 122, 75, 0.35); color: var(--green); font-weight: 600; }
.timeGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.field { display: grid; gap: 5px; }
.field label { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
.field label span { text-transform: none; letter-spacing: 0; }
input { width: 100%; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,0.7); padding: 10px 11px; font: inherit; color: var(--ink); }
input:focus { outline: 2px solid rgba(46, 182, 125, 0.55); outline-offset: 1px; border-color: transparent; }
.formFoot { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
.hint { color: var(--ink-soft); font-size: 0.8rem; margin: 0; max-width: 62ch; }
.addForm { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 18px; display: grid; gap: 12px; }
.formHead { display: flex; justify-content: space-between; align-items: center; }
.help { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: rgba(255,255,255,0.35); font-size: 0.82rem; }
.help summary { cursor: pointer; color: var(--ink-soft); font-weight: 600; }
.help ol { margin: 10px 0 0; padding-left: 20px; color: var(--ink-soft); display: grid; gap: 6px; }
.error { color: var(--red); font-size: 0.82rem; margin: 0; min-height: 1em; }
.log { list-style: none; margin: 0; padding: 0; }
.log li { display: grid; grid-template-columns: 56px 10px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 9px 0; border-top: 1px solid var(--line); font-size: 0.84rem; }
.log time { color: var(--ink-soft); font-variant-numeric: tabular-nums; font-size: 0.76rem; }
.log i { width: 7px; height: 7px; border-radius: 50%; background: #9aa79f; align-self: center; }
.log i[data-tone="green"] { background: var(--green-bright); }
.log i[data-tone="amber"] { background: var(--amber); }
.log strong { font-weight: 600; }
.log .who { font-size: 0.76rem; color: var(--ink-soft); margin-left: 6px; }
.foot { color: var(--ink-soft); font-size: 0.76rem; margin-top: 26px; text-align: center; }
.login { max-width: 520px; margin: 12vh auto 0; background: rgba(255,255,255,0.55); border: 1px solid var(--line); border-radius: var(--radius); padding: 30px; }
.login h1 { font-size: 2.3rem; margin-bottom: 12px; }
.login p { color: var(--ink-soft); }
.login .inline { display: flex; gap: 8px; margin-top: 6px; }
.login .inline input { flex: 1; }
.login .inline button { flex: 0 0 auto; }
.busy { opacity: 0.6; pointer-events: none; }
@media (max-width: 760px) {
  .hero { grid-template-columns: 1fr; gap: 22px; padding-top: 36px; }
  .grid { grid-template-columns: 1fr; }
  .span2 { grid-column: span 1; }
  .card { padding: 18px; }
  .timeGrid { grid-template-columns: 1fr 1fr; }
  .timeGrid .field:last-child { grid-column: span 2; }
  .workspace { grid-template-columns: minmax(0, 1fr) auto; }
  .wsActions { grid-column: 2; }
  .status { grid-column: 1; padding-left: 50px; }
  .formFoot { align-items: flex-start; flex-direction: column; }
  main { padding-left: 18px; padding-right: 18px; }
  .top { padding-left: 18px; padding-right: 18px; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
"""


PAGE_JS = r"""
(() => {
  const boot = JSON.parse(document.getElementById("bootstrap").textContent || "{}");
  const DAYS = [
    ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"],
    ["thursday", "Thu"], ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"]
  ];
  const state = { code: boot.code || "", data: null, draft: null, mode: "scheduled", days: [] };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const login = $("#login");
  const app = $("#app");

  function savedCode() {
    try { return localStorage.getItem("stillgreen.bridge") || ""; } catch { return ""; }
  }
  function storeCode(code) {
    state.code = code;
    try { localStorage.setItem("stillgreen.bridge", code); } catch {}
  }
  function authHeaders() { return { Authorization: `Bearer ${state.code}`, "Content-Type": "application/json" }; }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
      cache: "no-store"
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) { showLogin("That code was not accepted."); throw new Error("unauthorized"); }
    if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function showLogin(message = "") {
    login.hidden = false;
    app.hidden = true;
    $("#loginError").textContent = message;
    setTimeout(() => $("#accessCode").focus(), 50);
  }
  function showApp() {
    login.hidden = true;
    app.hidden = false;
  }

  function pulse(text, error = false) {
    const el = $("#loginError");
    if (!el) return;
    el.textContent = text;
    el.style.color = error ? "var(--red)" : "var(--green)";
  }

  function fmtStatus(item) {
    const map = {
      active: "Active", connected: "Connected", away: "Away", auto_away: "Away",
      manual_away: "Manual away", paused: "Paused", scheduled_off: "Outside schedule",
      daemon_stopped: "Daemon stopped", starting: "Starting", reconnecting: "Reconnecting",
      restarting: "Restarting", stopped: "Stopped", invalid_token: "Token rejected",
      invalid_config: "Check config", error: "Error"
    };
    return map[item] || item || "Unknown";
  }

  function render() {
    if (!state.data) return;
    const data = state.data;
    showApp();
    const running = data.daemon.running;
    $("#statusText").textContent = running ? `Daemon running${data.connected_count ? ` · ${data.connected_count} online` : ""}` : "Daemon stopped";
    $("#statusDot").style.background = running ? "var(--green-bright)" : "#9aa79f";
    $("#daemonState").textContent = running ? `Running (${data.daemon.pid})` : "Stopped";
    $("#onlineCount").textContent = `${data.connected_count} / ${data.workspaces.length}`;
    $("#modeTitle").textContent = data.paused ? "Paused" : data.stay_active ? "Stay online" : data.schedule.mode === "always" ? "Always on" : data.schedule.active ? "Scheduled · on" : "Scheduled · off";
    $("#modeDetail").textContent = data.paused
      ? `Presence is paused${data.pause_until ? ` until ${new Date(data.pause_until).toLocaleString()}` : " until resumed"}.`
      : data.stay_active
        ? `Override active${data.stay_until ? ` until ${new Date(data.stay_until).toLocaleString()}` : ""}.`
        : data.schedule.mode === "always" ? "The daemon keeps every session connected." : data.schedule.summary;
    $("#nextChange").textContent = data.schedule.next_change ? new Date(data.schedule.next_change).toLocaleString() : "—";
    $("#scheduleSummary").textContent = data.schedule.summary;
    $("#bridgeCode").textContent = state.code;
    $("#activityCount").textContent = `${data.activity.length} events`;

    const list = $("#workspaceList");
    if (!data.workspaces.length) {
      list.innerHTML = `<div class="workspace"><div class="who"><span class="avatar">+</span><div><strong>No workspaces yet</strong><span>Add one to start a session.</span></div></div></div>`;
    } else {
      list.innerHTML = data.workspaces.map((item) => `
        <div class="workspace ${item.status === "active" || item.connected ? "online" : ""}">
          <div class="who">
            <span class="avatar" aria-hidden="true">${esc((item.name || "S").slice(0, 1).toUpperCase())}</span>
            <div><strong>${esc(item.name)}</strong><span>${esc(item.team_id)}${item.user_id ? ` · ${esc(item.user_id)}` : ""}</span></div>
          </div>
          <span class="status" data-state="${esc(item.status)}"><i aria-hidden="true"></i>${esc(fmtStatus(item.status))}</span>
          <div class="wsActions">
            <button type="button" data-ws="${esc(item.team_id)}" data-do="${item.paused ? "resume" : "pause"}">${item.paused ? "Resume" : "Pause"}</button>
            <button type="button" class="danger" data-ws="${esc(item.team_id)}" data-do="remove">Remove</button>
          </div>
        </div>`).join("");
    }

    const activity = $("#activity");
    activity.innerHTML = data.activity.length ? data.activity.map((entry) => `
      <li><time>${esc(entry.time)}</time><i data-tone="${esc(entry.tone)}" aria-hidden="true"></i><span>${esc(entry.text)}${entry.workspace ? `<span class="who">${esc(entry.workspace)}</span>` : ""}</span></li>`).join("")
      : `<li><time>—</time><i aria-hidden="true"></i><span>No events yet. Logs appear here after the daemon starts.</span></li>`;

    state.mode = data.schedule.mode;
    state.days = data.schedule.active_days || [];
    state.draft = { start: data.schedule.start_time || "09:00", end: data.schedule.end_time || "17:00", timezone: data.schedule.timezone || "local" };
    renderSchedule();
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function renderSchedule() {
    $$("#scheduleForm [data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode)));
    $("#dayPicker").innerHTML = DAYS.map(([key, label]) => `<button type="button" data-day="${key}" aria-pressed="${state.days.includes(key)}">${label}</button>`).join("");
    $("#startTime").value = state.draft?.start || "09:00";
    $("#endTime").value = state.draft?.end || "17:00";
    $("#timezone").value = state.draft?.timezone || "local";
  }

  async function refresh() {
    try {
      state.data = await api("/api/state");
      render();
    } catch (error) {
      if (state.code) showLogin(error.message.includes("unauthorized") ? "That code was not accepted." : error.message);
      else showLogin();
    }
  }

  async function act(path, payload = {}) {
    try {
      state.data = await api(path, { method: "POST", body: JSON.stringify(payload) });
      if (state.data.state) state.data = state.data.state;
      render();
    } catch (error) { alert(error.message); }
  }

  async function init() {
    if (boot.embed && boot.code) storeCode(boot.code);
    if (!state.code) state.code = savedCode();
    if (!state.code) { showLogin(); return; }
    await refresh();
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    storeCode($("#accessCode").value.trim());
    await refresh();
  });

  $("#copyCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.code); $("#copyCode").textContent = "Copied"; setTimeout(() => $("#copyCode").textContent = "Copy code", 1600); } catch { alert(state.code); }
  });

  $("#rotateCode").addEventListener("click", async () => {
    if (!confirm("Rotate the access code? The hosted dashboard will need the new one.")) return;
    try {
      const result = await api("/api/code/rotate", { method: "POST", body: "{}" });
      storeCode(result.code);
      render();
      alert("New code: " + result.code);
    } catch (error) { alert(error.message); }
  });

  $("#addToggle").addEventListener("click", () => { $("#addForm").hidden = false; $("#xoxc").focus(); });
  $("#addClose").addEventListener("click", () => { $("#addForm").hidden = true; $("#addError").textContent = ""; });
  $("#addForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#addError").textContent = "";
    $("#addSubmit").disabled = true;
    $("#addSubmit").textContent = "Verifying…";
    try {
      const result = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ xoxc: $("#xoxc").value, xoxd: $("#xoxd").value, name: $("#name").value }) });
      state.data = result.state;
      $("#addForm").hidden = true;
      $("#addForm").reset();
      render();
    } catch (error) {
      $("#addError").textContent = error.message;
    } finally {
      $("#addSubmit").disabled = false;
      $("#addSubmit").textContent = "Verify & save";
    }
  });

  $("#workspaceList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-do]");
    if (!button) return;
    const team = button.dataset.ws;
    const action = button.dataset.do;
    if (action === "remove") {
      if (!confirm("Remove this workspace? Its tokens will be deleted from this machine.")) return;
      try {
        const result = await api(`/api/workspaces/${encodeURIComponent(team)}`, { method: "DELETE" });
        state.data = result.state;
        render();
      } catch (error) { alert(error.message); }
      return;
    }
    await act(action === "pause" ? "/api/pause" : "/api/resume", { workspace: team });
  });

  $("#scheduleForm").addEventListener("click", (event) => {
    const mode = event.target.closest("[data-mode]");
    if (mode) { state.mode = mode.dataset.mode; renderSchedule(); return; }
    const day = event.target.closest("[data-day]");
    if (day) {
      const key = day.dataset.day;
      state.days = state.days.includes(key) ? state.days.filter((item) => item !== key) : [...state.days, key];
      renderSchedule();
    }
  });

  $("#scheduleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.draft = { start: $("#startTime").value, end: $("#endTime").value, timezone: $("#timezone").value.trim() || "local" };
    await act("/api/schedule", {
      mode: state.mode,
      active_days: state.days.length ? state.days : ["monday", "tuesday", "wednesday", "thursday", "friday"],
      start_time: state.draft.start,
      end_time: state.draft.end,
      timezone: state.draft.timezone
    });
  });

  $$("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "pause") await act("/api/pause", { duration: "1h" });
    if (action === "resume") await act("/api/resume", {});
    if (action === "stay") await act("/api/stay", { duration: "1h" });
  }));

  init();
  setInterval(() => { if (state.code && !document.hidden) refresh().catch(() => {}); }, 15000);
})();
"""


FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="16" fill="#10241b"/>
<circle cx="32" cy="32" r="18" fill="none" stroke="#f1f6ed" stroke-width="2"/>
<circle cx="32" cy="32" r="7" fill="#2eb67d"/>
</svg>"""
