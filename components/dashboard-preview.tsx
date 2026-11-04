"use client";

import Link from "next/link";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { Magnetic } from "./motion/magnetic";
import { SplitText } from "./motion/split-text";
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
import {
  Card,
  EASE,
  Label,
  LogList,
  PresenceOrb,
  Segmented,
  Ticker,
  windowSegments,
} from "./dashboard-kit";
import {
  DAYS,
  WEEKDAY_KEYS,
  formatHours,
  isOvernight,
  toMinutes,
  weeklyHours,
  windowHours,
  type DayInfo,
  type Tone,
} from "@/lib/dashboard";
import shared from "./dashboard-shared.module.css";
import styles from "./dashboard-preview.module.css";

// Matches the daemon: one window for every active day, two schedule modes, and
// pause as a separate override.
type Mode = "scheduled" | "always";
type View = Mode | "paused";

type Day = DayInfo & {
  enabled: boolean;
};

type Entry = {
  id: number;
  time: string;
  text: string;
  tone: Tone;
};

// Sample data for the preview. Nothing below comes from a daemon or from Slack.
const sampleDays: Day[] = DAYS.map((day) => ({
  ...day,
  enabled: WEEKDAY_KEYS.includes(day.key),
}));

const sampleEntries: Entry[] = [
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

// "Now" in the sample day (Wednesday, about 13:55).
const NOW_PERCENT = 58;
const TODAY_INDEX = 2;

const modeCopy: Record<View, { title: string; detail: string; change: string; progress: number }> = {
  scheduled: {
    title: "Online",
    detail: "Inside today's window",
    change: "17:00 today",
    progress: 0.58,
  },
  always: {
    title: "Always on",
    detail: "No end time set",
    change: "Never",
    progress: 1,
  },
  paused: {
    title: "Paused",
    detail: "Disconnected from Slack",
    change: "When you resume",
    progress: 0,
  },
};

type DashboardPreviewProps = {
  topSlot?: ReactNode;
};

export function DashboardPreview({ topSlot }: DashboardPreviewProps = {}) {
  const [mode, setMode] = useState<Mode>("scheduled");
  const [paused, setPaused] = useState(false);
  const [days, setDays] = useState<Day[]>(sampleDays);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [zone, setZone] = useState(zones[0]);
  const [entries, setEntries] = useState<Entry[]>(sampleEntries);
  const [announcement, setAnnouncement] = useState("Preview ready. Sample data only.");
  const [counter, setCounter] = useState(5);

  const activeDays = days.filter((day) => day.enabled);
  const dayHours = windowHours(windowStart, windowEnd);
  const totalHours = weeklyHours(activeDays.length, windowStart, windowEnd);
  const view: View = paused ? "paused" : mode;
  const current = modeCopy[view];
  const today = { ...days[TODAY_INDEX], start: windowStart, end: windowEnd };
  const segments = windowSegments(toMinutes(windowStart), toMinutes(windowEnd));
  const overnight = isOvernight(windowStart, windowEnd);
  const tone = paused ? "amber" : "green";

  function log(text: string, entryTone: Tone) {
    setEntries((previous) => [{ id: counter, time: "Now", text, tone: entryTone }, ...previous]);
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
      previous.map((day) => (day.key === key ? { ...day, enabled: !day.enabled } : day)),
    );
  }

  function applyPreset(preset: "weekdays" | "everyday" | "clear") {
    setDays((previous) =>
      previous.map((day) => ({
        ...day,
        enabled:
          preset === "everyday" ? true : preset === "weekdays" ? WEEKDAY_KEYS.includes(day.key) : false,
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
      <MotionConfig reducedMotion="user">
        <main id="main" className={shared.main}>
          {topSlot}
          <section className={shared.masthead}>
            <div className={`container ${shared.mastheadInner}`}>
              <div>
                <p className={`${shared.eyebrow} riseIn`}>
                  <span className={shared.dot} data-tone={tone} aria-hidden="true" />
                  Preview · sample workspace
                </p>
                <h1 className={shared.title}>
                  <SplitText text="The control" delay={0.1} />
                  <br />
                  <span className={shared.titleAcid}>
                    <SplitText text="surface." delay={0.42} />
                  </span>
                </h1>
                <p
                  className={`${shared.lede} riseIn`}
                  style={{ "--rise-delay": "600ms" } as CSSProperties}
                >
                  Move the schedule, pause the session, watch the log. Everything here is
                  interactive — nothing here is connected to Slack.
                </p>
              </div>
              <div
                className={`${shared.meta} riseIn`}
                style={{ "--rise-delay": "750ms" } as CSSProperties}
              >
                <span className={shared.metaChip}>
                  <Calendar width={14} height={14} />
                  Sample week · Oct 26–Nov 1
                </span>
                <span className={shared.metaChip}>
                  <Shield width={14} height={14} />
                  No tokens requested
                </span>
                <Link href="/setup" className={shared.metaLink}>
                  Run it locally
                  <ArrowRight width={14} height={14} />
                </Link>
              </div>
            </div>
          </section>

          <div className={`container ${styles.grid}`}>
            <Card className={styles.presence} aria-labelledby="presence-heading">
              <div className={styles.presenceBody}>
                <div className={styles.orbCol}>
                  <PresenceOrb
                    tone={tone}
                    fast={view === "always"}
                    progress={current.progress}
                  />
                  <div className={shared.readout} aria-hidden="true">
                    <span>Presence</span>
                    <strong className={styles.readoutValue} data-tone={tone}>
                      <Ticker value={paused ? "Away" : "Active"} />
                    </strong>
                    <small>
                      <Ticker value={current.detail} />
                    </small>
                  </div>
                </div>

                <div className={styles.presenceCopy}>
                  <Label tone={tone}>
                    {paused ? "Paused" : mode === "always" ? "Always on" : "Scheduled"}
                  </Label>
                  <h2 id="presence-heading" className={styles.presenceTitle} data-tone={tone}>
                    <motion.span
                      key={current.title}
                      initial={{ opacity: 0, y: 24 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, ease: EASE }}
                    >
                      {current.title}
                    </motion.span>
                  </h2>
                  <p className={shared.cardText}>
                    {paused
                      ? "The daemon is disconnected. Slack shows your manual status."
                      : "The daemon holds the session open and checks presence every minute."}
                  </p>
                  <div className={styles.changeRow}>
                    <Clock width={14} height={14} />
                    <span>Next change</span>
                    <strong>
                      <Ticker value={current.change} />
                    </strong>
                  </div>
                  <Segmented
                    label="Preview presence mode"
                    className={styles.modeBar}
                    options={modes}
                    value={mode}
                    tone={tone}
                    onChange={(next) =>
                      applyMode(
                        next,
                        next === "always"
                          ? "Always on selected for preview."
                          : "Schedule selected for preview.",
                      )
                    }
                  />
                </div>
              </div>
            </Card>

            <Card className={styles.session} delay={120} aria-labelledby="session-heading">
              <div className={shared.cardHead}>
                <Label>Daemon</Label>
                <span className={shared.pill} data-tone={paused ? "muted" : "green"}>
                  <span aria-hidden="true" />
                  {paused ? "Idle" : "Sample daemon"}
                </span>
              </div>
              <h2 id="session-heading" className={shared.cardTitle}>
                Session
              </h2>
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
                  <dd>
                    <label className="visuallyHidden" htmlFor="timezone">
                      Preview timezone
                    </label>
                    <select
                      id="timezone"
                      className={`${shared.input} ${styles.zoneSelect}`}
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
              <div className={styles.statRow}>
                <div className={shared.stat}>
                  <span>Weekly window</span>
                  <strong>
                    <Ticker value={formatHours(totalHours)} />
                  </strong>
                </div>
                <div className={shared.stat}>
                  <span>Active days</span>
                  <strong>
                    <Ticker value={`${activeDays.length} / 7`} />
                  </strong>
                </div>
              </div>
            </Card>

            <Card className={styles.schedule} aria-labelledby="schedule-heading">
              <div className={styles.scheduleHead}>
                <div>
                  <Label>Week</Label>
                  <h2 id="schedule-heading" className={shared.cardTitle}>
                    Schedule
                  </h2>
                  <p className={shared.cardText}>
                    Click a day to include or exclude it. One window applies to every active
                    day, in your chosen timezone.
                  </p>
                </div>
                <div className={shared.chips} role="group" aria-label="Schedule presets">
                  <button type="button" className={shared.chipButton} onClick={() => applyPreset("weekdays")}>
                    Weekdays
                  </button>
                  <button type="button" className={shared.chipButton} onClick={() => applyPreset("everyday")}>
                    Every day
                  </button>
                  <button type="button" className={shared.chipButton} onClick={() => applyPreset("clear")}>
                    Clear
                  </button>
                </div>
              </div>

              <div className={styles.windowRow}>
                <label htmlFor="window-start">Start</label>
                <input
                  id="window-start"
                  className={shared.input}
                  type="time"
                  value={windowStart}
                  onChange={(event) => event.target.value && setWindowStart(event.target.value)}
                />
                <span aria-hidden="true">→</span>
                <label htmlFor="window-end">End</label>
                <input
                  id="window-end"
                  className={shared.input}
                  type="time"
                  value={windowEnd}
                  onChange={(event) => event.target.value && setWindowEnd(event.target.value)}
                />
                {overnight && <span className={styles.overnightTag}>overnight</span>}
              </div>

              <div className={styles.week}>
                {days.map((day, index) => (
                  <div
                    key={day.key}
                    className={styles.dayRow}
                    data-enabled={day.enabled}
                    data-today={index === TODAY_INDEX}
                  >
                    <button
                      type="button"
                      className={styles.dayToggle}
                      aria-pressed={day.enabled}
                      aria-label={`${day.enabled ? "Disable" : "Enable"} ${day.label} ${day.long}`}
                      onClick={() => toggleDay(day.key)}
                    >
                      <span className={styles.switch} aria-hidden="true">
                        <motion.span
                          className={styles.knob}
                          initial={false}
                          animate={{ x: day.enabled ? 16 : 0 }}
                          transition={{ type: "spring", stiffness: 600, damping: 32 }}
                        >
                          {day.enabled && <Check width={10} height={10} />}
                        </motion.span>
                      </span>
                      <span className={styles.dayName}>{day.label}</span>{" "}
                      <span className={styles.dayLong}>{day.long}</span>
                    </button>
                    <div className={styles.track} aria-hidden="true">
                      <AnimatePresence initial={false}>
                        {day.enabled &&
                          segments.map(([left, width], part) => (
                            <motion.i
                              key={`${day.key}-${part}`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              initial={{ scaleX: 0, opacity: 0 }}
                              animate={{ scaleX: 1, opacity: 1 }}
                              exit={{ scaleX: 0, opacity: 0 }}
                              transition={{ duration: 0.6, ease: EASE, delay: part * 0.08 }}
                            />
                          ))}
                      </AnimatePresence>
                      {index === TODAY_INDEX && (
                        <span className={styles.trackNow} style={{ left: `${NOW_PERCENT}%` }} />
                      )}
                    </div>
                    <span className={styles.dayRange}>
                      {day.enabled ? `${windowStart} – ${windowEnd}` : "—"}
                    </span>
                    <span className={styles.dayHours}>{day.enabled ? formatHours(dayHours) : "—"}</span>
                  </div>
                ))}
                <div className={styles.axis} aria-hidden="true">
                  <span>00</span>
                  <span>06</span>
                  <span>12</span>
                  <span>18</span>
                  <span>24</span>
                </div>
              </div>

              <div className={styles.scheduleFoot}>
                <span>
                  <Clock width={14} height={14} />
                  Total{" "}
                  <strong>
                    <Ticker value={formatHours(totalHours)} />
                  </strong>{" "}
                  per week
                </span>
                <span>
                  <Sliders width={14} height={14} />
                  {zone}
                </span>
              </div>
            </Card>

            <Card className={styles.quick} delay={120} aria-labelledby="quick-heading">
              <Label>Controls</Label>
              <h2 id="quick-heading" className={shared.cardTitle}>
                Quick actions
              </h2>
              <div className={styles.quickGrid}>
                <button
                  type="button"
                  className={styles.quickButton}
                  data-tone="amber"
                  onClick={() => applyPause(true, "Paused for 1 hour in preview.")}
                >
                  <Pause width={16} height={16} />
                  Pause 1h
                </button>
                <button
                  type="button"
                  className={styles.quickButton}
                  data-tone="green"
                  onClick={() => applyPause(false, "Session resumed in preview.")}
                >
                  <Play width={16} height={16} />
                  Resume
                </button>
                <button
                  type="button"
                  className={styles.quickButton}
                  data-tone="green"
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
                  data-tone="amber"
                  onClick={() => applyPause(true, "Session stopped in preview.")}
                >
                  <Lock width={16} height={16} />
                  Stop session
                </button>
              </div>

              <div className={styles.today}>
                <div className={styles.todayHead}>
                  <span>Today · Wednesday</span>
                  <strong>{today.enabled ? `${today.start} – ${today.end}` : "No window"}</strong>
                </div>
                <div className={styles.todayTrack} aria-hidden="true">
                  {today.enabled &&
                    segments.map(([left, width], part) => (
                      <i key={part} style={{ left: `${left}%`, width: `${width}%` }} />
                    ))}
                  <span className={styles.todayNow} style={{ left: `${NOW_PERCENT}%` }} data-tone={tone} />
                </div>
                <div className={styles.todayAxis} aria-hidden="true">
                  <span>00:00</span>
                  <span>12:00</span>
                  <span>24:00</span>
                </div>
              </div>

              <div className={styles.next}>
                <p className={styles.nextLabel}>Next in preview</p>
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
                    <em>
                      <Ticker value={today.enabled ? today.end : "—"} />
                    </em>
                  </li>
                </ul>
              </div>
              <p className={styles.quickNote}>
                Real actions run through <code className={shared.code}>./sg-local</code> on your
                daemon host.
              </p>
            </Card>

            <Card className={styles.activity} aria-labelledby="activity-heading">
              <div className={shared.cardHead}>
                <Label tone="green">Log</Label>
                <span className={shared.pill}>
                  <Ticker value={`${entries.length} events`} />
                </span>
              </div>
              <h2 id="activity-heading" className={shared.cardTitle}>
                Activity
              </h2>
              <p className={shared.cardText}>Preview events appear here as you use the controls.</p>
              <LogList
                entries={entries.map((entry) => ({
                  key: String(entry.id),
                  time: entry.time,
                  text: entry.text,
                  tone: entry.tone,
                }))}
              />
            </Card>

            <Card className={styles.honesty} delay={120}>
              <div className={styles.honestyIcon} aria-hidden="true">
                <Shield width={20} height={20} />
              </div>
              <h2 className={styles.honestyTitle}>What this page can and cannot do.</h2>
              <p className={shared.cardText}>
                This dashboard is a static preview. It never asks for Slack tokens and cannot
                reach your workspace until you pair it with a daemon. The daemon, config, and
                presence connection live on the host you own.
              </p>
              <div className={styles.honestyActions}>
                <Magnetic>
                  <Link href="/start#connect" className="button buttonPrimary">
                    Connect a daemon
                    <ArrowRight width={15} height={15} />
                  </Link>
                </Magnetic>
                <code className={shared.code}>./sg-local start</code>
              </div>
            </Card>
          </div>

          <p className={shared.liveRegion} role="status" aria-live="polite">
            {announcement}
          </p>
        </main>
      </MotionConfig>
      <SiteFooter />
    </>
  );
}
