// Stillgreen capture worker.
//
// Runs only when the toolbar popup asks it to. It reads two values that already
// exist in your own browser — the Slack web session token (xoxc) and the `d`
// cookie (xoxd) — and posts them to the Stillgreen daemon you configured.
//
// There is no network destination other than that daemon.

const DEFAULT_DAEMON = "http://127.0.0.1:8765";
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
    return "The daemon URL is not a valid URL.";
  }
  if (url.username || url.password) {
    return "The daemon URL must not contain a username or password.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The daemon URL must start with http:// or https://.";
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

async function settings() {
  const stored = await chrome.storage.local.get({
    daemonUrl: DEFAULT_DAEMON,
    bridgeCode: "",
  });
  const daemonUrl = String(stored.daemonUrl || DEFAULT_DAEMON).trim().replace(/\/+$/, "");
  return {
    daemonUrl,
    urlProblem: daemonUrlProblem(daemonUrl),
    bridgeCode: normalizeCode(stored.bridgeCode),
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
    return {
      ok: false,
      team: team.name,
      error: `Could not reach ${daemonUrl}. Start the daemon with ./sg-local start.`,
    };
  }

  if (response.status === 401) {
    return { ok: false, team: team.name, error: "The access code was rejected." };
  }
  if (response.status === 403) {
    return {
      ok: false,
      team: team.name,
      error: "The daemon refuses this extension origin. Start it with SG_LOCAL_ALLOW_EXTENSIONS=1.",
    };
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      team: team.name,
      error: payload.error || `The daemon returned ${response.status}.`,
    };
  }

  return { ok: true, team: payload.name || team.name, teamId: payload.team_id || team.teamId };
}

async function capture() {
  const { daemonUrl, urlProblem, bridgeCode } = await settings();
  if (urlProblem) {
    return { ok: false, error: urlProblem };
  }
  if (!bridgeCode) {
    return { ok: false, error: "Add your daemon access code first." };
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

  // One at a time: the daemon rewrites its config file on each add.
  const workspaces = [];
  for (const team of session.teams) {
    workspaces.push(await postWorkspace(daemonUrl, bridgeCode, { ...team, cookie }));
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
    return { ok: false, daemonUrl, error: "unreachable" };
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
