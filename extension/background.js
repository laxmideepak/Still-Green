// Stillgreen capture worker.
//
// Runs only when the toolbar popup asks it to. It reads two values that already
// exist in your own browser — the Slack web session token (xoxc) and the `d`
// cookie (xoxd) — and posts them to the Stillgreen daemon you configured.
//
// There is no network destination other than that daemon.

const DEFAULT_DAEMON = "http://127.0.0.1:8765";
// Bump when the consent notice in popup.html changes; everyone is asked again.
// Keep in sync with CONSENT_VERSION in popup.js.
const CONSENT_VERSION = 1;
const SLACK_URLS = ["https://app.slack.com/*", "https://*.slack.com/*"];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// This worker is the trust boundary: it is the only code that sends the Slack
// session anywhere. Plain http is allowed only to this machine; any other host
// must use https, and credentials in the URL are refused.
// Keep in sync with daemonUrlProblem() in popup.js.
function daemonUrlProblem(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "The Stillgreen address is not a valid web address.";
  }
  if (url.username || url.password) {
    return "The Stillgreen address must not contain a username or password.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The Stillgreen address must start with http:// or https://.";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return "Refusing to send your Slack session over plain http to another machine. Use http://127.0.0.1:8765 or an https:// URL.";
}

// Codes pasted from chat or docs often carry smart dashes, spaces or lowercase.
function normalizeCode(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// Consent is for one notice version and one destination: the notice names
// the Stillgreen address the login goes to, so a new address needs a new OK.
// Keep in sync with consentFits() in popup.js.
function consentFits(consent, daemonUrl) {
  const origin = originOf(daemonUrl);
  return Boolean(
    consent && consent.version === CONSENT_VERSION && origin && consent.origin === origin,
  );
}

async function settings() {
  const stored = await chrome.storage.local.get({
    daemonUrl: DEFAULT_DAEMON,
    bridgeCode: "",
    consent: null,
  });
  const daemonUrl = String(stored.daemonUrl || DEFAULT_DAEMON).trim().replace(/\/+$/, "");
  return {
    daemonUrl,
    urlProblem: daemonUrlProblem(daemonUrl),
    bridgeCode: normalizeCode(stored.bridgeCode),
    consented: consentFits(stored.consent, daemonUrl),
    consentedElsewhere: Boolean(stored.consent && stored.consent.version === CONSENT_VERSION),
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLoopback(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Why a request to Stillgreen got no answer, in plain words. The browser
// hides the real reason (nothing listening, an untrusted certificate, a
// blocked request all look the same), so the hint fits the kind of address.
function unreachable(daemonUrl) {
  if (isLoopback(daemonUrl)) {
    return {
      error: `Stillgreen is not running at ${hostOf(daemonUrl)}.`,
      next: "Start it with ./sg-local web --daemon --open, or check the address.",
    };
  }
  return {
    error: `Can't make a secure connection to ${hostOf(daemonUrl)}.`,
    next:
      "The server did not answer, or Chrome does not trust its certificate. Open the address in a tab to check. Don't click past a certificate warning.",
  };
}

// A refused capture, in plain words: { error, next }.
function refusal(status, payload) {
  const info = payload && typeof payload.error_info === "object" ? payload.error_info : null;
  if (info && info.title) {
    return { error: `${info.title}. ${info.message || ""}`.trim(), next: String(info.action || "") };
  }
  const text = String((payload && payload.error) || "");
  if (status === 401) {
    return {
      error: "The access code was not accepted.",
      next: "Copy it again from the control page, or run ./sg-local web --show-code.",
    };
  }
  if (status === 403) {
    return {
      error: "Stillgreen refuses this extension.",
      next: "Start it with SG_LOCAL_ALLOW_EXTENSIONS=1.",
    };
  }
  if (status === 421) {
    return {
      error: "Stillgreen doesn't know this address.",
      next: "Use the address Stillgreen showed when it started.",
    };
  }
  if (status === 429) {
    return {
      error: "Too many wrong access codes.",
      next: "Wait one minute, then try again with the right code.",
    };
  }
  if (/rejected these tokens|invalid_auth|not_authed|token_revoked|account_inactive/i.test(text)) {
    return {
      error: "Slack didn't accept this login.",
      next: "Reload app.slack.com, make sure you're signed in, then capture again.",
    };
  }
  if (/certificate|CERTIFICATE_VERIFY|SSL|TLS/i.test(text)) {
    return {
      error: "Stillgreen couldn't make a secure connection to Slack.",
      next: "Your network may use its own certificate. Use Check my setup on the dashboard, or run ./sg-local doctor.",
    };
  }
  if (/timed out|timeout/i.test(text)) {
    return {
      error: "Slack took too long to answer Stillgreen.",
      next: "Check the internet connection where Stillgreen runs, then try again.",
    };
  }
  if (/name or service|nodename|getaddrinfo|resolve|unreachable|connection refused/i.test(text)) {
    return {
      error: "Stillgreen couldn't reach Slack.",
      next: "Check the internet connection where Stillgreen runs. Use Check my setup on the dashboard.",
    };
  }
  if (/rate.?limit|ratelimited|429/i.test(text)) {
    return {
      error: "Slack asked Stillgreen to slow down.",
      next: "Wait a minute, then try again.",
    };
  }
  return {
    error: text ? `Stillgreen said: ${text}` : `Stillgreen returned an error (${status}).`,
    next: status >= 500 ? "Try again. If it keeps happening, run ./sg-local doctor." : "",
  };
}

// Runs inside the Slack page (MAIN world) so it can read page globals.
// Must be self-contained: Chrome serializes this function.
function readSlackSession() {
  const teams = [];
  let source = null;

  try {
    const raw = window.localStorage.getItem("localConfig_v2");
    if (raw) {
      const parsed = JSON.parse(raw);
      const entries = parsed && parsed.teams ? parsed.teams : {};
      for (const [id, team] of Object.entries(entries)) {
        if (!team || typeof team.token !== "string") continue;
        if (!team.token.startsWith("xoxc-")) continue;
        teams.push({
          teamId: String(team.id || id),
          name: String(team.name || team.domain || id),
          domain: team.domain ? String(team.domain) : null,
          token: team.token,
        });
      }
      if (teams.length) source = "localConfig_v2";
    }
  } catch {
    // Ignore a malformed or absent entry and fall through.
  }

  if (!teams.length) {
    const boot = window.boot_data;
    if (boot && typeof boot.api_token === "string" && boot.api_token.startsWith("xoxc-")) {
      teams.push({
        teamId: String(boot.team_id || "unknown"),
        name: String(boot.team_name || boot.team_domain || "Slack workspace"),
        domain: boot.team_domain ? String(boot.team_domain) : null,
        token: boot.api_token,
      });
      source = "boot_data";
    }
  }

  return { teams, source, href: window.location.href };
}

async function findSlackTab() {
  const tabs = await chrome.tabs.query({ url: SLACK_URLS });
  if (!tabs.length) return null;
  // Prefer a tab that is already on a client route; any Slack tab will do.
  const client = tabs.find((tab) => (tab.url || "").includes("/client/"));
  return client || tabs[0];
}

async function readCookie(domain) {
  const urls = ["https://app.slack.com"];
  if (domain) urls.push(`https://${domain}.slack.com`);

  for (const url of urls) {
    const cookies = await chrome.cookies.getAll({ url });
    const match = cookies.find(
      (cookie) => cookie.name === "d" && cookie.value.startsWith("xoxd-"),
    );
    if (match) return match.value;
  }

  const fallback = await chrome.cookies.getAll({ domain: "slack.com" });
  const match = fallback.find(
    (cookie) => cookie.name === "d" && cookie.value.startsWith("xoxd-"),
  );
  return match ? match.value : null;
}

async function postWorkspace(daemonUrl, bridgeCode, team) {
  let response;
  try {
    response = await fetch(`${daemonUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bridgeCode}`,
      },
      body: JSON.stringify({
        xoxc: team.token,
        xoxd: team.cookie,
        name: team.name,
      }),
    });
  } catch {
    return { ok: false, team: team.name, ...unreachable(daemonUrl) };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    return { ok: false, team: team.name, status: response.status, ...refusal(response.status, payload) };
  }

  return { ok: true, team: payload.name || team.name, teamId: payload.team_id || team.teamId };
}

async function capture() {
  const { daemonUrl, urlProblem, bridgeCode, consented, consentedElsewhere } = await settings();
  if (urlProblem) {
    return { ok: false, error: urlProblem };
  }
  // Nothing is read from Slack until the person has agreed to the notice
  // for this exact Stillgreen address.
  if (!consented) {
    return {
      ok: false,
      code: "consent_required",
      error: consentedElsewhere
        ? `Nothing was captured. The Stillgreen address changed to ${hostOf(daemonUrl)}. Read the notice in the Stillgreen popup and agree to it for the new address first.`
        : "Nothing was captured. Read the notice in the Stillgreen popup and agree to it first.",
    };
  }
  if (!bridgeCode) {
    return { ok: false, error: "Paste your access code first." };
  }

  const tab = await findSlackTab();
  if (!tab) {
    return {
      ok: false,
      error: "Open app.slack.com, sign in, then try again.",
    };
  }

  let session;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: readSlackSession,
    });
    session = result && result.result;
  } catch {
    return { ok: false, error: "Could not read the Slack tab. Reload app.slack.com and retry." };
  }

  if (!session || !session.teams || !session.teams.length) {
    return {
      ok: false,
      error:
        "No Slack token found in this tab. Newer Slack builds may not expose it to the " +
        `extension. Add the workspace by hand on ${daemonUrl}/#add or with ./sg-local add ` +
        "(see stillgreen.vercel.app/setup#tokens).",
    };
  }

  const cookie = await readCookie(session.teams[0].domain);
  if (!cookie) {
    return {
      ok: false,
      error: "The `d` cookie was not found. Sign in to Slack in this browser profile.",
    };
  }

  // One at a time: the daemon rewrites its config file on each add. Stop
  // after a refusal that would fail the same way for every workspace.
  const workspaces = [];
  for (const team of session.teams) {
    const result = await postWorkspace(daemonUrl, bridgeCode, { ...team, cookie });
    workspaces.push(result);
    if (!result.ok && (result.status === undefined || [401, 403, 421, 429].includes(result.status))) {
      return { ok: false, error: `${result.error} ${result.next || ""}`.trim(), codeRejected: result.status === 401 };
    }
  }

  return {
    ok: workspaces.some((item) => item.ok),
    source: session.source,
    workspaces,
  };
}

async function ping() {
  const { daemonUrl, urlProblem } = await settings();
  if (urlProblem) {
    return { ok: false, daemonUrl, error: urlProblem };
  }
  try {
    const response = await fetch(`${daemonUrl}/api/health`, { cache: "no-store" });
    const body = await response.json();
    return { ok: response.ok && body.app === "stillgreen", daemonUrl, daemon: !!body.daemon };
  } catch {
    return { ok: false, daemonUrl, error: "unreachable", hint: unreachable(daemonUrl) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "capture") {
    capture().then(sendResponse);
    return true;
  }
  if (message && message.type === "ping") {
    ping().then(sendResponse);
    return true;
  }
  return false;
});
