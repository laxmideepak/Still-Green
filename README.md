<p align="center">
  <img src="docs/banner.svg" alt="Stillgreen" width="100%">
</p>

# Stillgreen

Stillgreen keeps your Slack status **green (active)** while your computer is on,
even when the Slack tab is closed. You choose when: all the time, or only in
the hours you set (for example, weekdays 9:00–17:00).

Everything runs **on your own computer**. There is no account and no server in
the middle. Your Slack login stays on your machine and is only ever sent to
Slack.

> [!WARNING]
> Keeping your status green automatically may be against your employer's rules
> or Slack's terms. Use it only where you are allowed to.

## What it does

- Keeps a Slack connection open in the background, the same way the Slack web
  app does, so Slack shows you as active.
- Checks your status every minute. If Slack marks you "away" on its own, it
  reconnects to turn you green again.
- **Never** changes an "away" status you set yourself in Slack.
- Follows a weekly schedule, and lets you pause it, or stay online for a
  while, whenever you want.
- Works with several Slack workspaces at once.

## The three parts

| Part | What it is | Where it runs |
| --- | --- | --- |
| **Daemon** | A small Python program that holds the Slack connection. | Your computer, or a cloud server ([see below](#run-it-in-the-cloud)) |
| **Browser extension** | Copies your Slack login from your browser to the daemon in one click. | Chrome on your computer |
| **Dashboard** | A web page to see the status and change settings. | <https://stillgreen.vercel.app/dashboard>, or the daemon's own page at <http://127.0.0.1:8765> |

The dashboard website only shows the page. Your browser talks to the daemon on
your own computer directly; the website never receives your Slack login.

## What you need

- macOS or Linux
- Python 3.11 or newer (check with `python3 --version`)
- Google Chrome (or another Chromium browser, such as Edge or Brave)
- A Slack workspace you can sign in to at <https://app.slack.com>

## Set it up (about 5 minutes)

### Step 1 — Download it and install what it needs

```bash
git clone https://github.com/laxmideepak/slack.git
```

```bash
cd slack
```

```bash
python3 -m pip install --user websockets
```

Optional: run `./install.sh` so you can type `sg-local` from any folder instead
of `./sg-local`.

### Step 2 — Start Stillgreen

```bash
./sg-local web --daemon --open
```

This starts the daemon in the background and opens its control page at
<http://127.0.0.1:8765>. You can close the terminal; the daemon keeps running.
The page shows your **access code**, which looks like `SG-ABCD-EFGH-JKLM`. You
need it in the next steps.

Lost the code? Print it again with:

```bash
./sg-local web --show-code
```

### Step 3 — Add your Slack account with the extension

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder inside the `slack`
   folder you downloaded.
4. Click the Stillgreen icon in the toolbar (pin it from the puzzle-piece menu).
5. Leave **Daemon URL** as `http://127.0.0.1:8765` and paste your **access
   code**. It is saved automatically.
6. Open <https://app.slack.com> in the same Chrome window and sign in.
7. Click **Capture from Slack** in the extension.

The extension sends your Slack login to the daemon, the daemon checks it with
Slack, and the workspace appears on the control page. Within a few seconds its
status changes to **Active**.

<details>
<summary><strong>Prefer not to use the extension?</strong> Add the account by hand.</summary>

<br>

Run `./sg-local add` and paste two values when it asks. The input is hidden.

1. Open your workspace at <https://app.slack.com> in Chrome and sign in.
2. Open DevTools (`Cmd+Option+I` on Mac, `Ctrl+Shift+I` elsewhere) and go to
   the **Network** tab. Reload the page.
3. **Token:** type `api` in the filter box, click a request such as
   `client.boot`, and open **Payload**. Copy the `token` value. It starts with
   `xoxc-`.
4. **Cookie:** go to **Application → Cookies → https://app.slack.com** and copy
   the value of the cookie named `d`. It starts with `xoxd-`.

Both values must come from the same signed-in browser. Treat them like a
password: never paste them into chat, issues, or screenshots.

</details>

### Step 4 — (Optional) Use the online dashboard

Open <https://stillgreen.vercel.app/dashboard>, click **Connect daemon**, and
enter:

- **Daemon URL:** `http://127.0.0.1:8765`
- **Access code:** the same code as before

The browser remembers these, so you only do this once. You can also skip this
step and use the control page at <http://127.0.0.1:8765> instead; it has the
same controls.

You are done. Your status stays green while the daemon is running.

> [!NOTE]
> On your own computer, the daemon stops when the computer sleeps or shuts
> down. To stay green when your laptop is closed, run it in the cloud instead.

## Run it in the cloud

Run the daemon on a small server that is always on. The dashboard and the
extension work the same way; you just use the server's `https://` address
instead of `http://127.0.0.1:8765`.

### Why a server, and why not Vercel?

Stillgreen has to keep **one connection to Slack open all the time**. Vercel
only runs short pieces of code that stop after a few minutes at most, so it
can show the dashboard but cannot hold that connection. You need a small
always-on server for the daemon. The dashboard stays on Vercel.

The server needs `https://`, because the dashboard is an `https://` page and
browsers block it from talking to a plain `http://` server on the internet.
The setup below gets a free HTTPS certificate automatically.

### Which server?

| Option | Cost | Notes |
| --- | --- | --- |
| **Google Cloud e2-micro** (recommended) | Free | One small always-on server in the US regions us-west1, us-central1 or us-east1. Needs a card on file, but stays free within the limits. |
| **Oracle Cloud Always Free** | Free | Also works with the same steps. Free servers are sometimes not available in a region. |
| **Fly.io** | About $2-3 a month | Easiest to set up; HTTPS included. No free plan for new accounts. |
| **A computer at home** (Raspberry Pi, old laptop) | Free | Use the normal Mac/Linux setup above; it must stay on. |

Free plans that put the server to sleep when no one visits (for example
Render's free plan) do **not** work: a sleeping server drops the Slack
connection.

### Free setup on Google Cloud (about 15 minutes)

1. Open <https://console.cloud.google.com/compute/instances> and choose
   **Create instance**.
2. Pick **Region**: `us-central1` (or `us-west1` / `us-east1`), and **Machine
   type**: `e2-micro`.
3. Under **Boot disk**, click **Change** and pick **Standard persistent disk**
   (keep Debian and 10 GB). The default "Balanced" disk is **not** free.
4. Under **Firewall**, tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
   Create the instance.
5. Click **SSH** next to the new instance. In the window that opens, run:

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
git clone https://github.com/laxmideepak/slack.git && cd slack
```

```bash
sudo sh deploy/setup-vm.sh
```

The script installs Docker, starts Stillgreen with a free HTTPS address such
as `https://34-1-2-3.sslip.io` (made from the server's IP address), and prints:

```text
  Daemon URL:   https://34-1-2-3.sslip.io
  Access code:  SG-ABCD-EFGH-JKLM
```

Have your own domain? Point it at the server and run
`sudo sh deploy/setup-vm.sh stillgreen.example.com` instead.

6. Use that **Daemon URL** and **Access code** in the dashboard
   (**Connect daemon**) and in the extension (instead of
   `http://127.0.0.1:8765`), then click **Capture from Slack** as usual.

To update later, run `git pull && sudo docker compose up -d --build` in the
`slack` folder on the server.

> [!TIP]
> The server's IP address (and so the `sslip.io` address) changes if you
> stop and start the server. Restarting it from inside (`sudo reboot`) keeps
> it. If it does change, run `sudo sh deploy/setup-vm.sh` again and update
> the Daemon URL in the dashboard and extension. You can also keep the
> address with **VPC network → IP addresses → Promote to static**, but check
> **Billing** afterwards: a static address may cost a little.

### Setup on Fly.io (paid)

Install the `fly` command (<https://fly.io/docs/flyctl/install/>), then in the
`slack` folder:

```bash
fly launch --copy-config --no-deploy --name your-stillgreen
```

```bash
fly volumes create stillgreen_data --size 1
```

```bash
fly deploy
```

```bash
fly ssh console -C "sg-local web --show-code"
```

Your Daemon URL is `https://your-stillgreen.fly.dev`.

### Any other Docker host

`docker compose up -d --build` with `STILLGREEN_DOMAIN=your.domain` in a `.env`
file starts the daemon behind Caddy, which gets the HTTPS certificate. Without
Compose, the image alone is `docker build -t stillgreen .` and
`docker run -d -p 127.0.0.1:8765:8765 -v stillgreen-data:/data stillgreen`;
put your own HTTPS proxy in front of port 8765.

### Good to know

- Your Slack login is stored on your server, in a Docker volume only the
  Stillgreen user can read. It is never sent to the dashboard website.
- After 10 wrong access codes in a minute, the server refuses further tries
  from that visitor for a minute. Other visitors are not affected.
- Schedules saved from the dashboard use your browser's timezone, so "9 to 5"
  means your 9 to 5 even though the server runs on UTC.
- Slack may notice that your session is being used from a data-centre address
  and sign it out. If the status keeps showing **Tokens rejected**, capture
  again; if it keeps happening, run Stillgreen at home instead.

## Everyday use

You can do all of this from the dashboard, the control page, or the terminal.

| I want to… | Dashboard / control page | Terminal |
| --- | --- | --- |
| See if it is working | Look at the workspace status | `./sg-local status` |
| Only be green during work hours | **Schedule** → choose days and times → **Save schedule** | `./sg-local schedule set --days mon-fri --start 09:00 --end 17:00` |
| Be green all the time | **Schedule** → **Always on** | `./sg-local schedule always` |
| Stop for a while | **Pause all 1h** | `./sg-local pause --for 2h` |
| Stop one workspace | Select it → **Pause** | `./sg-local pause --workspace NAME` |
| Start again after a pause | **Resume all** / **Resume** | `./sg-local resume` |
| Stay green outside my schedule for a while | **Keep me online** → pick a time | `./sg-local stay 90m` |
| Remove a workspace and delete its login | Select it → **Remove** | `./sg-local remove NAME` |

Times like `30m`, `2h`, `1d` mean 30 minutes, 2 hours and 1 day. Schedules use
your computer's time zone unless you add one, for example
`--timezone America/New_York`. A window like `--start 22:00 --end 06:00` runs
overnight.

### Starting and stopping

| I want to… | Command |
| --- | --- |
| Start the daemon (it also serves the control page) | `./sg-local start` |
| Start it and open the control page | `./sg-local web --daemon --open` |
| Stop the daemon | `./sg-local stop` |
| Start it automatically when I log in (macOS) | `./sg-local install-launchd` |
| Undo automatic start | `./sg-local uninstall-launchd` |

The daemon keeps running after you close the terminal or the control page. It
stops when you run `./sg-local stop` or restart the computer (unless you turned
on automatic start).

## When something goes wrong

| What you see | What to do |
| --- | --- |
| `No module named 'websockets'` | Run `python3 -m pip install --user websockets`. |
| Dashboard says it **could not reach** the daemon | Run `./sg-local start`, and check the URL is `http://127.0.0.1:8765`. |
| Dashboard says the **origin is not allowed** | You opened the dashboard from a different web address. Use <https://stillgreen.vercel.app/dashboard>, or start the daemon with `SG_LOCAL_WEB_ORIGIN=https://your-address ./sg-local start`. |
| **The access code was not accepted** | Copy the code again with `./sg-local web --show-code`. |
| Status is **Tokens rejected** | Your Slack login expired (for example, you signed out). Sign in at app.slack.com and click **Capture from Slack** again. |
| Status is **Manual away** | You set yourself away in Slack. Stillgreen leaves this alone. Set yourself active in Slack. |
| Status is **Outside schedule** | You are outside your schedule. Use **Keep me online** or change the schedule. |
| Extension says **No Slack token found** | Reload app.slack.com while signed in, then try again. |
| **Too many wrong access codes** | Wait one minute, then paste the code again. |
| Cloud server: the `https://` address does not open | Check ports 80 and 443 are open (Google Cloud: **Allow HTTP/HTTPS traffic**) and run `sudo docker compose logs caddy` on the server. The first certificate can take a minute. |
| Anything else | Run `./sg-local doctor --check-tokens`, then look at `./sg-local logs -f`. |

## Your data

- Your Slack login is saved only in `~/.config/slack-green-local/config.json`.
  Only your user account can read this file.
- It is sent only to Slack. It is never shown by the dashboard, never written
  to logs, and never sent to the dashboard website.
- The control page and its API are reachable only from your own computer, and
  every request needs the access code. Other websites cannot read the code,
  and only the official dashboard address may use the API from a browser.
- The extension sends your login only to the daemon address you set. It
  refuses plain `http://` addresses that are not on your own computer.
- To remove everything: `./sg-local stop`, then delete
  `~/.config/slack-green-local` and `~/.local/state/slack-green-local`, and
  remove the extension from `chrome://extensions`.

## All commands

Run `./sg-local --help`, or `./sg-local COMMAND --help` for one command.

| Command | What it does |
| --- | --- |
| `add` | Add or update a workspace by pasting the token and cookie |
| `list` | List workspaces and their status |
| `remove NAME` | Remove a workspace and delete its login |
| `start` / `stop` / `restart` | Control the background daemon |
| `status` | Show the daemon, schedule, pause and workspace status |
| `schedule show` / `set` / `always` | Show or change the schedule |
| `pause` / `resume` | Pause or resume, for all workspaces or one |
| `stay DURATION` / `stay --cancel` | Stay online for a while, ignoring pause and schedule |
| `web` | Run the control page (`--daemon` also starts the daemon, `--open` opens the browser, `--show-code` prints the code) |
| `cloud` | Run the daemon and control page on a server or in a container (used by the Docker image) |
| `doctor` | Check the setup (`--check-tokens` also checks the login with Slack) |
| `logs` | Show the log (`-f` keeps following it) |
| `install-launchd` / `uninstall-launchd` | Turn automatic start at macOS login on or off |

## For developers

```bash
python3 -m pip install websockets pytest
```

```bash
python3 -m pytest -q
```

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run test:e2e
```

- `python3 -m pytest -q` runs the unit tests and the end-to-end tests. The
  end-to-end tests start the real daemon against a fake Slack server
  (`tests/e2e/fake_slack.py`), so no Slack account is needed.
- `npm run test:e2e` builds the dashboard and tests it in a real Chromium
  browser against the same fake setup. It needs Playwright's Chromium
  (`npx playwright install chromium`).

| Folder | Contents |
| --- | --- |
| `sg_local/` | The daemon, command line and control page (Python) |
| `app/`, `components/`, `lib/` | The dashboard website (Next.js) |
| `extension/` | The Chrome extension (no build step) |
| `tests/` | Unit tests and end-to-end tests |

Stillgreen is an independent project. It is not connected to Slack or to
slack.green.
