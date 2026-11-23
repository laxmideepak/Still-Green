# Instructions for AI assistants

This file is for AI coding assistants (Claude Code, Cursor, Codex, GitHub
Copilot and others) working in this repository. People can also paste the
prompt from the README's "Set up with an AI assistant" section into a chat app
such as ChatGPT or Claude.

Stillgreen keeps a Slack connection open from the user's own computer so Slack
can show them as active. It is a Python daemon (`sg_local/`), a local control
page, a Chrome extension (`extension/`) and an optional Next.js website (`app/`).

Write to the user in plain, simple English. Many users are not developers.

## Helping someone set up Stillgreen

Work through these steps in order. Before each command, say in one line what it
does. Stop and explain if a step fails; do not guess or try random fixes.

1. **Check the computer.** Stillgreen runs on macOS or Linux (not Windows).
   It needs `git`, Python 3.9 or newer (`python3 --version`) and Chrome, Edge or
   Brave. On a new Mac, the first `git` or `python3` may ask to install the
   developer tools: tell the user to click **Install**, then run it again.
2. **Download.** If you are not already inside the repository:
   ```bash
   git clone https://github.com/laxmideepak/Still-Green.git
   cd Still-Green
   ```
3. **Start.** `./sg-local web --daemon --open`
   The first run makes a private `.venv` folder and installs the locked
   packages from `requirements.lock` (about a minute, needs the internet
   once). It then starts in the background and opens the control page at
   <http://127.0.0.1:8765>. If setup fails, read `.venv-setup.log` and explain it.
4. **Check.** `./sg-local doctor`. Explain each line that is not OK, using its
   own "What to do" text.
5. **Add Slack (the user does this).** You cannot do this step. Guide the user:
   1. Open `chrome://extensions` and turn on **Developer mode** (top right).
   2. Click **Load unpacked** and choose the `extension` folder inside `Still-Green`.
   3. Click the Stillgreen icon in the toolbar. Leave the address as
      `http://127.0.0.1:8765` and paste the **access code** shown on the
      control page.
   4. Sign in at <https://app.slack.com> in the same Chrome window, then click
      **Capture from Slack** and read the notice.
6. **Confirm.** `./sg-local doctor --check-tokens` and `./sg-local status`.
   **Presence confirmed** turns green about a minute after Slack is added.

Optional, only if the user asks:
- Start at login on macOS: `./sg-local install-launchd`
- Type `sg-local` from any folder: `./install.sh`
- Online dashboard: <https://stillgreen.vercel.app/dashboard>, then **Connect
  Stillgreen** with the same address and access code.
- Always on, in the cloud: follow the README section "Run it in the cloud
  (advanced)". Do not invent your own server setup.

Useful later: `./sg-local stop`, `./sg-local logs -f`,
`./sg-local web --show-code` (the user runs this to see the access code again),
`./sg-local uninstall` (asks first; deletes settings and saved logins).

### Safety rules (always)

- **Never ask for, read, print or repeat** the Slack token (`xoxc-...`), the
  Slack `d` cookie (`xoxd-...`) or the access code (`SG-...`). Do not open
  `~/.config/slack-green-local/` or other settings files to look for them. Do not run
  `./sg-local web --show-code` yourself; tell the user to run it.
- Never ask the user to paste a token or cookie into the chat. Slack is added
  with the extension, or with `./sg-local add`, which the user runs in their
  own terminal (its input is hidden). If a token is pasted by mistake, tell the
  user to sign out of Slack's other sessions so it stops working.
- Do not use `sudo`, do not install packages system-wide or with `pip` outside
  `.venv`, and do not change `requirements.lock`.
- Never turn off certificate (TLS) checks, set `PYTHONHTTPSVERIFY=0` or use
  `--insecure`. On a company network, see the README troubleshooting entry
  "Security certificate not trusted".
- Remind the user once: use Stillgreen only on Slack workspaces where they are
  allowed to; their employer's rules may not allow it.

## Changing the code

Run the checks that match what you changed:

```bash
python3 -m pytest -q          # Python (needs the packages in requirements.lock)
npx tsc --noEmit              # TypeScript
npm run test:unit             # JavaScript unit tests
npm run test:e2e              # build + browser tests (needs the Python packages)
```

- Python must keep working on 3.9: a fresh Mac's `python3` is 3.9.
- The design tokens and plain-CSS UI layer are copied in several places;
  `tests/test_design_tokens.py` keeps them the same. Change all copies together.
- UI components and their rules are documented in `docs/design-system.md`.
- `lib/ai-setup.ts` holds the AI setup prompt. The README has a copy;
  `tests/test_ai_setup.py` keeps them the same.
