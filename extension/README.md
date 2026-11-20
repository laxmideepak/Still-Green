# Stillgreen capture extension

A small Chrome extension that fills in the two values Stillgreen needs by
reading the Slack session already open in your browser:

| Value | Where it comes from | Why it needs an extension |
| --- | --- | --- |
| `xoxc` token | `localStorage.localConfig_v2` (fallback: `window.boot_data`) | Page JavaScript can read this. |
| `xoxd` cookie | the `d` cookie on `slack.com` | The cookie is `HttpOnly`, so `document.cookie` never sees it. Only an extension with the `cookies` permission can read it. |

Together these two values let anyone who has them act as you in Slack, like
being signed in. Treat them like a password.

It posts both values to a daemon URL you enter — normally
`http://127.0.0.1:8765`. There is no other network destination in the code.
The worker refuses to send anything unless that URL is plain `http://` on this
machine (`127.0.0.1`, `localhost` or `[::1]`) or `https://` on another host,
and it never sends to a URL that contains a username or password.

## Install

1. Start the daemon (it also serves the control page on
   `http://127.0.0.1:8765`):

   ```sh
   ./sg-local start
   ```

2. Open `chrome://extensions`, enable **Developer mode**, choose **Load
   unpacked**, and select this `extension/` folder.
3. Pin the extension, open the popup.
4. Set **Stillgreen address** to `http://127.0.0.1:8765` and paste the access code
   (`./sg-local web --show-code`).
5. Sign in at <https://app.slack.com> in the same browser profile, then press
   **Capture from Slack**.
6. The first time, the popup shows what it reads, what that allows, where it
   goes, where it is kept and how to remove it. Read it and click
   **I understand, continue** (or **Cancel**; nothing is read then).

Every workspace signed in to that Slack tab is added in one pass.

If the popup says no Slack token was found, newer Slack builds may not expose it
to the extension. Add the workspace by hand instead: open
`http://127.0.0.1:8765/#add`, or run `./sg-local add` and paste the two values
(see <https://stillgreen.vercel.app/setup#tokens>).

## Consent

Nothing is read from Slack until you agree to the notice in the popup. The
answer is saved in `chrome.storage.local` as
`consent: { version, origin, acceptedAt }`, where `origin` is the Stillgreen
address the notice named (for example `http://127.0.0.1:8765`). The service
worker (`background.js`) refuses to capture when that is missing, older than
`CONSENT_VERSION`, or for a different address than the one set now, so a
changed notice or a new address (for example a cloud server) is shown again. When you
change the notice text in `popup.html`, bump `CONSENT_VERSION` in both
`popup.js` and `background.js`.

Slack does not officially support keeping you active, and your employer may
not allow it. See the [privacy policy](../docs/privacy.md) and the
[threat model](../docs/threat-model.md).

## Permissions, honestly

| Permission | Used for |
| --- | --- |
| `cookies` | Read the `d` cookie for `slack.com`. Nothing else. |
| `scripting` | Run one function inside the Slack tab to read its localStorage. |
| `storage` | Remember the daemon URL, the access code and your consent. |
| host `https://*.slack.com/*` | Find the open Slack tab and do the capture. |
| host `http://127.0.0.1/*`, `http://localhost/*` | Talking to your daemon. |

There is no `tabs` permission: the extension only looks up Slack tabs, which
the Slack host permission already covers.

## What it does not do

- No analytics, no remote code, no `eval`, no bundled third-party scripts.
- No cookies other than `d`, and no reading of any site other than Slack.
- No storage of the token itself — the token goes straight to the daemon and is
  never written to `chrome.storage`.
- No background polling. The service worker only runs when you press a button.

## Uninstall

Removing the extension from `chrome://extensions` deletes its stored daemon URL,
access code and consent. Tokens already added to the daemon stay there until you
remove the workspace (or run `./sg-local remove NAME`). Then, in Slack, go to
Settings and click **Sign out of all other sessions** to end the session.
