const DEFAULT_DAEMON = "http://127.0.0.1:8765";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SVG_NS = "http://www.w3.org/2000/svg";
let daemonRunning = false;
// Only one problem shows at a time: once a capture fails, its message is the
// one on screen until something changes.
let captureError = false;
const START_COMMAND = "./sg-local web --daemon --open";

const daemonInput = document.getElementById("daemonUrl");
const codeInput = document.getElementById("bridgeCode");
const codeToggle = document.getElementById("toggleCode");
const captureButton = document.getElementById("capture");
const captureLabel = document.getElementById("captureLabel");
const results = document.getElementById("results");
const status = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusNote = document.getElementById("statusNote");
const statusNoteTitle = document.getElementById("statusNoteTitle");
const statusNoteText = document.getElementById("statusNoteText");
const hint = document.getElementById("hint");
const target = document.getElementById("target");

// Line icons (paths copied from components/icons.tsx).
const ICONS = {
  check: ["m4 12.5 5 5L20 6.5"],
  alert: ["M12 7.5v5M12 16h.01", { circle: [12, 12, 9] }],
  lock: [{ rect: [4, 10, 16, 11, 3] }, "M8 10V7a4 4 0 0 1 8 0v3"],
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const part of ICONS[name]) {
    let node;
    if (typeof part === "string") {
      node = document.createElementNS(SVG_NS, "path");
      node.setAttribute("d", part);
    } else if (part.circle) {
      node = document.createElementNS(SVG_NS, "circle");
      const [cx, cy, r] = part.circle;
      node.setAttribute("cx", cx);
      node.setAttribute("cy", cy);
      node.setAttribute("r", r);
    } else {
      node = document.createElementNS(SVG_NS, "rect");
      const [x, y, width, height, rx] = part.rect;
      node.setAttribute("x", x);
      node.setAttribute("y", y);
      node.setAttribute("width", width);
      node.setAttribute("height", height);
      node.setAttribute("rx", rx);
    }
    svg.append(node);
  }
  return svg;
}

// Fill an element from text parts; a part wrapped as { code } becomes <code>.
function fill(element, parts) {
  element.textContent = "";
  for (const part of parts) {
    if (typeof part === "string") {
      element.append(part);
    } else {
      const code = document.createElement("code");
      code.textContent = part.code;
      element.append(code);
    }
  }
}

const STATUS_TONES = {
  live: "badge-success",
  warn: "badge-warning",
  down: "badge-danger",
  idle: "badge-neutral",
};

function setStatus(kind, text) {
  status.className = `badge ${STATUS_TONES[kind] || STATUS_TONES.idle}`;
  status.dataset.state = kind;
  statusText.textContent = text;
}

function setStatusNote(tone, title, parts) {
  if (!tone || captureError) {
    statusNote.hidden = true;
    return;
  }
  statusNote.className = `banner banner-${tone} status-note`;
  statusNoteTitle.textContent = title;
  fill(statusNoteText, parts);
  statusNote.hidden = false;
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
  return "Plain http is only allowed to this machine. Use http://127.0.0.1:8765 or an https:// URL.";
}

function normalizeCode(value) {
  return String(value || "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function currentHost() {
  try {
    return new URL(normalizeUrl(daemonInput.value)).host;
  } catch {
    return "";
  }
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
    daemonInput.setAttribute("aria-invalid", "true");
    showCaptureError(problem);
    return false;
  }
  daemonInput.removeAttribute("aria-invalid");
  return true;
}

// A plain next step for the errors people can fix themselves.
function nextStep(error) {
  const text = String(error || "");
  if (/access code was rejected/i.test(text)) {
    return "Check the access code. Run ./sg-local web --show-code to see it.";
  }
  if (/rejected these tokens|invalid_auth|not_authed|token_revoked/i.test(text)) {
    return "Reload app.slack.com, make sure you're signed in, then capture again.";
  }
  return "";
}

function renderItems(items) {
  results.textContent = "";
  results.className = "results";
  results.hidden = false;

  const list = document.createElement("ul");
  list.className = "result-list";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = `result ${item.ok ? "ok" : "bad"}`;

    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.append(icon(item.ok ? "check" : "alert"));

    const body = document.createElement("div");
    body.className = "result-body";
    const title = document.createElement("strong");
    title.textContent = item.team || "Workspace";
    const detail = document.createElement("span");
    detail.className = "result-detail";
    detail.textContent = item.ok ? "Added to Stillgreen" : item.error;
    body.append(title, detail);

    const step = item.ok ? "" : nextStep(item.error);
    if (step) {
      const next = document.createElement("span");
      next.className = "result-next";
      next.textContent = step;
      body.append(next);
    }

    const label = document.createElement("span");
    label.className = "visually-hidden";
    label.textContent = item.ok ? "Added: " : "Not added: ";
    row.append(glyph, label, body);
    list.append(row);
  }
  results.append(list);
}

function renderMessage(kind, text) {
  results.textContent = "";
  results.className = "results results-message";
  results.hidden = false;
  const box = document.createElement("div");
  box.className = `banner ${kind === "bad" ? "banner-danger" : "banner-success"} message ${kind}`;
  box.setAttribute("role", kind === "bad" ? "alert" : "status");
  const words = document.createElement("p");
  words.className = "banner-description";
  words.textContent = text;
  box.append(icon(kind === "bad" ? "alert" : "check"), words);
  results.append(box);
}

// Returns true when Stillgreen answered at the saved address.
async function checkDaemon() {
  // Nothing set up yet: a calm, neutral state, not an error.
  if (!normalizeCode(codeInput.value)) {
    setStatus("idle", "Not connected yet");
    setStatusNote(null);
    return false;
  }
  setStatus("idle", "Checking…");
  const response = await chrome.runtime.sendMessage({ type: "ping" });
  daemonRunning = Boolean(response && response.ok && response.daemon);
  const host = currentHost() || "Stillgreen";
  if (response && response.ok) {
    if (response.daemon) {
      setStatus("live", "Stillgreen running");
      setStatusNote(null);
    } else {
      setStatus("warn", "Stillgreen stopped");
      setStatusNote("warning", "Stillgreen is stopped", [
        "It won't keep you green until you run ",
        { code: "./sg-local start" },
        ". You can still add workspaces now.",
      ]);
    }
    return true;
  }
  setStatus("down", "Can't connect");
  const problem = response && response.error && response.error !== "unreachable" ? response.error : "";
  setStatusNote(
    "danger",
    `Can't reach ${host}`,
    problem ? [problem] : ["Check the address below, or start Stillgreen with ", { code: START_COMMAND }, "."],
  );
  return false;
}

// The capture's own problem replaces the banner at the top and the hint.
function showCaptureError(text) {
  captureError = true;
  statusNote.hidden = true;
  hint.hidden = true;
  renderMessage("bad", text);
}

function clearCaptureError() {
  captureError = false;
  hint.hidden = false;
}

function updateTarget() {
  const host = currentHost();
  target.textContent = "";
  if (!host) return;
  const where = document.createElement("span");
  where.className = "mono";
  where.textContent = host;
  target.append(icon("lock"), "Your Slack login goes only to ", where);
}

function setBusy(busy) {
  captureButton.disabled = busy;
  captureButton.classList.toggle("is-loading", busy);
  if (busy) {
    captureButton.setAttribute("aria-busy", "true");
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    captureButton.prepend(spinner);
    captureLabel.textContent = "Reading Slack…";
  } else {
    captureButton.removeAttribute("aria-busy");
    captureButton.querySelector(".spinner")?.remove();
    captureLabel.textContent = "Capture from Slack";
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

codeToggle.addEventListener("click", () => {
  const show = codeInput.type === "password";
  codeInput.type = show ? "text" : "password";
  codeToggle.setAttribute("aria-pressed", String(show));
  codeToggle.title = show ? "Hide code" : "Show code";
});

daemonInput.addEventListener("input", () => {
  daemonInput.removeAttribute("aria-invalid");
  clearCaptureError();
});

daemonInput.addEventListener("change", () => {
  daemonInput.value = normalizeUrl(daemonInput.value);
  updateTarget();
  if (!showDestination()) return;
  results.hidden = true;
  persist().then(checkDaemon);
});

codeInput.addEventListener("input", () => {
  codeInput.removeAttribute("aria-invalid");
  clearCaptureError();
  persist();
});

codeInput.addEventListener("change", () => {
  persist().then(checkDaemon);
});

captureButton.addEventListener("click", async () => {
  daemonInput.value = normalizeUrl(daemonInput.value);
  updateTarget();
  clearCaptureError();
  if (!showDestination()) return;
  await persist();
  setBusy(true);
  results.hidden = true;

  try {
    // Can't reach Stillgreen? Say that, not a Slack hint.
    if (normalizeCode(codeInput.value) && !(await checkDaemon())) {
      showCaptureError(
        `Can't reach ${currentHost() || "Stillgreen"}. Start Stillgreen with ${START_COMMAND}, or check the address.`,
      );
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: "capture" });

    if (!result || (!result.workspaces && !result.error)) {
      showCaptureError("No answer from the extension. Close this popup and open it again.");
    } else if (result.error) {
      if (/access code/i.test(result.error)) {
        codeInput.setAttribute("aria-invalid", "true");
      }
      showCaptureError(result.error);
    } else {
      renderItems(result.workspaces);
      if (result.ok) {
        const total = result.workspaces.length;
        const added = result.workspaces.filter((item) => item.ok).length;
        const lead = added < total ? `Added ${added} of ${total}.` : "Done.";
        fill(
          hint,
          daemonRunning
            ? [`${lead} Stillgreen now follows your schedule. Open the dashboard to check it.`]
            : [`${lead} Run `, { code: "./sg-local start" }, " to start keeping you green."],
        );
      }
      results.scrollIntoView({ block: "nearest" });
    }
  } catch {
    showCaptureError("The capture failed. Open app.slack.com and try again.");
  } finally {
    setBusy(false);
    if (!captureError) checkDaemon();
  }
});

load();
