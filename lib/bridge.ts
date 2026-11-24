export type BridgeConfig = {
  url: string;
  code: string;
};

/**
 * A problem in plain words, from the daemon's error catalogue
 * (sg_local/errors.py) or from this file for problems seen in the browser.
 */
export type ErrorInfo = {
  code: string;
  title: string;
  message: string;
  action: string;
};

/** Slack's login check for one workspace. Older daemons don't send it. */
export type AuthState = "ok" | "rejected" | "unknown";

/** What Slack last said about your status. Older daemons don't send it. */
export type PresenceState = "active" | "away" | "manual_away" | "unknown";

export type WorkspaceState = {
  team_id: string;
  name: string;
  user_id: string;
  paused: boolean;
  status: string;
  connected: boolean;
  reason: string;
  last_presence: string | null;
  last_error: string | null;
  stats: {
    pings?: number;
    tickles?: number;
    presence_checks?: number;
    connections?: number;
    reconnects?: number;
  };
  added_at?: string | null;
  /** Newer daemons: did Slack accept the saved login? */
  auth?: AuthState;
  /** Newer daemons: what Slack's own status check last said. */
  presence?: PresenceState;
  /** Newer daemons: the last time Slack's users.getPresence said "active". */
  presence_verified_at?: string | null;
  /** Newer daemons: the last problem, in plain words. */
  last_error_info?: ErrorInfo | null;
};

/** Newer daemons: a quick health summary. */
export type HealthState = {
  daemon: boolean;
  slack_reachable: boolean | null;
  checked_at: string | null;
};

export type ActivityEntry = {
  /** The daemon's local date and time ("2026-11-02", "03:48"). */
  date: string;
  time: string;
  /** The same moment with its UTC offset. Sent by newer daemons. */
  at?: string | null;
  workspace: string;
  /** The raw log line. */
  text: string;
  /** The line in plain words. Sent by newer daemons. */
  summary?: string;
  tone: "green" | "amber" | "muted";
  level: string;
};

export type DaemonState = {
  ok: boolean;
  app: string;
  version: string;
  server_time: string;
  /** The name of the daemon machine's time zone, e.g. "UTC". Sent by newer daemons. */
  server_timezone?: string;
  daemon: {
    running: boolean;
    pid: number | null;
    started_at: string | null;
    updated_at: string | null;
    stopped_at: string | null;
    /** The daemon runs older program files than the ones on disk ("restart to finish the update"). Newer daemons only. */
    update_pending?: boolean;
  };
  schedule: {
    mode: "always" | "scheduled";
    active_days: string[];
    start_time: string;
    end_time: string;
    timezone: string;
    /** The person picked or confirmed their hours at least once. Newer daemons only. */
    saved?: boolean;
    summary: string;
    active: boolean;
    next_change: string | null;
  };
  paused: boolean;
  pause_until: string | null;
  stay_active: boolean;
  stay_until: string | null;
  workspaces: WorkspaceState[];
  connected_count: number;
  activity: ActivityEntry[];
  /** Set when the daemon cannot read config.json; workspaces is then empty. */
  config_error?: string | null;
  /** Newer daemons only. */
  health?: HealthState;
  /** Does Stillgreen start by itself at login? Newer daemons only. */
  autostart?: AutostartState;
};

export type AutostartState = {
  /** True on macOS, where ./sg-local install-launchd adds a login item. */
  supported: boolean;
  enabled: boolean | null;
  /** The command that turns it on or off, or null where there is none. */
  command: string | null;
  /** One plain sentence about the current state. */
  note: string;
};

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

/** One line of "Check my setup" (GET /api/diagnostics). */
export type DiagnosticCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  action: string;
};

export type Diagnostics = {
  generated_at: string;
  checks: DiagnosticCheck[];
};

const STORAGE_KEY = "stillgreen.bridge.v1";
const TIMEOUT_MS = 9000;

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:8765";

// The local daemon speaks plain HTTP, so a scheme-less loopback address
// ("127.0.0.1:8765", "localhost:8765") gets http://. Anything else gets https://.
// [::1] is left out on purpose: the site's CSP cannot list IPv6 literals in
// connect-src, so use 127.0.0.1 instead.
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3})(?::\d*)?(?:[/?#]|$)/i;

// Origins the daemon's CORS allowlist accepts without SG_LOCAL_WEB_ORIGIN.
const DEFAULT_ALLOWED_ORIGIN = /^(https:\/\/stillgreen\.vercel\.app|https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)$/i;

export function normalizeUrl(value: string): string {
  let url = value.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `${LOOPBACK_HOST.test(url) ? "http" : "https"}://${url}`;
  }
  return url.replace(/\/+$/, "");
}

/** Codes pasted from chat or docs often carry smart dashes, spaces or lowercase. */
export function normalizeCode(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function loadBridge(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    if (!parsed.url || !parsed.code) return null;
    return { url: normalizeUrl(parsed.url), code: normalizeCode(parsed.code) };
  } catch {
    return null;
  }
}

export function saveBridge(config: BridgeConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ url: normalizeUrl(config.url), code: normalizeCode(config.code) }),
  );
}

export function clearBridge(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// ------------------------------------------------------------------ errors

/** An Error that also carries the problem in plain words. */
export class BridgeError extends Error {
  info: ErrorInfo;
  status: number;

  constructor(info: ErrorInfo, status = 0) {
    super([info.message, info.action].filter(Boolean).join(" "));
    this.name = "BridgeError";
    this.info = info;
    this.status = status;
  }
}

/** The plain-words problem behind any error, for showing title, message and action. */
export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof BridgeError) return error.info;
  const message = error instanceof Error && error.message ? error.message : "Something went wrong.";
  return { code: "unknown", title: "That didn't work", message, action: "Try again." };
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

function pageOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/**
 * A failed fetch in plain words. The browser hides why a request failed (no
 * answer, a certificate it does not trust, or a blocked cross-site request
 * all look the same), so the action covers the likely causes for that kind
 * of address.
 */
function networkErrorInfo(error: unknown, url: string): ErrorInfo {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "network_timeout",
      title: "Stillgreen took too long to answer",
      message: `Stillgreen at ${url} did not answer in time.`,
      action: "Check that it is running and that the address is right, then try again.",
    };
  }
  const origin = pageOrigin();
  const originHint =
    origin && !DEFAULT_ALLOWED_ORIGIN.test(origin)
      ? ` Stillgreen only accepts this page's address (${origin}) if you start it with SG_LOCAL_WEB_ORIGIN=${origin}.`
      : "";
  if (isLoopback(url)) {
    return {
      code: "daemon_not_running",
      title: "Stillgreen is not running",
      message: `Could not reach ${url}. Nothing answered at that address.`,
      action:
        "Start it with ./sg-local start, then try again. If it is running, check the address and port. If the browser asks to allow access to your network, click Allow." +
        originHint,
    };
  }
  if (url.startsWith("https://")) {
    return {
      code: "tls_or_network",
      title: "Can't make a secure connection to your Stillgreen",
      message: `Could not reach ${url}. The server did not answer, or this browser does not trust its certificate.`,
      action:
        "Open the address in a new tab. If the browser warns about the certificate, fix the certificate on the server (see the cloud guide) and do not click past the warning. If the page does not load at all, check that the server is on." +
        originHint,
    };
  }
  return {
    code: "network_unreachable",
    title: "Can't reach your Stillgreen",
    message: `Could not reach ${url}.`,
    action: "Check that Stillgreen is running and that the address and port are right." + originHint,
  };
}

/** A daemon reply that was not OK, in plain words. */
function httpErrorInfo(status: number, payload: unknown): ErrorInfo {
  const text = errorText(payload);
  if (status === 401) {
    return {
      code: "access_code_wrong",
      title: "Access code not accepted",
      message: "The access code was not accepted.",
      action: "Copy it again from your Stillgreen control page, or run ./sg-local web --show-code.",
    };
  }
  if (status === 403 && /origin is not allowed/i.test(text)) {
    const origin = pageOrigin() || "this page";
    return {
      code: "origin_not_allowed",
      title: "Stillgreen refused this page",
      message: `Stillgreen refused requests from ${origin}.`,
      action: `Restart it with SG_LOCAL_WEB_ORIGIN=${origin} to allow this dashboard.`,
    };
  }
  // Newer daemons explain the problem themselves (shared error catalogue).
  const own = daemonErrorInfo(payload);
  if (own && status !== 404 && status !== 421) return own;
  if (status === 403) {
    return {
      code: "forbidden",
      title: "Stillgreen refused the request",
      message: text ? `Stillgreen said: ${text}.` : "Stillgreen refused the request.",
      action: "Check the address and the access code, then try again.",
    };
  }
  if (status === 421) {
    return {
      code: "wrong_host",
      title: "Stillgreen doesn't know this address",
      message: "Something answered, but it only accepts the host names it was set up with.",
      action:
        "Use the address Stillgreen showed when it started. On a server, add this host name to SG_LOCAL_WEB_HOSTS and restart it.",
    };
  }
  if (status === 429) {
    return {
      code: "too_many_attempts",
      title: "Too many wrong codes",
      message: "Stillgreen saw too many wrong access codes from this network.",
      action: "Wait one minute, then try again with the right code.",
    };
  }
  if (status === 404) {
    return {
      code: "not_supported",
      title: "This Stillgreen is too old for that",
      message: "Your Stillgreen does not know this request.",
      action: "Update Stillgreen (git pull in its folder), then restart it.",
    };
  }
  if (status >= 500) {
    return {
      code: "server_error",
      title: "Stillgreen had a problem",
      message: text ? `Stillgreen said: ${capitalize(text)}.` : `Stillgreen returned an error (HTTP ${status}).`,
      action: "Try again. If it keeps happening, run ./sg-local doctor on the computer or server.",
    };
  }
  return {
    code: "request_refused",
    title: "That didn't work",
    message: text ? `${capitalize(text)}.` : `Stillgreen returned HTTP ${status}.`,
    action: "Check what you entered, then try again.",
  };
}

function capitalize(text: string): string {
  const clean = text.trim().replace(/[.]+$/, "");
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

/** The daemon's own plain-words problem from an error reply, if it sent one. */
function daemonErrorInfo(payload: unknown): ErrorInfo | null {
  if (!payload || typeof payload !== "object" || !("error_info" in payload)) return null;
  const info = (payload as { error_info: unknown }).error_info;
  if (!info || typeof info !== "object") return null;
  const { code, title, message, action } = info as Record<string, unknown>;
  if (typeof title !== "string" || !title) return null;
  return {
    code: typeof code === "string" ? code : "unknown",
    title,
    message: typeof message === "string" ? message : "",
    action: typeof action === "string" ? action : "",
  };
}

function errorText(payload: unknown): string {
  return payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error: unknown }).error)
    : "";
}

const NOT_STILLGREEN: ErrorInfo = {
  code: "not_stillgreen",
  title: "That address is not Stillgreen",
  message: "That address did not answer like Stillgreen.",
  action: "Check the address. On this computer it is usually http://127.0.0.1:8765.",
};

function asState(payload: unknown): DaemonState {
  const state = payload as Partial<DaemonState> | null;
  if (!state || state.app !== "stillgreen" || !Array.isArray(state.workspaces)) {
    throw new BridgeError(NOT_STILLGREEN);
  }
  return state as DaemonState;
}

/** Send one request and return the response once it is known to be OK. */
async function send(
  config: BridgeConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = normalizeUrl(config.url);
  try {
    let response: Response;
    try {
      response = await fetch(`${url}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${normalizeCode(config.code)}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new BridgeError(networkErrorInfo(error, url));
    }
    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // Keep the status code alone.
      }
      throw new BridgeError(httpErrorInfo(response.status, payload), response.status);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  config: BridgeConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const response = await send(config, path, init, timeoutMs);
  try {
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BridgeError(networkErrorInfo(error, normalizeUrl(config.url)));
    }
    throw new BridgeError(NOT_STILLGREEN, response.status);
  }
}

export async function connectBridge(url: string, code: string): Promise<DaemonState> {
  const config = { url: normalizeUrl(url), code: normalizeCode(code) };
  if (!config.url || !config.code) {
    throw new BridgeError({
      code: "missing_input",
      title: "Address and code needed",
      message: "Enter your Stillgreen address and access code.",
      action: "",
    });
  }
  return fetchState(config);
}

export function fetchState(config: BridgeConfig): Promise<DaemonState> {
  return request<unknown>(config, "/api/state").then(asState);
}

// Network checks (DNS, TLS to Slack) can take a while on a slow network.
const DIAGNOSTICS_TIMEOUT_MS = 30000;

const DIAGNOSTICS_UNSUPPORTED: ErrorInfo = {
  code: "not_supported",
  title: "This Stillgreen can't check itself yet",
  message: "Your Stillgreen is older than the setup check.",
  action: "Update Stillgreen (git pull in its folder) and restart it. Until then, run ./sg-local doctor in a terminal.",
};

/** Run "Check my setup" on the daemon (GET /api/diagnostics). */
export async function fetchDiagnostics(config: BridgeConfig): Promise<Diagnostics> {
  let payload: Partial<Diagnostics> | null;
  try {
    // fresh=1: a new run, not the copy the daemon keeps for 30 seconds (the
    // daemon still runs at most one check every few seconds).
    payload = await request<Partial<Diagnostics>>(config, "/api/diagnostics?fresh=1", {}, DIAGNOSTICS_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof BridgeError && error.status === 404) throw new BridgeError(DIAGNOSTICS_UNSUPPORTED, 404);
    throw error;
  }
  if (!payload || !Array.isArray(payload.checks)) throw new BridgeError(DIAGNOSTICS_UNSUPPORTED);
  return {
    generated_at: String(payload.generated_at || new Date().toISOString()),
    checks: payload.checks.filter(Boolean).map((check) => ({
      id: String(check.id || ""),
      label: String(check.label || check.id || "Check"),
      status: (["pass", "warn", "fail", "skip"].includes(check.status) ? check.status : "warn") as CheckStatus,
      detail: String(check.detail || ""),
      action: String(check.action || ""),
    })),
  };
}

const REPORT_FILENAME = "stillgreen-diagnostics.txt";

/**
 * The redacted setup report (GET /api/diagnostics/report) as a file. The
 * daemon leaves out tokens, cookies and the access code.
 */
export async function fetchDiagnosticsReport(config: BridgeConfig): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await send(config, "/api/diagnostics/report", {}, DIAGNOSTICS_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof BridgeError && error.status === 404) throw new BridgeError(DIAGNOSTICS_UNSUPPORTED, 404);
    throw error;
  }
  const text = await response.text();
  const match = /filename="?([^";]+)"?/i.exec(response.headers.get("Content-Disposition") || "");
  const filename = match && /^[\w.-]+$/.test(match[1]) ? match[1] : REPORT_FILENAME;
  return { blob: new Blob([text], { type: "text/plain;charset=utf-8" }), filename };
}

/** Hand a file to the browser's normal download. */
export function saveBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10000);
}

export function saveSchedule(
  config: BridgeConfig,
  payload: {
    mode: "always" | "scheduled";
    active_days: string[];
    start_time: string;
    end_time: string;
    timezone: string;
  },
): Promise<DaemonState> {
  return request<unknown>(config, "/api/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(asState);
}

export function pausePresence(
  config: BridgeConfig,
  payload: { duration?: string; workspace?: string } = {},
): Promise<DaemonState> {
  return request<unknown>(config, "/api/pause", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(asState);
}

export function resumePresence(
  config: BridgeConfig,
  payload: { workspace?: string } = {},
): Promise<DaemonState> {
  return request<unknown>(config, "/api/resume", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then(asState);
}

/** Stay online for a duration ("2h"), until a moment, or cancel (null). */
export function stayOnline(
  config: BridgeConfig,
  choice: string | { until: Date } | null,
): Promise<DaemonState> {
  const body =
    choice === null
      ? { cancel: true }
      : typeof choice === "string"
        ? { duration: choice }
        : { until: isoWithOffset(choice.until) };
  return request<unknown>(config, "/api/stay", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(asState);
}

/** Local time with its UTC offset, e.g. 2026-10-31T17:00:00-04:00. */
function isoWithOffset(date: Date): string {
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

/** The next HH:MM in this browser's timezone: today, or tomorrow once it has passed. */
export function todayAt(clock: string): Date | null {
  const [hours, minutes] = clock.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const moment = new Date();
  moment.setHours(hours, minutes, 0, 0);
  // "01:00" picked at 23:00 means tonight after midnight.
  if (moment.getTime() <= Date.now()) moment.setDate(moment.getDate() + 1);
  return moment;
}

type RemoveResult = { ok: true; removed: string; state: DaemonState };

export function removeWorkspace(config: BridgeConfig, teamId: string): Promise<DaemonState> {
  return request<RemoveResult>(config, `/api/workspaces/${encodeURIComponent(teamId)}`, {
    method: "DELETE",
  }).then((result) => asState(result?.state));
}

/**
 * The timezone to save with a schedule. "local" would mean the daemon's own
 * clock, which on a cloud server is usually UTC, so send this browser's zone
 * (for example "America/New_York") instead.
 */
export function scheduleTimezone(value: string): string {
  const text = value.trim();
  if (text && !/^(local|system|machine)$/i.test(text)) return text;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}
