# Stillgreen

A personal, self-hosted Slack presence daemon with an editorial web interface.
It keeps your Slack status "active" using your own browser session tokens — no
account on a third-party service, no relay, and no telemetry.

It comes in two parts that you can run together or separately:

- a **daemon** (`sg-local`) that holds the Slack connection and your tokens;
- a **dashboard** (Next.js) that can be hosted on Vercel and connects straight to
  your daemon over HTTPS.

Put the daemon on any always-on Linux host — a small VPS, Fly.io, Render, or
Railway — and the dashboard on Vercel. Close the laptop and presence continues.

The Python package and CLI keep their original internal name,
`slack-green-local`; **Stillgreen** is the product name used by the interface.

This is an independent project. It is not affiliated with Slack or
[slack.green](https://slack.green).

> **Use responsibly.** Automating presence may violate your employer's policy
> or Slack's terms. Use it only on workspaces you own or have explicit
> permission to use.

## What it does

- Connects to Slack's presence WebSocket (`wss-primary.slack.com`) as the web
  client does.
- Sends a JSON `ping` every 30 seconds and a simulated activity `tickle` every
  5 minutes.
- Checks `users.getPresence` every 60 seconds and reconnects if Slack marks you
  away. It **never overrides a manual "away"**.
- Supports one or many workspaces, a weekly schedule, global or per-workspace
  pause, temporary stay-online windows, and optional macOS login auto-start.
- Stores everything on the host you choose. Outbound traffic goes only to Slack.

## Web interface

The repository includes a Next.js interface in `app/` and `components/`:

- `/` — the Stillgreen landing page.
- `/dashboard` — live controls when paired with a daemon, sample data otherwise.
- `/start` — cloud deployment and daemon pairing.
- `/setup` — the local CLI setup and security guide.

The dashboard is **frontend only by design**. It never asks for Slack tokens.
When you pair it with a daemon it stores two things in `localStorage`: the
daemon's HTTPS URL and a bridge access code. Every request then goes directly
from your browser to your daemon. Vercel only serves static files and never sees
either value on a server.

Without a paired daemon the dashboard stays in an explicit "Preview mode ·
sample data" state. It does not pretend to control anything. Keep that
boundary if you fork it.

### Run the interface locally

```sh
npm install
npm run dev
# http://localhost:3000
```

```sh
npm run build   # production build
npm run start   # serve the production build
```

### Deploy the interface to Vercel

1. Import <https://github.com/laxmideepak/slack> at
   <https://vercel.com/new>.
2. Keep the root directory as the repository root. Vercel detects Next.js from
   `package.json`; the framework preset should be **Next.js**.
3. No environment variables, database, or server functions are required.
4. Deploy. The Python files are ignored by the Next.js build.

The Vercel deployment and the daemon are independent: redeploying the site does
not start, stop, or configure presence on your host.

## Run the daemon 24/7

Pick one always-on host. The daemon is one Python process with a WebSocket per
workspace; 256 MB of memory is enough. The repository ships four deployment
options:

| Host | Files | Notes |
| --- | --- | --- |
| Any Docker host / VPS | `Dockerfile`, `docker-compose.yml` | Mount a volume at `/data` |
| Fly.io | `fly.toml` | `fly volumes create stillgreen_data --size 1` |
| Render | `render.yaml` | Starter plan or higher; a persistent disk is required |
| Railway | `railway.json` | Add a volume mounted at `/data` |

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `SG_LOCAL_BRIDGE_CODE` | Cloud: yes | Access code for the dashboard. Set it as a secret. |
| `SG_LOCAL_WEB_ORIGIN` | Cloud: yes | Comma-separated dashboard origins, e.g. `https://stillgreen.vercel.app` |
| `SG_LOCAL_CONFIG_DIR` | With a volume | Where `config.json` and `bridge.json` live |
| `SG_LOCAL_STATE_DIR` | With a volume | Where the PID file and logs live |
| `PORT` | Platform-provided | Render and Railway set this; do not override it |

`*.vercel.app` origins and loopback are allowed by default; add a custom domain
to `SG_LOCAL_WEB_ORIGIN`. Set `SG_LOCAL_ALLOW_VERCEL=0` to disable the Vercel
wildcard entirely.

### Fly.io

```sh
fly launch --copy-config --name stillgreen-yourname --no-deploy
fly volumes create stillgreen_data --size 1 --region ams
fly secrets set \
  SG_LOCAL_BRIDGE_CODE="SG-$(openssl rand -hex 8)" \
  SG_LOCAL_WEB_ORIGIN="https://your-app.vercel.app"
fly deploy
```

Edit `app` and `primary_region` in `fly.toml` first. The volume keeps tokens
across deploys.

### Docker (VPS or local)

```sh
export SG_LOCAL_BRIDGE_CODE="SG-$(openssl rand -hex 8)"
export SG_LOCAL_WEB_ORIGIN="https://your-app.vercel.app"
docker compose up -d --build
```

Put the container behind Caddy, nginx, or a platform TLS proxy. The daemon
speaks plain HTTP; TLS termination is the proxy's job. Do not expose port 8765
directly to the internet without HTTPS.

### First run

1. Open `https://your-daemon-host/` in a browser.
2. Enter the access code when prompted.
3. Add each workspace with `sg-local add`, or use the daemon page's token form.
   Tokens are written to the volume with mode `0600`; they never reach Vercel.
4. Confirm the daemon is healthy: `curl https://your-daemon-host/api/health`.
5. In the hosted dashboard, choose **Connect daemon**, enter the daemon URL and
   the same access code, and open `/dashboard`.

The dashboard polls the daemon every few seconds. The control surface exposes
schedule, pause, resume, stay-online, and per-workspace actions. Token values
are never returned by any endpoint.

## Requirements

- Python 3.11 or newer
- [`websockets`](https://pypi.org/project/websockets/) 12 or newer
- Node.js 20.9+ and npm (only for the web interface)
- macOS, Linux, or another Unix-like system (optional launchd support is
  macOS-only)

The included wrapper prefers the Python at
`/opt/homebrew/Caskroom/miniforge/base/bin/python3` if present, then falls back
to `python3`. Set `SG_LOCAL_PYTHON` to choose a specific interpreter.

```sh
python3 -m pip install --user "websockets>=12"
```

## Install

```sh
cd /path/to/slack
chmod +x sg-local install.sh
./install.sh
```

`install.sh` creates a symlink at `~/.local/bin/sg-local`. If that directory is
not on your `PATH`, add it:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

You can also run the tool without installing:

```sh
./sg-local --help
```

## 1. Get your Slack tokens

Use the Slack **web app** in a desktop browser (not the desktop app). These
values grant full access to your Slack account, so treat them like passwords.

1. Open your workspace at <https://app.slack.com> and sign in.
2. Open DevTools (`Cmd+Option+I` on macOS) and select the **Network** tab.
   Keep DevTools open and reload the Slack tab.
3. Find the `xoxc` token. Newer Slack builds no longer always persist it in
   `localStorage`, so use one of these network-based paths:

   - Filter requests by `api`, open one such as `client.boot` or
     `users.getPresence`, and check **Payload → Form Data** (Chrome) or
     **Request → Form Data** (Firefox) for a `token` field starting with
     `xoxc-`.
   - Or filter by `WS`, open the `wss-primary.slack.com` request, and copy the
     `token=xoxc-...` value from its Request URL. Stop at the next `&`.

   On older Slack builds you can still try this in the **Console**:

   ```js
   JSON.parse(localStorage.localConfig_v2).teams
   ```

   If it returns `undefined` or an empty object, use the Network tab instead.

4. In DevTools, open **Application → Cookies → https://app.slack.com** and copy
   the cookie named `d`. It starts with `xoxd-`. This cookie is `HttpOnly`, so
   it will not appear in `document.cookie`; the Application panel is the
   reliable place to read it.

Do not paste these values into chat, issue trackers, websites, or shell
commands where they could end up in history. The tool reads them with hidden
input.

## 2. Add a workspace

```sh
sg-local add
```

The token is verified with Slack before it is saved. Config lives at:

```text
~/.config/slack-green-local/config.json   (mode 0600)
```

To add another workspace, run `sg-local add` again. To replace expired tokens,
run it for the same workspace; existing settings are preserved.

## 3. Start it

```sh
sg-local start
sg-local status
sg-local logs -f
```

The daemon follows the schedule (always-on by default). `stop` shuts it down:

```sh
sg-local stop
```

## Commands

| Command | Purpose |
| --- | --- |
| `sg-local add` | Add or update a workspace using hidden token prompts |
| `sg-local list` | List workspaces and live status |
| `sg-local remove NAME` | Remove a workspace by name or team ID |
| `sg-local schedule show` | Show the schedule and whether it is active now |
| `sg-local schedule always` | Keep presence on all the time |
| `sg-local schedule set --days mon-fri --start 09:00 --end 17:00 --timezone local` | Set a weekly window |
| `sg-local start` / `stop` / `restart` | Control the background daemon |
| `sg-local status` | Daemon, schedule, pause, and workspace status |
| `sg-local pause --for 2h` | Pause all presence for a while |
| `sg-local pause --workspace NAME` | Pause one workspace until resumed |
| `sg-local resume` | Clear global and per-workspace pauses |
| `sg-local resume --workspace NAME` | Resume one workspace |
| `sg-local stay 90m` | Stay online temporarily, overriding pause/schedule |
| `sg-local stay --cancel` | Cancel a stay-online window |
| `sg-local doctor` | Check configuration, permissions, and runtime |
| `sg-local doctor --check-tokens` | Also verify tokens with Slack |
| `sg-local web --daemon --open` | Run the local control surface and open it |
| `sg-local cloud` | Run the control surface on `0.0.0.0:$PORT` for a cloud host |
| `sg-local logs -n 100` | Show recent logs |
| `sg-local install-launchd` | Start automatically at macOS login |
| `sg-local uninstall-launchd` | Remove macOS login auto-start |

### Schedule examples

```sh
# Weekdays, 9am to 5pm in the machine's timezone
sg-local schedule set --days weekdays --start 09:00 --end 17:00

# Weekdays in New York, even if the Mac is elsewhere
sg-local schedule set --days mon-fri --start 09:00 --end 17:00 --timezone America/New_York

# Overnight window: Monday 22:00 through Tuesday 06:00
sg-local schedule set --days monday --start 22:00 --end 06:00 --timezone local

# Split days and weekends
sg-local schedule set --days mon,wed,fri --start 08:30 --end 18:00
sg-local schedule set --days weekends --start 10:00 --end 14:00

# Turn scheduling off
sg-local schedule always
```

An overnight window belongs to the day it starts. `--timezone local` uses the
machine's current timezone; any IANA name such as `Europe/London` also works.

## How it works

```text
Slack web tokens (xoxc + xoxd)
        │
        ▼
sg-local daemon ── WebSocket ──> wss-primary.slack.com
        │              ping every 30s, tickle every 5m
        │
        └──────── HTTP ────────> slack.com/api/users.getPresence every 60s
                                  reconnect if away (never if manual_away)
```

- The `xoxc` token is sent in the WebSocket query string, exactly as the Slack
  web client does. The `xoxd` cookie is sent in the `Cookie` header.
- Tokens are never written to logs.
- There are no external servers, no analytics, no crash reporting, and no
  inbound listening ports.
- The config is plain JSON protected by filesystem permissions (`0600`). It is
  not encrypted at rest; use full-disk encryption and keep backups secure.

## Sleep, laptops, and 24/7 operation

macOS suspends processes while the machine sleeps, so a daemon on a laptop
cannot keep presence alive when the lid is closed. The supported way to get
24/7 presence is to run the daemon on an always-on host (see
[Run the daemon 24/7](#run-the-daemon-247)).

If you keep it on a laptop instead:

- Keep the machine awake while it should be online, for example:
  `caffeinate -dimsu` (this prevents sleep; it does not bypass corporate
  policies).
- Use `sg-local install-launchd` so the daemon restarts after login.

## Security and privacy

- Tokens are read with hidden input, verified with `auth.test`, and stored only
  in `~/.config/slack-green-local/config.json` with mode `0600`.
- Logs contain workspace names, connection states, and errors — never token
  values. Runtime files live in `~/.local/state/slack-green-local/`.
- The control surface (`sg-local web` / `sg-local cloud`) requires the bridge
  access code on every state and mutation request. The code lives in
  `bridge.json` with mode `0600`, or in `SG_LOCAL_BRIDGE_CODE` on a cloud host.
- In cloud mode the server binds `0.0.0.0` behind the platform's TLS proxy. Use
  HTTPS and set `SG_LOCAL_WEB_ORIGIN` to your dashboard origin. CORS is an
  allowlist, and an unknown origin cannot read or change anything without the
  code.
- The dashboard stores only the daemon URL and access code in `localStorage`.
  It never receives Slack tokens; those exist only on the daemon.
- Revoking access is equivalent to signing out of Slack or changing your
  password; tokens may also expire on their own. If Slack rejects them, run
  `sg-local add` again.
- `sg-local doctor` checks file permissions. `--check-tokens` contacts Slack to
  verify the stored tokens.
- Never commit your config file. It is outside this repository by default, and
  `.gitignore` also excludes common secret files.

## Uninstall

```sh
sg-local stop
sg-local uninstall-launchd   # if installed
rm -f ~/.local/bin/sg-local
rm -rf ~/.config/slack-green-local ~/.local/state/slack-green-local
```

The last command deletes your stored tokens and logs. Run it only if you no
longer need the tool.

## Development

Python daemon:

```sh
python3 -m unittest discover -s tests -v
./sg-local doctor
```

The unit tests do not contact Slack; they use fake tokens and mock the network.
The package uses only `websockets` plus the Python standard library.

Web interface:

```sh
npm install
npm run build
```

Project layout:

```text
app/                  Next.js App Router pages, layout, and global styles
components/           landing, live dashboard, connect dialog, setup, and shared UI
lib/                  typed daemon client and localStorage pairing
sg_local/
  cli.py              command-line interface
  config.py           paths, config schema, permissions, pause/stay helpers
  daemon.py           background supervisor and schedule reconciliation
  launchd.py          optional macOS login auto-start
  schedule.py         weekly schedule parsing and evaluation
  slack.py            Slack HTTP client and presence WebSocket session
  state.py            PID/lock handling, runtime state, log tailing
  web.py              local/cloud control surface, bridge auth, and API
tests/                Python unit tests (no network)
sg-local              wrapper script
install.sh            user-level launcher installer
package.json          Next.js interface dependencies and scripts
Dockerfile            daemon image for Fly, Render, Railway, or a VPS
fly.toml              Fly.io configuration and volume mount
render.yaml           Render blueprint
railway.json          Railway build and health check
docker-compose.yml    local or VPS container with a named volume
```
