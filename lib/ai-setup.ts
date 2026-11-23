/**
 * The prompt people paste into an AI assistant (Claude Code, Cursor, Codex,
 * ChatGPT, Claude) to get help setting up Stillgreen. Shown with a copy button
 * on /setup and copied into README.md; tests/test_ai_setup.py keeps the two the
 * same. The full rules for coding assistants are in AGENTS.md.
 */
export const AI_SETUP_PROMPT = `Help me set up Stillgreen (https://github.com/laxmideepak/Still-Green) on this computer. It is open source and runs only on my computer.

If you can run terminal commands, run the steps yourself and tell me in one line what each command does first. If you cannot, give me one command at a time, wait for me to paste the output, then tell me the next step. Use plain, simple words.

Steps:
1. Check that this is macOS or Linux, that git works, and that "python3 --version" is 3.9 or newer.
2. git clone https://github.com/laxmideepak/Still-Green.git && cd Still-Green
3. ./sg-local web --daemon --open  (the first run sets itself up in about a minute)
4. ./sg-local doctor  (explain anything that is not OK, and how to fix it)
5. Walk me through adding Slack with the Stillgreen Chrome extension: open chrome://extensions, turn on Developer mode, click Load unpacked and choose the "extension" folder inside Still-Green, paste the access code shown on the control page at http://127.0.0.1:8765, sign in at https://app.slack.com, then click Capture from Slack. I do this part myself.
6. ./sg-local doctor --check-tokens  (confirm everything is OK)

Rules:
- Never ask me for my Slack token (xoxc-...), my Slack "d" cookie (xoxd-...) or my access code, and never ask me to paste them into this chat. If I paste one by mistake, tell me to sign out of Slack's other sessions so it stops working.
- Do not use sudo, do not install anything outside the Still-Green folder, and never turn off certificate (TLS) checks.
- If something fails, read the error message (and .venv-setup.log if setup failed) and explain it before you try something else.
- If the repository has an AGENTS.md file, follow it.`;
