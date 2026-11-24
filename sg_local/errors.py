"""Plain-English explanations for the problems Stillgreen can run into.

``explain()`` turns a real exception (or a known error code) into a short
entry a person can act on::

    {"code": "dns_failed",
     "title": "Cannot find Slack on the network",
     "message": "Stillgreen could not look up Slack's address. ...",
     "action": "Check that you are online ..."}

The daemon, the command line, the control page and the dashboard all show
these same words. The text never contains tokens, cookies or access codes:
it comes from the fixed catalogue below, not from the exception.

The launcher script (``sg-local``) also uses this module to explain a failed
install::

    python -m sg_local.errors CODE                   # print one entry
    python -m sg_local.errors --install < pip.log    # why an install failed
"""

from __future__ import annotations

import argparse
import asyncio
import errno
import re
import socket
import ssl
import sys
import urllib.error
from typing import Any

# Each entry: title (a few words), message (what happened, in plain words)
# and action (one concrete next step). Keep the words simple: many people
# who read them do not speak English as their first language.
CATALOGUE: dict[str, dict[str, str]] = {
    "tls_untrusted": {
        "title": "Security certificate not trusted",
        "message": (
            "Stillgreen could not check Slack's security certificate. "
            "Your company network may use its own certificate."
        ),
        "action": (
            "Stillgreen uses your computer's trusted certificates, so ask IT to "
            "install the company certificate, or try another network. "
            "Do not turn off security checks."
        ),
    },
    "tls_other": {
        "title": "Secure connection failed",
        "message": "Stillgreen could not make a secure connection to Slack.",
        "action": (
            "Try again in a few minutes. If it keeps happening, try another "
            "network, or ask IT if the network blocks Slack."
        ),
    },
    "clock_wrong": {
        "title": "Your computer's clock looks wrong",
        "message": (
            "Slack's security certificate looks expired or not valid yet. "
            "This usually means the date or time on this computer is wrong."
        ),
        "action": "Set the date and time to automatic in your computer's settings, then try again.",
    },
    "dns_failed": {
        "title": "Cannot find Slack on the network",
        "message": (
            "Stillgreen could not look up Slack's address. The internet may be off, "
            "or the network's name service (DNS) is not working."
        ),
        "action": (
            "Check that you are online and that https://slack.com opens in your "
            "browser. Then try again."
        ),
    },
    "proxy_failed": {
        "title": "Proxy problem",
        "message": "Stillgreen could not connect through your network's proxy server.",
        "action": (
            "Check the proxy setting (HTTPS_PROXY). If your company uses a proxy, "
            "ask IT for the right address. Then try again."
        ),
    },
    "network_timeout": {
        "title": "Slack did not answer in time",
        "message": "The connection to Slack took too long. The network may be slow or may block Slack.",
        "action": "Check your internet connection. Stillgreen keeps trying by itself.",
    },
    "network_unreachable": {
        "title": "Cannot reach Slack",
        "message": (
            "Stillgreen could not connect to Slack. The internet may be off, "
            "or a firewall may block the connection."
        ),
        "action": (
            "Check that you are online and that https://slack.com opens in your "
            "browser. Stillgreen keeps trying by itself."
        ),
    },
    "slack_auth_rejected": {
        "title": "Slack signed you out",
        "message": (
            "Slack did not accept the saved login for this workspace. This happens "
            "when you sign out of Slack in the browser, or when the login expires."
        ),
        "action": (
            "Sign in at app.slack.com in Chrome, then click Capture from Slack in "
            "the Stillgreen extension (or run ./sg-local add)."
        ),
    },
    "slack_rate_limited": {
        "title": "Slack asked Stillgreen to slow down",
        "message": "Slack got too many requests in a short time.",
        "action": "You do not need to do anything. Stillgreen waits and tries again by itself.",
    },
    "slack_unavailable": {
        "title": "Slack is having problems",
        "message": "Slack's servers answered with an error.",
        "action": (
            "Wait a few minutes. Stillgreen tries again by itself. "
            "You can check https://slack-status.com."
        ),
    },
    "port_in_use": {
        "title": "The port is already in use",
        "message": (
            "Another program already uses the port Stillgreen needs (8765, unless "
            "you changed it). It may be Stillgreen itself, already running."
        ),
        "action": (
            "Run ./sg-local status to see if Stillgreen is already running. If another "
            "program uses the port, pick a different one, for example: "
            "SG_LOCAL_WEB_PORT=8766 ./sg-local start"
        ),
    },
    "daemon_not_running": {
        "title": "Stillgreen is not running",
        "message": "Stillgreen is not running on this computer, so nothing could reach it.",
        "action": "Start it with ./sg-local start, then try again.",
    },
    "access_code_wrong": {
        "title": "Access code not accepted",
        "message": "The access code does not match the one Stillgreen uses.",
        "action": (
            "Copy the code again with sg-local web --show-code (./sg-local in the Still-Green folder). "
            "It looks like SG-ABCD-EFGH-JKLM."
        ),
    },
    "too_many_attempts": {
        "title": "Too many tries",
        "message": "The access code was wrong too many times, so Stillgreen is waiting before it accepts more tries.",
        "action": "Wait one minute, then try again with the right code.",
    },
    "diagnostics_busy": {
        "title": "Already checking",
        "message": "Stillgreen is already running these checks, and they are taking a while.",
        "action": "Wait a few seconds, then try again.",
    },
    "config_unreadable": {
        "title": "Settings file cannot be read",
        "message": (
            "Stillgreen could not read its settings file. The file may be damaged, "
            "or its folder may have the wrong owner or permissions."
        ),
        "action": (
            "Run ./sg-local doctor to see the problem. If the file is damaged, move it "
            "aside and add your workspaces again."
        ),
    },
    "python_too_old": {
        "title": "Python is too old",
        "message": "Stillgreen needs Python 3.9 or newer.",
        "action": (
            "Install a newer Python from https://www.python.org/downloads/ and run "
            "./sg-local again."
        ),
    },
    "missing_dependency": {
        "title": "A part Stillgreen needs is missing",
        "message": "A Python package that Stillgreen needs is not installed.",
        "action": (
            "Run ./sg-local again while you are online; it installs what it needs. "
            "If that does not help, delete the .venv folder in the Stillgreen folder "
            "and run ./sg-local again."
        ),
    },
    "install_failed": {
        "title": "Could not install what Stillgreen needs",
        "message": "Stillgreen could not download the Python packages it needs from pypi.org.",
        "action": (
            "Check that you are online, then run ./sg-local again. If your company "
            "network blocks pypi.org, ask IT for help."
        ),
    },
    "venv_unavailable": {
        "title": "Python cannot make a private setup",
        "message": (
            "Stillgreen keeps its Python packages in a private folder (.venv), but "
            "this Python cannot create one: its venv module is missing."
        ),
        "action": (
            "On Debian or Ubuntu run: sudo apt install python3-venv. Or install Python "
            "from https://www.python.org/downloads/. Then run ./sg-local again."
        ),
    },
    "invalid_input": {
        "title": "That value is not valid",
        "message": "Stillgreen could not use the value you gave.",
        "action": "Check the value and try again.",
    },
    "workspace_invalid": {
        "title": "Saved workspace is incomplete",
        "message": "The saved login for this workspace is missing a part, so Stillgreen cannot use it.",
        "action": (
            "Sign in at app.slack.com in Chrome, then click Capture from Slack in "
            "the Stillgreen extension (or run ./sg-local add)."
        ),
    },
    "origin_not_allowed": {
        "title": "This website is not allowed",
        "message": "Stillgreen only answers its own pages, the Stillgreen dashboard and the extension.",
        "action": (
            "Open the dashboard at https://stillgreen.vercel.app. To allow another "
            "website, add it to SG_LOCAL_WEB_ORIGIN where Stillgreen runs."
        ),
    },
    "host_not_allowed": {
        "title": "Unknown address",
        "message": "Stillgreen was reached through an address it does not know.",
        "action": "Use http://127.0.0.1:8765, or add the name to SG_LOCAL_WEB_HOSTS where Stillgreen runs.",
    },
    "not_found": {
        "title": "Not found",
        "message": "Stillgreen has nothing at this address.",
        "action": "Check the address. Stillgreen may be an older version: update it and try again.",
    },
    "unknown": {
        "title": "Something went wrong",
        "message": "Stillgreen hit a problem it does not know how to explain.",
        "action": (
            "Run ./sg-local doctor and look at ./sg-local logs. If it keeps happening, "
            "save a diagnostics report and share it when you ask for help."
        ),
    },
}

# Problems on the way to Slack (not problems with the login).
NETWORK_CODES = frozenset(
    {
        "tls_untrusted",
        "tls_other",
        "clock_wrong",
        "dns_failed",
        "proxy_failed",
        "network_timeout",
        "network_unreachable",
    }
)

# Slack API error names that mean the saved login is no longer valid.
AUTH_ERRORS = frozenset(
    {"invalid_auth", "not_authed", "token_expired", "token_revoked", "account_inactive"}
)

_CLOCK_WORDS = ("certificate has expired", "certificate is not yet valid", "not yet valid")

# Checked in order; the first match wins. Used for error text from pip and
# for messages that were saved as text (no exception object left).
_TEXT_RULES = (
    ("clock_wrong", re.compile(r"certificate has expired|certificate is not yet valid", re.I)),
    (
        "tls_untrusted",
        re.compile(
            r"certificate[_ ]verify[_ ]failed|self[- ]signed certificate|"
            r"unable to get local issuer|unable to verify the first certificate|"
            r"certificate is not trusted|SSLCertVerificationError",
            re.I,
        ),
    ),
    (
        "proxy_failed",
        re.compile(r"proxyerror|proxy error|tunnel connection failed|\b407\b|cannot connect to proxy|proxy", re.I),
    ),
    (
        "dns_failed",
        re.compile(
            r"name or service not known|nodename nor servname|temporary failure in name resolution|"
            r"getaddrinfo failed|could not resolve|failed to resolve|no address associated|"
            r"name resolution",
            re.I,
        ),
    ),
    ("tls_other", re.compile(r"\bssl\b|\btls\b|sslerror|handshake failure|wrong version number", re.I)),
    ("port_in_use", re.compile(r"address already in use|eaddrinuse", re.I)),
    ("network_timeout", re.compile(r"timed out|timeout", re.I)),
    (
        "network_unreachable",
        re.compile(
            r"connection refused|network is unreachable|no route to host|connection reset|"
            r"connection aborted|failed to establish a new connection|network error",
            re.I,
        ),
    ),
    (
        "slack_auth_rejected",
        re.compile(
            r"\b(" + "|".join(sorted(AUTH_ERRORS)) + r")\b|tokens are invalid|rejected the tokens",
            re.I,
        ),
    ),
    ("slack_rate_limited", re.compile(r"ratelimited|rate limited|\b429\b", re.I)),
    ("slack_unavailable", re.compile(r"\bHTTP 5\d\d\b|service unavailable|bad gateway", re.I)),
    ("venv_unavailable", re.compile(r"ensurepip is not available|no module named venv", re.I)),
    (
        "missing_dependency",
        re.compile(r"no module named|no matching distribution|could not find a version", re.I),
    ),
)


def entry(code: str) -> dict[str, str]:
    """The catalogue entry for ``code`` (``unknown`` if there is none)."""
    known = code if code in CATALOGUE else "unknown"
    return {"code": known, **CATALOGUE[known]}


def classify_text(text: str, default: str = "unknown") -> str:
    """The error code that best fits a piece of error text."""
    for code, pattern in _TEXT_RULES:
        if pattern.search(text or ""):
            return code
    return default


def _status_code(exc: BaseException) -> int:
    response = getattr(exc, "response", None)
    for value in (getattr(response, "status_code", None), getattr(exc, "status_code", None)):
        if isinstance(value, int):
            return value
    return 0


def _from_status(status: int) -> str | None:
    if status in (401, 403):
        return "slack_auth_rejected"
    if status == 407:
        return "proxy_failed"
    if status == 429:
        return "slack_rate_limited"
    if status >= 500:
        return "slack_unavailable"
    return None


def classify(exc: BaseException, *, local: bool = False) -> str:
    """The error code for an exception.

    ``local`` means the failed connection was to Stillgreen on this computer
    (not to Slack), so "connection refused" means Stillgreen is not running.
    """
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = _classify_one(current, local=local)
        if code is not None:
            return code
        current = _underlying(current)
    return classify_text(str(exc))


def _underlying(exc: BaseException) -> BaseException | None:
    """The exception behind ``exc``: a wrapped network error explains it best."""
    for attr in ("cause", "reason"):
        value = getattr(exc, attr, None)
        if isinstance(value, BaseException):
            return value
    return exc.__cause__ or exc.__context__


def _classify_one(exc: BaseException, *, local: bool) -> str | None:
    name = type(exc).__name__

    # Our own Slack client error (sg_local.slack.SlackAPIError), matched by
    # name so this module does not import the websockets package.
    if name == "SlackAPIError":
        error = str(getattr(exc, "error", "") or exc)
        if getattr(exc, "token_invalid", False) or error in AUTH_ERRORS:
            return "slack_auth_rejected"
        if error == "ratelimited":
            return "slack_rate_limited"
        status = getattr(exc, "http_status", None)
        if isinstance(status, int) and _from_status(status):
            return _from_status(status)
        if getattr(exc, "cause", None) is not None:
            return None  # the network error behind it decides
        if error.startswith("Network timeout"):
            return "network_timeout"
        return classify_text(error, default="unknown")

    if name == "ConfigError":
        code = getattr(exc, "code", None)
        if isinstance(code, str) and code:
            return code
        text = str(exc)
        if re.search(r"cannot read|must contain a json object|symbolic link|owned by another user", text, re.I):
            return "config_unreadable"
        return None

    # websockets: InvalidStatus carries the HTTP response of the handshake;
    # proxy failures have "Proxy" in the class name (websockets 15+).
    if "Proxy" in name:
        return "proxy_failed"
    if name in {"InvalidStatus", "InvalidStatusCode", "InvalidHandshake", "InvalidMessage"}:
        status = _status_code(exc)
        if status:
            return _from_status(status) or "slack_unavailable"

    if isinstance(exc, urllib.error.HTTPError):
        return _from_status(exc.code) or "slack_unavailable"
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, BaseException):
            return classify(reason, local=local)
        return classify_text(str(reason), default="network_unreachable")

    if isinstance(exc, ssl.SSLCertVerificationError):
        message = f"{getattr(exc, 'verify_message', '')} {exc}".lower()
        if any(word in message for word in _CLOCK_WORDS):
            return "clock_wrong"
        return "tls_untrusted"
    if isinstance(exc, ssl.SSLError):
        if classify_text(str(exc)) == "tls_untrusted":
            return "tls_untrusted"
        return "tls_other"

    if isinstance(exc, socket.gaierror):
        return "dns_failed"
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, socket.timeout)):
        return "network_timeout"
    if isinstance(exc, ConnectionRefusedError):
        return "daemon_not_running" if local else "network_unreachable"
    if isinstance(exc, (ModuleNotFoundError, ImportError)):
        return "missing_dependency"
    if isinstance(exc, OSError):
        if exc.errno == errno.EADDRINUSE:
            return "port_in_use"
        text = str(exc)
        if re.search(r"tunnel connection failed|proxy", text, re.I):
            return "proxy_failed"
        if exc.errno in {
            errno.ENETUNREACH,
            errno.EHOSTUNREACH,
            errno.ECONNRESET,
            errno.ECONNABORTED,
            errno.ENETDOWN,
        } or isinstance(exc, ConnectionError):
            return "network_unreachable"
        if exc.errno == errno.ETIMEDOUT:
            return "network_timeout"
        return None
    return None


def explain(exc_or_code: BaseException | str | None, *, local: bool = False) -> dict[str, str]:
    """A plain-English ``{"code", "title", "message", "action"}`` for a problem.

    Accepts an exception or an error code from the catalogue. The returned
    text comes only from the catalogue, so it never contains secrets, with
    one exception: settings mistakes (``invalid_input``) repeat the
    ConfigError message, which Stillgreen writes itself for the user.
    """
    if exc_or_code is None:
        return entry("unknown")
    if isinstance(exc_or_code, str):
        return entry(exc_or_code)
    exc = exc_or_code
    code = classify(exc, local=local)
    if code == "unknown" and type(exc).__name__ == "ConfigError":
        return {**entry("invalid_input"), "message": str(exc)}
    return entry(code)


# Why a first-time install failed, for ``explain_install``. The catalogue
# entries talk about Slack; an install talks to pypi.org instead.
INSTALL_REASONS: dict[str, tuple[str, str]] = {
    "tls_untrusted": (
        "The security certificate of pypi.org could not be checked. Your company "
        "network may use its own certificate.",
        "Save the company certificate as a file (ask IT for it) and run: "
        "PIP_CERT=/path/to/company-cert.pem ./sg-local. Or try another network. "
        "Do not turn off security checks.",
    ),
    "clock_wrong": (
        "The date or time on this computer looks wrong, so security certificates look expired.",
        "Set the date and time to automatic in your computer's settings, then run ./sg-local again.",
    ),
    "dns_failed": (
        "This computer could not look up the address of pypi.org.",
        "Check that you are online, then run ./sg-local again.",
    ),
    "proxy_failed": (
        "The network's proxy server did not work.",
        "Check the proxy setting (HTTPS_PROXY), or ask IT for the right address. "
        "Then run ./sg-local again.",
    ),
    "network_timeout": (
        "pypi.org did not answer in time.",
        "Check that you are online, then run ./sg-local again. If your company "
        "network blocks pypi.org, ask IT for help.",
    ),
    "network_unreachable": (
        "This computer could not connect to pypi.org.",
        "Check that you are online, then run ./sg-local again. If your company "
        "network blocks pypi.org, ask IT for help.",
    ),
}


def explain_install(output: str) -> dict[str, str]:
    """Explain a failed package install from pip's output.

    Returns the ``install_failed`` entry, with the likely reason added when
    the output shows one.
    """
    info = entry("install_failed")
    if re.search(r"ensurepip is not available|no module named venv", output or "", re.I):
        return entry("venv_unavailable")
    reason = INSTALL_REASONS.get(classify_text(output))
    if reason:
        info["reason"] = classify_text(output)
        info["message"] = f"{info['message']} {reason[0]}"
        info["action"] = reason[1]
    return info


def format_text(info: dict[str, Any]) -> str:
    """An entry as a few lines for a terminal."""
    return f"Problem: {info['title']}\n{info['message']}\nWhat to do: {info['action']}"


def summary(info: dict[str, Any]) -> str:
    """An entry as one paragraph, for places that show a single line of text."""
    return f"{info['title']}. {info['message']} {info['action']}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m sg_local.errors",
        description="Print the plain-English explanation of a Stillgreen error.",
    )
    parser.add_argument("code", nargs="?", help="an error code, for example tls_untrusted")
    parser.add_argument(
        "--text",
        action="store_true",
        help="read error output on standard input and explain the best match",
    )
    parser.add_argument("--default", default="unknown", help="code to use when nothing matches")
    parser.add_argument(
        "--install",
        action="store_true",
        help="read pip's output on standard input and explain why the install failed",
    )
    args = parser.parse_args(argv)
    if args.install:
        print(format_text(explain_install(sys.stdin.read())))
        return 0
    if args.text:
        code = classify_text(sys.stdin.read(), default=args.default)
    else:
        code = args.code or args.default
    print(format_text(entry(code)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
