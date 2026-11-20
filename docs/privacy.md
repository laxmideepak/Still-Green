# Privacy policy

Last updated: 20 November 2026. The same text is on the website at
[stillgreen.vercel.app/privacy](https://stillgreen.vercel.app/privacy).

Stillgreen is a free, open source project. There is no Stillgreen company,
account or server that holds your data. You run Stillgreen yourself, on your
own computer or (advanced) on your own cloud server.

## The short version

- Stillgreen needs your Slack web session (a token and a cookie) to work. It
  keeps them on your computer or your server, in a file only your user can
  read, and sends them only to Slack.
- The website never sees your Slack session. It only sends the dashboard page
  to your browser.
- No analytics, no tracking, no ads, no selling of data.
- You can delete everything at any time (see [Delete your data](#delete-your-data)).

## What is collected, and by which part

### The website (stillgreen.vercel.app)

- We collect nothing about you. The site sets no cookies and has no analytics
  or tracking scripts.
- The site is hosted by Vercel. Like any web host, Vercel may keep normal
  server logs (for example the IP address and the time of a request) under
  its own privacy policy. We don't use those logs.
- If you connect the dashboard, your **Stillgreen address** and **access
  code** are saved in your own browser (local storage), so you don't have to
  type them again. They are not sent to the website. Click **Disconnect** to
  remove them.

### The Chrome extension

- Only when you click **Capture from Slack**, it reads, for each Slack
  workspace open in Chrome:
  - your Slack **session token** (it starts with `xoxc-`), from the Slack tab;
  - the Slack **`d` cookie** (it starts with `xoxd-`).
- Together these let anyone who has them **act as you in Slack**, like being
  signed in.
- It sends them **only to the Stillgreen address you set**, never to the
  website or anyone else. Plain `http://` is allowed only to your own
  computer; any other address must use `https://`.
- It saves your Stillgreen address, access code and the date you agreed to
  this notice in Chrome's extension storage on your computer. It does not
  keep the Slack token or cookie.
- Before the first capture it shows what it reads and asks you to agree. If
  what it reads ever changes, or you change the Stillgreen address, it asks
  again.

### Stillgreen itself (the program on your computer or server)

It saves:

| What | Where | Who can read it |
| --- | --- | --- |
| Each workspace's name, team ID, user ID, session token and `d` cookie | `~/.config/slack-green-local/config.json` | Only your user (file mode `0600`) |
| The access code | `~/.config/slack-green-local/bridge.json` | Only your user (`0600`) |
| Schedule, pause and "keep me online" settings | the same folder | Only your user |
| Status and a log of what it did | `~/.local/state/slack-green-local/` | Only your user (folder mode `0700`) |

On a cloud server with Docker, the same files are in the `stillgreen-data`
volume (`/data/config` and `/data/state`).

Tokens, cookies and access codes are removed from the log, from error
messages and from the diagnostics report before they are written.

## Who it is shared with

- **Slack.** Stillgreen sends your token and cookie to Slack (`slack.com`) to
  check them and to keep a connection open, like the Slack web app does.
- **Nobody else.** There is no Stillgreen server in the middle, and nothing is
  sent to the website, to us, or to any other company.
- If you choose to run Stillgreen on a cloud server, your session is stored on
  that server, and the cloud company's own terms apply to the machine.

## How long it is kept

- Your saved Slack session stays until you remove the workspace or uninstall
  Stillgreen. Slack may also end it earlier, for example when you sign out.
- The log is kept to about 4 MB (one current file and three older ones); the
  oldest lines are deleted automatically.
- A diagnostics report is only made when you ask for one. It is saved where
  you choose, and you decide whether to share it.

## Delete your data

1. **Remove one workspace:** click **Remove** next to it in the dashboard or
   the control page, or run `./sg-local remove NAME`. Its saved session is
   deleted from your Stillgreen.
2. **Remove everything:** in the Stillgreen folder, run `./sg-local uninstall`.
   It stops Stillgreen and deletes the settings, logs, saved sessions and
   access code (it asks first). On a server, run `sudo docker compose down -v`.
3. **End the session in Slack too:** in Slack, go to Settings and click
   **Sign out of all other sessions**. A deleted file can't be used any more,
   but this makes sure no copy can be used either.
4. **Remove the extension:** open `chrome://extensions` and click **Remove**.
5. **Forget the dashboard:** click **Disconnect** on the dashboard.

## Slack and your workplace

Stillgreen is not made by or connected to Slack. Slack's official API can't
force a person to be active, so Stillgreen uses your web session. Slack does
not officially support this, it may stop working if Slack changes, and your
employer or workspace may not allow it. Check before you use it.

## Security

How Stillgreen protects your session, and the risks that remain, are in the
[threat model](threat-model.md).

## Changes

Changes to this policy are made in the open, in the project's Git history.
If the extension starts reading anything new, it asks for your agreement
again.

## Contact

Open an issue on GitHub:
[github.com/laxmideepak/Still-Green/issues](https://github.com/laxmideepak/Still-Green/issues).
Never paste tokens, cookies or your access code in an issue.
