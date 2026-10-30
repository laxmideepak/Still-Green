// Stillgreen capture worker.
//
// Runs only when the toolbar popup asks it to. It reads two values that already
// exist in your own browser — the Slack web session token (xoxc) and the `d`
// cookie (xoxd) — and posts them to the Stillgreen daemon you configured.
//
// There is no network destination other than that daemon.

const DEFAULT_DAEMON = "http://127.0.0.1:8765";
const SLACK_URLS = ["https://app.slack.com/*", "https://*.slack.com/*"];

async function settings() {
  const stored = await chrome.storage.local.get({
    daemonUrl: DEFAULT_DAEMON,
    bridgeCode: "",
  });
  return {
    daemonUrl: String(stored.daemonUrl || DEFAULT_DAEMON).trim().replace(/\/+$/, ""),
    bridgeCode: String(stored.bridgeCode || "").trim(),
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
      error: `Could not reach ${daemonUrl}. Is the daemon running?`,
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
  const { daemonUrl, bridgeCode } = await settings();
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
        "No Slack token found in this tab. Reload app.slack.com while signed in, then retry.",
    };
  }

  const cookie = await readCookie(session.teams[0].domain);
  if (!cookie) {
    return {
      ok: false,
      error: "The `d` cookie was not found. Sign in to Slack in this browser profile.",
    };
  }

  const workspaces = await Promise.all(
    session.teams.map((team) => postWorkspace(daemonUrl, bridgeCode, { ...team, cookie })),
  );

  return {
    ok: workspaces.some((item) => item.ok),
    source: session.source,
    workspaces,
  };
}

async function ping() {
  const { daemonUrl } = await settings();
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
