// Helpers shared by the live dashboard and the preview dashboard.

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
