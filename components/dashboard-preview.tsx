"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import {
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Lock,
  Pause,
  Play,
  Shield,
  Signal,
  Sliders,
} from "./icons";
import styles from "./dashboard-preview.module.css";

// Matches the daemon: one window for every active day, two schedule modes, and
// pause as a separate override.
type Mode = "scheduled" | "always";
type View = Mode | "paused";

type Day = {
  key: string;
  label: string;
  long: string;
  enabled: boolean;
};

type Tone = "green" | "muted" | "amber";

type Entry = {
  id: number;
  time: string;
  text: string;
  tone: Tone;
};

const initialDays: Day[] = [
  { key: "monday", label: "Mon", long: "Monday", enabled: true },
  { key: "tuesday", label: "Tue", long: "Tuesday", enabled: true },
  { key: "wednesday", label: "Wed", long: "Wednesday", enabled: true },
  { key: "thursday", label: "Thu", long: "Thursday", enabled: true },
  { key: "friday", label: "Fri", long: "Friday", enabled: true },
  { key: "saturday", label: "Sat", long: "Saturday", enabled: false },
  { key: "sunday", label: "Sun", long: "Sunday", enabled: false },
];

const initialEntries: Entry[] = [
  { id: 4, time: "12:30", text: "Presence check: active", tone: "green" },
  { id: 3, time: "10:30", text: "Activity tickle sent", tone: "muted" },
  { id: 2, time: "09:01", text: "Presence check: active", tone: "green" },
  { id: 1, time: "09:00", text: "Session started for Fieldwork", tone: "green" },
];

const modes: Array<{ id: Mode; label: string }> = [
  { id: "scheduled", label: "Scheduled" },
  { id: "always", label: "Always on" },
];

const zones = [
  "Europe/Amsterdam",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "UTC",
];

const modeCopy: Record<View, { title: string; detail: string; change: string; progress: string }> = {
  scheduled: {
    title: "Online",
    detail: "Inside today's window",
    change: "17:00 today",
    progress: "58%",
  },
  always: {
    title: "Always on",
    detail: "No end time set",
    change: "Never",
    progress: "100%",
  },
  paused: {
    title: "Paused",
    detail: "Disconnected from Slack",
    change: "When you resume",
    progress: "0%",
  },
};

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function windowHours(startTime: string, endTime: string) {
  if (!startTime || !endTime) return 0;
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === end) return 0;
  const span = end > start ? end - start : end + 24 * 60 - start;
  return span / 60;
}

function formatHours(value: number) {
  if (Number.isInteger(value)) return `${value}h`;
  return `${value.toFixed(1)}h`;
}

type DashboardPreviewProps = {
  topSlot?: ReactNode;
};

export function DashboardPreview({ topSlot }: DashboardPreviewProps = {}) {
  const [mode, setMode] = useState<Mode>("scheduled");
  const [paused, setPaused] = useState(false);
  const [days, setDays] = useState<Day[]>(initialDays);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [zone, setZone] = useState(zones[0]);
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [announcement, setAnnouncement] = useState("Preview ready. Sample data only.");
  const [counter, setCounter] = useState(5);

  const activeDays = days.filter((day) => day.enabled);
  const dayHours = windowHours(windowStart, windowEnd);
  const weeklyHours = useMemo(() => activeDays.length * dayHours, [activeDays.length, dayHours]);
  const view: View = paused ? "paused" : mode;
  const current = modeCopy[view];
  const today = { ...days[2], start: windowStart, end: windowEnd };
  const todayStart = (toMinutes(today.start) / 1440) * 100;
  const todayEnd = Math.max(
    todayStart + 4,
    (toMinutes(today.end) / 1440) * 100,
  );

  function log(text: string, tone: Tone) {
    setEntries((previous) => [
      { id: counter, time: "Now", text, tone },
      ...previous,
    ]);
    setCounter((value) => value + 1);
  }

  function applyMode(next: Mode, message: string) {
    setMode(next);
    setAnnouncement(message);
    log(message, "green");
  }

  function applyPause(next: boolean, message: string) {
    setPaused(next);
    setAnnouncement(message);
    log(message, next ? "amber" : "green");
  }

  function toggleDay(key: string) {
    setDays((previous) =>
      previous.map((day) =>
        day.key === key ? { ...day, enabled: !day.enabled } : day,
      ),
    );
  }

  function applyPreset(preset: "weekdays" | "everyday" | "clear") {
    setDays((previous) =>
      previous.map((day) => ({
        ...day,
        enabled: preset === "everyday" ? true : preset === "weekdays" ? day.key !== "saturday" && day.key !== "sunday" : false,
      })),
    );
    setAnnouncement(
      preset === "weekdays"
        ? "Weekdays only applied."
        : preset === "everyday"
          ? "Every day applied."
          : "All days cleared.",
    );
  }

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        {topSlot}
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Preview · sample workspace
              </p>
              <h1>The control surface.</h1>
              <p className={styles.lede}>
                Move the schedule, pause the session, watch the log. Everything here is
                interactive — nothing here is connected to Slack.
              </p>
            </div>
            <div className={styles.mastheadMeta}>
              <div className={styles.metaRow}>
                <Calendar width={15} height={15} />
                <span>Sample week · Oct 26–Nov 1</span>
              </div>
              <div className={styles.metaRow}>
                <Shield width={15} height={15} />
                <span>No tokens requested</span>
              </div>
              <Link href="/setup" className={styles.metaLink}>
                Run it locally
                <ArrowRight width={14} height={14} />
              </Link>
            </div>
          </div>
        </section>

        <div className={`container ${styles.workspace}`}>
          <section className={styles.presenceCard} aria-labelledby="presence-heading">
            <div className={styles.presenceBody}>
              <div
                className={styles.seal}
                data-mode={view}
                style={{ "--progress": current.progress } as CSSProperties}
                aria-hidden="true"
              >
                <div className={styles.sealFace}>
                  <span>Presence</span>
                  <strong>{paused ? "Away" : "Active"}</strong>
                  <small>{current.detail}</small>
                </div>
              </div>
              <div className={styles.presenceCopy}>
                <div className={styles.cardLabel}>
                  <span className={styles.liveDot} data-mode={view} aria-hidden="true" />
                  {paused ? "Paused" : mode === "always" ? "Always on" : "Scheduled"}
                </div>
                <h2 id="presence-heading">{current.title}</h2>
                <p>{paused ? "The daemon is disconnected. Slack shows your manual status." : "The daemon holds the session open and checks presence every minute."}</p>
                <div className={styles.changeRow}>
                  <Clock width={14} height={14} />
                  <span>
                    Next change <strong>{current.change}</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.modeBar} role="group" aria-label="Preview presence mode">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.modeButton}
                  aria-pressed={mode === item.id}
                  onClick={() =>
                    applyMode(
                      item.id,
                      item.id === "always"
                        ? "Always on selected for preview."
                        : "Schedule selected for preview.",
                    )
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <div className={styles.column}>
            <section className={styles.sessionCard} aria-labelledby="session-heading">
              <div className={styles.cardHead}>
                <h2 id="session-heading">Session</h2>
                <span className={styles.statusPill}>
                  <span aria-hidden="true" />
                  {paused ? "Idle" : "Sample daemon"}
                </span>
              </div>
              <dl className={styles.sessionList}>
                <div>
                  <dt>Transport</dt>
                  <dd>WebSocket</dd>
                </div>
                <div>
                  <dt>Keepalive</dt>
                  <dd>Ping · 30s</dd>
                </div>
                <div>
                  <dt>Presence check</dt>
                  <dd>60s interval</dd>
                </div>
                <div>
                  <dt>Timezone</dt>
                  <dd className={styles.zoneCell}>
                    <label className="visuallyHidden" htmlFor="timezone">
                      Preview timezone
                    </label>
                    <select
                      id="timezone"
                      value={zone}
                      onChange={(event) => {
                        setZone(event.target.value);
                        setAnnouncement(`Timezone set to ${event.target.value} in preview.`);
                      }}
                    >
                      {zones.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </dd>
                </div>
              </dl>
              <div className={styles.weekSummary}>
                <div>
                  <span>Weekly window</span>
                  <strong>{formatHours(weeklyHours)}</strong>
                </div>
                <div>
                  <span>Active days</span>
                  <strong>{activeDays.length} / 7</strong>
                </div>
              </div>
            </section>

            <section className={styles.quickCard} aria-labelledby="quick-heading">
              <div className={styles.cardHead}>
                <h2 id="quick-heading">Quick actions</h2>
              </div>
              <div className={styles.quickGrid}>
                <button
                  type="button"
                  className={styles.quickButton}
                  onClick={() => applyPause(true, "Paused for 1 hour in preview.")}
                >
                  <Pause width={16} height={16} />
                  Pause 1h
                </button>
                <button
                  type="button"
                  className={styles.quickButton}
                  onClick={() => applyPause(false, "Session resumed in preview.")}
                >
                  <Play width={16} height={16} />
                  Resume
                </button>
                <button
                  type="button"
                  className={styles.quickButton}
                  onClick={() => {
                    setAnnouncement("Activity tickle sent in preview.");
                    log("Activity tickle sent", "muted");
                  }}
                >
                  <Signal width={16} height={16} />
                  Send tickle
                </button>
                <button
                  type="button"
                  className={styles.quickButton}
                  onClick={() => applyPause(true, "Session stopped in preview.")}
                >
                  <Lock width={16} height={16} />
                  Stop session
                </button>
              </div>
              <div className={styles.quickToday}>
                <div className={styles.quickTodayHead}>
                  <span>Today · Wednesday</span>
                  <strong>
                    {today.enabled ? `${today.start} – ${today.end}` : "No window"}
                  </strong>
                </div>
                <div className={styles.todayTrack} aria-hidden="true">
                  {today.enabled && (
                    <span
                      className={styles.todayWindow}
                      style={{ left: `${todayStart}%`, width: `${todayEnd - todayStart}%` }}
                    />
                  )}
                  <span className={styles.todayNow} style={{ left: "58%" }} />
                </div>
                <div className={styles.todayAxis} aria-hidden="true">
                  <span>00:00</span>
                  <span>12:00</span>
                  <span>24:00</span>
                </div>
              </div>
              <div className={styles.quickNext}>
                <p className={styles.quickNextLabel}>Next in preview</p>
                <ul>
                  <li>
                    <span>Presence check</span>
                    <em>60s</em>
                  </li>
                  <li>
                    <span>Activity tickle</span>
                    <em>3m</em>
                  </li>
                  <li>
                    <span>Window closes</span>
                    <em>{today.enabled ? today.end : "—"}</em>
                  </li>
                </ul>
              </div>
              <p className={styles.quickNote}>
                Real actions run through <code>./sg-local</code> on your daemon host.
              </p>
            </section>
          </div>

          <section className={styles.scheduleCard} aria-labelledby="schedule-heading">
            <div className={styles.scheduleHead}>
              <div>
                <h2 id="schedule-heading">Schedule</h2>
                <p>
                  Click a day to include or exclude it. One window applies to every active
                  day, in your chosen timezone.
                </p>
              </div>
              <div className={styles.presets} role="group" aria-label="Schedule presets">
                <button type="button" onClick={() => applyPreset("weekdays")}>
                  Weekdays
                </button>
                <button type="button" onClick={() => applyPreset("everyday")}>
                  Every day
                </button>
                <button type="button" onClick={() => applyPreset("clear")}>
                  Clear
                </button>
              </div>
            </div>

            <div className={`${styles.timeRange} ${styles.windowRow}`}>
              <label htmlFor="window-start">Start</label>
              <input
                id="window-start"
                type="time"
                value={windowStart}
                onChange={(event) => event.target.value && setWindowStart(event.target.value)}
              />
              <span aria-hidden="true">–</span>
              <label htmlFor="window-end">End</label>
              <input
                id="window-end"
                type="time"
                value={windowEnd}
                onChange={(event) => event.target.value && setWindowEnd(event.target.value)}
              />
            </div>

            <div className={styles.dayList}>
              {days.map((day) => (
                <div key={day.key} className={styles.dayRow} data-enabled={day.enabled}>
                  <button
                    type="button"
                    className={styles.dayToggle}
                    aria-pressed={day.enabled}
                    aria-label={`${day.enabled ? "Disable" : "Enable"} ${day.label} ${day.long}`}
                    onClick={() => toggleDay(day.key)}
                  >
                    <span className={styles.check} aria-hidden="true">
                      {day.enabled && <Check width={12} height={12} />}
                    </span>
                    <span className={styles.dayName}>{day.label}</span>{" "}
                    <span className={styles.dayLong}>{day.long}</span>
                  </button>
                  <span className={styles.timeRange}>
                    {day.enabled ? `${windowStart} – ${windowEnd}` : "—"}
                  </span>
                  <span className={styles.dayHours}>
                    {day.enabled ? formatHours(dayHours) : "—"}
                  </span>
                  <span className={styles.night}>
                    {day.enabled && toMinutes(windowEnd) < toMinutes(windowStart) ? "overnight" : ""}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.scheduleFoot}>
              <span>
                <Clock width={14} height={14} />
                Total <strong>{formatHours(weeklyHours)}</strong> per week
              </span>
              <span>
                <Sliders width={14} height={14} />
                {zone}
              </span>
            </div>
          </section>

          <section className={styles.activityCard} aria-labelledby="activity-heading">
            <div className={styles.activityHead}>
              <div>
                <h2 id="activity-heading">Activity</h2>
                <p>Preview events appear here as you use the controls.</p>
              </div>
              <span className={styles.activityCount}>{entries.length} events</span>
            </div>
            <ol className={styles.log}>
              {entries.map((entry) => (
                <li key={entry.id}>
                  <time>{entry.time}</time>
                  <i data-tone={entry.tone} aria-hidden="true" />
                  <span>{entry.text}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.honestyCard}>
            <div className={styles.honestyIcon} aria-hidden="true">
              <Shield width={18} height={18} />
            </div>
            <div className={styles.honestyCopy}>
              <h2>What this page can and cannot do.</h2>
              <p>
                This dashboard is a static preview. It never asks for Slack tokens and
                cannot reach your workspace until you pair it with a daemon. The daemon,
                config, and presence connection live on the host you own.
              </p>
            </div>
            <div className={styles.honestyActions}>
              <Link href="/start#connect" className="button buttonPrimary">
                Connect a daemon
                <ArrowRight width={15} height={15} />
              </Link>
              <code>./sg-local start</code>
            </div>
          </section>
        </div>

        <p className={styles.liveRegion} role="status" aria-live="polite">
          {announcement}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
