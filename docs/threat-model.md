# Threat model

A short summary of what Stillgreen protects, where the trust boundaries are,
what can go wrong, what the code already does about it, and the risks that
remain. Plain words first; file names point to the code. See also the
[privacy policy](privacy.md).

## What we protect (assets)

| Asset | Why it matters |
| --- | --- |
| **Slack session token** (`xoxc-…`) and **`d` cookie** (`xoxd-…`) | Together they let anyone act as you in Slack, like being signed in: read and send messages, see files. This is the most sensitive thing Stillgreen holds. |
| **Access code** (`SG-XXXX-XXXX-XXXX`) | Lets someone control your Stillgreen: see your workspaces and status, change the schedule, add or remove workspaces. It does **not** reveal the Slack tokens: no API returns them. |
| Your status and schedule | Low sensitivity, but private. |

## Parts and trust boundaries

```
 Your browser                          Your computer or your server        Slack
 ┌────────────────────────┐   access   ┌──────────────────────────┐  token  ┌──────────┐
 │ Dashboard page         │ ── code ─▶ │ Stillgreen (sg_local)     │ ─ and ─▶│ slack.com│
 │ (from the website)     │            │  - control page + API     │  cookie │          │
 │ Chrome extension       │ ─ tokens ▶ │  - daemon (Slack session) │  (TLS)  │          │
 └────────────────────────┘ + code     │  - config.json (0600)     │         └──────────┘
          ▲                            └──────────────────────────┘
          │ only the page (HTML/JS)
 ┌────────────────────────┐
 │ stillgreen.vercel.app  │  never receives tokens or the access code
 └────────────────────────┘
```

1. **Browser ↔ website.** The website only serves static files. The dashboard
   runs in the browser and talks straight to your Stillgreen.
2. **Extension ↔ Slack tab.** The extension reads the token from the Slack
   page and the cookie from Chrome, only when you click **Capture from Slack**,
   and only after you agree to the consent notice.
3. **Browser/extension ↔ Stillgreen.** Every API call needs the access code.
   On your own computer this is `http://127.0.0.1`; on a server it must be
   `https://`.
4. **Stillgreen ↔ Slack.** Always TLS with certificate checks.
5. **Stillgreen ↔ the machine it runs on.** Anyone with your user account (or
   root) on that machine can read the saved session.

## Threats and what the code already does

| Threat | Mitigation in the code |
| --- | --- |
| A random website in your browser calls your local Stillgreen (CSRF, cross-site reads) | The access code is a bearer header, never a cookie, so the browser never sends it by itself. CORS only answers the official dashboard, loopback pages and extensions, plus addresses you add with `SG_LOCAL_WEB_ORIGIN` (`origin_allowed` in `sg_local/web.py`). |
| **DNS rebinding**: an attacker's domain is pointed at `127.0.0.1` to look same-origin | The server checks the `Host` header and answers only its own names: loopback, or the names in `SG_LOCAL_WEB_HOSTS` (`host_allowed`). Other names get HTTP 421. |
| Guessing the access code | Codes are random (`secrets`), compared in constant time (`hmac.compare_digest`). After **10 wrong codes in a minute** a visitor must wait (`FailureThrottle`), counted per real visitor behind a trusted proxy (`client_key`). |
| The control page leaks the code to another origin | The page that embeds the code is only served to same-origin loopback visits; it has a strict Content Security Policy (no inline script, `frame-ancestors 'none'`) and no CORS headers. On a server the page asks for the code instead. |
| Another account on the same computer reads the access code from the control page | Anyone on the machine can reach `127.0.0.1`, so the page embeds the code only when the URL carries this user's open key (`?k=`, from the `0600` file `open-key` that `sg-local web --open` reads; `web.open_key`). Without it the page asks for the code. The page then keeps the code in the browser and drops the key from the address bar. |
| Tokens are read from disk by another user | `config.json` and `bridge.json` are written atomically with mode `0600`, in folders with mode `0700` (`config.atomic_write`). `sg-local doctor` checks these permissions. |
| Tokens leak into logs, errors or support reports | Everything is passed through `redact()` (`sg_local/slack.py`) before logging; API errors are redacted; the diagnostics report also removes access codes, cookies and your home folder (`redact_report` in `sg_local/diagnostics.py`). The dashboard and control page never display tokens. |
| Tokens sent over the network in clear text | The extension refuses `http://` to anything but your own computer and refuses URLs with a username or password (`background.js`, enforced in the service worker, not just the popup). |
| A fake Slack or a network that intercepts TLS | Stillgreen always verifies Slack's certificate and host name and requires TLS 1.2 or newer (where Python cannot set a minimum version, TLS 1.0 and 1.1 are turned off instead). With Python 3.10 or newer it uses the operating system's trust store (`truststore`). With Python 3.9 on a Mac it uses Python's list, Apple's root certificates (minus any marked "Never Trust"), and only those System-keychain certificates an administrator marked as trusted for SSL (`sg_local/tls.py`). **There is no option to turn verification off.** A company certificate can be added with `SSL_CERT_FILE`. |
| Capturing the session without the person understanding it | The extension shows a consent screen before the first capture, again whenever the notice changes, and again when the Stillgreen address changes (the consent is stored with the address it names); capture is blocked in the service worker until consent for that address is stored. |
| Large or slow requests tie up the server | Request bodies are size-limited and each connection has a timeout (`MAX_BODY`, `REQUEST_TIMEOUT`). Diagnostics run one at a time, reuse a result for 30 seconds, and the connection test has one 15-second limit for all its steps (`cached_checks`, `PROBE_DEADLINE`). |
| Uninstall deletes the wrong files because of an odd setting | `./sg-local uninstall` deletes only the files Stillgreen writes, never a whole folder, refuses shared folders (`~/.config`, `~/Documents`, ...) and the program folder, and leaves any other file in place (`cmd_uninstall` in `sg_local/cli.py`). |

## Risks that remain

- **Anyone with the token and cookie can act as you.** Stillgreen keeps them
  safe on disk, but it cannot limit what they allow. Slack offers no smaller,
  "presence only" permission for a person's own status. Protect the machine
  Stillgreen runs on like you protect your Slack password.
- **Cloud server compromise.** If you run Stillgreen on a server and someone
  breaks into it (weak SSH, an unpatched system, a leaked backup or snapshot),
  they can take your Slack session. You are responsible for keeping that
  server updated. Running on your own computer is lower risk.
- **Access code exposure.** Anyone who sees your access code (a screenshot, a
  shared browser) can control Stillgreen, though not read the tokens. Change
  it on the control page if it leaks.
- **Malware on your computer** can read the files, the browser's storage and
  the Slack session in Chrome itself. Stillgreen can't protect against that.
- **Slack policy.** Slack's official API can't force a person to be active,
  so Stillgreen uses your web session. Slack does not officially support this.
  Slack may sign the session out, change how presence works, or treat this as
  against its terms. Your employer may not allow it.
- **Unsigned extension.** The extension is loaded unpacked in Developer mode,
  so Chrome does not review it. Read `extension/` before loading it.

## If a token leaks

1. Remove the workspace in Stillgreen (or run `./sg-local uninstall`).
2. In Slack, go to Settings and click **Sign out of all other sessions**. This
   makes the leaked token useless.
3. Change the access code on the control page.
