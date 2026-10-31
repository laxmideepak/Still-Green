"use client";

import Link from "next/link";
import { LayoutGroup, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { SplitText } from "./motion/split-text";
import {
  ArrowRight,
  ArrowUpRight,
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
  type LogItem,
  type OrbTone,
} from "./dashboard-kit";
import {
  clearBridge,
  fetchState,
  pausePresence,
  removeWorkspace,
  resumePresence,
  saveSchedule,
  scheduleTimezone,
  stayOnline,
  statusLabel,
  workspaceTime,
  type BridgeConfig,
  type DaemonState,
  type WorkspaceState,
} from "@/lib/bridge";
import { DAYS, WEEKDAY_KEYS, initials, statusTone, toMinutes, weeklyHours } from "@/lib/dashboard";
import shared from "./dashboard-shared.module.css";
import styles from "./dashboard-live.module.css";

const stays = ["30m", "1h", "2h", "4h", "8h"];

const scheduleModes = [
  { id: "always", label: "Always on" },
  { id: "scheduled", label: "Scheduled" },
] as const;

type Props = {
  config: BridgeConfig;
  initialState: DaemonState;
  onDisconnect: () => void;
  onReconnect: () => void;
};

const POLL_MS = 12000;
const ACTIVITY_LIMIT = 14;

type ScheduleDraft = {
  mode: "always" | "scheduled";
  days: string[];
  start: string;
  end: string;
  timezone: string;
};

function draftFromSchedule(schedule: DaemonState["schedule"]): ScheduleDraft {
  return {
    mode: schedule.mode,
    days: schedule.active_days || [],
    start: schedule.start_time || "09:00",
    end: schedule.end_time || "17:00",
    timezone: schedule.timezone || "local",
  };
}

function clockTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(ms);
}

function timeLeft(until: string | null, now: number) {
  const end = until ? Date.parse(until) : NaN;
  if (Number.isNaN(end)) return "";
  const minutes = Math.max(0, Math.ceil((end - now) / 60000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

// Stable keys for log entries, so a new entry at the top slides in without
// re-animating the ones below it. Repeats are numbered from the oldest.
function logItems(activity: DaemonState["activity"]): LogItem[] {
  const seen = new Map<string, number>();
  const keys: string[] = new Array(activity.length);
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const entry = activity[index];
    const base = `${entry.date}|${entry.time}|${entry.workspace}|${entry.text}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    keys[index] = `${base}|${count}`;
  }
  return activity.slice(0, ACTIVITY_LIMIT).map((entry, index) => ({
    key: keys[index],
    time: entry.time,
    tone: entry.tone,
    text: (
      <>
        {entry.text}
        {entry.workspace && <em>{entry.workspace}</em>}
      </>
    ),
  }));
}

export function DashboardLive({ config, initialState, onDisconnect, onReconnect }: Props) {
  const [state, setState] = useState<DaemonState>(initialState);
  const [selectedId, setSelectedId] = useState(initialState.workspaces[0]?.team_id || "");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [pollError, setPollError] = useState("");
  const [unreachableSince, setUnreachableSince] = useState<number | null>(null);
  const [lastOkAt, setLastOkAt] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("Connected to your daemon.");
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromSchedule(initialState.schedule));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  // Bumped when a mutation starts and ends, so a poll that raced it is dropped.
  const mutationSeq = useRef(0);
  const { mode, days, start, end, timezone } = draft;
  const error = actionError || pollError;
  const codeRejected = /access code was not accepted/i.test(error);
  const unreachable = unreachableSince !== null;

  const selected = useMemo(
    () => state.workspaces.find((item) => item.team_id === selectedId) || state.workspaces[0],
    [state.workspaces, selectedId],
  );

  const host = useMemo(() => {
    try {
      return new URL(config.url).host;
    } catch {
      return config.url;
    }
  }, [config.url]);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    async function poll() {
      if (document.hidden || polling) return;
      polling = true;
      const seq = mutationSeq.current;
      try {
        const next = await fetchState(config);
        if (cancelled || seq !== mutationSeq.current) return;
        setState(next);
        setPollError("");
        setActionError("");
        setUnreachableSince(null);
        setLastOkAt(Date.now());
        if (!dirtyRef.current) setDraft(draftFromSchedule(next.schedule));
      } catch (caught) {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : "Could not refresh the daemon.";
        setPollError(message);
        if (!/access code was not accepted/i.test(message)) {
          setUnreachableSince((since) => since ?? Date.now());
        }
      } finally {
        polling = false;
      }
    }
    const timer = window.setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [config]);

  function updateDraft(patch: Partial<ScheduleDraft>) {
    dirtyRef.current = true;
    setDirty(true);
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  async function run(
    label: string,
    action: () => Promise<DaemonState>,
    message: string,
  ) {
    setBusy(label);
    setActionError("");
    mutationSeq.current += 1;
    try {
      const next = await action();
      setState(next);
      setUnreachableSince(null);
      setLastOkAt(Date.now());
      setAnnouncement(message);
      if (!next.workspaces.some((item) => item.team_id === selectedId)) {
        setSelectedId(next.workspaces[0]?.team_id || "");
      }
      return next;
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "The daemon rejected that action.";
      setActionError(failure);
      setAnnouncement(failure);
      return null;
    } finally {
      mutationSeq.current += 1;
      setBusy("");
    }
  }

  function pauseOne(workspace: WorkspaceState) {
    void run(
      `pause-${workspace.team_id}`,
      () => pausePresence(config, { workspace: workspace.team_id }),
      `${workspace.name} paused.`,
    );
  }

  function resumeOne(workspace: WorkspaceState) {
    void run(
      `resume-${workspace.team_id}`,
      () => resumePresence(config, { workspace: workspace.team_id }),
      `${workspace.name} resumed.`,
    );
  }

  function removeOne(workspace: WorkspaceState) {
    if (!window.confirm(`Remove ${workspace.name}? Its tokens will be deleted from the daemon.`)) {
      return;
    }
    void run(
      `remove-${workspace.team_id}`,
      () => removeWorkspace(config, workspace.team_id),
      `${workspace.name} removed.`,
    );
  }

  async function submitSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidWindow) return;
    const next = await run(
      "schedule",
      () =>
        saveSchedule(config, {
          mode,
          active_days: days.length ? days : ["monday", "tuesday", "wednesday", "thursday", "friday"],
          start_time: start,
          end_time: end,
          timezone: scheduleTimezone(timezone),
        }),
      "Schedule saved. The daemon applies it within a few seconds.",
    );
    if (next) {
      dirtyRef.current = false;
      setDirty(false);
      setDraft(draftFromSchedule(next.schedule));
    }
  }

  function toggleDay(key: string) {
    updateDraft({
      days: days.includes(key) ? days.filter((item) => item !== key) : [...days, key],
    });
  }

  function preset(kind: "weekdays" | "everyday" | "clear") {
    updateDraft({
      days:
        kind === "weekdays"
          ? [...WEEKDAY_KEYS]
          : kind === "everyday"
            ? DAYS.map((day) => day.key)
            : [],
      ...(kind !== "clear" ? { mode: "scheduled" as const } : {}),
    });
  }

  function pauseAll() {
    void run(
      "pause-all",
      () => pausePresence(config, { duration: "1h" }),
      state.stay_active && state.stay_until
        ? `Paused for 1 hour, but the stay-online override keeps you green until ${workspaceTime(state.stay_until)}.`
        : "All presence paused for 1 hour.",
    );
  }

  function resumeAll() {
    void run("resume-all", () => resumePresence(config, {}), "All presence resumed.");
  }

  function disconnect() {
    if (!window.confirm("Disconnect this browser from the daemon? The daemon keeps running.")) {
      return;
    }
    clearBridge();
    onDisconnect();
  }

  const online = unreachable ? 0 : state.connected_count;
  const invalidWindow = mode === "scheduled" && (!start || !end || start === end);
  const pauseNote = state.paused
    ? state.stay_active && state.stay_until
      ? `Pause starts after the stay-online override ends at ${workspaceTime(state.stay_until)}.`
      : state.pause_until
        ? `Paused until ${workspaceTime(state.pause_until)}.`
        : "Paused until resumed."
    : "Manual away in Slack is never overridden.";


  // A clock for the stay-online countdown; it only ticks while an override runs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.stay_active || !state.stay_until) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [state.stay_active, state.stay_until]);

  const entries = useMemo(() => logItems(state.activity), [state.activity]);
  const segments = windowSegments(toMinutes(start), toMinutes(end));
  const selectedPaused = Boolean(
    selected && (selected.paused || (state.paused && !state.stay_active)),
  );
  const orbTone: OrbTone =
    !selected || unreachable
      ? "muted"
      : selected.status === "active"
        ? "green"
        : selectedPaused
          ? "amber"
          : "muted";
  const headTone: OrbTone = unreachable ? "muted" : online > 0 ? "green" : "amber";

  return (
    <>
      <SiteHeader />
      <MotionConfig reducedMotion="user">
        <main id="main" className={shared.main}>
          <section className={shared.masthead}>
            <div className={`container ${shared.mastheadInner}`}>
              <div>
                <p className={`${shared.eyebrow} riseIn`}>
                  <span className={shared.dot} data-tone={headTone} aria-hidden="true" />
                  {unreachable ? "Daemon unreachable" : "Live daemon"} · {host}
                </p>
                <h1 className={shared.title}>
                  <SplitText text="Your dot," delay={0.1} />
                  <br />
                  <span className={unreachable ? shared.titleDim : shared.titleAcid}>
                    <SplitText text="live." delay={0.36} />
                  </span>
                </h1>
                <p
                  className={`${shared.lede} riseIn`}
                  style={{ "--rise-delay": "550ms" } as CSSProperties}
                >
                  {unreachable
                    ? "This page cannot reach the daemon right now, so everything below is the last known state."
                    : online > 0
                      ? `${online} ${online === 1 ? "workspace is" : "workspaces are"} holding a Slack session. This page only sends schedule and presence commands.`
                      : "The daemon is connected. Add a workspace or resume a session to turn the dot green."}
                </p>
              </div>
              <div
                className={`${shared.meta} riseIn`}
                style={{ "--rise-delay": "700ms" } as CSSProperties}
              >
                <span className={shared.metaChip}>
                  <Signal width={14} height={14} />
                  {unreachable
                    ? `Daemon unreachable · last seen ${clockTime(lastOkAt)}`
                    : state.daemon.running
                      ? `Daemon running · pid ${state.daemon.pid}`
                      : "Daemon stopped"}
                </span>
                <span className={shared.metaChip}>
                  <Lock width={14} height={14} />
                  Access code protected
                </span>
                <span className={shared.metaChip}>
                  <Clock width={14} height={14} />
                  Refreshed {workspaceTime(state.server_time)}
                </span>
                <div className={styles.metaActions}>
                  <a className={shared.metaLink} href={config.url} target="_blank" rel="noreferrer">
                    Open daemon
                    <ArrowUpRight width={14} height={14} />
                  </a>
                  <button type="button" className={styles.disconnect} onClick={disconnect}>
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          </section>

          <div className={`container ${styles.body}`}>
            {!state.daemon.running && !unreachable && (
              <div className={styles.alert} role="alert">
                <strong>The daemon process is not running.</strong>
                <span>
                  Restart it with <code className={shared.code}>./sg-local start</code>. If it keeps
                  stopping, check <code className={shared.code}>./sg-local logs</code>.
                </span>
              </div>
            )}
            {state.config_error && (
              <div className={styles.alert} role="alert">
                <strong>The daemon cannot read its config file.</strong>
                <span>
                  Your workspaces are still in that file. Fix or restore it, then check with{" "}
                  <code className={shared.code}>./sg-local doctor</code>. Details: {state.config_error}
                </span>
              </div>
            )}
            {error && (
              <div className={styles.alert} role="alert">
                <strong>{unreachable ? "Daemon unreachable." : "Daemon error."}</strong>
                <span>{error}</span>
                {codeRejected && (
                  <button type="button" className="button buttonSecondary buttonSmall" onClick={onReconnect}>
                    Re-enter access code
                  </button>
                )}
              </div>
            )}

            <section className={styles.rail} aria-labelledby="workspaces-heading" data-reveal="">
              <div className={styles.railHead}>
                <div>
                  <Label>Workspaces</Label>
                  <h2 id="workspaces-heading" className={styles.railTitle}>
                    Connected Slack accounts
                  </h2>
                </div>
                <a
                  className="button buttonSecondary buttonSmall"
                  href={`${config.url}/#add`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Add workspace
                  <ArrowUpRight width={14} height={14} />
                </a>
              </div>
              <LayoutGroup id="workspace-rail">
                <div className={styles.chips}>
                  {state.workspaces.length === 0 && !state.config_error ? (
                    <a
                      className={styles.emptyWorkspace}
                      href={`${config.url}/#add`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className={styles.emptyPlus} aria-hidden="true">
                        +
                      </span>
                      <span>
                        <strong>Add your first workspace</strong>
                        <em>Use Capture from Slack in the extension, or add it on the daemon.</em>
                      </span>
                    </a>
                  ) : (
                    state.workspaces.map((workspace) => {
                      const tone = unreachable ? "muted" : statusTone(workspace.status);
                      const isSelected = selected?.team_id === workspace.team_id;
                      return (
                        <button
                          key={workspace.team_id}
                          type="button"
                          className={styles.chip}
                          data-selected={isSelected}
                          onClick={() => setSelectedId(workspace.team_id)}
                          aria-pressed={isSelected}
                        >
                          {isSelected && (
                            <motion.span
                              layoutId="chip"
                              className={styles.chipHighlight}
                              transition={{ type: "spring", stiffness: 420, damping: 34 }}
                            />
                          )}
                          <span className={styles.chipAvatar} data-tone={tone} aria-hidden="true">
                            {initials(workspace.name)}
                          </span>
                          <span className={styles.chipCopy}>
                            <strong>{workspace.name}</strong>
                            <em>
                              <i data-tone={tone} aria-hidden="true" />
                              {statusLabel(workspace.status)}
                            </em>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </LayoutGroup>
            </section>

            <div className={styles.grid}>
              <Card className={styles.presence} aria-labelledby="presence-heading">
                {selected ? (
                  <div className={styles.presenceBody}>
                    <div className={styles.orbCol}>
                      <PresenceOrb tone={orbTone} fast={state.stay_active && orbTone === "green"}>
                        {initials(selected.name)}
                      </PresenceOrb>
                    </div>

                    <div className={styles.presenceCopy}>
                      <Label tone={orbTone}>
                        {selected.name} · {selected.team_id}
                      </Label>
                      <h2 id="presence-heading" className={styles.presenceTitle} data-tone={orbTone}>
                        <motion.span
                          key={`${selected.team_id}-${selected.status}-${selectedPaused}-${unreachable}`}
                          initial={{ opacity: 0, y: 24 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, ease: EASE }}
                        >
                          {unreachable && "Last known: "}
                          {selected.status === "active"
                            ? "Green."
                            : selectedPaused
                              ? "Paused."
                              : statusLabel(selected.status)}
                        </motion.span>
                      </h2>
                      {selected.status === "invalid_token" ? (
                        <>
                          <p className={shared.cardText}>
                            Slack rejected this session. Sign in at app.slack.com and press
                            Capture from Slack in the extension, or add it again on the daemon
                            page with <code className={shared.code}>./sg-local add</code>.
                          </p>
                          {selected.last_error && <p className={shared.cardText}>{selected.last_error}</p>}
                        </>
                      ) : (
                        <p className={shared.cardText}>
                          {selected.last_error
                            ? selected.last_error
                            : selected.connected
                              ? "The daemon holds a WebSocket session to Slack and checks presence every minute."
                              : selected.reason || "Waiting for the next scheduled window."}
                        </p>
                      )}
                      <div className={styles.presenceStatus}>
                        <span
                          className={shared.dot}
                          data-tone={unreachable ? "muted" : statusTone(selected.status)}
                          aria-hidden="true"
                        />
                        <span>{selected.connected ? "WebSocket connected" : "No active session"}</span>
                        <span className={styles.presenceSince}>
                          {selected.last_presence
                            ? `Last presence: ${selected.last_presence}`
                            : "Presence not checked yet"}
                        </span>
                      </div>

                      <div className={styles.presenceActions}>
                        {selected.paused ? (
                          <button
                            type="button"
                            className="button buttonPrimary buttonSmall"
                            onClick={() => resumeOne(selected)}
                            disabled={busy === `resume-${selected.team_id}`}
                          >
                            <Play width={15} height={15} />
                            Resume
                          </button>
                        ) : state.paused ? (
                          <button
                            type="button"
                            className="button buttonPrimary buttonSmall"
                            onClick={resumeAll}
                            disabled={busy === "resume-all"}
                          >
                            <Play width={15} height={15} />
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button buttonPrimary buttonSmall"
                            onClick={() => pauseOne(selected)}
                            disabled={busy === `pause-${selected.team_id}`}
                          >
                            <Pause width={15} height={15} />
                            Pause
                          </button>
                        )}
                        <a
                          className="button buttonSecondary buttonSmall"
                          href={`${config.url}/#add`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Replace tokens
                          <ArrowUpRight width={14} height={14} />
                        </a>
                        <button
                          type="button"
                          className={`${styles.removeButton} button buttonQuiet buttonSmall`}
                          onClick={() => removeOne(selected)}
                          disabled={busy === `remove-${selected.team_id}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className={styles.presenceFoot}>
                      <div className={shared.stat}>
                        <span>Presence checks</span>
                        <strong>
                          <Ticker value={selected.stats.presence_checks ?? 0} />
                        </strong>
                      </div>
                      <div className={shared.stat}>
                        <span>Pings</span>
                        <strong>
                          <Ticker value={selected.stats.pings ?? 0} />
                        </strong>
                      </div>
                      <div className={shared.stat}>
                        <span>Reconnects</span>
                        <strong>
                          <Ticker value={selected.stats.reconnects ?? 0} />
                        </strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.presenceBody}>
                    <div className={styles.orbCol}>
                      <PresenceOrb tone="muted">+</PresenceOrb>
                    </div>
                    <div className={styles.presenceCopy}>
                      <Label>No workspace</Label>
                      <h2 id="presence-heading" className={styles.presenceTitle}>
                        Add a Slack account.
                      </h2>
                      <p className={shared.cardText}>
                        Sign in at app.slack.com and press <strong>Capture from Slack</strong> in
                        the extension. Or open the daemon and paste your{" "}
                        <code className={shared.code}>xoxc</code> token and{" "}
                        <code className={shared.code}>xoxd</code> cookie. The session will start
                        here.
                      </p>
                      <div className={styles.presenceActions}>
                        <a
                          className="button buttonPrimary buttonSmall"
                          href={`${config.url}/#add`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open the daemon
                          <ArrowRight width={14} height={14} />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              <Card as="aside" className={styles.session} delay={120} aria-labelledby="session-heading">
                <div className={shared.cardHead}>
                  <Label>Session</Label>
                  <span
                    className={shared.pill}
                    data-tone={unreachable ? "muted" : state.daemon.running ? "green" : "amber"}
                  >
                    <span aria-hidden="true" />
                    {unreachable ? "Unreachable" : state.daemon.running ? "Running" : "Stopped"}
                  </span>
                </div>
                <h2 id="session-heading" className={shared.cardTitle}>
                  Daemon health
                </h2>
                <div className={styles.sessionCount}>
                  <strong>
                    <Ticker value={state.connected_count} />
                  </strong>
                  <span>
                    / {state.workspaces.length}
                    <em>sessions live</em>
                  </span>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>Transport</dt>
                    <dd>Slack WebSocket</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>
                      {state.connected_count} of {state.workspaces.length} connected
                    </dd>
                  </div>
                  <div>
                    <dt>Schedule</dt>
                    <dd>{state.schedule.summary}</dd>
                  </div>
                  <div>
                    <dt>Daemon updated</dt>
                    <dd>{workspaceTime(state.daemon.updated_at)}</dd>
                  </div>
                </dl>
                <div className={styles.sessionFoot}>
                  <span>
                    Started <strong>{workspaceTime(state.daemon.started_at)}</strong>
                  </span>
                  <span>
                    Version <strong>{state.version}</strong>
                  </span>
                </div>
              </Card>

              <Card className={styles.schedule} aria-labelledby="schedule-heading">
                <div className={shared.cardHead}>
                  <Label tone={state.schedule.active ? "green" : undefined}>Schedule</Label>
                  <span className={shared.pill} data-tone={state.schedule.active ? "green" : undefined}>
                    <span aria-hidden="true" />
                    {state.schedule.active ? "Inside window" : "Outside window"}
                  </span>
                </div>
                <h2 id="schedule-heading" className={shared.cardTitle}>
                  When the dot is green
                </h2>

                <form onSubmit={submitSchedule} className={styles.scheduleForm}>
                  <Segmented
                    label="Schedule mode"
                    className={styles.modeBar}
                    options={scheduleModes}
                    value={mode}
                    onChange={(next) => updateDraft({ mode: next })}
                  />

                  {mode === "scheduled" ? (
                    <motion.div
                      key="scheduled"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      <div className={styles.dayPicker} role="group" aria-label="Active days">
                        {DAYS.map((day, index) => {
                          const on = days.includes(day.key);
                          return (
                            <button
                              key={day.key}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleDay(day.key)}
                            >
                              <span className={styles.dayBar} aria-hidden="true">
                                {segments.map(([top, height], part) => (
                                  <motion.i
                                    key={part}
                                    style={{ top: `${top}%`, height: `${height}%` }}
                                    initial={false}
                                    animate={{ scaleY: on ? 1 : 0, opacity: on ? 1 : 0 }}
                                    transition={{
                                      duration: 0.55,
                                      ease: EASE,
                                      delay: on ? index * 0.03 : 0,
                                    }}
                                  />
                                ))}
                              </span>
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className={shared.chips} role="group" aria-label="Schedule presets">
                        <button type="button" className={shared.chipButton} onClick={() => preset("weekdays")}>
                          Weekdays
                        </button>
                        <button type="button" className={shared.chipButton} onClick={() => preset("everyday")}>
                          Every day
                        </button>
                        <button type="button" className={shared.chipButton} onClick={() => preset("clear")}>
                          Clear
                        </button>
                      </div>

                      <div className={styles.timeGrid}>
                        <label>
                          <span>Start</span>
                          <input
                            className={shared.input}
                            type="time"
                            value={start}
                            onChange={(event) => updateDraft({ start: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>End</span>
                          <input
                            className={shared.input}
                            type="time"
                            value={end}
                            onChange={(event) => updateDraft({ end: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>Timezone</span>
                          <input
                            className={shared.input}
                            value={timezone}
                            onChange={(event) => updateDraft({ timezone: event.target.value })}
                            placeholder="Europe/Amsterdam"
                            spellCheck={false}
                          />
                        </label>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.p
                      key="always"
                      className={styles.alwaysNote}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      Every workspace stays connected all the time. Manual away is still left
                      alone. Use a scheduled window when you want the dot to end on its own.
                    </motion.p>
                  )}

                  <div className={styles.scheduleFoot}>
                    <span>
                      <Calendar width={14} height={14} />
                      {invalidWindow
                        ? "Start and end must be set and differ"
                        : mode === "scheduled"
                          ? `${weeklyHours(days.length, start, end).toFixed(1)}h / week · ${days.length} days`
                          : "24 / 7"}
                    </span>
                    <span>
                      <Sliders width={14} height={14} />
                      {timezone || "local"}
                    </span>
                    <button
                      type="submit"
                      className="button buttonPrimary buttonSmall"
                      data-dirty={dirty}
                      disabled={busy === "schedule" || !dirty || invalidWindow}
                    >
                      {busy === "schedule" ? "Saving…" : dirty ? "Save schedule" : "Saved"}
                      {!busy && dirty && <Check width={14} height={14} />}
                    </button>
                  </div>
                </form>
              </Card>

              <Card className={styles.keep} delay={120} aria-labelledby="keep-heading">
                <div className={shared.cardHead}>
                  <Label>Override</Label>
                  <span className={shared.pill} data-tone={state.stay_active ? "green" : "muted"}>
                    <span aria-hidden="true" />
                    {state.stay_active ? "Active" : "Off"}
                  </span>
                </div>
                <h2 id="keep-heading" className={shared.cardTitle}>
                  Keep me online
                </h2>
                <p className={shared.cardText}>
                  A temporary override ignores the global pause and the schedule (a paused
                  workspace stays paused). It expires on its own.
                </p>
                {state.stay_active && state.stay_until ? (
                  <motion.div
                    key="stay-active"
                    className={styles.stayActive}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  >
                    <span className={styles.stayPulse} aria-hidden="true">
                      <i />
                    </span>
                    <span className={styles.stayCopy}>
                      <span>
                        Online until <strong>{workspaceTime(state.stay_until)}</strong>
                      </span>
                      <em>
                        <Ticker value={timeLeft(state.stay_until, now)} />
                      </em>
                    </span>
                    <button
                      type="button"
                      className="button buttonSecondary buttonSmall"
                      onClick={() =>
                        void run(
                          "stay-cancel",
                          () => stayOnline(config, null),
                          "Stay-online override cleared.",
                        )
                      }
                      disabled={busy === "stay-cancel"}
                    >
                      Cancel override
                    </button>
                  </motion.div>
                ) : (
                  <div className={styles.stayGrid}>
                    {stays.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        className={styles.stayButton}
                        data-busy={busy === `stay-${duration}`}
                        onClick={() =>
                          void run(
                            `stay-${duration}`,
                            () => stayOnline(config, duration),
                            `Staying online for ${duration}.`,
                          )
                        }
                        disabled={Boolean(busy)}
                      >
                        {duration}
                      </button>
                    ))}
                  </div>
                )}
                <div className={styles.keepActions}>
                  <button
                    type="button"
                    className="button buttonSecondary buttonSmall"
                    onClick={pauseAll}
                    disabled={Boolean(busy)}
                  >
                    <Pause width={14} height={14} />
                    Pause all 1h
                  </button>
                  <button
                    type="button"
                    className="button buttonQuiet buttonSmall"
                    onClick={resumeAll}
                    disabled={Boolean(busy)}
                  >
                    <Play width={14} height={14} />
                    Resume all
                  </button>
                </div>
                <p className={styles.keepNote} data-paused={state.paused}>
                  {pauseNote}
                </p>
              </Card>

              <Card className={styles.activity} aria-labelledby="activity-heading">
                <div className={shared.cardHead}>
                  <Label tone="green">Activity</Label>
                  <span className={shared.pill}>
                    <Ticker
                      value={`${state.activity.length} ${state.activity.length === 1 ? "event" : "events"}`}
                    />
                  </span>
                </div>
                <h2 id="activity-heading" className={shared.cardTitle}>
                  What the daemon is doing
                </h2>
                {state.activity.length === 0 ? (
                  <p className={shared.cardText}>
                    No events yet. The daemon writes here when a session starts, connects, or
                    checks presence.
                  </p>
                ) : (
                  <LogList entries={entries} />
                )}
              </Card>

              <Card className={styles.security} delay={120}>
                <div className={styles.securityIcon} aria-hidden="true">
                  <Shield width={20} height={20} />
                </div>
                <h2 className={styles.securityTitle}>Tokens never touch this page.</h2>
                <p className={shared.cardText}>
                  The dashboard has your daemon URL and access code, not your Slack
                  credentials. Tokens live in config.json wherever the daemon runs (this
                  computer or your own server); the browser talks to the daemon directly and
                  sends only schedule and presence commands.
                </p>
                <Link href="/start" className={`${shared.metaLink} ${styles.securityLink}`}>
                  Setup notes
                  <ArrowRight width={14} height={14} />
                </Link>
              </Card>
            </div>
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
