export type BridgeConfig = {
  url: string;
  code: string;
};

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
};

export type ActivityEntry = {
  date: string;
  time: string;
  workspace: string;
  text: string;
  tone: "green" | "amber" | "muted";
  level: string;
};

export type DaemonState = {
  ok: boolean;
  app: string;
  version: string;
  server_time: string;
  daemon: {
    running: boolean;
    pid: number | null;
    started_at: string | null;
    updated_at: string | null;
    stopped_at: string | null;
  };
  schedule: {
    mode: "always" | "scheduled";
    active_days: string[];
    start_time: string;
    end_time: string;
    timezone: string;
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
};

const STORAGE_KEY = "stillgreen.bridge.v1";
const TIMEOUT_MS = 9000;

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:8765";

// The local daemon speaks plain HTTP, so a scheme-less loopback address
// ("127.0.0.1:8765", "localhost:8765") gets http://. Anything else gets https://.
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d*)?(?:[/?#]|$)/i;

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

function friendlyError(error: unknown, url: string): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return `The daemon at ${url} did not answer in time. Check that it is running and that the URL is reachable.`;
  }
  if (error instanceof TypeError) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const originHint =
      origin && !DEFAULT_ALLOWED_ORIGIN.test(origin)
        ? ` The daemon only accepts this page's origin (${origin}) if you start it with SG_LOCAL_WEB_ORIGIN=${origin}.`
        : "";
    return `Could not reach ${url}. Check that the daemon is running (./sg-local start), that the URL and port are right, and that the browser allowed the local-network request.${originHint}`;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

function errorText(payload: unknown): string {
  return payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error: unknown }).error)
    : "";
}

function asState(payload: unknown): DaemonState {
  const state = payload as Partial<DaemonState> | null;
  if (!state || state.app !== "stillgreen" || !Array.isArray(state.workspaces)) {
    throw new Error("That URL did not answer like a Stillgreen daemon.");
  }
  return state as DaemonState;
}

async function request<T>(
  config: BridgeConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizeUrl(config.url)}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${normalizeCode(config.code)}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // The daemon always returns JSON; keep the status message otherwise.
    }
    if (response.status === 401) {
      throw new Error("The access code was not accepted. Copy it from the daemon's control page.");
    }
    if (response.status === 403 && /origin is not allowed/i.test(errorText(payload))) {
      const origin = typeof window === "undefined" ? "this page" : window.location.origin;
      throw new Error(
        `The daemon refused requests from ${origin}. Restart it with SG_LOCAL_WEB_ORIGIN=${origin} to allow this dashboard.`,
      );
    }
    if (!response.ok) {
      throw new Error(errorText(payload) || `Daemon returned HTTP ${response.status}.`);
    }
    return payload as T;
  } catch (error) {
    throw new Error(friendlyError(error, normalizeUrl(config.url)));
  } finally {
    clearTimeout(timer);
  }
}

export async function connectBridge(url: string, code: string): Promise<DaemonState> {
  const config = { url: normalizeUrl(url), code: normalizeCode(code) };
  if (!config.url || !config.code) {
    throw new Error("Enter the daemon URL and access code.");
  }
  return fetchState(config);
}

export function fetchState(config: BridgeConfig): Promise<DaemonState> {
  return request<unknown>(config, "/api/state").then(asState);
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

export function stayOnline(config: BridgeConfig, duration: string | null): Promise<DaemonState> {
  return request<unknown>(config, "/api/stay", {
    method: "POST",
    body: JSON.stringify(duration ? { duration } : { cancel: true }),
  }).then(asState);
}

type RemoveResult = { ok: true; removed: string; state: DaemonState };

export function removeWorkspace(config: BridgeConfig, teamId: string): Promise<DaemonState> {
  return request<RemoveResult>(config, `/api/workspaces/${encodeURIComponent(teamId)}`, {
    method: "DELETE",
  }).then((result) => asState(result?.state));
}

export function workspaceTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "Active",
    connected: "Connected",
    away: "Away",
    auto_away: "Away",
    manual_away: "Manual away",
    paused: "Paused",
    scheduled_off: "Outside schedule",
    daemon_stopped: "Daemon stopped",
    starting: "Starting",
    reconnecting: "Reconnecting",
    restarting: "Restarting",
    stopped: "Stopped",
    invalid_token: "Tokens rejected",
    invalid_config: "Check config",
    error: "Error",
  };
  return labels[status] || status;
}
