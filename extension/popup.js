const DEFAULT_DAEMON = "http://127.0.0.1:8765";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
let daemonRunning = false;

const daemonInput = document.getElementById("daemonUrl");
const codeInput = document.getElementById("bridgeCode");
const captureButton = document.getElementById("capture");
const results = document.getElementById("results");
const status = document.getElementById("status");
const hint = document.getElementById("hint");
const target = document.getElementById("target");

function setStatus(kind, text) {
  status.className = `status ${
    kind === "live"
      ? "statusLive"
      : kind === "down"
        ? "statusDown"
        : kind === "warn"
          ? "statusWarn"
          : "statusIdle"
  }`;
  status.textContent = text;
}

// Scheme-less loopback addresses get http://, anything else https://.
function normalizeUrl(value) {
  let trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_DAEMON;
  if (!/^https?:\/\//i.test(trimmed)) {
    const loopback = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d*)?(?:[/?#]|$)/i.test(trimmed);
    trimmed = `${loopback ? "http" : "https"}://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, "");
}

// Mirrors the check in background.js, which is the one that is enforced.
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
  return "Plain http is only allowed to this machine. Use http://127.0.0.1:8765 or an https:// URL.";
}

function normalizeCode(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

async function persist() {
  await chrome.storage.local.set({
    daemonUrl: normalizeUrl(daemonInput.value),
    bridgeCode: normalizeCode(codeInput.value),
  });
}

function showDestination() {
  const url = normalizeUrl(daemonInput.value);
  const problem = daemonUrlProblem(url);
  if (problem) {
    renderMessage("bad", problem);
    return false;
  }
  return true;
}

function renderItems(items) {
  results.innerHTML = "";
  results.hidden = false;

  for (const item of items) {
    const row = document.createElement("div");
    row.className = `result ${item.ok ? "ok" : "bad"}`;

    const glyph = document.createElement("div");
    glyph.className = "glyph";
    glyph.textContent = item.ok ? "✓" : "!";

    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.team || "Workspace";
    const detail = document.createElement("span");
    detail.textContent = item.ok ? "Added to your daemon" : item.error;

    body.append(title, detail);
    row.append(glyph, body);
    results.append(row);
  }
}

function renderMessage(kind, text) {
  results.innerHTML = "";
  results.hidden = false;
  const box = document.createElement("div");
  box.className = `message ${kind}`;
  box.textContent = text;
  results.append(box);
}

async function checkDaemon() {
  setStatus("idle", "Checking…");
  const response = await chrome.runtime.sendMessage({ type: "ping" });
  daemonRunning = Boolean(response && response.ok && response.daemon);
  if (response && response.ok) {
    if (response.daemon) setStatus("live", "Daemon running");
    else setStatus("warn", "Daemon stopped: run ./sg-local start");
  } else {
    setStatus("down", "Not reachable");
  }
}

async function load() {
  const stored = await chrome.storage.local.get({
    daemonUrl: DEFAULT_DAEMON,
    bridgeCode: "",
  });
  daemonInput.value = stored.daemonUrl || DEFAULT_DAEMON;
  codeInput.value = stored.bridgeCode || "";
  updateTarget();
  await checkDaemon();
}

function updateTarget() {
  let host = "";
  try {
    host = new URL(normalizeUrl(daemonInput.value)).host;
  } catch {
    host = "";
  }
  target.textContent = host ? `Sends only to ${host}` : "";
}

daemonInput.addEventListener("change", () => {
  daemonInput.value = normalizeUrl(daemonInput.value);
  updateTarget();
  if (!showDestination()) return;
  results.hidden = true;
  persist().then(checkDaemon);
});

codeInput.addEventListener("input", () => {
  persist();
});

captureButton.addEventListener("click", async () => {
  daemonInput.value = normalizeUrl(daemonInput.value);
  updateTarget();
  if (!showDestination()) return;
  await persist();
  captureButton.disabled = true;
  const original = captureButton.firstChild.textContent;
  captureButton.firstChild.textContent = "Reading Slack… ";
  results.hidden = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: "capture" });

    if (!result || (!result.workspaces && !result.error)) {
      renderMessage("bad", "No response from the extension worker. Reopen the popup.");
    } else if (result.error) {
      renderMessage("bad", result.error);
    } else {
      renderItems(result.workspaces);
      if (result.ok) {
        hint.textContent = daemonRunning
          ? "Done. Open the dashboard — the daemon will pick up the workspace on its next tick."
          : "Saved. Start the daemon with ./sg-local start to bring it online.";
      }
    }
  } catch {
    renderMessage("bad", "The capture failed. Open app.slack.com and try again.");
  } finally {
    captureButton.firstChild.textContent = original;
    captureButton.disabled = false;
    checkDaemon();
  }
});

load();
