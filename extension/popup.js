const DEFAULT_DAEMON = "http://127.0.0.1:8765";

const daemonInput = document.getElementById("daemonUrl");
const codeInput = document.getElementById("bridgeCode");
const captureButton = document.getElementById("capture");
const results = document.getElementById("results");
const status = document.getElementById("status");
const hint = document.getElementById("hint");

function setStatus(kind, text) {
  status.className = `status ${
    kind === "live" ? "statusLive" : kind === "down" ? "statusDown" : "statusIdle"
  }`;
  status.textContent = text;
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_DAEMON;
  return trimmed.replace(/\/+$/, "");
}

async function persist() {
  await chrome.storage.local.set({
    daemonUrl: normalizeUrl(daemonInput.value),
    bridgeCode: codeInput.value.trim(),
  });
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
  if (response && response.ok) {
    setStatus("live", response.daemon ? "Daemon running" : "Reachable");
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
  await checkDaemon();
}

daemonInput.addEventListener("change", () => {
  daemonInput.value = normalizeUrl(daemonInput.value);
  persist().then(checkDaemon);
});

codeInput.addEventListener("input", () => {
  persist();
});

captureButton.addEventListener("click", async () => {
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
        hint.textContent =
          "Done. Open the dashboard — the daemon will pick up the workspace on its next tick.";
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
