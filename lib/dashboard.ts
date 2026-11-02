// Presentation helpers for the web dashboard (live and preview). Nothing here
// talks to the daemon; lib/bridge.ts does that.

import type { ActivityEntry, DaemonState, WorkspaceState } from "./bridge";

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
  state: Pick<DaemonState, "paused" | "stay_active">,
  unreachable = false,
): { tone: StatusTone; label: string } {
  if (unreachable) return { tone: "neutral", label: "Unknown" };
  if (workspace.paused) return { tone: "warning", label: "Paused" };
  if (state.paused && !state.stay_active) return { tone: "warning", label: "Paused" };
  switch (workspace.status) {
    case "active":
      return { tone: "success", label: "Active" };
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
  tone: "success" | "warning" | "neutral" | "danger";
  title: string;
  /** Shown after a dot, quieter. */
  detail?: string;
  description: string;
};

/**
 * Workspaces that are green right now. A workspace paused a moment ago can
 * still be reported as connected until the daemon drops it, so paused ones
 * never count, and nothing counts during a pause of everything.
 */
export function onlineCount(state: Pick<DaemonState, "workspaces" | "paused" | "stay_active">): number {
  if (state.paused && !state.stay_active) return 0;
  return state.workspaces.filter((item) => item.connected && item.status === "active" && !item.paused).length;
}

/**
 * What happens when Keep me online ends: the end of the sentence
 * "You'll stay online until 5:00 PM, …". Same words on the control page.
 */
export function afterStay(state: Pick<DaemonState, "paused" | "schedule">): string {
  if (state.paused) return "then your pause carries on";
  if (state.schedule.mode === "scheduled") return "then your schedule takes over";
  return "then Stillgreen goes back to always on";
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

/** The big line at the top of the dashboard, in plain words. */
export function presenceSummary(state: DaemonState, unreachable: boolean, now = Date.now()): PresenceSummary {
  const total = state.workspaces.length;
  const online = onlineCount(state);
  const greenIn = `Your Slack status is green in ${online} of ${total} ${total === 1 ? "workspace" : "workspaces"}.`;

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
      description: "Stillgreen can't read its settings file, so it isn't keeping anyone green.",
    };
  }
  if (!state.daemon.running) {
    return {
      tone: "warning",
      title: "Stopped",
      description: "Stillgreen isn't running, so it isn't keeping you green.",
    };
  }
  if (total === 0) {
    return {
      tone: "neutral",
      title: "Ready",
      detail: "Add a workspace to start",
      description: "Stillgreen starts keeping your Slack status green as soon as you add a workspace.",
    };
  }
  if (state.stay_active) {
    return {
      tone: online > 0 ? "success" : "warning",
      title: online > 0 ? "Active" : "Connecting",
      detail: state.stay_until ? `Staying online until ${when(state.stay_until, now)}` : "Staying online",
      description: `${online > 0 ? greenIn : "Stillgreen is connecting to Slack."} When it ends, ${afterStay(state).replace(/^then /, "")}.`,
    };
  }
  if (state.paused) {
    return {
      tone: "warning",
      title: "Paused",
      detail: state.pause_until ? `Until ${when(state.pause_until, now)}` : "Until you resume",
      description: "Stillgreen isn't keeping you green right now. Slack will set you away as usual.",
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
  if (online === 0) {
    return {
      tone: "warning",
      title: "Not green yet",
      detail: "Connecting to Slack",
      description: "No workspace is active right now. This usually takes a few seconds. Check the workspaces below.",
    };
  }
  const next = state.schedule.mode === "scheduled" && state.schedule.next_change ? when(state.schedule.next_change, now) : "";
  return {
    tone: "success",
    title: "Active",
    detail: state.schedule.mode === "always" ? "Always on" : next ? `Until ${next}` : "On schedule",
    description: greenIn + (state.schedule.mode === "always" ? " You stay green until you pause." : " Your schedule ends it on its own."),
  };
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
  [/^reconnecting to reset presence/i, "Reconnecting to turn you green again"],
  [/^slack asked the client to reconnect/i, "Slack asked for a fresh connection"],
  [/^sent activity tickle/i, "Sent a small sign of activity"],
  [/^starting presence session/i, "Started keeping you green"],
  [/^presence session stopped \((.+)\)/i, (why) => (/^stopped$/i.test(why) ? "Stopped keeping you green" : `Stopped keeping you green (${why})`)],
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
