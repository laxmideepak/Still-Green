// Presentation helpers for the web dashboard (live and preview). Nothing here
// talks to the daemon; lib/bridge.ts does that.

import type { ActivityEntry, AuthState, DaemonState, Diagnostics, ErrorInfo, WorkspaceState } from "./bridge";

export type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type DayInfo = {
  key: DayKey;
  label: string;
  long: string;
};

// Keys match the daemon's schedule `active_days`.
export const DAYS: readonly DayInfo[] = [
  { key: "monday", label: "Mon", long: "Monday" },
  { key: "tuesday", label: "Tue", long: "Tuesday" },
  { key: "wednesday", label: "Wed", long: "Wednesday" },
  { key: "thursday", label: "Thu", long: "Thursday" },
  { key: "friday", label: "Fri", long: "Friday" },
  { key: "saturday", label: "Sat", long: "Saturday" },
  { key: "sunday", label: "Sun", long: "Sunday" },
];

export const WEEKDAY_KEYS: readonly DayKey[] = DAYS.slice(0, 5).map((day) => day.key);

export type Tone = "green" | "muted" | "amber";

/** Badge tones from components/ui. */
export type StatusTone = "success" | "neutral" | "warning" | "danger" | "info" | "violet";

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "S"
  );
}

/** The first letter of a workspace name, for its avatar. */
export function initial(name: string) {
  const match = name.trim().match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "#";
}

export function toMinutes(value: string) {
  const [hours, minutes] = (value || "0:0").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

// Length of one daily window in hours. An end before the start runs past
// midnight; an empty or zero-length window counts as no time.
export function windowHours(start: string, end: string) {
  if (!start || !end) return 0;
  const span = toMinutes(end) - toMinutes(start);
  if (span === 0) return 0;
  return (span > 0 ? span : span + 1440) / 60;
}

export function weeklyHours(dayCount: number, start: string, end: string) {
  if (!dayCount) return 0;
  return dayCount * windowHours(start, end);
}

export function isOvernight(start: string, end: string) {
  return Boolean(start && end) && toMinutes(end) < toMinutes(start);
}

export function formatHours(value: number) {
  if (Number.isInteger(value)) return `${value}h`;
  return `${value.toFixed(1)}h`;
}

// Green only for a confirmed active session; unknown statuses never look online.
export function statusTone(status: string): Tone {
  if (status === "active") return "green";
  if (
    [
      "connected",
      "starting",
      "reconnecting",
      "restarting",
      "invalid_token",
      "invalid_config",
      "error",
      "away",
      "auto_away",
    ].includes(status)
  ) {
    return "amber";
  }
  return "muted";
}

// ------------------------------------------------------------------ time

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "3:46 PM" (or "15:46", following the browser's locale). */
export function clock(value: string | number | Date | null | undefined): string {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

/** "3:46 PM" today, "tomorrow 9:00 AM", or "Mon 9:00 AM" later. */
export function when(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = asDate(value);
  if (!date) return "";
  const today = new Date(now);
  if (sameDay(date, today)) return clock(date);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) return `tomorrow ${clock(date)}`;
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  if (date.getTime() - now < 6 * 86400000 && date.getTime() > now) return `${day} ${clock(date)}`;
  const full = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  return `${full}, ${clock(date)}`;
}

/** "1 h 12 min", "42 min", "under a minute". */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "just now", "12 s ago", "4 min ago", or a clock time. */
export function ago(value: number | null, now = Date.now()): string {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return clock(value);
}

/** "6 days, 3 hours" style uptime. */
export function since(value: string | null | undefined, now = Date.now()): string {
  const date = asDate(value);
  if (!date) return "";
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return `${days} ${days === 1 ? "day" : "days"}${restHours ? `, ${restHours} h` : ""}`;
}

/** "Thursday, Oct 31" */
export function longDate(now = Date.now()): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(now);
}

/**
 * "HH:MM" for the "Until" picker: 17:00, or two hours ahead (on the hour) once
 * 17:00 is close or past. Late in the evening it is 23:59, the last minute of
 * the day. The control page (sg_local/static/app.js) uses the same rule.
 */
export function defaultUntil(now = new Date()): string {
  const fivePm = new Date(now);
  fivePm.setHours(17, 0, 0, 0);
  if (fivePm.getTime() - now.getTime() > 15 * 60000) return "17:00";
  const next = now.getHours() + 2;
  if (next >= 24) return "23:59";
  return `${String(next).padStart(2, "0")}:00`;
}

/** "9:00 AM" from "09:00". */
export function clockFromHHMM(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return clock(date);
}

/** The browser's timezone, e.g. "America/New_York". */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Whether a timezone name is one this browser knows. */
export function knownTimezone(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^(local|system|machine)$/i.test(text)) return true;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ durations

export type StayChoice = "30m" | "1h" | "2h" | "3h";

export const STAY_CHOICES: ReadonlyArray<{ value: StayChoice; label: string; long: string; minutes: number }> = [
  { value: "30m", label: "30 min", long: "30 minutes", minutes: 30 },
  { value: "1h", label: "1 h", long: "1 hour", minutes: 60 },
  { value: "2h", label: "2 h", long: "2 hours", minutes: 120 },
  { value: "3h", label: "3 h", long: "3 hours", minutes: 180 },
];

// ------------------------------------------------------------------ status

/** Status badge for one workspace: words plus a tone. */
export function workspaceBadge(
  workspace: WorkspaceState,
  state: Pick<DaemonState, "paused" | "stay_active"> & Partial<Pick<DaemonState, "server_time">>,
  unreachable = false,
): { tone: StatusTone; label: string } {
  if (unreachable) return { tone: "neutral", label: "Unknown" };
  if (workspace.paused) return { tone: "warning", label: "Paused" };
  if (state.paused && !state.stay_active) return { tone: "warning", label: "Paused" };
  switch (workspace.status) {
    case "active":
      // "Active" only once Slack's own check confirmed it recently.
      return presenceConfirmed(workspace, state)
        ? { tone: "success", label: "Active" }
        : { tone: "info", label: "Connected" };
    case "manual_away":
      return { tone: "violet", label: "Away (set by you)" };
    case "away":
    case "auto_away":
      return { tone: "neutral", label: "Away" };
    case "connected":
      return { tone: "info", label: "Connected" };
    case "starting":
      return { tone: "info", label: "Starting" };
    case "reconnecting":
    case "restarting":
      return { tone: "info", label: "Reconnecting" };
    case "scheduled_off":
      return { tone: "neutral", label: "Off schedule" };
    case "daemon_stopped":
    case "stopped":
      return { tone: "neutral", label: "Stopped" };
    case "paused":
      return { tone: "warning", label: "Paused" };
    case "invalid_token":
      return { tone: "danger", label: "Signed out" };
    case "invalid_config":
      return { tone: "danger", label: "Check settings" };
    case "error":
      return { tone: "danger", label: "Error" };
    default:
      return { tone: "neutral", label: workspace.status || "Unknown" };
  }
}

/** One plain line under a workspace name. */
export function workspaceNote(workspace: WorkspaceState): string {
  if (workspace.status === "invalid_token") {
    return "Slack signed this session out. Capture it again with the extension.";
  }
  if (workspace.status === "manual_away") return "You set yourself away, so Stillgreen leaves it alone.";
  if (workspace.paused) return "Paused until you resume it";
  if (workspace.connected) return "Live connection to Slack";
  if (workspace.status === "scheduled_off") return "Waiting for your schedule";
  if (workspace.status === "daemon_stopped") return "Stillgreen isn't running";
  if (workspace.reason) return capitalize(workspace.reason);
  return "Not connected";
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export type PresenceSummary = {
  tone: "success" | "warning" | "neutral" | "danger" | "info";
  title: string;
  /** Shown after a dot, quieter. */
  detail?: string;
  description: string;
  /** True only while Stillgreen is keeping you green: Active, or Connected and waiting for Slack. */
  keepingGreen?: boolean;
};

/**
 * Workspaces that are green right now. A workspace paused a moment ago can
 * still be reported as connected until the daemon drops it, so paused ones
 * never count, and nothing counts during a pause of everything.
 */
export function onlineCount(
  state: Pick<DaemonState, "workspaces" | "paused" | "stay_active"> & Partial<Pick<DaemonState, "server_time">>,
): number {
  if (state.paused && !state.stay_active) return 0;
  return state.workspaces.filter(
    (item) => item.connected && item.status === "active" && !item.paused && presenceConfirmed(item, state),
  ).length;
}

// ------------------------------------------------------------------ verified presence

/**
 * How long a "Slack says you are active" check counts as fresh. The daemon
 * asks Slack about once a minute, so this allows a few missed checks.
 */
export const PRESENCE_FRESH_MS = 5 * 60000;

/** Whether this daemon sends the presence fields (newer daemons do). */
export function reportsPresence(workspace: WorkspaceState): boolean {
  return workspace.presence_verified_at !== undefined || workspace.presence !== undefined;
}

/** Milliseconds between Slack's last "active" answer and the daemon's clock, or null. */
export function presenceAge(
  workspace: WorkspaceState,
  state: Partial<Pick<DaemonState, "server_time">>,
): number | null {
  const verified = asDate(workspace.presence_verified_at);
  if (!verified) return null;
  const server = asDate(state.server_time);
  const reference = server ? server.getTime() : Date.now();
  return Math.max(0, reference - verified.getTime());
}

/**
 * Slack itself recently said this workspace shows you as active. Older
 * daemons don't send the time; they only report "active" after Slack said so,
 * so a live "active" counts there.
 */
export function presenceConfirmed(
  workspace: WorkspaceState,
  state: Partial<Pick<DaemonState, "server_time">>,
): boolean {
  if (workspace.paused) return false;
  if (!reportsPresence(workspace)) return workspace.connected && workspace.status === "active";
  if (workspace.presence === "away" || workspace.presence === "manual_away") return false;
  const age = presenceAge(workspace, state);
  return age !== null && age <= PRESENCE_FRESH_MS;
}

/** Workspaces where Slack recently confirmed you as active. */
export function confirmedCount(
  state: Pick<DaemonState, "workspaces" | "paused" | "stay_active" | "server_time">,
): number {
  if (state.paused && !state.stay_active) return 0;
  return state.workspaces.filter((item) => presenceConfirmed(item, state)).length;
}

/** Did Slack accept the saved login? Older daemons: worked out from the status. */
export function workspaceAuth(workspace: WorkspaceState): AuthState {
  if (workspace.auth === "ok" || workspace.auth === "rejected" || workspace.auth === "unknown") return workspace.auth;
  if (workspace.status === "invalid_token") return "rejected";
  if (workspace.connected || ["active", "away", "auto_away", "manual_away", "connected"].includes(workspace.status)) {
    return "ok";
  }
  return "unknown";
}

/** The workspace's problem in plain words: the daemon's own words when it sends them. */
export function workspaceProblem(workspace: WorkspaceState): ErrorInfo | null {
  if (workspace.last_error_info && workspace.last_error_info.title) return workspace.last_error_info;
  if (workspace.status === "invalid_token" || workspace.auth === "rejected") {
    return {
      code: "slack_auth_rejected",
      title: "Slack signed you out here",
      message: "Slack no longer accepts the saved login for this workspace.",
      action: "Open Slack in Chrome, sign in, and click Capture from Slack in the extension again.",
    };
  }
  if (workspace.last_error && workspace.status !== "active") {
    return {
      code: "unknown",
      title: "Problem talking to Slack",
      message: `${capitalize(workspace.last_error.replace(/[.]+$/, ""))}.`,
      action: "Stillgreen keeps trying. If it doesn't clear, use Check my setup.",
    };
  }
  return null;
}

/** When Slack last confirmed you as active anywhere, as a moment in this browser's clock. */
function latestConfirmation(state: DaemonState, now: number, lastOkAt: number | null): number | null {
  let best: number | null = null;
  for (const workspace of state.workspaces) {
    const age = presenceAge(workspace, state);
    if (age === null) continue;
    const at = (lastOkAt ?? now) - age;
    if (best === null || at > best) best = at;
  }
  return best;
}

export type SignalTone = "pass" | "warn" | "fail" | "off";

/** One of the three lines in the status card. */
export type StatusSignal = {
  id: "running" | "login" | "presence";
  label: string;
  tone: SignalTone;
  /** Short state, e.g. "Running", "Valid", "Confirmed 2 min ago". */
  value: string;
  /** One plain line that explains it. */
  detail: string;
};

/**
 * The three things that must all be true before Slack shows you as active:
 * Stillgreen is running, Slack accepts your login, and Slack has confirmed
 * your status. Kept apart so a working connection never looks like a
 * confirmed green dot.
 */
export function statusSignals(
  state: DaemonState,
  options: { unreachable?: boolean; now?: number; lastOkAt?: number | null } = {},
): StatusSignal[] {
  const { unreachable = false, now = Date.now(), lastOkAt = null } = options;
  const running = state.health ? state.health.daemon : state.daemon.running;
  const total = state.workspaces.length;

  // 1. Stillgreen running
  let runningSignal: StatusSignal;
  if (unreachable) {
    runningSignal = {
      id: "running",
      label: "Stillgreen running",
      tone: "warn",
      value: "Can't reach it",
      detail: "This page can't reach your Stillgreen right now. It keeps trying.",
    };
  } else if (!running) {
    runningSignal = {
      id: "running",
      label: "Stillgreen running",
      tone: "fail",
      value: "Stopped",
      detail: "Start it with ./sg-local start (on a server: docker compose up -d).",
    };
  } else if (state.config_error) {
    runningSignal = {
      id: "running",
      label: "Stillgreen running",
      tone: "fail",
      value: "Settings problem",
      detail: "It is running but can't read its settings file. Run ./sg-local doctor.",
    };
  } else {
    const uptime = since(state.daemon.started_at, now);
    runningSignal = {
      id: "running",
      label: "Stillgreen running",
      tone: "pass",
      value: "Running",
      detail: uptime ? `Running for ${uptime}.` : "It just started.",
    };
  }

  // 2. Slack login valid
  let loginSignal: StatusSignal;
  const auths = state.workspaces.map(workspaceAuth);
  const rejected = state.workspaces.filter((_, index) => auths[index] === "rejected");
  const accepted = auths.filter((auth) => auth === "ok").length;
  if (total === 0) {
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: "off",
      value: "No workspace yet",
      detail: "Add your Slack with the Stillgreen browser extension.",
    };
  } else if (rejected.length) {
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: "fail",
      value: rejected.length === total ? "Signed out" : `Signed out in ${rejected.length} of ${total}`,
      detail: `Slack signed you out of ${rejected.map((item) => item.name).join(", ")}. Open Slack in Chrome and click Capture from Slack again.`,
    };
  } else if (state.health && state.health.slack_reachable === false) {
    const problem = state.workspaces.map(workspaceProblem).find(Boolean);
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: "fail",
      value: "Can't reach Slack",
      detail: problem ? `${problem.title}. ${problem.action}` : "Your Stillgreen can't reach Slack. Use Check my setup to find out why.",
    };
  } else if (accepted === total) {
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: "pass",
      value: "Valid",
      detail: total === 1 ? "Slack accepts your saved login." : `Slack accepts your saved login in all ${total} workspaces.`,
    };
  } else if (!running || unreachable) {
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: "off",
      value: "Not checked",
      detail: "Stillgreen checks your login when it connects to Slack.",
    };
  } else {
    loginSignal = {
      id: "login",
      label: "Slack login valid",
      tone: accepted ? "warn" : "off",
      value: accepted ? `Valid in ${accepted} of ${total}` : "Not checked yet",
      detail: "Stillgreen checks your login each time it connects to Slack.",
    };
  }

  // 3. Presence confirmed
  const presence = (tone: SignalTone, value: string, detail: string): StatusSignal => ({
    id: "presence",
    label: "Presence confirmed",
    tone,
    value,
    detail,
  });
  let presenceSignal: StatusSignal;
  const pausedAll = state.paused && !state.stay_active;
  const live = state.workspaces.filter((item) => !item.paused && workspaceAuth(item) !== "rejected");
  const wanted = live.filter((item) => item.status !== "manual_away" && item.presence !== "manual_away");
  const confirmed = wanted.filter((item) => presenceConfirmed(item, state));
  const latest = latestConfirmation(state, now, lastOkAt);
  const agoText = latest ? ago(latest, now) : "";
  if (unreachable) {
    presenceSignal = presence("warn", "Unknown", "Shown again when this page can reach your Stillgreen.");
  } else if (!running) {
    presenceSignal = presence("off", "Not checked", "Needs Stillgreen to be running.");
  } else if (total === 0) {
    presenceSignal = presence("off", "Nothing to check yet", "Add a workspace first.");
  } else if (pausedAll || state.workspaces.every((item) => item.paused)) {
    presenceSignal = presence("off", "Paused", "Stillgreen is paused, so Slack shows your normal status.");
  } else if (live.length === 0) {
    presenceSignal = presence("fail", "Not confirmed", "No workspace can connect until you capture it again.");
  } else if (state.schedule.mode === "scheduled" && !state.schedule.active && !state.stay_active) {
    presenceSignal = presence("off", "Off schedule", "Outside your hours, so Slack shows your normal status.");
  } else if (wanted.length === 0) {
    presenceSignal = presence("off", "Away (set by you)", "You set yourself away in Slack, so Stillgreen leaves it alone.");
  } else if (confirmed.length === wanted.length) {
    const where = wanted.length === 1 ? "" : ` in all ${wanted.length} workspaces`;
    presenceSignal = presence(
      "pass",
      agoText ? `Confirmed ${agoText}` : "Confirmed",
      `Slack's own status check shows you as active${where}.`,
    );
  } else if (confirmed.length > 0) {
    presenceSignal = presence(
      "warn",
      `Confirmed in ${confirmed.length} of ${wanted.length}`,
      "Slack has not confirmed the other workspaces yet. Stillgreen keeps trying.",
    );
  } else if (wanted.some((item) => item.presence === "away" || ["away", "auto_away"].includes(item.status))) {
    presenceSignal = presence("warn", "Slack shows you away", "Stillgreen is reconnecting to try again. Slack decides your final status.");
  } else if (latest) {
    presenceSignal = presence(
      "warn",
      `Last confirmed ${agoText}`,
      "Slack has not confirmed you as active lately. Stillgreen keeps trying.",
    );
  } else if (wanted.some((item) => item.connected)) {
    presenceSignal = presence("warn", "Waiting for Slack", "Connected. Stillgreen asks Slack about once a minute.");
  } else if (wanted.some((item) => workspaceProblem(item))) {
    presenceSignal = presence("fail", "Not confirmed", "Stillgreen can't connect to Slack. See the workspace below.");
  } else {
    presenceSignal = presence("warn", "Waiting for Slack", "Stillgreen is connecting to Slack. This usually takes a few seconds.");
  }

  return [runningSignal, loginSignal, presenceSignal];
}

/**
 * What happens when Keep me online ends: the end of the sentence
 * "Stillgreen keeps helping until 5:00 PM, …". Same words on the control page.
 */
export function afterStay(state: Pick<DaemonState, "paused" | "schedule">): string {
  if (state.paused) return "then your pause carries on";
  if (state.schedule.mode === "scheduled") return "then your schedule takes over";
  return "then it goes back to always on";
}

/** "at 5:00 PM" today, otherwise "tomorrow 9:00 AM" or "Mon 9:00 AM". */
export function atWhen(value: string | null | undefined, now = Date.now()): string {
  const text = when(value, now);
  return text && /^\d/.test(text) ? `at ${text}` : text;
}

/** The "Mode" stat. Same words on the control page. */
export function modeLabel(state: Pick<DaemonState, "paused" | "stay_active" | "schedule">): string {
  if (state.stay_active) return "Keep me online";
  if (state.paused) return "Paused";
  return state.schedule.mode === "scheduled" ? "Scheduled" : "Always on";
}

/** The "Next change" stat. Same words on the control page. */
export function nextChangeText(
  state: Pick<DaemonState, "paused" | "pause_until" | "stay_active" | "stay_until" | "schedule">,
  now = Date.now(),
): string {
  if (state.stay_active && state.stay_until) return `Ends ${atWhen(state.stay_until, now)}`;
  if (state.paused && !state.stay_active) {
    return state.pause_until ? `Resumes ${atWhen(state.pause_until, now)}` : "When you resume";
  }
  if (state.schedule.mode === "scheduled" && state.schedule.next_change) {
    return `Turns ${state.schedule.active ? "off" : "on"} ${atWhen(state.schedule.next_change, now)}`;
  }
  return "Nothing planned";
}

/** "Today", "Yesterday" or "Sun, Nov 1": a day heading in the activity list. */
export function dayHeading(date: Date, now = Date.now()): string {
  const today = new Date(now);
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

/**
 * When an activity entry happened, as a Date in this browser's time zone.
 * Older daemons send only their own local date and time; those are read as
 * if they were local here, which is right when both share a clock.
 */
export function activityDate(entry: Pick<ActivityEntry, "at" | "date" | "time">): Date | null {
  return asDate(entry.at) ?? asDate(entry.date && entry.time ? `${entry.date}T${entry.time}` : null);
}

/**
 * The big line at the top of the dashboard, in plain words. It says "Active"
 * only when Slack itself recently confirmed it; a live connection alone is
 * "Connected · waiting for Slack to confirm".
 */
export function presenceSummary(state: DaemonState, unreachable: boolean, now = Date.now()): PresenceSummary {
  const total = state.workspaces.length;
  const online = onlineCount(state);
  const confirmed = confirmedCount(state);
  const connected = state.workspaces.filter((item) => item.connected && !item.paused).length;
  const confirmedIn = `Slack confirmed you as active in ${confirmed} of ${total} ${total === 1 ? "workspace" : "workspaces"}.`;
  const waiting: PresenceSummary = {
    tone: "info",
    keepingGreen: true,
    title: "Connected",
    detail: "waiting for Slack to confirm",
    description:
      "Stillgreen has a live connection, like the Slack web app. Slack decides your final status; Stillgreen asks it about once a minute.",
  };

  if (unreachable) {
    return {
      tone: "neutral",
      title: "Can't reach your Stillgreen",
      description: "Below is the last update it sent. This page keeps trying in the background.",
    };
  }
  if (state.config_error) {
    return {
      tone: "danger",
      title: "Settings file problem",
      description: "Stillgreen can't read its settings file, so it isn't keeping you active.",
    };
  }
  if (!state.daemon.running) {
    return {
      tone: "warning",
      title: "Stopped",
      description: "Stillgreen isn't running, so it isn't keeping you active.",
    };
  }
  if (total === 0) {
    return {
      tone: "neutral",
      title: "Ready",
      detail: "Add a workspace to start",
      description: "Stillgreen starts helping as soon as you add a Slack workspace.",
    };
  }
  if (state.stay_active) {
    const after = `When it ends, ${afterStay(state).replace(/^then /, "")}.`;
    if (confirmed > 0) {
      return {
        tone: "success",
        keepingGreen: true,
        title: "Active",
        detail: state.stay_until ? `Staying online until ${when(state.stay_until, now)}` : "Staying online",
        description: `${confirmedIn} ${after}`,
      };
    }
    if (online > 0 || connected > 0) {
      return { ...waiting, description: `Keep me online is on. Stillgreen is connected and waiting for Slack to confirm. ${after}` };
    }
    return {
      tone: "warning",
      title: "Connecting",
      detail: state.stay_until ? `Staying online until ${when(state.stay_until, now)}` : "Staying online",
      description: `Stillgreen is connecting to Slack. ${after}`,
    };
  }
  if (state.paused) {
    return {
      tone: "warning",
      title: "Paused",
      detail: state.pause_until ? `Until ${when(state.pause_until, now)}` : "Until you resume",
      description: "Stillgreen isn't keeping you active right now. Slack will set you away as usual.",
    };
  }
  if (state.workspaces.every((item) => item.paused)) {
    return {
      tone: "warning",
      title: "Paused",
      detail: total === 1 ? "Your workspace is paused" : "Every workspace is paused",
      description: "Resume a workspace below to turn it back on.",
    };
  }
  if (state.schedule.mode === "scheduled" && !state.schedule.active) {
    const next = state.schedule.next_change ? when(state.schedule.next_change, now) : "";
    return {
      tone: "neutral",
      title: "Off schedule",
      detail: next ? `Back ${/^\d/.test(next) ? `at ${next}` : next.startsWith("tomorrow") ? next : `on ${next}`}` : undefined,
      description: "You're outside your schedule, so Slack shows your normal status.",
    };
  }
  if (confirmed === 0) {
    if (online > 0 || connected > 0) return waiting;
    return {
      tone: "warning",
      title: "Not active yet",
      detail: "Connecting to Slack",
      description: "No workspace is connected right now. This usually takes a few seconds. Check the workspaces below.",
    };
  }
  const next = state.schedule.mode === "scheduled" && state.schedule.next_change ? when(state.schedule.next_change, now) : "";
  return {
    tone: "success",
    keepingGreen: true,
    title: "Active",
    detail: state.schedule.mode === "always" ? "Always on" : next ? `Until ${next}` : "On schedule",
    description:
      confirmedIn + (state.schedule.mode === "always" ? " Stillgreen keeps helping until you pause it." : " Your schedule ends it on its own."),
  };
}

/**
 * The logo's mood on the dashboard: "on" (laughing) only while Stillgreen is
 * actually keeping you green, meaning Slack confirmed it or a live connection
 * is waiting on Slack. Paused, stopped, unreachable, off schedule, no
 * workspace or not connected yet are all "off" (sad).
 */
export function brandMood(state: DaemonState, unreachable: boolean, now = Date.now()): "on" | "off" {
  return presenceSummary(state, unreachable, now).keepingGreen ? "on" : "off";
}

// ------------------------------------------------------------------ setup checklist

export type StepStatus = "done" | "todo" | "problem" | "waiting";

export type SetupStep = {
  id: "running" | "tls" | "slack" | "hours" | "startup" | "presence";
  title: string;
  status: StepStatus;
  /** What it means now, or the next thing to do. */
  detail: string;
};

/**
 * The setup steps, worked out from live state each time (nothing is stored
 * here), so the list picks up where the person left off. A step is "done"
 * only when Stillgreen reports it: hours count once the person saved or
 * confirmed them, and presence only when Slack confirmed every workspace
 * that should be active right now.
 */
export function setupSteps(
  state: DaemonState,
  options: { unreachable?: boolean; diagnostics?: Diagnostics | null } = {},
): SetupStep[] {
  const { unreachable = false, diagnostics = null } = options;
  const running = !unreachable && (state.health ? state.health.daemon : state.daemon.running);
  const total = state.workspaces.length;
  const tls = diagnostics?.checks.find((check) => check.id === "tls");
  const reachable = state.health?.slack_reachable;
  const tlsProblem = state.workspaces
    .map((item) => item.last_error_info)
    .find((info) => info && /^(tls_|dns_|proxy_|network_)/.test(info.code));

  const steps: SetupStep[] = [];
  steps.push({
    id: "running",
    title: "Stillgreen running",
    status: running ? "done" : "problem",
    detail: running
      ? "Stillgreen is running and this page can reach it."
      : unreachable
        ? "This page can't reach Stillgreen. Start it with ./sg-local start, then check the address."
        : "Start it with ./sg-local start (on a server: docker compose up -d).",
  });

  let tlsStep: SetupStep;
  if (tls && tls.status === "fail") {
    tlsStep = { id: "tls", title: "Secure connection to Slack", status: "problem", detail: tls.action || tls.detail };
  } else if (tlsProblem) {
    tlsStep = { id: "tls", title: "Secure connection to Slack", status: "problem", detail: `${tlsProblem.title}. ${tlsProblem.action}` };
  } else if (reachable === false) {
    tlsStep = {
      id: "tls",
      title: "Secure connection to Slack",
      status: "problem",
      detail: "Your Stillgreen can't reach Slack. Use Check my setup to see why.",
    };
  } else if ((tls && tls.status === "pass") || reachable === true || state.workspaces.some((item) => workspaceAuth(item) === "ok")) {
    tlsStep = { id: "tls", title: "Secure connection to Slack", status: "done", detail: "Stillgreen can reach Slack over a secure connection." };
  } else if (tls && tls.status === "warn") {
    tlsStep = { id: "tls", title: "Secure connection to Slack", status: "waiting", detail: tls.action || tls.detail };
  } else {
    tlsStep = {
      id: "tls",
      title: "Secure connection to Slack",
      status: running ? "todo" : "waiting",
      detail: "Not tested yet. Click Check my setup to test it.",
    };
  }
  steps.push(tlsStep);

  const rejected = state.workspaces.filter((item) => workspaceAuth(item) === "rejected");
  steps.push({
    id: "slack",
    title: "Add your Slack",
    status: total === 0 ? "todo" : rejected.length ? "problem" : "done",
    detail:
      total === 0
        ? "Open Slack in Chrome, then click Capture from Slack in the Stillgreen extension."
        : rejected.length
          ? `Slack signed you out of ${rejected.map((item) => item.name).join(", ")}. Capture it again with the extension.`
          : `${total} ${total === 1 ? "workspace" : "workspaces"} added.`,
  });

  const scheduled = state.schedule.mode === "scheduled";
  // Older daemons do not say; a schedule someone picked counts as chosen.
  const hoursChosen = state.schedule.saved ?? scheduled;
  const hoursNow = scheduled
    ? `Scheduled: ${state.schedule.summary || daysSummary(state.schedule.active_days)}.`
    : "Always on.";
  steps.push({
    id: "hours",
    title: "Choose your hours",
    status: hoursChosen ? "done" : "todo",
    detail: hoursChosen
      ? `${hoursNow} Change it under Schedule any time.`
      : `Now: ${hoursNow} Pick Always on or Scheduled under Schedule and save, so Stillgreen helps only when you want.`,
  });

  const autostart = state.autostart;
  if (autostart && autostart.supported) {
    steps.push({
      id: "startup",
      title: "Start at login (optional)",
      status: autostart.enabled ? "done" : "todo",
      detail: autostart.enabled
        ? "Stillgreen starts by itself when you log in to this Mac."
        : `To start Stillgreen when you log in to this Mac, run ${autostart.command || "./sg-local install-launchd"}`,
    });
  }

  // The same checks as the "Presence confirmed" signal (statusSignals).
  const pausedAll = state.paused && !state.stay_active;
  const offSchedule = scheduled && !state.schedule.active && !state.stay_active;
  const wanted = state.workspaces.filter(
    (item) =>
      !item.paused &&
      workspaceAuth(item) !== "rejected" &&
      item.status !== "manual_away" &&
      item.presence !== "manual_away",
  );
  const confirmed = pausedAll || offSchedule ? 0 : wanted.filter((item) => presenceConfirmed(item, state)).length;
  const wantedNow = !pausedAll && !offSchedule && wanted.length > 0;
  let presenceStep: SetupStep;
  if (!running || total === 0) {
    presenceStep = { id: "presence", title: "Presence confirmed", status: "todo", detail: "Finish the steps above first." };
  } else if (!wantedNow) {
    presenceStep = {
      id: "presence",
      title: "Presence confirmed",
      status: "todo",
      detail: "Paused, outside your hours, or set away by you, so there is nothing to confirm right now.",
    };
  } else if (confirmed === wanted.length) {
    presenceStep = {
      id: "presence",
      title: "Presence confirmed",
      status: "done",
      detail:
        wanted.length === 1
          ? "Slack's own status check shows you as active."
          : `Slack's own status check shows you as active in all ${wanted.length} workspaces.`,
    };
  } else {
    presenceStep = {
      id: "presence",
      title: "Presence confirmed",
      status: "waiting",
      detail:
        confirmed > 0
          ? `Confirmed in ${confirmed} of ${wanted.length}. Waiting for Slack to confirm the others. Stillgreen asks about once a minute.`
          : "Waiting for Slack to confirm. Stillgreen asks about once a minute.",
    };
  }
  steps.push(presenceStep);
  return steps;
}

/** Show the checklist when there is nothing set up yet or something is failing. */
export function needsSetupHelp(steps: SetupStep[]): boolean {
  return steps.some((step) => step.status === "problem" || (step.id === "slack" && step.status === "todo"));
}

/** "Weekdays", "Every day", "Mon, Wed, Fri" */
export function daysSummary(days: readonly string[]): string {
  const keys = DAYS.map((day) => day.key).filter((key) => days.includes(key));
  if (keys.length === 7) return "Every day";
  if (keys.length === 5 && WEEKDAY_KEYS.every((key) => keys.includes(key))) return "Weekdays";
  if (keys.length === 2 && keys.includes("saturday") && keys.includes("sunday")) return "Weekends";
  return DAYS.filter((day) => keys.includes(day.key))
    .map((day) => day.label)
    .join(", ");
}

/** Avatar colors per workspace, stable by team id. Tones only, so both themes work. */
export function avatarTone(teamId: string): "info" | "violet" | "neutral" {
  let hash = 0;
  for (const char of teamId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (["info", "violet", "neutral"] as const)[hash % 3];
}

// ------------------------------------------------------------------ activity

// The daemon's log lines, in plain words, for daemons too old to send their
// own "summary" (sg_local/web.py summarize). Unknown lines are shown as written.
const ACTIVITY_PHRASES: ReadonlyArray<[RegExp, string | ((...groups: string[]) => string)]> = [
  [/^connected to slack websocket/i, "Connected to Slack"],
  [/^received hello from slack/i, "Slack confirmed the connection"],
  [/^presence is active/i, "Slack shows you as active"],
  [/^presence is manually away/i, "You set yourself away, so it was left alone"],
  [/^presence is (\S+); reconnecting/i, "Slack showed you as away, so Stillgreen reconnected"],
  [/^reconnecting to reset presence/i, "Reconnecting so Slack can see you as active again"],
  [/^slack asked the client to reconnect/i, "Slack asked for a fresh connection"],
  [/^sent activity tickle/i, "Sent a small sign of activity"],
  [/^starting presence session/i, "Started the Slack connection"],
  [/^presence session stopped \((.+)\)/i, (why) => (/^stopped$/i.test(why) ? "Stopped the Slack connection" : `Stopped the Slack connection (${why})`)],
  [/^starting session for (.+)/i, (name) => `Starting ${name}`],
  [/^stopping session for (.+?) \((.+)\)/i, (name, why) => `Stopped ${name} (${why})`],
  [/^connection lasted \S+; retrying in (\S+?)s?$/i, (wait) => `Connection dropped. Trying again in ${wait} s`],
  [/^mode: inside schedule/i, "Inside your schedule"],
  [/^mode: outside schedule/i, "Outside your schedule"],
  [/^mode: paused until resumed/i, "Paused until you resume"],
  [/^mode: paused/i, "Paused for a while"],
  [/^mode: stay online/i, "Keep me online started"],
  [/^mode: always on/i, "Always on"],
  [/^config (?:re)?loaded: (\d+) workspace/i, (count) => `Settings loaded: ${count} ${count === "1" ? "workspace" : "workspaces"}`],
  [/^daemon started/i, "Stillgreen started"],
  [/^daemon (?:stopping|shutting down)/i, "Stillgreen is stopping"],
  [/^control page listening/i, "Control page started"],
  [/^tokens for (.+?) were rejected/i, (name) => `Slack signed ${name} out. Capture it again with the extension`],
  [/^workspace (.+) was removed from config/i, (name) => `Removed ${name}`],
];

export function activityText(text: string): string {
  for (const [pattern, phrase] of ACTIVITY_PHRASES) {
    const match = text.match(pattern);
    if (match) return typeof phrase === "string" ? phrase : phrase(...match.slice(1));
  }
  return capitalize(text);
}

/** One activity entry in plain words. Newer daemons send the words themselves. */
export function activityLine(entry: Pick<ActivityEntry, "text" | "summary">): string {
  return entry.summary || activityText(entry.text);
}
