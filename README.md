# slack-green-local

A personal, self-hosted Slack presence daemon. It keeps your Slack status
"active" using your own browser session tokens — no account on a third-party
service, no inbound ports, and no telemetry.

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
- Stores everything locally. Outbound traffic goes only to Slack.

## Requirements

- Python 3.11 or newer
- [`websockets`](https://pypi.org/project/websockets/) 12 or newer
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
2. Open DevTools (`Cmd+Option+I` on macOS) and switch to **Console**.
3. Run:

   ```js
   JSON.parse(localStorage.localConfig_v2).teams
   ```

   Find your workspace and copy its `token` value. It starts with `xoxc-`.
   If that returns nothing, open the **Network** panel, filter by `WS`, reload
   the page, and inspect the `wss-primary.slack.com` URL for `token=xoxc-...`.

4. In DevTools, open **Application → Cookies → https://app.slack.com** and copy
   the cookie named `d`. It starts with `xoxd-`.

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

## macOS sleep and 24/7 operation

macOS suspends processes while the machine sleeps, so the daemon cannot keep
presence alive during sleep. Options:

- Run it on an always-on machine or small VPS.
- Keep the Mac awake while it should be online, for example:
  `caffeinate -dimsu` (this prevents sleep; it does not bypass corporate
  policies).
- Use `sg-local install-launchd` so the daemon restarts after login.

## Security and privacy

- Tokens are read with hidden input, verified with `auth.test`, and stored only
  in `~/.config/slack-green-local/config.json` with mode `0600`.
- Logs contain workspace names, connection states, and errors — never token
  values. Runtime files live in `~/.local/state/slack-green-local/`.
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

```sh
python3 -m unittest discover -s tests -v
./sg-local doctor
```

The unit tests do not contact Slack; they use fake tokens and mock the network.
The package uses only `websockets` plus the Python standard library.

Project layout:

```text
sg_local/
  cli.py        command-line interface
  config.py     paths, config schema, permissions, pause/stay helpers
  daemon.py     background supervisor and schedule reconciliation
  launchd.py    optional macOS login auto-start
  schedule.py   weekly schedule parsing and evaluation
  slack.py      Slack HTTP client and presence WebSocket session
  state.py      PID/lock handling, runtime state, log tailing
tests/          unit tests (no network)
sg-local        wrapper script
install.sh      user-level launcher installer
```
