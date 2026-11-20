<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
    <img src="docs/banner-light.svg" alt="Stillgreen helps keep your Slack status green on your schedule. A sample status pill, labeled Sample, reads: Active, until 5:00 PM." width="100%">
  </picture>
</p>

<p align="center">
  <strong>Helps keep your Slack status green, on your schedule.<br>Free, open source, and it runs on your own computer.</strong>
</p>

<p align="center">
  <a href="https://github.com/laxmideepak/Still-Green/actions/workflows/tests.yml"><img src="https://github.com/laxmideepak/Still-Green/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-15803d" alt="MIT license"></a>
  <a href="https://github.com/laxmideepak/Still-Green/stargazers"><img src="https://img.shields.io/github/stars/laxmideepak/Still-Green?style=flat&color=15803d" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/python-3.9%2B-3776AB?logo=python&logoColor=white" alt="Python 3.9+">
</p>

<p align="center">
  <a href="https://stillgreen.vercel.app"><strong>Website</strong></a> ·
  <a href="https://stillgreen.vercel.app/dashboard"><strong>Open dashboard</strong></a> ·
  <a href="#quick-start-5-minutes"><strong>Quick start</strong></a> ·
  <a href="#check-my-setup"><strong>Check my setup</strong></a> ·
  <a href="#privacy-and-security"><strong>Privacy</strong></a> ·
  <a href="#faq"><strong>FAQ</strong></a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="The Stillgreen dashboard: the user picks Keep me online for 1 hour, then pauses one workspace." width="860">
</p>

## Why Stillgreen

- **Slack marks you away too soon.** You step away for a few minutes, or your laptop goes to sleep, and your status turns grey.
- **Most fixes have a catch.** Paid "stay online" services keep your Slack login on their servers. Mouse jigglers only work while your computer is on and awake.
- **Stillgreen is free and private.** It runs on your own computer (or, advanced, your own small cloud server). Your Slack login is only ever sent to Slack.
- **You decide when.** Run it all the time, or only on the days and hours you choose.
- **It tells you the truth.** The dashboard shows separately whether Stillgreen is running, whether Slack accepts your login, and whether Slack itself has confirmed you as active.

> [!IMPORTANT]
> Slack decides your final status. Stillgreen keeps a connection open like the Slack web app, which helps keep you active. Slack's official API cannot force a person to be active, so this uses your web session. It may stop working if Slack changes, and your workspace may not allow it. Slack does not officially support it.

## Features

<table>
  <tr>
    <td width="33%"><strong>Always on or on a schedule</strong><br>Pick the days, the hours and your timezone.</td>
    <td width="33%"><strong>Keep me online</strong><br>Keep helping for 30 min, 1 h, 2 h, 3 h, or until a time today.</td>
    <td width="33%"><strong>Pause any time</strong><br>For 1 hour or until you resume. Or pause just one workspace.</td>
  </tr>
  <tr>
    <td><strong>Many workspaces</strong><br>Add them all with one click in the browser extension.</td>
    <td><strong>Respects your "away"</strong><br>If you set yourself away in Slack, Stillgreen leaves it alone.</td>
    <td><strong>Reconnects by itself</strong><br>Checks every minute and reconnects if Slack marks you away.</td>
  </tr>
  <tr>
    <td><strong>Activity log</strong><br>See what Stillgreen did and when, newest first.</td>
    <td><strong>Light and dark theme</strong><br>On the dashboard and on Stillgreen's own control page.</td>
    <td><strong>Private by design</strong><br>Your login stays with you. The website never sees it.</td>
  </tr>
  <tr>
    <td><strong>Clear status</strong><br>"Stillgreen running", "Slack login valid" and "Presence confirmed", each on its own.</td>
    <td><strong>Check my setup</strong><br>One click tests the network, certificates, clock and each workspace, and says what to do.</td>
    <td><strong>Sets itself up</strong><br>The first run prepares everything it needs. No <code>pip</code>, no <code>sudo</code>.</td>
  </tr>
</table>

## How it works

1. **Start Stillgreen** on your computer. It is one small Python program, and it sets itself up the first time.
2. **Add your workspaces.** Open Slack in Chrome and click **Capture from Slack** in the Stillgreen extension. It first tells you what it reads and asks for your OK.
3. **Set your schedule** in the dashboard. Stillgreen keeps a Slack connection open, like the Slack web app does, which helps Slack show you as active. The dashboard shows when Slack confirms it.

```mermaid
flowchart LR
    ext["Chrome extension<br/>Capture from Slack"] -- "your Slack login" --> sg
    dash["Dashboard<br/>in your browser"] -- "access code" --> sg
    sg["Your Stillgreen<br/>your computer or server"] -- "keeps a connection open" --> slack["Slack"]
    site["stillgreen.vercel.app"] -. "only serves the page" .-> dash
```

The website only sends the dashboard page to your browser. After that, your browser talks straight to **your** Stillgreen. Your Slack login never goes to the website.

## Quick start (5 minutes)

**You need:** macOS or Linux, Python 3.9 or newer, and Chrome (or another Chromium browser, such as Edge or Brave). A Mac already has Python: the built-in `python3` (3.9) works. On a new Mac, the first `git` or `python3` may ask to install the developer tools; click **Install**. Check with `python3 --version`; if yours is older, get a new one from <https://www.python.org/downloads/>. You do not need `pip` or `sudo`.

**1. Download Stillgreen and start it**

```bash
git clone https://github.com/laxmideepak/Still-Green.git
cd Still-Green
./sg-local web --daemon --open
```

The first time, `./sg-local` sets itself up: it makes a private folder `.venv` inside `Still-Green` and downloads the exact package versions listed in `requirements.lock` (websockets, and truststore on Python 3.10 or newer) from pypi.org, checking each file's hash. This takes about a minute and happens only once. After that it starts at once. Nothing is installed outside the `Still-Green` folder.

If you have Python 3.10 or newer, Stillgreen uses it; otherwise it uses the Mac's own Python 3.9. With 3.10 or newer it trusts the same certificates as your Mac, which matters on company networks. If setup fails, the message says what to do and the full details are in `.venv-setup.log`.

This starts Stillgreen in the background and opens its control page at <http://127.0.0.1:8765>. You can close the terminal; Stillgreen keeps running.

The page shows your **access code**. It looks like `SG-ABCD-EFGH-JKLM`. Lost it? Run `./sg-local web --show-code`.

Optional: run `./install.sh` so you can type `sg-local` from any folder instead of `./sg-local`.

**2. Add your Slack account with the extension**

1. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `extension` folder inside `Still-Green`.
3. Click the Stillgreen icon in the toolbar (pin it from the puzzle-piece menu).
4. Leave **Stillgreen address** as `http://127.0.0.1:8765` and paste your **access code**. It is saved automatically.
5. Open <https://app.slack.com> in the same Chrome window and sign in.
6. Click **Capture from Slack**. The first time, the extension explains what it reads (your Slack session token and the `d` cookie), what that allows (acting as you in Slack, like being signed in), where it goes (only to your Stillgreen) and how to remove it. Read it and click **I understand, continue**.

The workspace appears on the control page within a few seconds. About a minute later, **Presence confirmed** turns green when Slack's own status check says you are active.

<details>
<summary><strong>Prefer not to use the extension?</strong> Add the account by hand.</summary>

<br>

Run `./sg-local add` and paste two values when it asks. The input is hidden.

1. Open your workspace at <https://app.slack.com> in Chrome and sign in.
2. Open DevTools (`Cmd+Option+I` on Mac, `Ctrl+Shift+I` elsewhere) and go to the **Network** tab. Reload the page.
3. **Token:** type `api` in the filter box, click a request such as `client.boot`, and open **Payload**. Copy the `token` value. It starts with `xoxc-`.
4. **Cookie:** go to **Application → Cookies → https://app.slack.com** and copy the value of the cookie named `d`. It starts with `xoxd-`.

Both values must come from the same signed-in browser. Treat them like a password: never paste them into chat, issues, or screenshots.

More about the extension and its permissions: [extension/README.md](extension/README.md).

</details>

**3. (Optional) Connect the online dashboard**

Open <https://stillgreen.vercel.app/dashboard>, click **Connect Stillgreen**, and enter:

- **Stillgreen address:** `http://127.0.0.1:8765`
- **Access code:** the same code as before

Your browser remembers these, so you only do this once. You can also skip this and use the control page at <http://127.0.0.1:8765>. It has the same controls.

**That's it.** While Stillgreen runs, it keeps a Slack connection open, which helps keep you active. Slack decides your final status; the dashboard shows when Slack confirms it.

> [!NOTE]
> On your own computer, Stillgreen stops when the computer sleeps or shuts down. To keep it running when your laptop is closed, you can [run it in the cloud](#run-it-in-the-cloud-advanced) (advanced).

## Check my setup

Something not working? Click **Check my setup** on the dashboard or the control page. It tests Python, Stillgreen itself, the settings file, file permissions, finding slack.com, the secure (TLS) connection, a proxy, your clock, each workspace's login and whether Slack confirmed your presence. Each line says what is wrong and what to do.

In a terminal:

```bash
./sg-local doctor                                   # check everything and explain each problem
./sg-local doctor --check-tokens                    # also check each saved login with Slack
./sg-local doctor --report stillgreen-report.txt    # save a report to share when you ask for help
```

**Download report** on the dashboard saves the same report. It leaves out passwords, Slack tokens, cookies and your access code, but read it before you share it.

Stillgreen never turns off certificate checks. If your company network uses its own certificate, see **Security certificate not trusted** under [Troubleshooting](#guides-and-reference).

## Update

In the `Still-Green` folder, run:

```bash
git pull && ./sg-local restart
```

`git pull` gets the new version, and `restart` makes the running Stillgreen use it. If the update needs new Python packages, `./sg-local` installs them first; it stops Stillgreen while it does that and starts it again afterwards. Until you restart, `./sg-local status`, `./sg-local doctor` and the **Details** on the control page say that an update is waiting. If you use automatic start at login, `restart` restarts that too.

On a cloud server, see [Update to a new version](#update-to-a-new-version).

## Uninstall

1. In the `Still-Green` folder, run:

   ```bash
   ./sg-local uninstall
   ```

   It stops Stillgreen, removes the macOS login item, and deletes Stillgreen's settings, logs, saved Slack logins and access code. It asks first (`--yes` skips the question). It deletes only the files Stillgreen made: if you put other files in its folders, they stay, and it tells you which. It does not delete the program folder.
2. In Slack, go to Settings and click **Sign out of all other sessions**. This ends the session Stillgreen used.
3. In Chrome, open `chrome://extensions` and click **Remove** on Stillgreen.
4. Delete the `Still-Green` folder.

On a cloud server: run `sudo docker compose down -v` in the `Still-Green` folder, then delete the server.

## Run it in the cloud (advanced)

Most people should run Stillgreen on their own computer. If you are comfortable looking after a server, you can put Stillgreen on one that is always on, so it keeps running when your laptop is closed. Google Cloud's **e2-micro** server is free within its limits, and one setup script does the rest: Docker, Stillgreen and a free HTTPS address.

> [!WARNING]
> **Before you choose the cloud:**
> - Google Cloud needs a **card on file**, even for the free server.
> - The **free tier has limits.** Going past them (for example the wrong disk type or region), or keeping a static IP address, can cost money.
> - The server's **IP address can change** when it stops and starts, and then the address changes too.
> - **You keep the server updated** and secure.
> - **Your Slack session lives on that server.** If someone breaks into it, they can act as you in Slack. That is more risk than keeping it on your own computer. See the [threat model](docs/threat-model.md).

**On Google Cloud (about 15 minutes):**

1. Open <https://console.cloud.google.com/compute/instances> and click **Create instance**.
2. Pick **Region** `us-central1` (or `us-west1` / `us-east1`) and **Machine type** `e2-micro`.
3. Under **Boot disk**, click **Change** and pick **Standard persistent disk** (keep Debian and 10 GB). The default "Balanced" disk is **not** free.
4. Under **Firewall**, tick **Allow HTTP traffic** and **Allow HTTPS traffic**. Create the instance.
5. Click **SSH** next to the new instance, and run:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/laxmideepak/Still-Green.git && cd Still-Green
sudo sh deploy/setup-vm.sh
```

The script prints your address and access code:

```text
  Address:      https://34-1-2-3.sslip.io
  Access code:  SG-ABCD-EFGH-JKLM
```

6. Use these two values in the dashboard (**Connect Stillgreen**) and in the extension, instead of `http://127.0.0.1:8765`. Then click **Capture from Slack** as usual.

<details>
<summary><strong>The full cloud guide:</strong> why a server, which server, your own domain, updates, and good to know</summary>

<br>

#### Why a server, and why not Vercel?

Stillgreen has to keep **one connection to Slack open all the time**. Vercel only runs short pieces of code that stop after a few minutes at most, so it can show the dashboard but cannot hold that connection. You need a small always-on server for Stillgreen. The dashboard stays on Vercel.

The server needs `https://`, because the dashboard is an `https://` page and browsers block it from talking to a plain `http://` server on the internet. The setup script gets a free HTTPS certificate automatically.

#### Which server?

| Option | Cost | Notes |
| --- | --- | --- |
| **Google Cloud e2-micro** | Free within limits | One small always-on server in the US regions us-west1, us-central1 or us-east1. Needs a card on file. |
| **Oracle Cloud Always Free** | Free | Also works with the same steps. Free servers are sometimes not available in a region. |
| **Fly.io** | About $2-3 a month | Easiest to set up; HTTPS included. No free plan for new accounts. |
| **A computer at home** (Raspberry Pi, old laptop) | Free | Use the normal [Quick start](#quick-start-5-minutes); it must stay on. |

Free plans that put the server to sleep when no one visits (for example Render's free plan) do **not** work: a sleeping server drops the Slack connection.

#### Your own domain

The setup script makes an address from the server's IP, such as `https://34-1-2-3.sslip.io`. Have your own domain? Point it at the server and run this instead:

```bash
sudo sh deploy/setup-vm.sh stillgreen.example.com
```

#### Update to a new version

In the `Still-Green` folder on the server, run:

```bash
git pull && sudo docker compose up -d --build
```

#### If the address changes

The server's IP address (and so the `sslip.io` address) changes if you stop and start the server. Restarting it from inside (`sudo reboot`) keeps it. If it does change, run `sudo sh deploy/setup-vm.sh` again and update the Stillgreen address in the dashboard and the extension.

You can also keep the address with **VPC network → IP addresses → Promote to static**, but check **Billing** afterwards: a static address may cost a little.

#### Good to know

- Your Slack login is stored on your server, in a Docker volume only the Stillgreen user can read. It is never sent to the dashboard website.
- After 10 wrong access codes in a minute, the server refuses more tries from that visitor for a minute. Other visitors are not affected.
- Schedules saved from the dashboard use your browser's timezone, so "9 to 5" means your 9 to 5 even though the server runs on UTC.
- Slack may notice that your login is used from a cloud server and sign it out. If the status keeps showing **Signed out**, capture again. If it keeps happening, run Stillgreen at home instead.

</details>

<details>
<summary><strong>Fly.io</strong> (paid, about $2-3 a month)</summary>

<br>

Install the `fly` command (<https://fly.io/docs/flyctl/install/>), then in the `Still-Green` folder:

```bash
fly launch --copy-config --no-deploy --name your-stillgreen
fly volumes create stillgreen_data --size 1
fly deploy
fly ssh console -C "sg-local web --show-code"
```

The last command prints your access code. Your Stillgreen address is `https://your-stillgreen.fly.dev`.

</details>

<details>
<summary><strong>Any other Docker host</strong></summary>

<br>

With Docker Compose, Caddy sits in front of Stillgreen and gets the HTTPS certificate:

```bash
echo "STILLGREEN_DOMAIN=your.domain" > .env
docker compose up -d --build
docker compose exec stillgreen sg-local web --show-code
```

Without Compose, build and run the image alone, and put your own HTTPS proxy in front of port 8765:

```bash
docker build -t stillgreen .
docker run -d -p 127.0.0.1:8765:8765 -v stillgreen-data:/data stillgreen
```

</details>

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard-light.png" alt="Dashboard in light mode"></td>
    <td width="50%"><img src="docs/screenshots/dashboard-dark.png" alt="Dashboard in dark mode"></td>
  </tr>
  <tr>
    <td align="center">Dashboard, light</td>
    <td align="center">Dashboard, dark</td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/server-page.png" alt="Stillgreen's own control page"></td>
    <td width="25%" align="center"><img src="docs/screenshots/mobile.png" alt="Dashboard on a phone" width="200"></td>
    <td width="25%" align="center"><img src="docs/screenshots/extension.png" alt="The Chrome extension popup" width="200"></td>
  </tr>
  <tr>
    <td align="center">Stillgreen's own control page</td>
    <td align="center">On a phone</td>
    <td align="center">Chrome extension</td>
  </tr>
</table>

## Stillgreen vs other ways

| | **Stillgreen** | Paid "stay online" services | Mouse jigglers |
| --- | --- | --- | --- |
| **Price** | Free | Monthly fee | Free app, or a small device to buy |
| **Needs your computer on** | Yes, or an always-on server (advanced) | No | Yes, on and awake |
| **Who holds your Slack login** | You (your computer or your server) | The service | No login needed |
| **Schedules** | Yes: days, hours and timezone | Often | Usually not |
| **Respects an "away" you set** | Yes | Depends on the service | Does not know about Slack |
| **Open source** | Yes (MIT) | Usually not | Some are |

## Privacy and security

Read the full [privacy policy](docs/privacy.md) (also at <https://stillgreen.vercel.app/privacy>) and the [threat model](docs/threat-model.md): what Stillgreen protects, the trust boundaries, the protections in the code, and the risks that remain.

- **What the login allows.** The Slack session token and `d` cookie let anyone who has them act as you in Slack, like being signed in. Protect the computer or server Stillgreen runs on.
- **You agree first.** The extension shows what it reads and where it goes, and captures nothing until you click **I understand, continue**.
- **Your login stays with you.** It is stored on your computer or server in a file only your user can read (file mode `0600`). It is sent only to Slack and never written to logs.
- **The website never sees it.** The dashboard page talks from your browser straight to your Stillgreen.
- **Access code.** Stillgreen shows your status and changes settings only for someone with your access code. After 10 wrong codes in a minute, that visitor must wait a minute.
- **Locked to the right addresses.** A Host check blocks DNS rebinding (a trick where another website pretends to be your Stillgreen), and only the official dashboard address may use the API from a browser.
- **The extension is careful too.** It sends your login only to the Stillgreen address you set, asks you again if you change that address, and refuses plain `http://` addresses that are not on your own computer.
- **Always a verified connection to Slack.** Stillgreen checks Slack's certificate, and there is no option to turn that off. With Python 3.10 or newer it uses your computer's trusted certificates. With Python 3.9 it uses Python's own list plus, on a Mac, Apple's root certificates and the ones your administrator marked as trusted, so a company certificate may not be trusted: install Python 3.10 or newer.
- **No analytics, no tracking.** Neither the website, the extension nor Stillgreen reports anything about you to anyone.
- **Remove it any time.** Remove a workspace, or run `./sg-local uninstall`, then in Slack use **Sign out of all other sessions**. See [Uninstall](#uninstall).

More in **Your data** under [Guides and reference](#guides-and-reference), and in [extension/README.md](extension/README.md).

## FAQ

<details>
<summary><strong>Is it free?</strong></summary>

<br>

Yes. Stillgreen is free and open source under the MIT license. Running it on your own computer costs nothing. Running it in the cloud can also be free (see below).

</details>

<details>
<summary><strong>Does my computer need to stay on?</strong></summary>

<br>

Yes, if you run Stillgreen on your computer. It stops when the computer sleeps or shuts down. To keep it running with your laptop closed, you can [run it on a cloud server](#run-it-in-the-cloud-advanced) (advanced: it needs a card on file and some upkeep, and your Slack session then lives on that server).

</details>

<details>
<summary><strong>Will Slack always show me as active?</strong></summary>

<br>

No, and Stillgreen does not promise it. Slack decides your final status. Stillgreen keeps a connection open like the Slack web app, which usually helps. Slack's official API cannot force a person to be active, so this uses your web session, and it may stop working if Slack changes. The dashboard shows **Presence confirmed** only when Slack's own status check says you are active.

</details>

<details>
<summary><strong>Is it allowed at work?</strong></summary>

<br>

It depends on where you work. Slack does not officially support keeping you active, and doing it automatically may be against your employer's rules or Slack's terms. Check them first, and use Stillgreen only where you are allowed to.

</details>

<details>
<summary><strong>Can the website see my Slack login?</strong></summary>

<br>

No. The website only sends the dashboard page to your browser. Your browser then talks straight to your own Stillgreen, using your access code. Your Slack login stays on your computer or server and is only sent to Slack.

</details>

<details>
<summary><strong>What if I set myself away in Slack?</strong></summary>

<br>

Stillgreen leaves it alone. It never changes an "away" status you set yourself. The dashboard shows **Away (set by you)** until you set yourself active in Slack again.

</details>

<details>
<summary><strong>Does it work with many workspaces?</strong></summary>

<br>

Yes. Every workspace signed in to your Slack tab is added in one click of **Capture from Slack**. You can pause or remove each one on its own.

</details>

<details>
<summary><strong>What does the cloud server cost?</strong></summary>

<br>

Google Cloud's e2-micro server is free within its limits, in the US regions us-west1, us-central1 and us-east1, with a **Standard** disk. Google needs a card on file, and going past the limits costs money. A static IP address may cost a little. Fly.io costs about $2-3 a month. A computer you already have at home is free. Running in the cloud is optional and advanced; see [the warnings](#run-it-in-the-cloud-advanced).

</details>

## Guides and reference

<details>
<summary><strong>Everyday use</strong></summary>

<br>

You can do all of this from the dashboard, the control page, or the terminal.

| I want to… | Dashboard / control page | Terminal |
| --- | --- | --- |
| See if it is working | Look at the workspace status | `./sg-local status` |
| Only run during work hours | **Schedule** → choose days and times → **Save schedule** | `./sg-local schedule set --days mon-fri --start 09:00 --end 17:00` |
| Run all the time | **Schedule** → **Always on** | `./sg-local schedule always` |
| Stop for a while | **Pause 1 h** or **Pause until I resume** | `./sg-local pause --for 2h` |
| Stop one workspace | **Pause** on that workspace | `./sg-local pause --workspace NAME` |
| Start again after a pause | **Resume all** / **Resume** | `./sg-local resume` |
| Keep helping outside my schedule for a while | **Keep me online** → pick a time | `./sg-local stay 90m` |
| Keep helping until a time today | **Keep me online** → **Until** | `./sg-local stay --until 17:00` |
| Remove a workspace and delete its login | **Remove** on that workspace | `./sg-local remove NAME` |

Times like `30m`, `2h`, `1d` mean 30 minutes, 2 hours and 1 day. Schedules use your computer's timezone unless you add one, for example `--timezone America/New_York`. A window like `--start 22:00 --end 06:00` runs overnight.

**Starting and stopping**

| I want to… | Command |
| --- | --- |
| Start Stillgreen (it also serves the control page) | `./sg-local start` |
| Start it and open the control page | `./sg-local web --daemon --open` |
| Stop it | `./sg-local stop` |
| Start it automatically when I log in (macOS) | `./sg-local install-launchd` |
| Undo automatic start | `./sg-local uninstall-launchd` |

Stillgreen keeps running after you close the terminal or the control page. It stops when you run `./sg-local stop` or restart the computer (unless you turned on automatic start).

</details>

<details>
<summary><strong>All commands</strong></summary>

<br>

Run `./sg-local --help`, or `./sg-local COMMAND --help` for one command.

| Command | What it does |
| --- | --- |
| `add` | Add or update a workspace by pasting the token and cookie |
| `list` | List workspaces and their status |
| `remove NAME` | Remove a workspace and delete its login |
| `start` / `stop` / `restart` | Start, stop or restart Stillgreen in the background |
| `status` | Show if Stillgreen is running, the schedule, any pause, and each workspace |
| `schedule show` / `set` / `always` | Show or change the schedule |
| `pause` / `resume` | Pause or resume, for all workspaces or one |
| `stay DURATION` / `stay --until HH:MM` / `stay --cancel` | Keep helping you look active for a while, or until a time today, even when paused or outside your schedule |
| `web` | Run the control page (`--daemon` also starts Stillgreen in the background, `--open` opens the browser, `--show-code` prints the code) |
| `cloud` | Run Stillgreen and its control page on a server or in a container (used by the Docker image) |
| `doctor` | Check the setup and explain each problem (`--check-tokens` also checks the login with Slack, `--report FILE` saves a report without tokens) |
| `uninstall` | Stop Stillgreen and delete its settings, logs and saved logins (asks first) |
| `logs` | Show the log (`-f` keeps following it) |
| `install-launchd` / `uninstall-launchd` | Turn automatic start at macOS login on or off |

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

<br>

| What you see | What to do |
| --- | --- |
| The first `./sg-local` says it **could not install** what it needs | Check that you are online and run it again. The message says what went wrong; the full details are in `.venv-setup.log`. |
| `No module named 'websockets'` | Run `./sg-local` again: it installs what it needs. If that does not help, delete the `.venv` folder in `Still-Green` and run `./sg-local` again. |
| `./sg-local` says **Python is too old** | Stillgreen needs Python 3.9 or newer. Install one from <https://www.python.org/downloads/> and run `./sg-local` again. |
| `./sg-local status` or the control page says **an update is waiting** | Run `./sg-local restart` so the running Stillgreen uses the new version. |
| Dashboard says **Connected · waiting for Slack to confirm** | Stillgreen has a live connection and asks Slack about once a minute. If it stays like this for more than a few minutes, Slack may not be counting the connection. Slack decides your final status. |
| **Security certificate not trusted** | Your company network may use its own certificate. Stillgreen uses your computer's trusted certificates (Python 3.10 or newer), so ask IT to install the company certificate, or try another network. With Python 3.9, install Python 3.10 or newer, then delete the `.venv` folder and run `./sg-local` again. You can also point `SSL_CERT_FILE` at the certificate file. Do not turn off security checks. |
| Dashboard says it **could not reach** Stillgreen | Run `./sg-local start`, and check the address is `http://127.0.0.1:8765` (or your server's `https://` address). |
| Dashboard says the **origin is not allowed** | You opened the dashboard from a different web address. Use <https://stillgreen.vercel.app/dashboard>, or restart Stillgreen with `SG_LOCAL_WEB_ORIGIN=https://your-address ./sg-local restart`. |
| **The access code was not accepted** | Copy the code again with `./sg-local web --show-code`. |
| Status is **Signed out** | Your Slack login expired (for example, you signed out). Sign in at app.slack.com and click **Capture from Slack** again. |
| Status is **Away (set by you)** | You set yourself away in Slack. Stillgreen leaves this alone. Set yourself active in Slack. |
| Status is **Off schedule** | You are outside your schedule. Use **Keep me online** or change the schedule. |
| Extension says **No Slack token found** | Reload app.slack.com while signed in, then try again. If it still fails, [add the account by hand](#quick-start-5-minutes). |
| Extension says **Nothing was captured** | You clicked **Cancel** on the notice. Click **Capture from Slack** again and read the notice. |
| **Too many wrong access codes** | After 10 wrong codes in a minute, wait one minute, then paste the code again. |
| Cloud server: the `https://` address does not open | Check ports 80 and 443 are open (Google Cloud: **Allow HTTP/HTTPS traffic**) and run `sudo docker compose logs caddy` on the server. The first certificate can take a minute. |
| Anything else | Click **Check my setup** on the dashboard, or run `./sg-local doctor --check-tokens`, then look at `./sg-local logs -f`. Asking for help? Attach `./sg-local doctor --report stillgreen-report.txt`. |

</details>

<details>
<summary><strong>Your data</strong></summary>

<br>

- Your Slack login is saved only in `~/.config/slack-green-local/config.json`. Only your user account can read this file (mode `0600`). On a cloud server it lives in the Docker volume instead.
- It is sent only to Slack. It is never shown by the dashboard, never written to logs, and never sent to the dashboard website.
- On your computer, the control page and its API are reachable only from your own computer, and everything except a simple health check needs the access code. Other websites cannot read the code, and only the official dashboard address may use the API from a browser.
- The extension sends your login only to the Stillgreen address you set. It refuses plain `http://` addresses that are not on your own computer.
- The log keeps about 4 MB; older lines are deleted automatically.
- To remove everything, see [Uninstall](#uninstall). More in the [privacy policy](docs/privacy.md).

</details>

<details>
<summary><strong>For developers</strong></summary>

<br>

```bash
./sg-local --version                    # sets up .venv the first time
.venv/bin/python -m pip install pytest
.venv/bin/python -m pytest -q
npm install
npm run dev
npm run test:e2e
```

- `.venv/bin/python -m pytest -q` runs the unit tests and the end-to-end tests. The end-to-end tests start the real Stillgreen program against a fake Slack server (`tests/e2e/fake_slack.py`), so no Slack account is needed.
- `npm run dev` runs the dashboard website on your computer.
- `npm run test:e2e` builds the dashboard and tests it in a real Chromium browser against the same fake setup. It needs Playwright's Chromium (`npx playwright install chromium`).

| Folder | Contents |
| --- | --- |
| `sg_local/` | The main Stillgreen program, the command line and the control page (Python) |
| `app/`, `components/`, `lib/` | The dashboard website (Next.js) |
| `extension/` | The Chrome extension (no build step) |
| `deploy/` | The cloud setup script and the Caddy config |
| `tests/` | Unit tests and end-to-end tests |

</details>

## Contributing

Bug reports, ideas and pull requests are welcome.

- Found a problem? [Open an issue](https://github.com/laxmideepak/Still-Green/issues). Please never paste tokens, cookies or access codes.
- Sending a change? Run `.venv/bin/python -m pytest -q` (and `npm run test:e2e` for dashboard changes) first. The setup is under **For developers** above.

## Star history

<a href="https://star-history.com/#laxmideepak/Still-Green&Date">
  <img src="https://api.star-history.com/svg?repos=laxmideepak/Still-Green&type=Date" alt="Star history chart" width="600">
</a>

If Stillgreen helps you, please **[give it a star](https://github.com/laxmideepak/Still-Green)**. It helps other people find it.

## Disclaimer

Stillgreen is an independent project. It is not affiliated with Slack, or with slack.green.

Slack does not officially support keeping you active, and Slack decides your final status. Keeping your status active automatically may be against your employer's rules or Slack's terms. Use it only where you are allowed to.

## License

[MIT](LICENSE)
