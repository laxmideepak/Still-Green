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

  // How long Slack's "you are active" answer counts as fresh. The daemon asks
  // about once a minute. Same rule as lib/dashboard.ts PRESENCE_FRESH_MS.
  const PRESENCE_FRESH_MS = 5 * 60000;
  const REPORT_FILENAME = "stillgreen-diagnostics.txt";

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
    diag: { result: null, error: null, running: false },
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

  // `info` is the problem in plain words: { code, title, message, action }.
  class ApiError extends Error {
    constructor(message, status, kind, info) {
      super(message);
      this.status = status;
      this.kind = kind;
      this.info = info || { code: kind || "unknown", title: "That didn't work", message, action: "" };
    }
  }

  function apiError(status, payload) {
    const text = payload && payload.error ? String(payload.error) : "";
    if (status === 401) {
      return new ApiError("The access code was not accepted.", 401, "auth", {
        code: "access_code_wrong", title: "Access code not accepted", message: "The access code was not accepted.",
        action: "Copy it again, or run ./sg-local web --show-code.",
      });
    }
    if (status === 429) {
      return new ApiError("Too many wrong codes from this network. Wait a minute, then try again.", 429, "throttle", {
        code: "too_many_attempts", title: "Too many wrong codes", message: "Stillgreen saw too many wrong access codes from this network.",
        action: "Wait one minute, then try again.",
      });
    }
    if (status === 421) {
      return new ApiError("Stillgreen doesn't know this address.", 421, "request", {
        code: "wrong_host", title: "Stillgreen doesn't know this address", message: "It only accepts the host names it was set up with.",
        action: "Use the address Stillgreen showed when it started, or add this name to SG_LOCAL_WEB_HOSTS and restart it.",
      });
    }
    if (status === 404) {
      return new ApiError("This Stillgreen is too old for that.", 404, "request", {
        code: "not_supported", title: "This Stillgreen can't do that yet", message: "Your Stillgreen does not know this request.",
        action: "Update Stillgreen (git pull in its folder), then restart it. You can also run ./sg-local doctor in a terminal.",
      });
    }
    const kind = status >= 500 || status === 0 ? "server" : "request";
    // Newer daemons explain the problem themselves (shared error catalogue).
    const own = payload && payload.error_info && typeof payload.error_info === "object" ? payload.error_info : null;
    if (own && own.title) {
      const info = { code: own.code || "unknown", title: String(own.title), message: String(own.message || ""), action: String(own.action || "") };
      return new ApiError(info.message || info.title, status, kind, info);
    }
    const message = sentence(text) || `Request failed (${status}).`;
    return new ApiError(message, status, kind, {
      code: kind === "server" ? "server_error" : "request_refused",
      title: kind === "server" ? "Stillgreen had a problem" : "That didn't work",
      message,
      action: kind === "server" ? "Try again. If it keeps happening, run ./sg-local doctor." : "",
    });
  }

  // fetch with the access code. `raw` returns the Response (for files).
  async function api(path, { method = "GET", body, code = S.code, raw = false, timeout = 15000 } = {}) {
    if (!/^[\x21-\x7e]+$/.test(code || "")) throw new ApiError("That access code isn't valid.", 401, "auth");
    let response;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : 0;
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
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      const slow = error && error.name === "AbortError";
      throw new ApiError(slow ? "Stillgreen took too long to answer." : "Can't reach Stillgreen.", 0, "network", slow
        ? { code: "network_timeout", title: "Stillgreen took too long to answer", message: "It did not answer in time.", action: "Check that it is running, then try again." }
        : { code: "daemon_not_running", title: "Can't reach Stillgreen", message: "Nothing answered at this address.", action: "Check that Stillgreen is running (./sg-local start, or docker compose up -d on a server)." });
    } finally {
      clearTimeout(timer);
    }
    if (raw && response.ok) return response;
    let payload = {};
    try { payload = await response.json(); } catch { /* empty or non-JSON body */ }
    if (!response.ok || payload.ok === false) throw apiError(response.status, payload);
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
    const info = error && error.info;
    if (info && info.title && info.code !== "request_refused") {
      toast(info.title, "danger", { description: [info.message, info.action].filter(Boolean).join(" ") });
      return;
    }
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
    renderMood();
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
    S.diag = { result: null, error: null, running: false };
    renderDiag();
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
    if (S.data) { renderUpdated(); renderSignals(); renderSetup(); }
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
    renderSignals();
    renderSetup();
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
    else if (d) {
      const n = confirmedCount(d);
      const live = d.workspaces.filter((w) => w.connected && !w.paused).length;
      tone = n ? "success" : live ? "info" : "neutral";
      label = n ? `${n} active` : live ? "Connected" : "Running";
    }
    setBadge(pill, tone, label, text);
    $("#hostDot").dataset.tone = tone;
    renderMood();
  }

  // The logo switch is on (laughing) while Stillgreen is keeping you green:
  // the headline says Active, or Connected and waiting for Slack to confirm
  // (the same rule as the web dashboard). Anything else (paused, stopped,
  // offline, off schedule, no workspace) flips it off.
  function renderMood() {
    const p = !S.offline && S.data ? presenceSummary(S.data) : null;
    const on = !!p && p.keepingGreen === true;
    document.querySelectorAll(".logo").forEach((mark) => { mark.dataset.mood = on ? "on" : "off"; });
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
        return banner("danger", "alert", "There's a problem with the settings file", [sentence(extra), " Changes are blocked until the file is fixed. Run ", h("code", { text: "./sg-local doctor" }), " to see why."]);
      }
      return banner("warning", "warn", "Stillgreen isn't running",
        ["It can't help keep you active until it starts. On a computer, run ", h("code", { text: "./sg-local start" }),
          ". On a server, run ", h("code", { text: "sudo docker compose up -d" }), "."]);
    });
    $("#banners").replaceChildren(...nodes);
  }

  // Workspaces that are green right now. A workspace paused a moment ago can
  // still be reported as connected until the daemon drops it. Same rule as
  // lib/dashboard.ts onlineCount.
  function onlineCount(d) {
    if (d.paused && !d.stay_active) return 0;
    return d.workspaces.filter((w) => w.connected && w.status === "active" && !w.paused && presenceConfirmed(w, d)).length;
  }

  // The end of "Stillgreen keeps helping until 5:00 PM, …" (lib/dashboard.ts afterStay).
  function afterStay(d) {
    if (d.paused) return "then your pause carries on";
    if (d.schedule && d.schedule.mode === "scheduled") return "then your schedule takes over";
    return "then it goes back to always on";
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

  // ------------------------------------------------------ verified presence
  // Same rules as lib/dashboard.ts (reportsPresence, presenceConfirmed, ...).

  function reportsPresence(w) { return w.presence_verified_at !== undefined || w.presence !== undefined; }

  function dateMs(value) {
    if (!value) return NaN;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? NaN : ms;
  }

  // Milliseconds between Slack's last "active" answer and the daemon's clock.
  function presenceAge(w, d) {
    const verified = dateMs(w.presence_verified_at);
    if (Number.isNaN(verified)) return null;
    const server = dateMs(d.server_time);
    return Math.max(0, (Number.isNaN(server) ? Date.now() : server) - verified);
  }

  // Slack itself recently said you are active here. Older daemons only say
  // "active" after Slack did, so a live "active" counts there.
  function presenceConfirmed(w, d) {
    if (w.paused) return false;
    if (!reportsPresence(w)) return Boolean(w.connected && w.status === "active");
    if (w.presence === "away" || w.presence === "manual_away") return false;
    const age = presenceAge(w, d);
    return age !== null && age <= PRESENCE_FRESH_MS;
  }

  function confirmedCount(d) {
    if (d.paused && !d.stay_active) return 0;
    return d.workspaces.filter((w) => presenceConfirmed(w, d)).length;
  }

  function workspaceAuth(w) {
    if (["ok", "rejected", "unknown"].includes(w.auth)) return w.auth;
    if (w.status === "invalid_token") return "rejected";
    if (w.connected || ["active", "away", "auto_away", "manual_away", "connected"].includes(w.status)) return "ok";
    return "unknown";
  }

  // The workspace's problem in plain words; the daemon's own words when sent.
  function workspaceProblem(w) {
    if (w.last_error_info && w.last_error_info.title) return w.last_error_info;
    if (w.status === "invalid_token" || w.auth === "rejected") {
      return { code: "slack_auth_rejected", title: "Slack signed you out here", message: "Slack no longer accepts the saved login for this workspace.", action: "Open Slack in Chrome, sign in, and click Capture from Slack in the extension again." };
    }
    if (w.last_error && w.status !== "active") {
      return { code: "unknown", title: "Problem talking to Slack", message: sentence(w.last_error), action: "Stillgreen keeps trying. If it doesn't clear, use Check my setup." };
    }
    return null;
  }

  // When Slack last confirmed you anywhere, in this browser's clock.
  function latestConfirmation(d) {
    let best = null;
    for (const w of d.workspaces) {
      const age = presenceAge(w, d);
      if (age === null) continue;
      const at = (S.lastOk || Date.now()) - age;
      if (best === null || at > best) best = at;
    }
    return best;
  }

  // The three signals (lib/dashboard.ts statusSignals): running, login, presence.
  function statusSignals(d) {
    const running = d.health ? Boolean(d.health.daemon) : Boolean(d.daemon && d.daemon.running);
    const total = d.workspaces.length;
    const sig = (id, label, tone, value, detail) => ({ id, label, tone, value, detail });

    let one;
    if (S.offline) one = sig("running", "Stillgreen running", "warn", "Can't reach it", "This page can't reach Stillgreen right now. It keeps trying.");
    else if (!running) one = sig("running", "Stillgreen running", "fail", "Stopped", "Start it with ./sg-local start (on a server: docker compose up -d).");
    else if (d.config_error) one = sig("running", "Stillgreen running", "fail", "Settings problem", "It is running but can't read its settings file. Run ./sg-local doctor.");
    else {
      const started = dateMs(d.daemon && d.daemon.started_at);
      one = sig("running", "Stillgreen running", "pass", "Running", Number.isNaN(started) ? "It just started." : `Running for ${fmtSpan(Date.now() - started)}.`);
    }

    let two;
    const auths = d.workspaces.map(workspaceAuth);
    const rejected = d.workspaces.filter((_, i) => auths[i] === "rejected");
    const accepted = auths.filter((a) => a === "ok").length;
    if (!total) two = sig("login", "Slack login valid", "off", "No workspace yet", "Add your Slack with the Stillgreen browser extension.");
    else if (rejected.length) {
      two = sig("login", "Slack login valid", "fail", rejected.length === total ? "Signed out" : `Signed out in ${rejected.length} of ${total}`,
        `Slack signed you out of ${rejected.map((w) => w.name).join(", ")}. Open Slack in Chrome and click Capture from Slack again.`);
    } else if (d.health && d.health.slack_reachable === false) {
      const problem = d.workspaces.map(workspaceProblem).find(Boolean);
      two = sig("login", "Slack login valid", "fail", "Can't reach Slack",
        problem ? `${problem.title}. ${problem.action}` : "Stillgreen can't reach Slack. Use Check my setup to find out why.");
    } else if (accepted === total) {
      two = sig("login", "Slack login valid", "pass", "Valid", total === 1 ? "Slack accepts your saved login." : `Slack accepts your saved login in all ${total} workspaces.`);
    } else if (!running || S.offline) {
      two = sig("login", "Slack login valid", "off", "Not checked", "Stillgreen checks your login when it connects to Slack.");
    } else {
      two = sig("login", "Slack login valid", accepted ? "warn" : "off", accepted ? `Valid in ${accepted} of ${total}` : "Not checked yet",
        "Stillgreen checks your login each time it connects to Slack.");
    }

    const p = (tone, value, detail) => sig("presence", "Presence confirmed", tone, value, detail);
    let three;
    const sched = d.schedule || {};
    const pausedAll = d.paused && !d.stay_active;
    const live = d.workspaces.filter((w) => !w.paused && workspaceAuth(w) !== "rejected");
    const wanted = live.filter((w) => w.status !== "manual_away" && w.presence !== "manual_away");
    const confirmed = wanted.filter((w) => presenceConfirmed(w, d));
    const latest = latestConfirmation(d);
    const agoText = latest ? ago(latest) : "";
    if (S.offline) three = p("warn", "Unknown", "Shown again when this page can reach Stillgreen.");
    else if (!running) three = p("off", "Not checked", "Needs Stillgreen to be running.");
    else if (!total) three = p("off", "Nothing to check yet", "Add a workspace first.");
    else if (pausedAll || d.workspaces.every((w) => w.paused)) three = p("off", "Paused", "Stillgreen is paused, so Slack shows your normal status.");
    else if (!live.length) three = p("fail", "Not confirmed", "No workspace can connect until you capture it again.");
    else if (sched.mode === "scheduled" && !sched.active && !d.stay_active) three = p("off", "Off schedule", "Outside your hours, so Slack shows your normal status.");
    else if (!wanted.length) three = p("off", "Away (set by you)", "You set yourself away in Slack, so Stillgreen leaves it alone.");
    else if (confirmed.length === wanted.length) {
      three = p("pass", agoText ? `Confirmed ${agoText}` : "Confirmed",
        `Slack's own status check shows you as active${wanted.length === 1 ? "" : ` in all ${wanted.length} workspaces`}.`);
    } else if (confirmed.length) three = p("warn", `Confirmed in ${confirmed.length} of ${wanted.length}`, "Slack has not confirmed the other workspaces yet. Stillgreen keeps trying.");
    else if (wanted.some((w) => w.presence === "away" || ["away", "auto_away"].includes(w.status))) three = p("warn", "Slack shows you away", "Stillgreen is reconnecting to try again. Slack decides your final status.");
    else if (latest) three = p("warn", `Last confirmed ${agoText}`, "Slack has not confirmed you as active lately. Stillgreen keeps trying.");
    else if (wanted.some((w) => w.connected)) three = p("warn", "Waiting for Slack", "Connected. Stillgreen asks Slack about once a minute.");
    else if (wanted.some((w) => workspaceProblem(w))) three = p("fail", "Not confirmed", "Stillgreen can't connect to Slack. See the workspace below.");
    else three = p("warn", "Waiting for Slack", "Stillgreen is connecting to Slack. This usually takes a few seconds.");
    return [one, two, three];
  }

  // The big line at the top, in plain words (lib/dashboard.ts presenceSummary).
  // It says "Active" only when Slack itself recently confirmed it.
  // Tones: green, amber, blue (off schedule, waiting), red, muted.
  // keepingGreen marks the summaries where the logo switch is on.
  function presenceSummary(d) {
    const total = d.workspaces.length;
    const online = onlineCount(d);
    const confirmed = confirmedCount(d);
    const connected = d.workspaces.filter((w) => w.connected && !w.paused).length;
    const sched = d.schedule || {};
    const confirmedIn = `Slack confirmed you as active in ${confirmed} of ${plural(total, "workspace", "workspaces")}.`;
    const waiting = {
      tone: "blue",
      keepingGreen: true,
      title: "Connected",
      detail: "waiting for Slack to confirm",
      description: "Stillgreen has a live connection, like the Slack web app. Slack decides your final status; Stillgreen asks it about once a minute.",
    };
    if (d.config_error) return { tone: "red", title: "Settings file problem", description: "Stillgreen can't read its settings file, so it isn't keeping you active." };
    if (!d.daemon || !d.daemon.running) return { tone: "amber", title: "Stopped", description: "Stillgreen isn't running, so it isn't keeping you active." };
    if (!total) return { tone: "muted", title: "Ready", detail: "Add a workspace to start", description: "Stillgreen starts helping as soon as you add a Slack workspace." };
    if (d.stay_active) {
      const after = `When it ends, ${afterStay(d).replace(/^then /, "")}.`;
      if (confirmed) {
        return { tone: "green", keepingGreen: true, title: "Active", detail: d.stay_until ? `Staying online until ${fmtWhen(d.stay_until)}` : "Staying online", description: `${confirmedIn} ${after}` };
      }
      if (online || connected) return { ...waiting, description: `Keep me online is on. Stillgreen is connected and waiting for Slack to confirm. ${after}` };
      return { tone: "amber", title: "Connecting", detail: d.stay_until ? `Staying online until ${fmtWhen(d.stay_until)}` : "Staying online", description: `Stillgreen is connecting to Slack. ${after}` };
    }
    if (d.paused) {
      return {
        tone: "amber",
        title: "Paused",
        detail: d.pause_until ? `Until ${fmtWhen(d.pause_until)}` : "Until you resume",
        description: "Stillgreen isn't keeping you active right now. Slack will set you away as usual.",
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
    if (!confirmed) {
      if (online || connected) return waiting;
      return {
        tone: "amber",
        title: "Not active yet",
        detail: "Connecting to Slack",
        description: "No workspace is connected right now. This usually takes a few seconds. Check the workspaces below.",
      };
    }
    const next = sched.mode === "scheduled" && sched.next_change ? fmtWhen(sched.next_change) : "";
    return {
      tone: "green",
      keepingGreen: true,
      title: "Active",
      detail: sched.mode === "always" || !sched.mode ? "Always on" : next ? `Until ${next}` : "On schedule",
      description: confirmedIn + (sched.mode === "scheduled" ? " Your schedule ends it on its own." : " Stillgreen keeps helping until you pause it."),
    };
  }

  const SIGNAL_WORDS = { pass: "OK", warn: "Check", fail: "Problem", off: "Not needed now", skip: "Skipped" };
  function signalGlyph(tone) {
    if (tone === "pass") return icon("check", 2.4);
    if (tone === "warn") return icon("warn", 2);
    if (tone === "fail") return icon("alert", 2);
    return h("i");
  }

  function renderSignals() {
    const signals = statusSignals(S.data);
    const sig = JSON.stringify(signals);
    if (S.sigs.signals === sig) return;
    S.sigs.signals = sig;
    $("#signals").replaceChildren(...signals.map((item) => h("li", { className: "signal", dataset: { tone: item.tone, signal: item.id } },
      h("span", { className: "signal-icon", dataset: { tone: item.tone }, attrs: { "aria-hidden": "true" } }, signalGlyph(item.tone)),
      h("div", { className: "signal-text" },
        h("span", { className: "signal-label", text: item.label }),
        h("span", { className: "signal-value" }, h("span", { className: "visually-hidden", text: `${SIGNAL_WORDS[item.tone]}: ` }), item.value),
        h("span", { className: "signal-detail", text: item.detail })))));
  }

  // ------------------------------------------------------- setup checklist
  // Worked out from live state each time (lib/dashboard.ts setupSteps).

  function setupSteps(d) {
    const running = !S.offline && (d.health ? Boolean(d.health.daemon) : Boolean(d.daemon && d.daemon.running));
    const total = d.workspaces.length;
    const diag = S.diag.result;
    const tls = diag && diag.checks ? diag.checks.find((c) => c.id === "tls") : null;
    const reachable = d.health ? d.health.slack_reachable : undefined;
    const netProblem = d.workspaces.map((w) => w.last_error_info).find((i) => i && /^(tls_|dns_|proxy_|network_)/.test(i.code || ""));
    const steps = [];
    steps.push({ id: "running", title: "Stillgreen running", status: running ? "done" : "problem",
      detail: running ? "Stillgreen is running and this page can reach it." : "Start it with ./sg-local start (on a server: docker compose up -d)." });
    let tlsStep;
    if (tls && tls.status === "fail") tlsStep = { status: "problem", detail: tls.action || tls.detail };
    else if (netProblem) tlsStep = { status: "problem", detail: `${netProblem.title}. ${netProblem.action}` };
    else if (reachable === false) tlsStep = { status: "problem", detail: "Stillgreen can't reach Slack. Use Check my setup to see why." };
    else if ((tls && tls.status === "pass") || reachable === true || d.workspaces.some((w) => workspaceAuth(w) === "ok")) tlsStep = { status: "done", detail: "Stillgreen can reach Slack over a secure connection." };
    else if (tls && tls.status === "warn") tlsStep = { status: "waiting", detail: tls.action || tls.detail };
    else tlsStep = { status: running ? "todo" : "waiting", detail: "Not tested yet. Click Check my setup to test it." };
    steps.push({ id: "tls", title: "Secure connection to Slack", ...tlsStep });
    const rejected = d.workspaces.filter((w) => workspaceAuth(w) === "rejected");
    steps.push({ id: "slack", title: "Add your Slack", status: !total ? "todo" : rejected.length ? "problem" : "done",
      detail: !total ? "Open Slack in Chrome, then click Capture from Slack in the Stillgreen extension."
        : rejected.length ? `Slack signed you out of ${rejected.map((w) => w.name).join(", ")}. Capture it again with the extension.`
          : `${plural(total, "workspace", "workspaces")} added.` });
    const sched = d.schedule || {};
    const scheduled = sched.mode === "scheduled";
    // Done only once the person saved or confirmed their hours.
    const chosen = typeof sched.saved === "boolean" ? sched.saved : scheduled;
    const hoursNow = scheduled ? `Scheduled: ${sched.summary || daysLabel(sched.active_days)}.` : "Always on.";
    steps.push({ id: "hours", title: "Choose your hours", status: chosen ? "done" : "todo",
      detail: chosen ? `${hoursNow} Change it under Schedule any time.`
        : `Now: ${hoursNow} Pick Always on or Scheduled under Schedule and save, so Stillgreen helps only when you want.` });
    const auto = d.autostart;
    if (auto && auto.supported) {
      steps.push({ id: "startup", title: "Start at login (optional)", status: auto.enabled ? "done" : "todo",
        detail: auto.enabled ? "Stillgreen starts by itself when you log in to this Mac."
          : `To start Stillgreen when you log in to this Mac, run ${auto.command || "./sg-local install-launchd"}` });
    }
    // The same checks as the "Presence confirmed" signal.
    const pausedAll = d.paused && !d.stay_active;
    const offSchedule = scheduled && !sched.active && !d.stay_active;
    const wanted = d.workspaces.filter((w) => !w.paused && workspaceAuth(w) !== "rejected" && w.status !== "manual_away" && w.presence !== "manual_away");
    const confirmed = pausedAll || offSchedule ? 0 : wanted.filter((w) => presenceConfirmed(w, d)).length;
    const wantedNow = !pausedAll && !offSchedule && wanted.length > 0;
    let presence;
    if (!running || !total) presence = { status: "todo", detail: "Finish the steps above first." };
    else if (!wantedNow) presence = { status: "todo", detail: "Paused, outside your hours, or set away by you, so there is nothing to confirm right now." };
    else if (confirmed === wanted.length) presence = { status: "done", detail: wanted.length === 1 ? "Slack's own status check shows you as active." : `Slack's own status check shows you as active in all ${wanted.length} workspaces.` };
    else presence = { status: "waiting", detail: confirmed ? `Confirmed in ${confirmed} of ${wanted.length}. Waiting for Slack to confirm the others. Stillgreen asks about once a minute.` : "Waiting for Slack to confirm. Stillgreen asks about once a minute." };
    steps.push({ id: "presence", title: "Presence confirmed", ...presence });
    return steps;
  }

  const STEP_WORDS = { done: "Done", todo: "To do", problem: "Needs attention", waiting: "Waiting" };

  function renderSetup() {
    const steps = setupSteps(S.data);
    const show = steps.some((s) => s.status === "problem" || (s.id === "slack" && s.status === "todo"));
    const card = $("#setupCard");
    card.hidden = !show;
    if (!show) return;
    const done = steps.filter((s) => s.status === "done").length;
    $("#setupCount").textContent = `${done}/${steps.length}`;
    $("#setupSub").textContent = `${done} of ${steps.length} steps done. This list follows what Stillgreen reports, so you can come back to it any time.`;
    const sig = JSON.stringify(steps);
    if (S.sigs.setup === sig) return;
    S.sigs.setup = sig;
    $("#setupSteps").replaceChildren(...steps.map((step, index) => {
      const glyph = step.status === "done" ? icon("check", 2.4) : step.status === "problem" ? icon("alert", 2) : step.status === "waiting" ? icon("clock", 2) : h("span", { text: String(index + 1) });
      let action = null;
      if (step.id === "tls" && step.status !== "done") {
        action = h("button", { className: "btn btn-secondary btn-sm", type: "button", dataset: { key: "setup-check" } }, h("span", { className: "btn-label", text: "Check my setup" }));
        action.addEventListener("click", () => { $("#diagCard").scrollIntoView({ block: "start" }); runDiagnostics(); });
      } else if (step.id === "slack" && step.status !== "done") {
        action = h("button", { className: "btn btn-secondary btn-sm", type: "button", dataset: { key: "setup-add" } }, h("span", { className: "btn-label", text: step.status === "problem" ? "How to capture again" : "Add workspace" }));
        action.addEventListener("click", () => openAdd());
      } else if (step.id === "hours" && step.status !== "done") {
        action = h("button", { className: "btn btn-secondary btn-sm", type: "button", dataset: { key: "setup-hours" } }, h("span", { className: "btn-label", text: "Choose hours" }));
        action.addEventListener("click", () => $("#scheduleCard").scrollIntoView({ block: "start" }));
      }
      return h("li", { className: "setup-step", dataset: { status: step.status, step: step.id } },
        h("span", { className: "step-icon", dataset: { status: step.status }, attrs: { "aria-hidden": "true" } }, glyph),
        h("div", { className: "step-text" },
          h("span", { className: "step-title" }, `${index + 1}. ${step.title}`, h("span", { className: "visually-hidden", text: `: ${STEP_WORDS[step.status]}.` })),
          h("span", { className: "step-detail", text: step.detail })),
        action || h("span", { className: "step-state", dataset: { status: step.status }, text: STEP_WORDS[step.status] }));
    }));
  }

  // --------------------------------------------------------- check my setup

  const CHECK_BADGE = { pass: ["OK", "success"], warn: ["Check", "warning"], fail: ["Problem", "danger"], skip: ["Skipped", "neutral"] };

  function problemNodes(info) {
    return [
      icon("alert"),
      h("div", {},
        h("p", { className: "problem-title", text: info.title }),
        info.message ? h("p", { className: "problem-message", text: info.message }) : null,
        info.action ? h("p", { className: "problem-action" }, h("b", { text: "What to do: " }), info.action) : null),
    ];
  }

  function renderDiag() {
    const { result, error } = S.diag;
    const run = $("#diagRun");
    if (!isBusy(run)) $(".btn-label", run).textContent = result ? "Check again" : "Check my setup";
    $("#diagIntro").hidden = Boolean(result || error);
    const box = $("#diagError");
    box.hidden = !error;
    box.replaceChildren(...(error ? problemNodes(error) : []));
    const list = $("#diagChecks");
    list.hidden = !result;
    $("#diagBody").classList.toggle("is-flush", Boolean(result));
    const badge = $("#diagBadge");
    badge.hidden = !result;
    if (!result) { list.replaceChildren(); return; }
    const fails = result.checks.filter((c) => c.status === "fail").length;
    const warns = result.checks.filter((c) => c.status === "warn").length;
    setBadge(badge, fails ? "danger" : warns ? "warning" : "success",
      fails ? plural(fails, "problem", "problems") : warns ? `${warns} to check` : "All good", $("#diagBadgeText"));
    list.replaceChildren(...result.checks.map((check) => {
      const [word, tone] = CHECK_BADGE[check.status] || CHECK_BADGE.warn;
      return h("li", { className: "check", dataset: { status: check.status, check: check.id } },
        h("span", { className: "signal-icon", dataset: { tone: check.status === "skip" ? "off" : check.status }, attrs: { "aria-hidden": "true" } }, signalGlyph(check.status)),
        h("div", { className: "check-text" },
          h("span", { className: "check-label" }, check.label, h("span", { className: `badge badge-${tone}`, text: word })),
          check.detail ? h("span", { className: "check-detail", text: check.detail }) : null,
          check.action && check.status !== "pass" ? h("span", { className: "check-action" }, h("b", { text: "What to do: " }), check.action) : null));
    }));
    $("#diagNote").textContent = `The report has no passwords, Slack tokens, cookies or access code. Read it before you share it.${result.generated_at ? ` Checked at ${clockFmt.format(new Date(result.generated_at))}.` : ""}`;
  }

  async function runDiagnostics() {
    const button = $("#diagRun");
    if (isBusy(button) || !S.code) return;
    setBusy(button, true);
    $(".btn-label", button).textContent = "Checking";
    S.diag.running = true;
    try {
      // fresh=1: a new run, not the copy the daemon keeps for 30 seconds.
      const result = await api("/api/diagnostics?fresh=1", { timeout: 30000 });
      S.diag.result = { generated_at: result.generated_at, checks: Array.isArray(result.checks) ? result.checks : [] };
      S.diag.error = null;
    } catch (error) {
      if (error && error.kind === "auth") { sessionExpired(); return; }
      S.diag.error = error && error.info ? error.info : { code: "unknown", title: "The check didn't run", message: String(error && error.message || ""), action: "Try again." };
    } finally {
      S.diag.running = false;
      setBusy(button, false);
      renderDiag();
      if (S.data) renderSetup();
    }
  }

  async function downloadReport() {
    const button = $("#diagDownload");
    if (isBusy(button) || !S.code) return;
    setBusy(button, true);
    $(".btn-label", button).textContent = "Preparing";
    try {
      const response = await api("/api/diagnostics/report", { raw: true, timeout: 30000 });
      const text = await response.text();
      const match = /filename="?([^";]+)"?/i.exec(response.headers.get("Content-Disposition") || "");
      const filename = match && /^[\w.-]+$/.test(match[1]) ? match[1] : REPORT_FILENAME;
      const href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      const link = h("a", { href, download: filename, attrs: { hidden: "" } });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      toast("Report saved", "success", { description: `${filename} is in your downloads. It has no passwords, tokens or access code.` });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(button, false);
      $(".btn-label", button).textContent = "Download report";
    }
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
      preview.replaceChildren("Stillgreen is helping until ", h("strong", { className: "tnum", text: fmtWhen(d.stay_until) }),
        left > 0 ? ` · ${fmtSpan(left)} left.` : ".");
      return;
    }
    if (active) { preview.replaceChildren("Keep me online is on."); return; }
    const target = stayTarget();
    if (!target) { preview.replaceChildren("Pick how long to keep helping."); return; }
    if (S.stay.kind === "until" && target.getTime() <= Date.now()) {
      preview.replaceChildren("Pick a time later today.");
      return;
    }
    preview.replaceChildren("Stillgreen keeps helping until ", h("strong", { className: "tnum", text: clockFmt.format(target) }),
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
    // "Active" only once Slack's own check confirmed it recently.
    if (item.status === "active" && S.data && !presenceConfirmed(item, S.data)) return ["Connected", "info"];
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
    const sig = JSON.stringify([d.paused && !d.stay_active, d.workspaces.map((w) => [w.team_id, w.name, w.connected, w.paused, w.status, w.reason, w.last_error, w.last_error_info, w.auth, presenceConfirmed(w, d)])]);
    const count = $("#workspaceCount");
    count.hidden = !total;
    count.textContent = String(total);
    count.setAttribute("aria-label", plural(total, "workspace", "workspaces"));
    $("#workspacesSub").textContent = total
      ? `${onlineCount(d)} of ${total} online. Your Slack login stays on this ${LOOPBACK.has(location.hostname) ? "computer" : "server"}.`
      : "Slack workspaces Stillgreen helps keep active.";
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
        wsProblem(item)),
      h("div", { className: "ws-actions" }, toggle, remove));
  }

  function wsProblem(item) {
    const info = item.status === "active" && !item.last_error_info ? null : workspaceProblem(item);
    return info ? h("div", { className: "ws-problem" }, ...problemNodes(info)) : null;
  }

  async function removeWorkspace(item, name) {
    const result = await confirmAction({
      title: `Remove ${name}?`,
      body: "Stillgreen will stop working there and delete its saved Slack login. To end that login in Slack too, use Sign out of all other sessions in Slack. You can add the workspace again any time.",
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
    // Not saved or confirmed yet (first run): saving it as it is counts.
    const unconfirmed = Boolean(S.data && S.data.schedule && S.data.schedule.saved === false);
    const problem = dirty || unconfirmed ? scheduleProblem(draft) : "";
    $("#scheduleDirty").hidden = !dirty;
    $("#scheduleDiscard").hidden = !dirty;
    $("#scheduleSummary").hidden = dirty;
    $("#scheduleSummary").textContent = unconfirmed ? "Not saved yet" : "All changes saved";
    const save = $("#scheduleSave");
    if (!isBusy(save)) save.disabled = !(dirty || unconfirmed) || Boolean(problem);
    save.classList.toggle("btn-primary", dirty || unconfirmed);
    save.classList.toggle("btn-secondary", !(dirty || unconfirmed));
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
    $("#factUpdate").hidden = !(d.daemon && d.daemon.update_pending);
    const auto = d.autostart;
    $("#factStartupRow").hidden = !auto;
    if (auto) {
      $("#factStartup").textContent = auto.supported ? (auto.enabled ? "On" : "Off") : "Not built in here";
      $("#factStartupNote").replaceChildren(String(auto.note || ""),
        ...(auto.command ? [" ", h("code", { className: "mono", text: auto.command })] : []));
    }
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
      const code = err.info && err.info.code;
      const refused = err.kind === "request" && (code === "slack_auth_rejected" || /reject|invalid|token|cookie|xox/i.test(err.message));
      const known = err.info && err.info.title && code !== "request_refused" && code !== "invalid_input";
      addError(refused ? "Slack didn't accept these values. Copy both again from the same signed-in tab."
        : known ? [err.info.title + ".", err.info.message, err.info.action ? "What to do: " + err.info.action : ""].filter(Boolean).join(" ")
          : err.message);
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
      mutate(button, () => post("/api/resume", {}), ["Resumed", "Stillgreen is helping keep you active again."])
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

    // Check my setup
    $("#diagRun").addEventListener("click", runDiagnostics);
    $("#diagDownload").addEventListener("click", downloadReport);

    // Activity: show the newest few, or all.
    $("#activityToggle").addEventListener("click", () => {
      S.activityExpanded = !S.activityExpanded;
      renderActivity();
    });

    // Keep relative times fresh between polls.
    setInterval(() => { if (S.data && !$("#app").hidden) { renderStay(); renderDaemon(); renderUpdated(); renderSignals(); } }, 10000);

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
    if (!S.code) { showLogin(""); bootDone(); return; }
    showApp();
    renderTop();
    bootDone();
    refresh().then((ok) => {
      if (ok && location.hash === "#add") openAdd({ manual: true });
      if (S.code) schedulePoll();
    });
  }

  // The page is drawn: drop the "didn't load" message from index.html.
  function bootDone() {
    const fail = document.getElementById("bootFail");
    if (fail) fail.remove();
  }

  function paintEmptySchedule() {
    S.sched.draft = { mode: "always", days: [...WEEKDAYS], start: "09:00", end: "17:00", timezone: browserZone() || "local", local: true };
    paintScheduleFields();
  }

  init();
})();
