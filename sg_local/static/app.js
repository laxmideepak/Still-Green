// Stillgreen control page. Vanilla JS, no dependencies, CSP-safe (no inline
// code, no eval). Every server-provided string is written with textContent.
(() => {
  "use strict";

  const STORAGE_KEY = "stillgreen.bridge";
  const POLL_MS = 12000;
  const RETRY_MS = [3000, 6000, 12000, 20000, 30000];
  const DAYS = [
    ["monday", "Mon", "Monday"], ["tuesday", "Tue", "Tuesday"], ["wednesday", "Wed", "Wednesday"],
    ["thursday", "Thu", "Thursday"], ["friday", "Fri", "Friday"], ["saturday", "Sat", "Saturday"],
    ["sunday", "Sun", "Sunday"],
  ];
  const DAY_KEYS = DAYS.map((d) => d[0]);
  const WEEKDAYS = DAY_KEYS.slice(0, 5);
  const DASHES = /[‐-―−﹘﹣－]/g;
  const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

  const STATUS = {
    active: ["Active", "green"],
    connected: ["Connected", "green"],
    away: ["Away", "amber"],
    auto_away: ["Away", "amber"],
    manual_away: ["Manual away", "blue"],
    paused: ["Paused", "muted"],
    scheduled_off: ["Outside schedule", "muted"],
    daemon_stopped: ["Daemon stopped", "muted"],
    starting: ["Starting", "blue"],
    reconnecting: ["Reconnecting", "amber"],
    restarting: ["Restarting", "amber"],
    stopped: ["Stopped", "muted"],
    invalid_token: ["Tokens rejected", "red"],
    invalid_config: ["Check config", "red"],
    error: ["Error", "red"],
  };

  // ------------------------------------------------------------------ state

  const boot = readBootstrap();
  const S = {
    embed: Boolean(boot.embed && boot.code),
    code: "",
    data: null,
    offline: false,
    offlineReason: "",
    lastOk: 0,
    failures: 0,
    timer: 0,
    refreshing: null,
    mutationSeq: 0,
    revealCode: false,
    rotated: false,
    sigs: {},
    sched: { base: null, draft: null, serverLocal: false, touched: false },
  };

  // ---------------------------------------------------------------- helpers

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function readBootstrap() {
    try { return JSON.parse(document.getElementById("bootstrap").textContent || "{}") || {}; }
    catch { return {}; }
  }

  // h("div", {className, text, attrs, dataset, on}, ...children)
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "className") el.className = value;
      else if (key === "text") el.textContent = String(value);
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "attrs") for (const [a, v] of Object.entries(value)) { if (v !== undefined && v !== null && v !== false) el.setAttribute(a, String(v)); }
      else if (key === "on") for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
      else el[key] = value;
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function normalizeCode(value) {
    return String(value || "").replace(DASHES, "-").replace(/\s+/g, "").toUpperCase();
  }

  function storageGet() { try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; } }
  function storageSet(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* private mode */ } }
  function storageClear() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ } }

  function sentence(text) {
    const t = String(text || "").trim();
    if (!t) return "";
    const s = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?)]$/.test(s) ? s : `${s}.`;
  }

  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

  const clockFmt = safeFormat({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdayFmt = safeFormat({ weekday: "short" });
  const dateFmt = safeFormat({ month: "short", day: "numeric" });
  function safeFormat(opts) {
    try { return new Intl.DateTimeFormat(undefined, opts); } catch { return new Intl.DateTimeFormat("en-GB", opts); }
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayDiff(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }

  // "17:00", "tomorrow 09:00", "Mon 09:00", "Nov 12 09:00"
  function fmtWhen(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const t = clockFmt.format(d);
    const diff = dayDiff(d);
    if (diff === 0) return t;
    if (diff === 1) return `tomorrow ${t}`;
    if (diff > 1 && diff < 7) return `${weekdayFmt.format(d)} ${t}`;
    return `${dateFmt.format(d)} ${t}`;
  }

  function browserZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
  }
  function isLocalZone(tz) { return !tz || /^(local|system|machine)$/i.test(String(tz).trim()); }
  function validZone(tz) {
    if (isLocalZone(tz)) return true;
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
  }

  function daysLabel(days) {
    const set = DAY_KEYS.filter((k) => (days || []).includes(k));
    if (set.length === 7) return "Every day";
    if (set.length === 5 && WEEKDAYS.every((k) => set.includes(k))) return "Weekdays";
    if (set.length === 2 && set.includes("saturday") && set.includes("sunday")) return "Weekends";
    return set.map((k) => DAYS[DAY_KEYS.indexOf(k)][1]).join(", ") || "No days";
  }

  // ------------------------------------------------------------------- api

  class ApiError extends Error {
    constructor(message, status, kind) { super(message); this.status = status; this.kind = kind; }
  }

  async function api(path, { method = "GET", body, code = S.code } = {}) {
    if (!/^[\x21-\x7e]+$/.test(code || "")) throw new ApiError("That access code isn't valid.", 401, "auth");
    let response;
    try {
      response = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${code}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new ApiError("Can't reach the Stillgreen server.", 0, "network");
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* empty or non-JSON body */ }
    if (response.status === 401) throw new ApiError("The access code was not accepted.", 401, "auth");
    if (response.status === 429) throw new ApiError("Too many wrong access codes from this network. Wait a minute, then try again.", 429, "throttle");
    if (!response.ok || payload.ok === false) {
      const kind = response.status >= 500 || response.status === 0 ? "server" : "request";
      throw new ApiError(sentence(payload.error) || `Request failed (${response.status}).`, response.status, kind);
    }
    return payload;
  }

  // ----------------------------------------------------------- busy & toast

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.dataset.wasFocused = document.activeElement === button ? "1" : "";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (!button.querySelector(".spinner")) button.append(h("span", { className: "spinner", attrs: { "aria-hidden": "true" } }));
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.querySelector(".spinner")?.remove();
      const lost = !document.activeElement || document.activeElement === document.body;
      if (button.dataset.wasFocused && lost) {
        // The row may have been re-rendered; focus its replacement.
        const key = button.dataset.key;
        const target = button.isConnected ? button : key ? document.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
        if (target && !target.disabled) target.focus();
      }
      delete button.dataset.wasFocused;
    }
  }

  function isBusy(button) { return Boolean(button && button.getAttribute("aria-busy") === "true"); }

  function toast(message, tone = "success", timeout) {
    const region = $("#toasts");
    while (region.children.length >= 3) region.firstElementChild.remove();
    const close = h("button", { className: "toast-close", type: "button", attrs: { "aria-label": "Dismiss" }, text: "×" });
    const node = h("div", { className: "toast", dataset: { tone } },
      h("span", { className: "toast-dot", attrs: { "aria-hidden": "true" } }),
      h("span", { className: "toast-text", text: message }),
      close);
    let timer = 0;
    const dismiss = () => { clearTimeout(timer); node.remove(); };
    close.addEventListener("click", dismiss);
    const arm = () => { timer = setTimeout(dismiss, timeout || (tone === "error" ? 8000 : 4000)); };
    node.addEventListener("mouseenter", () => clearTimeout(timer));
    node.addEventListener("mouseleave", arm);
    node.addEventListener("focusin", () => clearTimeout(timer));
    region.append(node);
    arm();
  }

  function handleError(error) {
    if (error && error.kind === "auth") { sessionExpired(); return; }
    if (error && error.kind === "network") { markOffline(error.message); }
    toast(error && error.message ? error.message : "Something went wrong.", "error");
  }

  // Run a mutation with a busy button; apply the returned state.
  async function mutate(button, request, success) {
    if (isBusy(button)) return null;
    setBusy(button, true);
    try {
      const result = await request();
      S.mutationSeq += 1;
      applyState(result && result.state ? result.state : result);
      const message = typeof success === "function" ? success(result) : success;
      if (message) toast(message);
      return result;
    } catch (error) {
      handleError(error);
      return null;
    } finally {
      setBusy(button, false);
    }
  }

  function post(path, body = {}) { return api(path, { method: "POST", body }); }

  // ---------------------------------------------------------------- dialogs

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

  function openDialog(dialog, { initialFocus, onCancel, onClosed } = {}) {
    const opener = document.activeElement;
    let closed = false;
    const trap = (event) => {
      if (event.key !== "Tab") return;
      const items = $$(FOCUSABLE, dialog).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const cancel = (event) => {
      event.preventDefault();
      if (onCancel) onCancel(); else close();
    };
    const backdrop = (event) => { if (event.target === dialog && onCancel) onCancel(); };
    // Runs however the dialog closes, including a forced close by the browser.
    const cleanup = () => {
      if (closed) return;
      closed = true;
      dialog.removeEventListener("keydown", trap);
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("click", backdrop);
      dialog.removeEventListener("close", cleanup);
      if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
      if (onClosed) onClosed();
    };
    function close() {
      if (dialog.open) dialog.close();
      cleanup();
    }
    dialog.addEventListener("keydown", trap);
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("click", backdrop);
    dialog.addEventListener("close", cleanup);
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    (initialFocus || $(FOCUSABLE, dialog))?.focus();
    return close;
  }

  // In-page replacement for window.confirm. `action` runs while the dialog
  // shows a busy button; errors stay in the dialog.
  function confirmAction({ title, body, confirmLabel, danger = true, action }) {
    const dialog = $("#confirmDialog");
    const ok = $("#confirmOk");
    const cancelBtn = $("#confirmCancel");
    const error = $("#confirmError");
    $("#confirmTitle").textContent = title;
    $("#confirmBody").replaceChildren(...(Array.isArray(body) ? body : [body]));
    $(".btn-label", ok).textContent = confirmLabel;
    ok.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
    error.textContent = "";
    return new Promise((resolve) => {
      let busy = false;
      let done = false;
      let close = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        $("#confirmForm").removeEventListener("submit", submit);
        cancelBtn.removeEventListener("click", dismiss);
        close();
        resolve(value);
      };
      const dismiss = () => { if (!busy) finish(null); };
      const submit = async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        error.textContent = "";
        setBusy(ok, true);
        cancelBtn.disabled = true;
        try {
          const result = await action();
          busy = false;
          setBusy(ok, false);
          cancelBtn.disabled = false;
          finish(result);
        } catch (err) {
          busy = false;
          setBusy(ok, false);
          cancelBtn.disabled = false;
          if (err && err.kind === "auth") { finish(null); sessionExpired(); return; }
          error.textContent = err && err.message ? err.message : "Something went wrong.";
          ok.focus();
        }
      };
      $("#confirmForm").addEventListener("submit", submit);
      cancelBtn.addEventListener("click", dismiss);
      close = openDialog(dialog, { initialFocus: cancelBtn, onCancel: dismiss, onClosed: () => finish(null) });
    });
  }

  // ------------------------------------------------------------------- views

  function showLogin(message = "", tone = "error") {
    stopPolling();
    closeOpenDialogs();
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#loginHost").textContent = location.host || "this server";
    const err = $("#loginError");
    err.textContent = message;
    err.dataset.tone = tone;
    $("#accessCode").setAttribute("aria-invalid", message && tone === "error" ? "true" : "false");
    document.title = "Stillgreen · Locked";
    setTimeout(() => $("#accessCode").focus(), 30);
  }

  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    document.title = "Stillgreen control";
    if (!S.data) $("#app").classList.add("is-loading");
  }

  function closeOpenDialogs() {
    $$("dialog[open]").forEach((d) => d.close());
  }

  function sessionExpired() {
    if (!S.embed) storageClear();
    S.code = "";
    S.data = null;
    S.sigs = {};
    S.revealCode = false;
    S.rotated = false;
    showLogin(S.embed
      ? "The access code changed. Reload this page, or enter the new code."
      : "Your session ended because the access code changed or was revoked. Enter the current code.");
  }

  function lock() {
    storageClear();
    S.code = "";
    S.data = null;
    S.sigs = {};
    S.revealCode = false;
    S.rotated = false;
    resetSkeleton();
    showLogin("");
    $("#accessCode").value = "";
    toast("Page locked. The access code was removed from this browser.", "info");
  }

  function resetSkeleton() {
    $("#app").classList.add("is-loading");
  }

  function markOffline(reason) {
    S.offline = true;
    S.offlineReason = reason || "";
    renderTop();
    renderBanners();
  }

  // ----------------------------------------------------------------- render

  function applyState(data) {
    if (!data || !Array.isArray(data.workspaces)) return;
    S.data = data;
    S.offline = false;
    S.failures = 0;
    S.lastOk = Date.now();
    $("#app").classList.remove("is-loading");
    render();
  }

  function render() {
    if (!S.data) return;
    renderTop();
    renderBanners();
    renderOverview();
    renderStay();
    renderWorkspaces();
    renderSchedule();
    renderActivity();
    renderCode();
    $("#version").textContent = S.data.version ? `v${S.data.version}` : "";
  }

  function renderTop() {
    const host = location.hostname;
    $("#hostKind").textContent = LOOPBACK.has(host) ? "This computer" : "Server";
    $("#hostName").textContent = location.host;
    $("#menuLock").hidden = S.embed;
    const pill = $("#statusPill");
    const text = $("#statusText");
    const d = S.data;
    if (S.offline) { pill.dataset.tone = "amber"; text.textContent = "Offline · retrying"; return; }
    if (!d) { pill.dataset.tone = "muted"; text.textContent = "Connecting…"; return; }
    if (!d.daemon || !d.daemon.running) { pill.dataset.tone = "red"; text.textContent = "Daemon stopped"; return; }
    pill.dataset.tone = d.connected_count ? "green" : "muted";
    text.textContent = `Daemon running · ${d.connected_count} online`;
  }

  function banner(tone, icon, title, bodyNodes, action) {
    return h("div", { className: "banner", dataset: { tone }, attrs: { role: tone === "red" ? "alert" : "status" } },
      h("span", { className: "banner-icon", attrs: { "aria-hidden": "true" }, text: icon }),
      h("div", { className: "banner-body" }, h("strong", { text: title }), h("p", {}, bodyNodes)),
      action || null);
  }

  function renderBanners() {
    const d = S.data;
    const items = [];
    if (S.offline) {
      items.push(["offline", S.lastOk, S.offlineReason]);
    }
    if (d && d.config_error) items.push(["config", d.config_error]);
    if (d && d.daemon && !d.daemon.running) items.push(["stopped"]);
    const sig = JSON.stringify(items);
    if (S.sigs.banners === sig) return;
    S.sigs.banners = sig;
    const nodes = items.map(([kind, extra, reason]) => {
      if (kind === "offline") {
        const since = extra ? ` from ${clockFmt.format(new Date(extra))}` : "";
        const retry = h("button", { className: "btn btn-secondary btn-sm", type: "button", dataset: { key: "retry" } }, h("span", { className: "btn-label", text: "Retry now" }));
        retry.addEventListener("click", async () => { setBusy(retry, true); await refresh(); setBusy(retry, false); schedulePoll(); });
        const why = reason && reason !== "Can't reach the Stillgreen server." ? `${reason} ` : "";
        return banner("amber", "!", "Can't reach Stillgreen",
          d ? `${why}Showing the last known state${since}. Retrying automatically.` : `${why}Retrying automatically.`, retry);
      }
      if (kind === "config") {
        return banner("red", "!", "Config file problem", [sentence(extra), " Changes are blocked until the file is fixed."]);
      }
      return banner("amber", "!", "The presence daemon is not running",
        ["No workspace is kept online until it starts. On your computer run ", h("code", { text: "./sg-local start" }),
          "; on a server run ", h("code", { text: "sudo docker compose up -d" }), "."]);
    });
    $("#banners").replaceChildren(...nodes);
  }

  function renderOverview() {
    const d = S.data;
    const total = d.workspaces.length;
    const online = d.connected_count || 0;
    const running = Boolean(d.daemon && d.daemon.running);
    const sched = d.schedule || {};
    let tone = "green";
    let title;
    let detail;
    if (d.paused) {
      tone = "amber";
      title = d.pause_until ? `Paused until ${fmtWhen(d.pause_until)}` : "Paused until resumed";
      detail = "Presence is off for every workspace. Resume to go green again.";
    } else if (d.stay_active) {
      title = d.stay_until ? `Staying online until ${fmtWhen(d.stay_until)}` : "Staying online";
      detail = "A temporary override keeps you green regardless of the schedule.";
    } else if (sched.mode === "scheduled") {
      const when = fmtWhen(sched.next_change);
      if (sched.active) {
        title = when ? `Scheduled · on until ${when}` : "Scheduled · on";
      } else {
        tone = "blue";
        title = when ? `Scheduled · off until ${when}` : "Scheduled · off";
      }
      detail = `${daysLabel(sched.active_days)}, ${sched.start_time || "09:00"}–${sched.end_time || "17:00"}${isLocalZone(sched.timezone) ? " (server time)" : ` (${sched.timezone})`}.`;
    } else {
      title = "Always on";
      detail = total ? `Keeping ${online} of ${plural(total, "workspace", "workspaces")} green around the clock.` : "Add a workspace to start keeping it green.";
    }
    if (!running) {
      tone = "muted";
      detail = "The daemon is stopped, so nothing is kept online right now.";
    } else if (!total && !d.paused) {
      tone = "muted";
      detail = "No workspaces yet. Add one to start keeping it green.";
    }
    $("#beacon").dataset.tone = tone;
    $("#overviewTitle").textContent = title;
    $("#overviewDetail").textContent = detail;
    $("#factOnline").textContent = total ? `${online} of ${total}` : "None yet";
    $("#factNext").textContent = d.paused && d.pause_until ? `Resumes ${fmtWhen(d.pause_until)}`
      : d.stay_active && d.stay_until ? `Override ends ${fmtWhen(d.stay_until)}`
        : sched.mode === "scheduled" && sched.next_change ? `${sched.active ? "Off" : "On"} ${fmtWhen(sched.next_change)}`
          : "No change planned";
    $("#factDaemon").textContent = running ? `Running${d.daemon.pid ? ` · PID ${d.daemon.pid}` : ""}` : "Stopped";

    const pause1 = $('[data-pause="1h"]');
    const pauseForever = $('[data-pause="forever"]');
    const resume = $("[data-resume]");
    const canPause = !d.paused && total > 0;
    pause1.hidden = !canPause;
    pauseForever.hidden = !canPause;
    resume.hidden = !d.paused;
  }

  function renderStay() {
    const d = S.data;
    const active = Boolean(d.stay_active);
    $("#stayActive").hidden = !active;
    if (active) $("#stayActiveText").textContent = d.stay_until ? `Online until ${fmtWhen(d.stay_until)}` : "Staying online";
  }

  function wsTone(item) {
    if (item.paused) return ["Paused", "muted"];
    return STATUS[item.status] || [sentence(String(item.status || "Unknown").replace(/_/g, " ")).replace(/\.$/, ""), "muted"];
  }

  function renderWorkspaces() {
    const d = S.data;
    const list = $("#workspaceList");
    const sig = JSON.stringify(d.workspaces.map((w) => [w.team_id, w.name, w.user_id, w.paused, w.status, w.reason, w.last_error]));
    $("#workspaceCount").textContent = d.workspaces.length ? String(d.workspaces.length) : "";
    if (S.sigs.ws === sig) return;
    S.sigs.ws = sig;
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.key : "";
    list.setAttribute("role", d.workspaces.length ? "list" : "presentation");

    if (!d.workspaces.length) {
      const add = h("button", { className: "btn btn-primary", type: "button", dataset: { key: "empty-add" } }, h("span", { className: "btn-label", text: "Add workspace" }));
      add.addEventListener("click", () => openAdd());
      list.replaceChildren(h("div", { className: "empty" },
        h("span", { className: "empty-art", attrs: { "aria-hidden": "true" } }, h("i")),
        h("h3", { text: "No workspaces yet" }),
        h("p", { text: "Capture a Slack session with the Stillgreen browser extension, or paste the two tokens by hand." }),
        add));
    } else {
      list.replaceChildren(...d.workspaces.map(workspaceRow));
    }
    if (focusKey) {
      const target = list.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (target) target.focus();
    }
  }

  function workspaceRow(item) {
    const name = item.name || item.team_id || "Workspace";
    const [label, tone] = wsTone(item);
    const initial = (Array.from(name.trim())[0] || "S").toUpperCase();
    const toggle = h("button", {
      className: "btn btn-secondary btn-sm", type: "button",
      dataset: { key: `ws-toggle-${item.team_id}` },
      attrs: { "aria-label": `${item.paused ? "Resume" : "Pause"} ${name}` },
    }, h("span", { className: "btn-label", text: item.paused ? "Resume" : "Pause" }));
    toggle.addEventListener("click", () => {
      const resume = item.paused;
      mutate(toggle, () => post(resume ? "/api/resume" : "/api/pause", { workspace: item.team_id }),
        resume ? `Resumed ${name}.` : `Paused ${name}. It stays off until you resume it.`);
    });
    const remove = h("button", {
      className: "btn btn-ghost btn-sm btn-danger-text", type: "button",
      dataset: { key: `ws-remove-${item.team_id}` },
      attrs: { "aria-label": `Remove ${name}` },
    }, h("span", { className: "btn-label", text: "Remove" }));
    remove.addEventListener("click", () => removeWorkspace(item, name));

    const meta = [h("span", { className: "mono", text: item.team_id })];
    if (item.user_id) meta.push(" · ", h("span", { className: "mono", text: item.user_id }));

    let note = "";
    if (!item.last_error && item.reason && !["active", "connected", "daemon_stopped"].includes(item.status) && !item.paused) {
      note = sentence(item.reason);
    }
    return h("div", { className: "ws", dataset: { tone }, attrs: { role: "listitem" } },
      h("span", { className: "avatar", attrs: { "aria-hidden": "true" }, text: initial }),
      h("div", { className: "ws-who" },
        h("div", { className: "ws-name", text: name, attrs: { title: name } }),
        h("div", { className: "ws-meta" }, meta)),
      h("span", { className: "badge", dataset: { tone } }, h("i", { attrs: { "aria-hidden": "true" } }), label),
      h("div", { className: "ws-actions" }, toggle, remove),
      note ? h("p", { className: "ws-note", text: note }) : null,
      item.last_error ? h("p", { className: "ws-error" }, h("b", { text: "Last error: " }), String(item.last_error)) : null);
  }

  async function removeWorkspace(item, name) {
    const result = await confirmAction({
      title: `Remove ${name}?`,
      body: ["Stillgreen stops keeping ", h("strong", { text: name }), " online and deletes its tokens from this daemon. You can add it again later."],
      confirmLabel: "Remove workspace",
      action: () => api(`/api/workspaces/${encodeURIComponent(item.team_id)}`, { method: "DELETE" }),
    });
    if (!result) return;
    S.mutationSeq += 1;
    applyState(result.state);
    toast(`Removed ${result.removed || name}.`);
    $("#addOpen").focus();
  }

  // --------------------------------------------------------------- schedule

  function scheduleFromServer(d) {
    const s = d.schedule || {};
    const local = isLocalZone(s.timezone);
    return {
      mode: s.mode === "scheduled" ? "scheduled" : "always",
      days: DAY_KEYS.filter((k) => (s.active_days || []).includes(k)),
      start: s.start_time || "09:00",
      end: s.end_time || "17:00",
      timezone: local ? (browserZone() || "local") : String(s.timezone),
      local,
    };
  }

  function sameSchedule(a, b) {
    if (!a || !b) return false;
    if (a.mode !== b.mode) return false;
    if (a.mode === "always") return a.timezone === b.timezone || (a.local && b.local);
    return a.days.join() === b.days.join() && a.start === b.start && a.end === b.end && a.timezone === b.timezone;
  }

  function scheduleDirty() { return !sameSchedule(S.sched.draft, S.sched.base); }

  function scheduleProblem(draft) {
    if (draft.mode !== "scheduled") return validZone(draft.timezone) ? "" : "Unknown timezone. Use a name like America/New_York.";
    if (!draft.days.length) return "Pick at least one day.";
    if (!draft.start || !draft.end) return "Enter a start and an end time.";
    if (draft.start === draft.end) return "Start and end can't be the same time.";
    if (!draft.timezone.trim()) return "Enter a timezone, like America/New_York.";
    if (!validZone(draft.timezone.trim())) return "Unknown timezone. Use a name like America/New_York.";
    return "";
  }

  function renderSchedule() {
    const d = S.data;
    const base = scheduleFromServer(d);
    S.sched.base = base;
    S.sched.serverLocal = base.local;
    if (!S.sched.draft || !scheduleDirty() || !S.sched.touched) {
      // Nothing unsaved: follow the server. Unsaved edits are kept as-is.
      S.sched.draft = { ...base, days: [...base.days] };
      S.sched.touched = false;
      paintScheduleFields();
    }
    const s = d.schedule || {};
    $("#scheduleSummary").textContent = s.mode === "scheduled"
      ? `${daysLabel(s.active_days)} · ${s.start_time}–${s.end_time} · ${isLocalZone(s.timezone) ? "server time" : s.timezone} · ${s.active ? "on now" : "off now"}`
      : "Always on, around the clock.";
    updateScheduleState();
  }

  function paintScheduleFields() {
    const draft = S.sched.draft;
    $$("#scheduleForm [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === draft.mode)));
    $("#scheduleWindow").hidden = draft.mode !== "scheduled";
    $("#alwaysHint").hidden = draft.mode === "scheduled";
    const picker = $("#dayPicker");
    if (!picker.children.length) {
      picker.replaceChildren(...DAYS.map(([key, short, full]) => h("button", {
        type: "button", dataset: { day: key }, attrs: { "aria-pressed": "false", "aria-label": full }, text: short,
      })));
    }
    $$("[data-day]", picker).forEach((b) => b.setAttribute("aria-pressed", String(draft.days.includes(b.dataset.day))));
    if ($("#startTime").value !== draft.start) $("#startTime").value = draft.start;
    if ($("#endTime").value !== draft.end) $("#endTime").value = draft.end;
    if ($("#timezone").value !== draft.timezone) $("#timezone").value = draft.timezone;
  }

  function updateScheduleState() {
    const draft = S.sched.draft;
    const dirty = scheduleDirty();
    const problem = dirty ? scheduleProblem(draft) : "";
    $("#scheduleDirty").hidden = !dirty;
    $("#scheduleDiscard").hidden = !dirty;
    if (!isBusy($("#scheduleSave"))) $("#scheduleSave").disabled = !dirty || Boolean(problem);
    $("#scheduleError").textContent = problem;
    $("#timezone").setAttribute("aria-invalid", String(Boolean(problem) && /timezone/i.test(problem)));
    const tzHint = S.sched.serverLocal
      ? "The server uses its own clock right now. Saving uses this zone instead. An end before the start runs overnight."
      : "An end time earlier than the start runs overnight.";
    $("#tzHint").textContent = tzHint;
  }

  function editSchedule(change) {
    change(S.sched.draft);
    S.sched.touched = true;
    paintScheduleFields();
    updateScheduleState();
  }

  async function saveSchedule() {
    const draft = S.sched.draft;
    const problem = scheduleProblem(draft);
    if (problem) { $("#scheduleError").textContent = problem; return; }
    const timezone = draft.timezone.trim() || browserZone() || "local";
    const saved = await mutate($("#scheduleSave"), () => post("/api/schedule", {
      mode: draft.mode,
      active_days: draft.days,
      start_time: draft.start,
      end_time: draft.end,
      timezone,
    }), () => (draft.mode === "always" ? "Schedule saved: always on." : "Schedule saved."));
    if (saved) {
      S.sched.touched = false;
      S.sched.draft = null;
      renderSchedule();
    } else {
      updateScheduleState();
    }
  }

  // --------------------------------------------------------------- activity

  function renderActivity() {
    const events = S.data.activity || [];
    $("#activityCount").textContent = events.length ? plural(events.length, "event", "events") : "";
    $("#activitySub").textContent = LOOPBACK.has(location.hostname)
      ? "Recent daemon events, newest first."
      : "Recent daemon events, newest first. Times use the server's clock.";
    const sig = JSON.stringify(events);
    if (S.sigs.log === sig) return;
    S.sigs.log = sig;
    const list = $("#activity");
    if (!events.length) {
      list.replaceChildren(h("li", { className: "log-empty", text: "No activity yet. Events show up here once the daemon starts." }));
      return;
    }
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const multipleDays = events.some((e) => e.date !== todayKey);
    const nodes = [];
    let lastDate = "";
    for (const entry of events) {
      if (multipleDays && entry.date !== lastDate) {
        lastDate = entry.date;
        const label = entry.date === todayKey ? "Today" : dayLabel(entry.date);
        nodes.push(h("li", { className: "day-sep", text: label }));
      }
      const tone = ["green", "amber"].includes(entry.tone) ? entry.tone : "muted";
      nodes.push(h("li", {},
        h("time", { attrs: { datetime: `${entry.date}T${entry.time}` }, text: entry.time }),
        h("span", { className: "dot", dataset: { tone }, attrs: { "aria-hidden": "true" } }),
        h("span", { className: "msg" },
          entry.workspace ? h("span", { className: "ws-tag", text: entry.workspace }) : null,
          sentence(entry.text).replace(/\.$/, ""))));
    }
    list.replaceChildren(...nodes);
  }

  function dayLabel(date) {
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return date;
    if (dayDiff(d) === -1) return "Yesterday";
    return `${weekdayFmt.format(d)}, ${dateFmt.format(d)}`;
  }

  // ------------------------------------------------------------------- code

  function maskCode(code) {
    const body = code.replace(/^SG-/, "");
    return `SG-${body.replace(/[^-]/g, "•")}`;
  }

  function renderCode() {
    const code = S.code || "";
    $("#codeValue").textContent = S.revealCode ? code : maskCode(code || "SG-XXXX-XXXX-XXXX");
    const show = $("#codeShow");
    show.setAttribute("aria-pressed", String(S.revealCode));
    $(".btn-label", show).textContent = S.revealCode ? "Hide" : "Show";
    $("#codeRotated").hidden = !S.rotated;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    }
    const area = h("textarea", { value: text, attrs: { readonly: "", "aria-hidden": "true" } });
    area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.append(area);
    const active = document.activeElement;
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    if (active && typeof active.focus === "function") active.focus();
    return ok;
  }

  // ---------------------------------------------------------------- polling

  function stopPolling() { clearTimeout(S.timer); S.timer = 0; }

  function schedulePoll(delay) {
    stopPolling();
    if (!S.code || document.hidden) return;
    const wait = delay ?? (S.offline ? RETRY_MS[Math.min(S.failures, RETRY_MS.length) - 1] || POLL_MS : POLL_MS);
    S.timer = setTimeout(async () => { await refresh(); schedulePoll(); }, wait);
  }

  function refresh() {
    if (S.refreshing) return S.refreshing;
    const seq = S.mutationSeq;
    const code = S.code;
    S.refreshing = (async () => {
      try {
        const data = await api("/api/state", { code });
        if (code !== S.code) return false; // locked or re-keyed meanwhile
        if (seq !== S.mutationSeq) return true; // a newer mutation result already landed
        applyState(data);
        return true;
      } catch (error) {
        if (code !== S.code) return false;
        if (error.kind === "auth") { sessionExpired(); return false; }
        S.failures += 1;
        markOffline(error.kind === "throttle" || error.kind === "server" ? error.message : "");
        return false;
      } finally {
        S.refreshing = null;
      }
    })();
    return S.refreshing;
  }

  // --------------------------------------------------------------- add flow

  let closeAdd = null;
  function openAdd({ manual = false } = {}) {
    if (!S.code || $("#addDialog").open) return;
    $("#addError").textContent = "";
    $("#addOrigin").textContent = location.origin;
    $$("#addForm .input").forEach((i) => i.removeAttribute("aria-invalid"));
    closeAdd = openDialog($("#addDialog"), {
      initialFocus: manual ? $("#xoxc") : $("#addClose"),
      onCancel: dismissAdd,
      onClosed: () => {
        closeAdd = null;
        $("#addForm").reset();
        if (location.hash === "#add") history.replaceState(null, "", location.pathname + location.search);
      },
    });
  }

  function dismissAdd() {
    if (isBusy($("#addSubmit"))) return;
    if (closeAdd) closeAdd();
  }

  async function submitAdd(event) {
    event.preventDefault();
    const submit = $("#addSubmit");
    if (isBusy(submit)) return;
    const xoxc = $("#xoxc").value.trim();
    const xoxd = $("#xoxd").value.trim();
    const name = $("#wsName").value.trim();
    const error = $("#addError");
    $("#xoxc").setAttribute("aria-invalid", String(!xoxc));
    $("#xoxd").setAttribute("aria-invalid", String(!xoxd));
    if (!xoxc || !xoxd) {
      error.textContent = "Paste both the xoxc token and the xoxd cookie.";
      (!xoxc ? $("#xoxc") : $("#xoxd")).focus();
      return;
    }
    error.textContent = "";
    setBusy(submit, true);
    $("#addCancel").disabled = true;
    try {
      const result = await post("/api/workspaces", { xoxc, xoxd, name });
      S.mutationSeq += 1;
      setBusy(submit, false);
      $("#addCancel").disabled = false;
      dismissAdd();
      applyState(result.state);
      toast(`Added ${result.name || "the workspace"}. Connecting to Slack…`);
    } catch (err) {
      setBusy(submit, false);
      $("#addCancel").disabled = false;
      if (err.kind === "auth") { dismissAdd(); sessionExpired(); return; }
      error.textContent = err.message;
      if (/xoxc|token/i.test(err.message) && !/cookie|xoxd/i.test(err.message)) $("#xoxc").setAttribute("aria-invalid", "true");
      if (/xoxd|cookie/i.test(err.message)) $("#xoxd").setAttribute("aria-invalid", "true");
      submit.focus();
    }
  }

  // ------------------------------------------------------------------- menu

  function setMenu(open, focusFirst = false) {
    const button = $("#menuButton");
    const list = $("#menuList");
    list.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open && focusFirst) $$("button:not([hidden])", list)[0]?.focus();
  }

  function onMenuKey(event) {
    const items = $$("#menuList button:not([hidden])");
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); setMenu(false); $("#menuButton").focus(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
    else if (event.key === "Tab") setMenu(false);
  }

  // ----------------------------------------------------------------- wiring

  function bind() {
    // Login
    $("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = $("#loginSubmit");
      if (isBusy(submit)) return;
      const input = $("#accessCode");
      const code = normalizeCode(input.value);
      const err = $("#loginError");
      err.dataset.tone = "error";
      if (!code) {
        err.textContent = "Enter the access code.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.value = code;
      err.textContent = "";
      setBusy(submit, true);
      try {
        const data = await api("/api/state", { code });
        S.code = code;
        S.embed = false;
        storageSet(code);
        input.setAttribute("aria-invalid", "false");
        input.value = "";
        showApp();
        applyState(data);
        schedulePoll();
        $("#main").focus({ preventScroll: true });
        if (location.hash === "#add") openAdd({ manual: true });
      } catch (error) {
        input.setAttribute("aria-invalid", "true");
        err.textContent = error.kind === "auth" ? "That code wasn't accepted. Check it and try again."
          : error.kind === "throttle" ? "Too many wrong codes. Wait a minute, then try again."
            : error.kind === "network" ? "Can't reach the Stillgreen server. Check your connection and try again."
              : error.message;
        input.focus();
        input.select();
      } finally {
        setBusy(submit, false);
      }
    });
    $("#accessCode").addEventListener("input", () => {
      $("#accessCode").setAttribute("aria-invalid", "false");
      $("#loginError").textContent = "";
    });

    // Menu
    $("#menuButton").addEventListener("click", () => setMenu($("#menuList").hidden, true));
    $("#menuButton").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setMenu(true, true); }
    });
    $("#menuList").addEventListener("keydown", onMenuKey);
    document.addEventListener("click", (event) => {
      if (!$("#menuList").hidden && !event.target.closest(".menu")) setMenu(false);
    });
    $("#menuList").addEventListener("click", async (event) => {
      const item = event.target.closest("[data-menu]");
      if (!item) return;
      setMenu(false);
      const action = item.dataset.menu;
      if (action === "refresh") {
        $("#menuButton").focus();
        const ok = await refresh();
        schedulePoll();
        if (ok) toast("Up to date.", "info", 2000);
      } else if (action === "add") {
        $("#menuButton").focus();
        openAdd();
      } else if (action === "lock") {
        lock();
      }
    });

    // Pause / resume (all workspaces)
    $$("[data-pause]").forEach((button) => button.addEventListener("click", () => {
      const forever = button.dataset.pause === "forever";
      mutate(button, () => post("/api/pause", forever ? {} : { duration: button.dataset.pause }),
        (r) => (forever ? "Paused until you resume." : `Paused until ${fmtWhen(r.pause_until) || "later"}.`))
        .then((r) => { if (r) $("[data-resume]").focus(); });
    }));
    $("[data-resume]").addEventListener("click", (event) => {
      const button = event.currentTarget;
      mutate(button, () => post("/api/resume", {}), "Resumed. Workspaces reconnect in a few seconds.")
        .then((r) => { if (r) $('[data-pause="1h"]').focus(); });
    });

    // Keep me online
    $$("[data-stay]").forEach((button) => button.addEventListener("click", () => {
      mutate(button, () => post("/api/stay", { duration: button.dataset.stay }),
        (r) => `Staying online until ${fmtWhen(r.stay_until) || "later"}.`);
    }));
    $("#stayCancel").addEventListener("click", (event) => {
      mutate(event.currentTarget, () => post("/api/stay", { cancel: true }), "Stay-online override cancelled.")
        .then((r) => { if (r) $('[data-stay="1h"]').focus(); });
    });
    $("#stayUntil").addEventListener("input", () => { $("#stayUntilError").textContent = ""; $("#stayUntil").removeAttribute("aria-invalid"); });
    $("#stayUntilForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("#stayUntil");
      const error = $("#stayUntilError");
      const match = /^(\d{1,2}):(\d{2})/.exec(input.value || "");
      if (!match) { error.textContent = "Enter a time, like 17:00."; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const until = new Date();
      until.setHours(hours, minutes, 0, 0);
      if (until.getTime() <= Date.now()) {
        error.textContent = `${input.value} has already passed today. Pick a later time.`;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      error.textContent = "";
      input.removeAttribute("aria-invalid");
      // Send this browser's offset so a server on UTC stops at the right moment.
      const pad = (n) => String(Math.abs(n)).padStart(2, "0");
      const offset = -until.getTimezoneOffset();
      const iso = `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}T${pad(hours)}:${pad(minutes)}:00${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
      mutate($("#stayUntilSubmit"), () => post("/api/stay", { until: iso }), (r) => `Staying online until ${fmtWhen(r.stay_until) || input.value}.`);
    });

    // Workspaces
    $("#addOpen").addEventListener("click", () => openAdd());
    $("#addClose").addEventListener("click", dismissAdd);
    $("#addCancel").addEventListener("click", dismissAdd);
    $("#addForm").addEventListener("submit", submitAdd);
    $$("#addForm .input").forEach((input) => input.addEventListener("input", () => input.removeAttribute("aria-invalid")));
    window.addEventListener("hashchange", () => { if (location.hash === "#add" && S.data) openAdd({ manual: true }); });

    // Schedule
    const form = $("#scheduleForm");
    form.addEventListener("click", (event) => {
      const mode = event.target.closest("[data-mode]");
      if (mode) { editSchedule((d) => { d.mode = mode.dataset.mode; }); return; }
      const day = event.target.closest("[data-day]");
      if (day) {
        const key = day.dataset.day;
        editSchedule((d) => {
          d.days = d.days.includes(key) ? d.days.filter((k) => k !== key) : DAY_KEYS.filter((k) => k === key || d.days.includes(k));
        });
        return;
      }
      const preset = event.target.closest("[data-preset]");
      if (preset) editSchedule((d) => { d.days = preset.dataset.preset === "weekdays" ? [...WEEKDAYS] : [...DAY_KEYS]; });
    });
    $("#startTime").addEventListener("input", (e) => editSchedule((d) => { d.start = e.target.value; }));
    $("#endTime").addEventListener("input", (e) => editSchedule((d) => { d.end = e.target.value; }));
    $("#timezone").addEventListener("input", (e) => editSchedule((d) => { d.timezone = e.target.value; }));
    $("#timezone").addEventListener("focus", fillZones, { once: true });
    $("#scheduleDiscard").addEventListener("click", () => {
      S.sched.touched = false;
      S.sched.draft = null;
      renderSchedule();
      $("#scheduleForm [data-mode][aria-pressed='true']").focus();
    });
    form.addEventListener("submit", (event) => { event.preventDefault(); saveSchedule(); });

    // Access code
    $("#codeShow").addEventListener("click", () => { S.revealCode = !S.revealCode; renderCode(); });
    $("#codeCopy").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (await copyText(S.code)) {
        $(".btn-label", button).textContent = "Copied";
        setTimeout(() => { $(".btn-label", button).textContent = "Copy"; }, 1600);
        toast("Access code copied.");
      } else {
        S.revealCode = true;
        renderCode();
        const range = document.createRange();
        range.selectNodeContents($("#codeValue"));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast("Copying is blocked here. The code is selected; press Ctrl+C or ⌘C.", "info", 6000);
      }
    });
    $("#codeRotate").addEventListener("click", async () => {
      const result = await confirmAction({
        title: "Rotate the access code?",
        body: "A new code replaces the current one immediately. The hosted dashboard and the browser extension stop working until you paste the new code into them.",
        confirmLabel: "Rotate code",
        action: () => post("/api/code/rotate", {}),
      });
      if (!result || !result.code) return;
      S.code = normalizeCode(result.code);
      if (!S.embed) storageSet(S.code);
      S.revealCode = true;
      S.rotated = true;
      renderCode();
      toast("New access code is active. Update the dashboard and the extension.", "success", 7000);
      $("#codeCopy").focus();
    });

    // Polling follows tab visibility.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { stopPolling(); return; }
      if (S.code && !$("#app").hidden) { refresh().then(() => schedulePoll()); }
    });
    window.addEventListener("online", () => { if (S.code && S.offline) refresh().then(() => schedulePoll()); });
  }

  function fillZones() {
    let zones = [];
    try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []; } catch { zones = []; }
    const list = $("#tzList");
    list.replaceChildren(...["local", ...zones].map((z) => h("option", { value: z })));
  }

  // ------------------------------------------------------------------- init

  function init() {
    bind();
    paintEmptySchedule();
    if (S.embed) S.code = normalizeCode(boot.code);
    else S.code = normalizeCode(storageGet());
    if (!S.code) { showLogin(""); return; }
    showApp();
    renderTop();
    refresh().then((ok) => {
      if (ok && location.hash === "#add") openAdd({ manual: true });
      if (S.code) schedulePoll();
    });
  }

  function paintEmptySchedule() {
    S.sched.draft = { mode: "always", days: [...WEEKDAYS], start: "09:00", end: "17:00", timezone: browserZone() || "local", local: true };
    paintScheduleFields();
  }

  init();
})();
