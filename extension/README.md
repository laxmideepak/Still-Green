# Stillgreen capture extension

A ~300-line Chrome extension that fills in the two values Stillgreen needs by
reading the Slack session already open in your browser:

| Value | Where it comes from | Why it needs an extension |
| --- | --- | --- |
| `xoxc` token | `localStorage.localConfig_v2` (fallback: `window.boot_data`) | Page JavaScript can read this. |
| `xoxd` cookie | the `d` cookie on `slack.com` | The cookie is `HttpOnly`, so `document.cookie` never sees it. Only an extension with the `cookies` permission can read it. |

It posts both values to a daemon URL you enter — normally
`http://127.0.0.1:8765`. There is no other network destination in the code.

## Install

1. Start the daemon and its control surface:

   ```sh
   ./sg-local web --daemon
   ```

2. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select this `extension/` folder.
3. Pin the extension, open the popup.
4. Set **Daemon URL** to `http://127.0.0.1:8765` and paste the access code
   (`./sg-local web --show-code`).
5. Sign in at <https://app.slack.com> in the same browser profile, then press
   **Capture from Slack**.

Every workspace signed in to that Slack tab is added in one pass.

## Permissions, honestly

| Permission | Used for |
| --- | --- |
| `cookies` | Read the `d` cookie for `slack.com`. Nothing else. |
| `scripting` | Run one function inside the Slack tab to read its localStorage. |
| `tabs` | Find an open Slack tab. |
| `storage` | Remember the daemon URL and access code. |
| host `https://*.slack.com/*` | The capture itself. |
| host `http://127.0.0.1/*`, `http://localhost/*` | Talking to your daemon. |
| optional `https://*/*` | Only if you point the extension at a non-local daemon. |

## What it does not do

- No analytics, no remote code, no `eval`, no bundled third-party scripts.
- No cookies other than `d`, and no reading of any site other than Slack.
- No storage of the token itself — the token goes straight to the daemon and is
  never written to `chrome.storage`.
- No background polling. The service worker only runs when you press a button.

## Uninstall

Removing the extension from `chrome://extensions` deletes its stored daemon URL
and access code. Tokens already added to the daemon stay there until you run
`./sg-local remove NAME`.
