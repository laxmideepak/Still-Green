(() => {
  const boot = JSON.parse(document.getElementById("bootstrap").textContent || "{}");
  const DAYS = [
    ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"],
    ["thursday", "Thu"], ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"]
  ];
  const state = { code: boot.code || "", data: null, draft: null, mode: "scheduled", days: [], scheduleDirty: false };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const login = $("#login");
  const app = $("#app");

  function savedCode() {
    try { return localStorage.getItem("stillgreen.bridge") || ""; } catch { return ""; }
  }
  function storeCode(code) {
    state.code = code;
    try { localStorage.setItem("stillgreen.bridge", code); } catch {}
  }
  function authHeaders() { return { Authorization: `Bearer ${state.code}`, "Content-Type": "application/json" }; }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
      cache: "no-store"
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (response.status === 401) { showLogin("That code was not accepted."); throw new Error("unauthorized"); }
    if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function showLogin(message = "") {
    login.hidden = false;
    app.hidden = true;
    $("#loginError").textContent = message;
    setTimeout(() => $("#accessCode").focus(), 50);
  }
  function showApp() {
    login.hidden = true;
    app.hidden = false;
  }

  function fmtStatus(item) {
    const map = {
      active: "Active", connected: "Connected", away: "Away", auto_away: "Away",
      manual_away: "Manual away", paused: "Paused", scheduled_off: "Outside schedule",
      daemon_stopped: "Daemon stopped", starting: "Starting", reconnecting: "Reconnecting",
      restarting: "Restarting", stopped: "Stopped", invalid_token: "Tokens rejected",
      invalid_config: "Check config", error: "Error"
    };
    return map[item] || item || "Unknown";
  }

  function render() {
    if (!state.data) return;
    const data = state.data;
    showApp();
    const running = data.daemon.running;
    $("#statusText").textContent = running ? `Daemon running${data.connected_count ? ` · ${data.connected_count} online` : ""}` : "Daemon stopped";
    if (data.config_error) $("#statusText").textContent = `Config file problem: ${data.config_error}`;
    $("#statusDot").style.background = running ? "var(--green-bright)" : "#9aa79f";
    $("#daemonState").textContent = running ? `Running (${data.daemon.pid})` : "Stopped";
    $("#onlineCount").textContent = `${data.connected_count} / ${data.workspaces.length}`;
    $("#modeTitle").textContent = data.paused ? "Paused" : data.stay_active ? "Stay online" : data.schedule.mode === "always" ? "Always on" : data.schedule.active ? "Scheduled · on" : "Scheduled · off";
    $("#modeDetail").textContent = data.paused
      ? `Presence is paused${data.pause_until ? ` until ${new Date(data.pause_until).toLocaleString()}` : " until resumed"}.`
      : data.stay_active
        ? `Override active${data.stay_until ? ` until ${new Date(data.stay_until).toLocaleString()}` : ""}.`
        : data.schedule.mode === "always" ? "The daemon keeps every session connected." : data.schedule.summary;
    $("#nextChange").textContent = data.schedule.next_change ? new Date(data.schedule.next_change).toLocaleString() : "—";
    $("#scheduleSummary").textContent = data.schedule.summary;
    $("#bridgeCode").textContent = state.code;
    $("#activityCount").textContent = `${data.activity.length} events`;

    const list = $("#workspaceList");
    if (!data.workspaces.length) {
      list.innerHTML = `<div class="workspace"><div class="who"><span class="avatar">+</span><div><strong>No workspaces yet</strong><span>Add one to start a session.</span></div></div></div>`;
    } else {
      list.innerHTML = data.workspaces.map((item) => `
        <div class="workspace ${item.status === "active" || item.connected ? "online" : ""}">
          <div class="who">
            <span class="avatar" aria-hidden="true">${esc((item.name || "S").slice(0, 1).toUpperCase())}</span>
            <div><strong>${esc(item.name)}</strong><span>${esc(item.team_id)}${item.user_id ? ` · ${esc(item.user_id)}` : ""}</span></div>
          </div>
          <span class="status" data-state="${esc(item.status)}"><i aria-hidden="true"></i>${esc(fmtStatus(item.status))}</span>
          <div class="wsActions">
            <button type="button" data-ws="${esc(item.team_id)}" data-do="${item.paused ? "resume" : "pause"}">${item.paused ? "Resume" : "Pause"}</button>
            <button type="button" class="danger" data-ws="${esc(item.team_id)}" data-do="remove">Remove</button>
          </div>
        </div>`).join("");
    }

    const activity = $("#activity");
    activity.innerHTML = data.activity.length ? data.activity.map((entry) => `
      <li><time>${esc(entry.time)}</time><i data-tone="${esc(entry.tone)}" aria-hidden="true"></i><span>${esc(entry.text)}${entry.workspace ? `<span class="who">${esc(entry.workspace)}</span>` : ""}</span></li>`).join("")
      : `<li><time>—</time><i aria-hidden="true"></i><span>No events yet. Logs appear here after the daemon starts.</span></li>`;

    // Keep what the user is editing; the 15-second refresh must not undo it.
    if (!state.scheduleDirty) {
      state.mode = data.schedule.mode;
      state.days = data.schedule.active_days || [];
      state.draft = { start: data.schedule.start_time || "09:00", end: data.schedule.end_time || "17:00", timezone: data.schedule.timezone || "local" };
      renderSchedule();
    }
    openAddFromHash();
  }

  function openAddFromHash() {
    if (location.hash !== "#add" || !$("#addForm").hidden) return;
    $("#addForm").hidden = false;
    $("#xoxc").focus();
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function renderSchedule() {
    $$("#scheduleForm [data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode)));
    $("#dayPicker").innerHTML = DAYS.map(([key, label]) => `<button type="button" data-day="${key}" aria-pressed="${state.days.includes(key)}">${label}</button>`).join("");
    $("#startTime").value = state.draft?.start || "09:00";
    $("#endTime").value = state.draft?.end || "17:00";
    $("#timezone").value = state.draft?.timezone || "local";
  }

  async function refresh() {
    try {
      state.data = await api("/api/state");
      render();
    } catch (error) {
      if (state.code) showLogin(error.message.includes("unauthorized") ? "That code was not accepted." : error.message);
      else showLogin();
    }
  }

  async function act(path, payload = {}) {
    try {
      const result = await api(path, { method: "POST", body: JSON.stringify(payload) });
      state.data = result.state || result;
      render();
      return true;
    } catch (error) {
      alert(error.message);
      return false;
    }
  }

  async function init() {
    if (boot.embed && boot.code) storeCode(boot.code);
    if (!state.code) state.code = savedCode();
    if (!state.code) { showLogin(); return; }
    await refresh();
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    storeCode($("#accessCode").value.trim());
    await refresh();
  });

  $("#copyCode").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.code); $("#copyCode").textContent = "Copied"; setTimeout(() => $("#copyCode").textContent = "Copy code", 1600); } catch { alert(state.code); }
  });

  $("#rotateCode").addEventListener("click", async () => {
    if (!confirm("Rotate the access code? The hosted dashboard will need the new one.")) return;
    try {
      const result = await api("/api/code/rotate", { method: "POST", body: "{}" });
      storeCode(result.code);
      render();
      alert("New code: " + result.code);
    } catch (error) { alert(error.message); }
  });

  $("#addToggle").addEventListener("click", () => { $("#addForm").hidden = false; $("#xoxc").focus(); });
  $("#addClose").addEventListener("click", () => { $("#addForm").hidden = true; $("#addError").textContent = ""; });
  $("#addForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#addError").textContent = "";
    $("#addSubmit").disabled = true;
    $("#addSubmit").textContent = "Verifying…";
    try {
      const result = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ xoxc: $("#xoxc").value, xoxd: $("#xoxd").value, name: $("#name").value }) });
      state.data = result.state;
      $("#addForm").hidden = true;
      $("#addForm").reset();
      render();
    } catch (error) {
      $("#addError").textContent = error.message;
    } finally {
      $("#addSubmit").disabled = false;
      $("#addSubmit").textContent = "Verify & save";
    }
  });

  $("#workspaceList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-do]");
    if (!button) return;
    const team = button.dataset.ws;
    const action = button.dataset.do;
    if (action === "remove") {
      if (!confirm("Remove this workspace? Its tokens will be deleted from this machine.")) return;
      try {
        const result = await api(`/api/workspaces/${encodeURIComponent(team)}`, { method: "DELETE" });
        state.data = result.state;
        render();
      } catch (error) { alert(error.message); }
      return;
    }
    await act(action === "pause" ? "/api/pause" : "/api/resume", { workspace: team });
  });

  $("#scheduleForm").addEventListener("input", () => { state.scheduleDirty = true; });
  $("#scheduleForm").addEventListener("click", (event) => {
    const mode = event.target.closest("[data-mode]");
    if (mode) { state.scheduleDirty = true; state.mode = mode.dataset.mode; renderSchedule(); return; }
    const day = event.target.closest("[data-day]");
    if (day) {
      state.scheduleDirty = true;
      const key = day.dataset.day;
      state.days = state.days.includes(key) ? state.days.filter((item) => item !== key) : [...state.days, key];
      renderSchedule();
    }
  });

  $("#scheduleForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.draft = { start: $("#startTime").value, end: $("#endTime").value, timezone: $("#timezone").value.trim() || "local" };
    const saved = await act("/api/schedule", {
      mode: state.mode,
      active_days: state.days,
      start_time: state.draft.start,
      end_time: state.draft.end,
      timezone: state.draft.timezone
    });
    if (saved) { state.scheduleDirty = false; render(); }
  });

  window.addEventListener("hashchange", openAddFromHash);

  $$("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "pause") await act("/api/pause", { duration: "1h" });
    if (action === "resume") await act("/api/resume", {});
    if (action === "stay") await act("/api/stay", { duration: "1h" });
  }));

  init();
  setInterval(() => { if (state.code && !document.hidden) refresh().catch(() => {}); }, 15000);
})();
