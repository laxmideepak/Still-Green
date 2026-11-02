// Stillgreen control page. Vanilla JS, no dependencies, CSP-safe (no inline
// code, no eval). Every server-provided string is written with textContent.
// Look and class names: docs/design-system.md (tokens.css + ui.css).
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
  const STAY_LABELS = { "30m": ["30 min", 30], "1h": ["1 h", 60], "2h": ["2 h", 120], "3h": ["3 h", 180] };
  const ACTIVITY_SHORT = 6;

  // Workspace status -> [label, badge tone]. Same words as the web dashboard
  // (lib/dashboard.ts workspaceBadge).
  const STATUS = {
    active: ["Active", "success"],
    connected: ["Connected", "info"],
    away: ["Away", "neutral"],
    auto_away: ["Away", "neutral"],
    manual_away: ["Away (set by you)", "violet"],
    paused: ["Paused", "warning"],
    scheduled_off: ["Off schedule", "neutral"],
    daemon_stopped: ["Stopped", "neutral"],
    starting: ["Starting", "info"],
    reconnecting: ["Reconnecting", "info"],
    restarting: ["Reconnecting", "info"],
    stopped: ["Stopped", "neutral"],
    invalid_token: ["Signed out", "danger"],
    invalid_config: ["Check settings", "danger"],
    error: ["Error", "danger"],
  };

  // Line icons on a 24px grid (same paths as components/icons.tsx).
  const ICONS = {
    check: [["path", { d: "m4 12.5 5 5L20 6.5" }]],
    x: [["path", { d: "M6 6l12 12M18 6 6 18" }]],
    plus: [["path", { d: "M12 5v14M5 12h14" }]],
    pause: [["rect", { x: 6, y: 4.5, width: 4, height: 15, rx: 1, fill: "currentColor", stroke: "none" }], ["rect", { x: 14, y: 4.5, width: 4, height: 15, rx: 1, fill: "currentColor", stroke: "none" }]],
    play: [["path", { d: "M8 5.5 19 12 8 18.5v-13Z", fill: "currentColor" }]],
    trash: [["path", { d: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" }]],
    refresh: [["path", { d: "M20 11a8 8 0 0 0-14.5-4.5L4 8" }], ["path", { d: "M4 4v4h4" }], ["path", { d: "M4 13a8 8 0 0 0 14.5 4.5L20 16" }], ["path", { d: "M20 20v-4h-4" }]],
    info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v5M12 8h.01" }]],
    alert: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7.5v5M12 16h.01" }]],
    warn: [["path", { d: "M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" }], ["path", { d: "M12 9.5v4M12 17h.01" }]],
    grid: [["rect", { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.5 }], ["rect", { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.5 }], ["rect", { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.5 }], ["rect", { x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1.5 }]],
    clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7v5l3.2 2" }]],
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
    stay: { kind: "duration", value: "1h" },
    stayWasActive: null,
    activityExpanded: false,
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

  function icon(name, strokeWidth = 1.7) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" };
    for (const [k, v] of Object.entries(base)) svg.setAttribute(k, String(v));
    for (const [tag, attrs] of ICONS[name] || []) {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.append(node);
    }
    return svg;
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

  // Same clock as the web dashboard (lib/dashboard.ts clock): the browser's
  // own locale, so it matches the native time inputs next to it.
  const clockFmt = safeFormat({ hour: "numeric", minute: "2-digit" });
  const weekdayFmt = safeFormat({ weekday: "short" });
  const dateFmt = safeFormat({ month: "short", day: "numeric" });
  const longDateFmt = safeFormat({ weekday: "long", month: "short", day: "numeric" });
  function safeFormat(opts) {
    try { return new Intl.DateTimeFormat(undefined, opts); } catch { return new Intl.DateTimeFormat("en-GB", opts); }
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayDiff(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }

  // "9:00 AM" from "09:00".
  function clockHHMM(hhmm) {
    const m = minutesOf(hhmm);
    if (m === null) return hhmm || "";
    const d = new Date();
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return clockFmt.format(d);
  }

  // "just now", "12 s ago", "4 min ago", or a clock time.
  function ago(ms) {
    if (!ms) return "";
    const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds} s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    return clockFmt.format(new Date(ms));
  }

  // "HH:MM" for the Until picker. Same rule as lib/dashboard.ts defaultUntil:
  // 17:00, or two hours ahead once 17:00 is close or past, at most 23:59.
  function defaultUntil(now = new Date()) {
    const fivePm = new Date(now);
    fivePm.setHours(17, 0, 0, 0);
    if (fivePm.getTime() - now.getTime() > 15 * 60000) return "17:00";
    const next = now.getHours() + 2;
    if (next >= 24) return "23:59";
    return `${String(next).padStart(2, "0")}:00`;
  }

  // "5:00 PM", "tomorrow 9:00 AM", "Mon 9:00 AM", "Nov 12, 9:00 AM"
  function fmtWhen(iso) {
    if (!iso) return "";
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const t = clockFmt.format(d);
    const diff = dayDiff(d);
    if (diff === 0) return t;
    if (diff === 1) return `tomorrow ${t}`;
    if (diff > 1 && diff < 7) return `${weekdayFmt.format(d)} ${t}`;
    return `${dateFmt.format(d)}, ${t}`;
  }

  // "at 17:00" today, otherwise "tomorrow 09:00" / "Mon 09:00"
  function atWhen(iso) {
    const when = fmtWhen(iso);
    return when && /^\d/.test(when) ? `at ${when}` : when;
  }

  // "2 h 14 min", "5 min", "3 days 4 h"
  function fmtSpan(ms) {
    const minutes = Math.max(0, Math.round(ms / 60000));
    if (minutes < 1) return "less than a minute";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${plural(days, "day", "days")} ${hours % 24} h` : plural(days, "day", "days");
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

  function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
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
      throw new ApiError("Can't reach Stillgreen.", 0, "network");
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* empty or non-JSON body */ }
    if (response.status === 401) throw new ApiError("The access code was not accepted.", 401, "auth");
    if (response.status === 429) throw new ApiError("Too many wrong codes from this network. Wait a minute, then try again.", 429, "throttle");
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
      button.classList.add("is-loading");
      button.setAttribute("aria-busy", "true");
      if (!button.querySelector(".spinner")) {
        const spinner = h("span", { className: "spinner", attrs: { "aria-hidden": "true" } });
        const svg = button.querySelector(":scope > svg");
        if (svg) svg.hidden = true;
        button.prepend(spinner);
      }
    } else {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      button.querySelector(".spinner")?.remove();
      const svg = button.querySelector(":scope > svg");
      if (svg) svg.hidden = false;
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

  // toast("Staying online", "success", { description: "Until 17:00 today" })
  function toast(title, tone = "success", { description = "", timeout } = {}) {
    const region = $("#toasts");
    while (region.children.length >= 3) region.firstElementChild.remove();
    const glyph = { success: "check", danger: "alert", warning: "alert", info: "info" }[tone] || "info";
    const close = h("button", { className: "toast-close", type: "button", attrs: { "aria-label": "Dismiss" } }, icon("x"));
    const node = h("div", { className: `toast toast-${tone}`, attrs: { role: tone === "danger" ? "alert" : "status" } },
      h("span", { className: "toast-icon", attrs: { "aria-hidden": "true" } }, icon(glyph, 2.4)),
      h("div", { className: "toast-text" },
        h("span", { className: "toast-title", text: title }),
        description ? h("span", { className: "toast-description", text: description }) : null),
      close);
    let timer = 0;
    const dismiss = () => { clearTimeout(timer); node.remove(); };
    close.addEventListener("click", dismiss);
    const arm = () => { clearTimeout(timer); timer = setTimeout(dismiss, timeout || (tone === "danger" ? 8000 : 5000)); };
    node.addEventListener("mouseenter", () => clearTimeout(timer));
    node.addEventListener("mouseleave", arm);
    node.addEventListener("focusin", () => clearTimeout(timer));
    node.addEventListener("focusout", arm);
    region.append(node);
    arm();
  }

  function handleError(error) {
    if (error && error.kind === "auth") { sessionExpired(); return; }
    if (error && error.kind === "network") { markOffline(error.message); }
    toast(error && error.message ? error.message : "Something went wrong.", "danger");
  }

  // Run a mutation with a busy button; apply the returned state.
  // `success` returns a toast title, or [title, description].
  async function mutate(button, request, success) {
    if (isBusy(button)) return null;
    setBusy(button, true);
    try {
      const result = await request();
      S.mutationSeq += 1;
      clearStaleStayError();
      applyState(result && result.state ? result.state : result);
      const message = typeof success === "function" ? success(result) : success;
      if (Array.isArray(message)) toast(message[0], "success", { description: message[1] });
      else if (message) toast(message);
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
      document.documentElement.classList.remove("has-dialog");
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
    document.documentElement.classList.add("has-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    (initialFocus || $(FOCUSABLE, dialog))?.focus();
    return close;
  }

  // In-page replacement for window.confirm. `action` runs while the dialog
  // shows a busy button; errors stay in the dialog.
  function confirmAction({ title, body, confirmLabel, glyph = "trash", action }) {
    const dialog = $("#confirmDialog");
    const ok = $("#confirmOk");
    const cancelBtn = $("#confirmCancel");
    const error = $("#confirmError");
    $("#confirmTitle").textContent = title;
    $("#confirmBody").replaceChildren(...(Array.isArray(body) ? body : [body]));
    $("#confirmIcon").replaceChildren(icon(glyph));
    $(".btn-label", ok).textContent = confirmLabel;
    error.replaceChildren();
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
        error.replaceChildren();
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
          const message = err && err.message ? err.message : "Something went wrong.";
          error.replaceChildren(icon("alert"), h("span", { text: /SG_LOCAL_BRIDGE_CODE/.test(message)
            ? "This code is fixed by the SG_LOCAL_BRIDGE_CODE setting on this server. Change it there, then restart Stillgreen."
            : message }));
          ok.focus();
        }
      };
      $("#confirmForm").addEventListener("submit", submit);
      cancelBtn.addEventListener("click", dismiss);
      close = openDialog(dialog, { initialFocus: cancelBtn, onCancel: dismiss, onClosed: () => finish(null) });
    });
  }

  // ------------------------------------------------------------------- views

  function showLogin(message = "") {
    stopPolling();
    closeOpenDialogs();
    $("#app").hidden = true;
    $("#login").hidden = false;
    $("#loginHost").textContent = location.host || "this server";
    $("#loginError").replaceChildren(...(message ? [icon("alert"), h("span", { text: message })] : []));
    $("#accessCode").setAttribute("aria-invalid", message ? "true" : "false");
    document.title = "Stillgreen · Locked";
    setTimeout(() => $("#accessCode").focus(), 30);
  }

  function loginError(message) {
    $("#loginError").replaceChildren(...(message ? [icon("alert"), h("span", { text: message })] : []));
  }

  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    document.title = "Stillgreen";
    if (!S.data) $("#app").classList.add("is-loading");
  }

  function closeOpenDialogs() {
    $$("dialog[open]").forEach((d) => d.close());
  }

  function forget() {
    S.code = "";
    S.data = null;
    S.sigs = {};
    S.revealCode = false;
    S.rotated = false;
  }

  function sessionExpired() {
    if (!S.embed) storageClear();
    forget();
    showLogin(S.embed
      ? "The access code changed. Reload this page, or enter the new code."
      : "You were signed out because the access code changed. Enter the current code.");
  }

  function lock() {
    storageClear();
    forget();
    $("#app").classList.add("is-loading");
    showLogin("");
    $("#accessCode").value = "";
    toast("Page locked", "info", { description: "The access code was removed from this browser." });
  }

  function markOffline(reason) {
    S.offline = true;
    S.offlineReason = reason || "";
    renderTop();
    renderBanners();
    if (S.data) renderUpdated();
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
    renderDaemon();
    $("#version").textContent = S.data.version ? `v${S.data.version}` : "";
  }

  function setBadge(el, tone, text, textEl) {
    el.className = `badge badge-${tone}`;
    (textEl || el).textContent = text;
  }

  function renderTop() {
    const host = location.hostname;
    $("#hostKind").textContent = LOOPBACK.has(host) ? "This computer" : "Server";
    $("#hostName").textContent = location.host;
    $("#menuLock").hidden = S.embed;
    const pill = $("#statusPill");
    const text = $("#statusText");
    const d = S.data;
    let tone = "neutral";
    let label = "Connecting";
    if (S.offline) { tone = "warning"; label = "Offline, retrying"; }
    else if (d && (!d.daemon || !d.daemon.running)) { tone = "danger"; label = "Stopped"; }
    else if (d) { const n = onlineCount(d); tone = n ? "success" : "neutral"; label = n ? `${n} online` : "Running"; }
    setBadge(pill, tone, label, text);
    $("#hostDot").dataset.tone = tone;
  }

  function banner(tone, glyph, title, bodyNodes, action) {
    return h("div", { className: `banner banner-${tone}`, attrs: { role: tone === "danger" ? "alert" : "status" } },
      icon(glyph),
      h("div", { className: "banner-text" }, h("p", { className: "banner-title", text: title }), h("p", { className: "banner-description" }, bodyNodes)),
      action ? h("div", { className: "banner-actions" }, action) : null);
  }

  function renderBanners() {
    const d = S.data;
    const items = [];
    if (S.offline) items.push(["offline", S.lastOk, S.offlineReason]);
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
        const why = reason && reason !== "Can't reach Stillgreen." ? `${reason} ` : "";
        return banner("warning", "warn", "Can't reach Stillgreen",
          d ? `${why}Showing what we last saw${since}. Trying again by itself.` : `${why}Trying again by itself.`, retry);
      }
      if (kind === "config") {
        return banner("danger", "alert", "There's a problem with the settings file", [sentence(extra), " Changes are blocked until the file is fixed."]);
      }
      return banner("warning", "warn", "Stillgreen isn't running",
        ["Nothing is kept green until it starts. On a computer, run ", h("code", { text: "./sg-local start" }),
          ". On a server, run ", h("code", { text: "sudo docker compose up -d" }), "."]);
    });
    $("#banners").replaceChildren(...nodes);
  }

  // Workspaces that are green right now. A workspace paused a moment ago can
  // still be reported as connected until the daemon drops it. Same rule as
  // lib/dashboard.ts onlineCount.
  function onlineCount(d) {
    if (d.paused && !d.stay_active) return 0;
    return d.workspaces.filter((w) => w.connected && w.status === "active" && !w.paused).length;
  }

  // The end of "You'll stay online until 5:00 PM, …" (lib/dashboard.ts afterStay).
  function afterStay(d) {
    if (d.paused) return "then your pause carries on";
    if (d.schedule && d.schedule.mode === "scheduled") return "then your schedule takes over";
    return "then Stillgreen goes back to always on";
  }

  function modeLabel(d) {
    if (d.stay_active) return "Keep me online";
    if (d.paused) return "Paused";
    return d.schedule && d.schedule.mode === "scheduled" ? "Scheduled" : "Always on";
  }

  function nextChangeText(d) {
    const sched = d.schedule || {};
    if (d.stay_active && d.stay_until) return `Ends ${atWhen(d.stay_until)}`;
    if (d.paused && !d.stay_active) return d.pause_until ? `Resumes ${atWhen(d.pause_until)}` : "When you resume";
    if (sched.mode === "scheduled" && sched.next_change) return `Turns ${sched.active ? "off" : "on"} ${atWhen(sched.next_change)}`;
    return "Nothing planned";
  }

  // The big line at the top, in plain words (lib/dashboard.ts presenceSummary).
  // Tones: green, amber, blue (off schedule), red, muted.
  function presenceSummary(d) {
    const total = d.workspaces.length;
    const online = onlineCount(d);
    const sched = d.schedule || {};
    const greenIn = `Your Slack status is green in ${online} of ${plural(total, "workspace", "workspaces")}.`;
    if (d.config_error) return { tone: "red", title: "Settings file problem", description: "Stillgreen can't read its settings file, so it isn't keeping anyone green." };
    if (!d.daemon || !d.daemon.running) return { tone: "amber", title: "Stopped", description: "Stillgreen isn't running, so it isn't keeping you green." };
    if (!total) return { tone: "muted", title: "Ready", detail: "Add a workspace to start", description: "Stillgreen starts keeping your Slack status green as soon as you add a workspace." };
    if (d.stay_active) {
      return {
        tone: online ? "green" : "amber",
        title: online ? "Active" : "Connecting",
        detail: d.stay_until ? `Staying online until ${fmtWhen(d.stay_until)}` : "Staying online",
        description: `${online ? greenIn : "Stillgreen is connecting to Slack."} When it ends, ${afterStay(d).replace(/^then /, "")}.`,
      };
    }
    if (d.paused) {
      return {
        tone: "amber",
        title: "Paused",
        detail: d.pause_until ? `Until ${fmtWhen(d.pause_until)}` : "Until you resume",
        description: "Stillgreen isn't keeping you green right now. Slack will set you away as usual.",
      };
    }
    if (d.workspaces.every((w) => w.paused)) {
      return {
        tone: "amber",
        title: "Paused",
        detail: total === 1 ? "Your workspace is paused" : "Every workspace is paused",
        description: "Resume a workspace below to turn it back on.",
      };
    }
    if (sched.mode === "scheduled" && !sched.active) {
      const next = sched.next_change ? fmtWhen(sched.next_change) : "";
      return {
        tone: "blue",
        title: "Off schedule",
        detail: next ? `Back ${/^\d/.test(next) ? `at ${next}` : next.startsWith("tomorrow") ? next : `on ${next}`}` : "",
        description: "You're outside your schedule, so Slack shows your normal status.",
      };
    }
    if (!online) {
      return {
        tone: "amber",
        title: "Not green yet",
        detail: "Connecting to Slack",
        description: "No workspace is active right now. This usually takes a few seconds. Check the workspaces below.",
      };
    }
    const next = sched.mode === "scheduled" && sched.next_change ? fmtWhen(sched.next_change) : "";
    return {
      tone: "green",
      title: "Active",
      detail: sched.mode === "always" || !sched.mode ? "Always on" : next ? `Until ${next}` : "On schedule",
      description: greenIn + (sched.mode === "scheduled" ? " Your schedule ends it on its own." : " You stay green until you pause."),
    };
  }

  function renderOverview() {
    const d = S.data;
    const total = d.workspaces.length;
    const summary = presenceSummary(d);
    $("#overview").dataset.tone = summary.tone;
    $("#overviewTitle").replaceChildren(
      h("span", { className: "hero-state", text: summary.title }),
      summary.detail ? h("span", { className: "hero-sep", text: " · " }) : null,
      summary.detail ? h("span", { className: "hero-rest", text: summary.detail }) : null);
    $("#overviewDetail").textContent = summary.description;
    $("#factOnline").textContent = total ? `${onlineCount(d)} of ${total}` : "None yet";
    $("#factMode").textContent = modeLabel(d);
    $("#factNext").textContent = nextChangeText(d);
    renderUpdated();

    $("#pageSub").textContent = `${longDateFmt.format(new Date())} · Times shown in ${browserZone() || "your time zone"}`;

    const canPause = !d.paused && total > 0;
    $('[data-pause="1h"]').hidden = !canPause;
    $('[data-pause="forever"]').hidden = !canPause;
    $("[data-resume]").hidden = !d.paused;
  }

  function renderUpdated() {
    $("#factUpdated").textContent = S.offline ? "Can't reach" : ago(S.lastOk) || "Just now";
  }

  // ---------------------------------------------------------- keep me online

  function stayTarget() {
    if (S.stay.kind === "duration") {
      const [, minutes] = STAY_LABELS[S.stay.value] || STAY_LABELS["1h"];
      return new Date(Date.now() + minutes * 60000);
    }
    if (S.stay.kind !== "until") return null;
    const m = minutesOf($("#stayUntil").value);
    if (m === null) return null;
    const until = new Date();
    until.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return until;
  }

  // Same words and layout as the web dashboard's Keep me online card.
  function paintStayPicker() {
    const d = S.data;
    const active = Boolean(d && d.stay_active);
    $$("[data-stay]").forEach((b) => b.setAttribute("aria-pressed", String(S.stay.kind === "duration" && b.dataset.stay === S.stay.value)));
    $("#stayUntilBox").classList.toggle("is-active", S.stay.kind === "until");
    $("#stayOn").hidden = !active;
    $("#stayCancel").hidden = !active;
    const button = $("#stayUntilSubmit");
    button.hidden = active && !S.stay.kind;
    const value = $("#stayUntil").value;
    const label = S.stay.kind === "duration" ? `Keep on for ${STAY_LABELS[S.stay.value][0]}`
      : S.stay.kind === "until" ? `Keep on until ${value ? clockHHMM(value) : "…"}` : "Keep on";
    if (!isBusy(button)) $(".btn-label", button).textContent = label;
    const preview = $("#stayPreview");
    if (active && d.stay_until) {
      const left = new Date(d.stay_until).getTime() - Date.now();
      preview.replaceChildren("You're staying online until ", h("strong", { className: "tnum", text: fmtWhen(d.stay_until) }),
        left > 0 ? ` · ${fmtSpan(left)} left.` : ".");
      return;
    }
    if (active) { preview.replaceChildren("Keep me online is on."); return; }
    const target = stayTarget();
    if (!target) { preview.replaceChildren("Pick how long to stay online."); return; }
    if (S.stay.kind === "until" && target.getTime() <= Date.now()) {
      preview.replaceChildren("Pick a time later today.");
      return;
    }
    preview.replaceChildren("You'll stay online until ", h("strong", { className: "tnum", text: clockFmt.format(target) }),
      `, ${d ? afterStay(d) : "then it ends on its own"}.`);
  }

  function renderStay() {
    const active = Boolean(S.data.stay_active);
    // After Keep me online starts or ends, reset the picker for the next time.
    if (S.stayWasActive !== null && S.stayWasActive !== active) {
      S.stay = active ? { kind: null } : { kind: "duration", value: "1h" };
      setStayError("");
    } else if (S.stayWasActive === null && active) {
      S.stay = { kind: null };
    }
    S.stayWasActive = active;
    paintStayPicker();
  }

  function submitStay(event) {
    event.preventDefault();
    const button = $("#stayUntilSubmit");
    const input = $("#stayUntil");
    if (S.stay.kind === "duration") {
      const value = S.stay.value;
      mutate(button, () => post("/api/stay", { duration: value }),
        (r) => ["Staying online", `Until ${fmtWhen(r.stay_until) || "later"}`]);
      return;
    }
    if (S.stay.kind !== "until") return;
    const m = minutesOf(input.value);
    if (m === null) { setStayError("Pick a time."); input.focus(); return; }
    const hours = Math.floor(m / 60);
    const minutes = m % 60;
    const until = new Date();
    until.setHours(hours, minutes, 0, 0);
    if (until.getTime() <= Date.now()) {
      setStayError("That time has already passed today. Pick a later time.");
      input.focus();
      return;
    }
    setStayError("");
    // Send this browser's offset so a server on UTC stops at the right moment.
    const pad = (n) => String(Math.abs(n)).padStart(2, "0");
    const offset = -until.getTimezoneOffset();
    const iso = `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}T${pad(hours)}:${pad(minutes)}:00${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
    mutate(button, () => post("/api/stay", { until: iso }), (r) => ["Staying online", `Until ${fmtWhen(r.stay_until) || clockHHMM(input.value)} today`]);
  }

  // After any other change, an old "Pick a time" error goes away and an
  // emptied Until field goes back to a sensible pick.
  function clearStaleStayError() {
    if (!$("#stayUntilError").childNodes.length) return;
    setStayError("");
    if (!$("#stayUntil").value) {
      $("#stayUntil").value = defaultUntil();
      if (S.stay.kind === "until") S.stay = S.data && S.data.stay_active ? { kind: null } : { kind: "duration", value: "1h" };
    }
  }

  function setStayError(message) {
    const input = $("#stayUntil");
    $("#stayUntilError").replaceChildren(...(message ? [icon("alert"), h("span", { text: message })] : []));
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }

  // -------------------------------------------------------------- workspaces

  function wsTone(item) {
    if (item.paused) return ["Paused", "warning"];
    if (S.data && S.data.paused && !S.data.stay_active) return ["Paused", "warning"];
    return STATUS[item.status] || [sentence(String(item.status || "Unknown").replace(/_/g, " ")).replace(/\.$/, ""), "neutral"];
  }

  // One plain line under a workspace name (lib/dashboard.ts workspaceNote).
  function workspaceNote(item) {
    if (item.status === "invalid_token") return "Slack signed this session out. Capture it again with the extension.";
    if (item.status === "manual_away") return "You set yourself away, so Stillgreen leaves it alone.";
    if (item.paused) return "Paused until you resume it";
    if (item.connected) return "Live connection to Slack";
    if (item.status === "scheduled_off") return "Waiting for your schedule";
    if (item.status === "daemon_stopped") return "Stillgreen isn't running";
    if (item.reason) return sentence(item.reason).replace(/\.$/, "");
    return "Not connected";
  }

  // Same palette and hash as lib/dashboard.ts avatarTone, so a workspace has
  // the same color on both pages.
  const AVATAR_TONES = ["info", "violet", "neutral"];
  function avatarTone(key) {
    let n = 0;
    for (const ch of String(key)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_TONES[n % AVATAR_TONES.length];
  }

  function renderWorkspaces() {
    const d = S.data;
    const list = $("#workspaceList");
    const total = d.workspaces.length;
    const sig = JSON.stringify([d.paused && !d.stay_active, d.workspaces.map((w) => [w.team_id, w.name, w.connected, w.paused, w.status, w.reason, w.last_error])]);
    const count = $("#workspaceCount");
    count.hidden = !total;
    count.textContent = String(total);
    count.setAttribute("aria-label", plural(total, "workspace", "workspaces"));
    $("#workspacesSub").textContent = total
      ? `${onlineCount(d)} of ${total} online. Your Slack login stays on this ${LOOPBACK.has(location.hostname) ? "computer" : "server"}.`
      : "Slack workspaces Stillgreen keeps green.";
    if (S.sigs.ws === sig) return;
    S.sigs.ws = sig;
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.key : "";
    list.setAttribute("role", total ? "list" : "presentation");

    if (!total) {
      const add = h("button", { className: "btn btn-primary", type: "button", dataset: { key: "empty-add" } }, icon("plus"), h("span", { className: "btn-label", text: "Add workspace" }));
      add.addEventListener("click", () => openAdd());
      list.replaceChildren(h("div", { className: "empty" },
        h("span", { className: "empty-icon", attrs: { "aria-hidden": "true" } }, icon("grid")),
        h("h3", { className: "empty-title", text: "No workspaces yet" }),
        h("p", { className: "empty-description", text: "Open Slack in Chrome and click Capture from Slack in the Stillgreen extension." }),
        h("div", { className: "empty-actions" }, add)));
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
    }, icon(item.paused ? "play" : "pause"), h("span", { className: "btn-label", text: item.paused ? "Resume" : "Pause" }));
    toggle.addEventListener("click", () => {
      const resume = item.paused;
      mutate(toggle, () => post(resume ? "/api/resume" : "/api/pause", { workspace: item.team_id }),
        resume ? [`${name} resumed`, "It reconnects in a few seconds."] : [`${name} paused`, "It stays paused until you resume it."]);
    });
    const remove = h("button", {
      className: "btn btn-destructive-ghost btn-sm", type: "button",
      dataset: { key: `ws-remove-${item.team_id}` },
      attrs: { "aria-label": `Remove ${name}` },
    }, icon("trash"), h("span", { className: "btn-label", text: "Remove" }));
    remove.addEventListener("click", () => removeWorkspace(item, name));

    return h("div", { className: "ws", attrs: { role: "listitem" } },
      h("span", { className: "avatar", dataset: { tone: avatarTone(item.team_id || name) }, attrs: { "aria-hidden": "true" }, text: initial }),
      h("div", { className: "ws-who" },
        h("div", { className: "ws-line" },
          h("span", { className: "ws-name", text: name, attrs: { title: name } }),
          h("span", { className: `badge badge-${tone}` }, h("span", { className: "dot", attrs: { "aria-hidden": "true" } }), label)),
        h("div", { className: "ws-meta" }, h("span", { text: workspaceNote(item) })),
        item.last_error && item.status !== "active" ? h("p", { className: "ws-error" }, icon("alert"), h("span", { text: sentence(item.last_error).replace(/\.$/, "") })) : null),
      h("div", { className: "ws-actions" }, toggle, remove));
  }

  async function removeWorkspace(item, name) {
    const result = await confirmAction({
      title: `Remove ${name}?`,
      body: "Stillgreen will stop keeping you green there and delete its saved Slack login. You can add it again any time.",
      confirmLabel: "Remove workspace",
      glyph: "trash",
      action: () => api(`/api/workspaces/${encodeURIComponent(item.team_id)}`, { method: "DELETE" }),
    });
    if (!result) return;
    S.mutationSeq += 1;
    applyState(result.state);
    toast(`${result.removed || name} removed`, "success", { description: "Its saved Slack login was deleted from your Stillgreen." });
    ($('[data-key="empty-add"]') || $("#workspacesCard .card-header")).focus();
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
    if (draft.mode !== "scheduled") return validZone(draft.timezone) ? "" : "Unknown time zone. Use a name like America/New_York.";
    if (!draft.days.length) return "Pick at least one day.";
    if (!draft.start || !draft.end) return "Enter a start and an end time.";
    if (draft.start === draft.end) return "Start and end can't be the same time.";
    if (!draft.timezone.trim()) return "Enter a time zone, like America/New_York.";
    if (!validZone(draft.timezone.trim())) return "Unknown time zone. Use a name like America/New_York.";
    return "";
  }

  function weeklyHours(draft) {
    const a = minutesOf(draft.start);
    const b = minutesOf(draft.end);
    if (a === null || b === null || a === b) return 0;
    const per = b > a ? b - a : 24 * 60 - a + b;
    return (per * draft.days.length) / 60;
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
    $("#scheduleSummary").textContent = "All changes saved";
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
        className: "chip day", type: "button", dataset: { day: key }, attrs: { "aria-pressed": "false", "aria-label": full }, text: short,
      })));
    }
    $$("[data-day]", picker).forEach((b) => b.setAttribute("aria-pressed", String(draft.days.includes(b.dataset.day))));
    if ($("#startTime").value !== draft.start) $("#startTime").value = draft.start;
    if ($("#endTime").value !== draft.end) $("#endTime").value = draft.end;
    if ($("#timezone").value !== draft.timezone) $("#timezone").value = draft.timezone;
    // Same line as the web dashboard: "Weekdays, 9:00 AM to 5:00 PM · 40 hours a week".
    const hours = weeklyHours(draft);
    const hoursText = ` · ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours a week`;
    const a = minutesOf(draft.start);
    const b = minutesOf(draft.end);
    const overnight = a !== null && b !== null && b < a ? " (ends the next day)" : "";
    $("#scheduleSummaryText").textContent = draft.days.length
      ? `${daysLabel(draft.days)}, ${clockHHMM(draft.start)} to ${clockHHMM(draft.end)}${overnight}${hoursText}`
      : "No days picked yet";
  }

  function updateScheduleState() {
    const draft = S.sched.draft;
    const dirty = scheduleDirty();
    const problem = dirty ? scheduleProblem(draft) : "";
    $("#scheduleDirty").hidden = !dirty;
    $("#scheduleDiscard").hidden = !dirty;
    $("#scheduleSummary").hidden = dirty;
    const save = $("#scheduleSave");
    if (!isBusy(save)) save.disabled = !dirty || Boolean(problem);
    save.classList.toggle("btn-primary", dirty);
    save.classList.toggle("btn-secondary", !dirty);
    $("#scheduleError").replaceChildren(...(problem ? [icon("alert"), h("span", { text: problem })] : []));
    $("#timezone").setAttribute("aria-invalid", String(Boolean(problem) && /time zone/i.test(problem)));
    const zone = browserZone();
    $("#tzHint").textContent = zone && draft.timezone.trim() !== zone
      ? `This browser is in ${zone}. An end before the start runs overnight.`
      : "Start and end follow this time zone. An end before the start runs overnight.";
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
    if (problem) { updateScheduleState(); return; }
    const timezone = draft.timezone.trim() || browserZone() || "local";
    const saved = await mutate($("#scheduleSave"), () => post("/api/schedule", {
      mode: draft.mode,
      active_days: draft.days,
      start_time: draft.start,
      end_time: draft.end,
      timezone,
    }), ["Schedule saved", "Stillgreen uses it within a few seconds."]);
    if (saved) {
      S.sched.touched = false;
      S.sched.draft = null;
      renderSchedule();
    } else {
      updateScheduleState();
    }
  }

  // --------------------------------------------------------------- activity

  // When an entry happened, in this browser's time zone. Older daemons send
  // only their own local date and time.
  function activityDate(entry) {
    const d = new Date(entry.at || `${entry.date}T${entry.time}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function renderActivity() {
    const all = S.data.activity || [];
    const events = S.activityExpanded ? all : all.slice(0, ACTIVITY_SHORT);
    const foot = $("#activityFoot");
    foot.hidden = all.length <= ACTIVITY_SHORT;
    $("#activityShown").textContent = `Showing ${events.length} of ${all.length}`;
    const toggle = $("#activityToggle");
    toggle.textContent = S.activityExpanded ? "Show less" : "Show all";
    toggle.setAttribute("aria-expanded", String(S.activityExpanded));
    const sig = JSON.stringify([S.activityExpanded, new Date().toDateString(), events]);
    if (S.sigs.log === sig) return;
    S.sigs.log = sig;
    const list = $("#activity");
    if (!events.length) {
      list.replaceChildren(h("li", { className: "log-empty", text: "Nothing yet. Events show up here when Stillgreen connects to Slack or checks your status." }));
      return;
    }
    const dated = events.map((entry) => [entry, activityDate(entry)]);
    const days = new Set(dated.map(([, at]) => (at ? dayLabel(at) : "")));
    const withDays = days.size > 1 || (days.size === 1 && !days.has("Today"));
    const nodes = [];
    let lastDay = "";
    for (const [entry, at] of dated) {
      const day = at ? dayLabel(at) : "";
      if (withDays && day && day !== lastDay) {
        lastDay = day;
        nodes.push(h("li", { className: "day-sep", text: day }));
      }
      const tone = ["green", "amber"].includes(entry.tone) ? entry.tone : "muted";
      const glyph = tone === "green" ? icon("check", 2.4) : tone === "amber" ? icon("warn", 2.4) : h("i");
      nodes.push(h("li", { className: "log-item" },
        h("span", { className: "log-icon", dataset: { tone }, attrs: { "aria-hidden": "true" } }, glyph),
        h("span", { className: "log-msg" },
          h("span", { className: "log-text", text: entry.summary || sentence(entry.text).replace(/\.$/, ""), attrs: { title: entry.text } }),
          entry.workspace ? h("span", { className: "log-ws", text: entry.workspace }) : null),
        h("time", { className: "log-time mono", attrs: { datetime: entry.at || `${entry.date}T${entry.time}` }, text: at ? clockFmt.format(at) : entry.time })));
    }
    list.replaceChildren(...nodes);
  }

  // "Today", "Yesterday" or "Sun, Nov 1" (lib/dashboard.ts dayHeading).
  function dayLabel(d) {
    const diff = dayDiff(d);
    if (diff === 0) return "Today";
    if (diff === -1) return "Yesterday";
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
    show.setAttribute("aria-label", S.revealCode ? "Hide access code" : "Show access code");
    show.title = S.revealCode ? "Hide" : "Show";
    show.classList.toggle("is-revealed", S.revealCode);
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

  // ----------------------------------------------------------------- daemon

  function renderDaemon() {
    const d = S.data;
    const running = Boolean(d.daemon && d.daemon.running);
    setBadge($("#daemonBadge"), running ? "success" : "danger", running ? "Running" : "Stopped", $("#daemonBadgeText"));
    $("#factHost").textContent = location.host;
    $("#factVersion").textContent = d.version || "—";
    const started = running && d.daemon.started_at ? new Date(d.daemon.started_at).getTime() : NaN;
    $("#factUptime").textContent = running ? (Number.isNaN(started) ? "Running" : fmtSpan(Date.now() - started)) : "Not running";
    const tz = d.schedule && d.schedule.timezone;
    $("#factZone").textContent = isLocalZone(tz) ? (d.server_timezone || "This server's clock") : String(tz);
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
    $("#addError").replaceChildren();
    $("#addOrigin").textContent = location.origin;
    $$("#addForm .input").forEach((i) => i.removeAttribute("aria-invalid"));
    closeAdd = openDialog($("#addDialog"), {
      initialFocus: manual ? $("#xoxc") : $("#addCancel"),
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

  // The error sits right under the two fields and is scrolled into view, so
  // it is seen on a phone too.
  function addError(message) {
    const box = $("#addError");
    box.replaceChildren(...(message ? [icon("alert"), h("span", { text: message })] : []));
    if (message) box.scrollIntoView({ block: "nearest" });
  }

  async function submitAdd(event) {
    event.preventDefault();
    const submit = $("#addSubmit");
    if (isBusy(submit)) return;
    const xoxc = $("#xoxc").value.trim();
    const xoxd = $("#xoxd").value.trim();
    const name = $("#wsName").value.trim();
    $("#xoxc").setAttribute("aria-invalid", String(!xoxc));
    $("#xoxd").setAttribute("aria-invalid", String(!xoxd));
    if (!xoxc || !xoxd) {
      addError(!xoxc && !xoxd ? "Paste both values." : !xoxc ? "Paste the xoxc token too." : "Paste the xoxd cookie too.");
      (!xoxc ? $("#xoxc") : $("#xoxd")).focus();
      return;
    }
    addError("");
    setBusy(submit, true);
    $(".btn-label", submit).textContent = "Checking with Slack";
    $("#addCancel").disabled = true;
    try {
      const result = await post("/api/workspaces", { xoxc, xoxd, name });
      S.mutationSeq += 1;
      setBusy(submit, false);
      $(".btn-label", submit).textContent = "Verify & add";
      $("#addCancel").disabled = false;
      dismissAdd();
      applyState(result.state);
      toast(`${result.name || "Workspace"} added`, "success", { description: "Connecting to Slack now." });
    } catch (err) {
      setBusy(submit, false);
      $(".btn-label", submit).textContent = "Verify & add";
      $("#addCancel").disabled = false;
      if (err.kind === "auth") { dismissAdd(); sessionExpired(); return; }
      // Slack checks the two values together, so a refusal marks both.
      const refused = err.kind === "request" && /reject|invalid|token|cookie|xox/i.test(err.message);
      addError(refused ? "Slack didn't accept these values. Copy both again from the same signed-in tab." : err.message);
      if (refused) {
        $("#xoxc").setAttribute("aria-invalid", "true");
        $("#xoxd").setAttribute("aria-invalid", "true");
      }
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
      if (!code) {
        loginError("Enter the access code.");
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      input.value = code;
      loginError("");
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
        loginError(error.kind === "auth" ? "That code wasn't accepted. Check it and try again."
          : error.kind === "throttle" ? "Too many wrong codes. Wait a minute, then try again."
            : error.kind === "network" ? "Can't reach Stillgreen. Check your connection and try again."
              : error.message);
        input.focus();
        input.select();
      } finally {
        setBusy(submit, false);
      }
    });
    $("#accessCode").addEventListener("input", () => {
      $("#accessCode").setAttribute("aria-invalid", "false");
      loginError("");
    });

    // Menu
    $("#menuButton").addEventListener("click", () => setMenu($("#menuList").hidden, true));
    $("#menuButton").addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setMenu(true, true); }
    });
    $("#menuList").addEventListener("keydown", onMenuKey);
    document.addEventListener("click", (event) => {
      if (!$("#menuList").hidden && !event.target.closest(".menu-wrap")) setMenu(false);
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
        if (ok) toast("Up to date", "info", { timeout: 2000 });
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
        (r) => (forever
          ? ["Paused until you resume", r.stay_active ? "Keep me online is still on. The pause starts when it ends." : "Slack will set you away as usual."]
          : ["Paused for 1 hour", r.stay_active && r.stay_until
            ? `Keep me online is on until ${fmtWhen(r.stay_until)}, so the pause starts after that.`
            : `Stillgreen starts again ${atWhen(r.pause_until) || "later"}.`]))
        .then((r) => { if (r) $("[data-resume]").focus(); });
    }));
    $("[data-resume]").addEventListener("click", (event) => {
      const button = event.currentTarget;
      mutate(button, () => post("/api/resume", {}), ["Resumed", "Stillgreen is keeping you green again."])
        .then((r) => { if (r) $('[data-pause="1h"]').focus(); });
    });

    // Keep me online
    $$("[data-stay]").forEach((button) => button.addEventListener("click", () => {
      S.stay = { kind: "duration", value: button.dataset.stay };
      setStayError("");
      paintStayPicker();
    }));
    $("#stayCancel").addEventListener("click", (event) => {
      mutate(event.currentTarget, () => post("/api/stay", { cancel: true }), ["Keep me online is off", "Your normal settings apply again."])
        .then((r) => { if (r) $("#stayUntilSubmit").focus(); });
    });
    const pickUntil = () => { S.stay = { kind: "until" }; setStayError(""); paintStayPicker(); };
    $("#stayUntil").addEventListener("input", pickUntil);
    $("#stayUntil").addEventListener("focus", () => { if (S.stay.kind !== "until") pickUntil(); });

    $("#stayUntilForm").addEventListener("submit", submitStay);

    // Workspaces
    $("#addOpen").addEventListener("click", () => openAdd());
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
        button.classList.add("is-copied");
        setTimeout(() => button.classList.remove("is-copied"), 1600);
        toast("Access code copied");
      } else {
        S.revealCode = true;
        renderCode();
        const range = document.createRange();
        range.selectNodeContents($("#codeValue"));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast("Copy it by hand", "info", { description: "This browser blocked copying. The code is selected; press Ctrl+C or ⌘C.", timeout: 7000 });
      }
    });
    $("#codeRotate").addEventListener("click", async () => {
      const result = await confirmAction({
        title: "Change the access code?",
        body: "You get a new code right away and the old one stops working. The web dashboard and the browser extension stay disconnected until you paste the new code into them.",
        confirmLabel: "Change code",
        glyph: "refresh",
        action: () => post("/api/code/rotate", {}),
      });
      if (!result || !result.code) return;
      S.code = normalizeCode(result.code);
      if (!S.embed) storageSet(S.code);
      S.revealCode = true;
      S.rotated = true;
      renderCode();
      toast("New access code is active", "success", { description: "Paste it into the web dashboard and the extension.", timeout: 8000 });
      $("#codeCopy").focus();
    });

    // Activity: show the newest few, or all.
    $("#activityToggle").addEventListener("click", () => {
      S.activityExpanded = !S.activityExpanded;
      renderActivity();
    });

    // Keep relative times fresh between polls.
    setInterval(() => { if (S.data && !$("#app").hidden) { renderStay(); renderDaemon(); renderUpdated(); } }, 10000);

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
    $("#stayUntil").value = defaultUntil();
    bind();
    paintEmptySchedule();
    paintStayPicker();
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
