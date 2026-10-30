"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
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
import { DAYS, WEEKDAY_KEYS, initials, statusTone, weeklyHours } from "@/lib/dashboard";
import styles from "./dashboard-live.module.css";

const stays = ["30m", "1h", "2h", "4h", "8h"];

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

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                {!unreachable && <span className={styles.liveDot} aria-hidden="true" />}
                {unreachable ? "Daemon unreachable" : "Live daemon"} · {host}
              </p>
              <h1>
                Your dot,
                <br />
                live<span className={styles.stop}>.</span>
              </h1>
              <p className={styles.lede}>
                {unreachable
                  ? "This page cannot reach the daemon right now, so everything below is the last known state."
                  : online > 0
                    ? `${online} ${online === 1 ? "workspace is" : "workspaces are"} holding a Slack session. This page only sends schedule and presence commands.`
                    : "The daemon is connected. Add a workspace or resume a session to turn the dot green."}
              </p>
            </div>
            <div className={styles.mastheadMeta}>
              <span className={styles.metaRow}>
                <Signal width={15} height={15} />
                {unreachable
                  ? `Daemon unreachable · last seen ${clockTime(lastOkAt)}`
                  : state.daemon.running
                    ? `Daemon running · pid ${state.daemon.pid}`
                    : "Daemon stopped"}
              </span>
              <span className={styles.metaRow}>
                <Lock width={15} height={15} />
                Access code protected
              </span>
              <span className={styles.metaRow}>
                <Clock width={15} height={15} />
                Refreshed {workspaceTime(state.server_time)}
              </span>
              <div className={styles.metaActions}>
                <a
                  className={styles.metaLink}
                  href={config.url}
                  target="_blank"
                  rel="noreferrer"
                >
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
                Restart it with <code>./sg-local start</code>. If it keeps stopping,
                check <code>./sg-local logs</code>.
              </span>
            </div>
          )}
          {state.config_error && (
            <div className={styles.alert} role="alert">
              <strong>The daemon cannot read its config file.</strong>
              <span>
                Your workspaces are still in that file. Fix or restore it, then check with{" "}
                <code>./sg-local doctor</code>. Details: {state.config_error}
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

          <section className={styles.workspaceRail} aria-labelledby="workspaces-heading">
            <div className={styles.railHead}>
              <div>
                <p className={styles.kicker}>Workspaces</p>
                <h2 id="workspaces-heading">Connected Slack accounts</h2>
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
            <div className={styles.rail}>
              {state.workspaces.length === 0 && !state.config_error ? (
                <a className={styles.emptyWorkspace} href={`${config.url}/#add`} target="_blank" rel="noreferrer">
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
                  return (
                    <button
                      key={workspace.team_id}
                      type="button"
                      className={styles.workspaceChip}
                      data-selected={selected?.team_id === workspace.team_id}
                      onClick={() => setSelectedId(workspace.team_id)}
                      aria-pressed={selected?.team_id === workspace.team_id}
                    >
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
          </section>

          <div className={styles.grid}>
            <section className={styles.presenceCard} aria-labelledby="presence-heading">
              {selected ? (
                <>
                  <div className={styles.presenceTop}>
                    <div
                      className={styles.avatarRing}
                      data-online={!unreachable && selected.connected && selected.status === "active"}
                      aria-hidden="true"
                    >
                      <span>{initials(selected.name)}</span>
                      <i />
                    </div>
                    <div className={styles.presenceCopy}>
                      <p className={styles.cardKicker}>
                        {selected.name} · {selected.team_id}
                      </p>
                      <h2 id="presence-heading">
                        {unreachable && "Last known: "}
                        {selected.status === "active"
                          ? "Green."
                          : selected.paused || (state.paused && !state.stay_active)
                            ? "Paused."
                            : statusLabel(selected.status)}
                      </h2>
                      {selected.status === "invalid_token" ? (
                        <>
                          <p>
                            Slack rejected this session. Sign in at app.slack.com and press
                            Capture from Slack in the extension, or add it again on the daemon
                            page with <code>./sg-local add</code>.
                          </p>
                          {selected.last_error && <p>{selected.last_error}</p>}
                        </>
                      ) : (
                        <p>
                          {selected.last_error
                            ? selected.last_error
                            : selected.connected
                              ? "The daemon holds a WebSocket session to Slack and checks presence every minute."
                              : selected.reason || "Waiting for the next scheduled window."}
                        </p>
                      )}
                      <div className={styles.presenceStatus}>
                        <span
                          data-tone={unreachable ? "muted" : statusTone(selected.status)}
                          aria-hidden="true"
                        />
                        {selected.connected ? "WebSocket connected" : "No active session"}
                        <span className={styles.presenceSince}>
                          {selected.last_presence
                            ? `Last presence: ${selected.last_presence}`
                            : "Presence not checked yet"}
                        </span>
                      </div>
                    </div>
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

                  <div className={styles.presenceFoot}>
                    <span>
                      Presence checks <strong>{selected.stats.presence_checks ?? 0}</strong>
                    </span>
                    <span>
                      Pings <strong>{selected.stats.pings ?? 0}</strong>
                    </span>
                    <span>
                      Reconnects <strong>{selected.stats.reconnects ?? 0}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <div className={styles.presenceEmpty}>
                  <div className={styles.emptyRing} aria-hidden="true">
                    <span>+</span>
                  </div>
                  <div>
                    <p className={styles.cardKicker}>No workspace</p>
                    <h2 id="presence-heading">Add a Slack account.</h2>
                    <p>
                      Sign in at app.slack.com and press <strong>Capture from Slack</strong> in
                      the extension. Or open the daemon and paste your <code>xoxc</code> token
                      and <code>xoxd</code> cookie. The session will start here.
                    </p>
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
              )}
            </section>

            <aside className={styles.sessionCard} aria-labelledby="session-heading">
              <div className={styles.cardHead}>
                <div>
                  <p className={styles.kicker}>Session</p>
                  <h2 id="session-heading">Daemon health</h2>
                </div>
                <span
                  className={styles.pill}
                  data-tone={unreachable ? "muted" : state.daemon.running ? "green" : "amber"}
                >
                  <span aria-hidden="true" />
                  {unreachable ? "Unreachable" : state.daemon.running ? "Running" : "Stopped"}
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
            </aside>

            <section className={styles.scheduleCard} aria-labelledby="schedule-heading">
              <div className={styles.cardHead}>
                <div>
                  <p className={styles.kicker}>Schedule</p>
                  <h2 id="schedule-heading">When the dot is green</h2>
                </div>
                <span className={styles.pill}>
                  {state.schedule.active ? "Inside window" : "Outside window"}
                </span>
              </div>

              <form onSubmit={submitSchedule}>
                <div className={styles.modeBar} role="group" aria-label="Schedule mode">
                  <button
                    type="button"
                    aria-pressed={mode === "always"}
                    onClick={() => updateDraft({ mode: "always" })}
                  >
                    Always on
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "scheduled"}
                    onClick={() => updateDraft({ mode: "scheduled" })}
                  >
                    Scheduled
                  </button>
                </div>

                {mode === "scheduled" ? (
                  <>
                    <div className={styles.scheduleTop}>
                      <div className={styles.dayPicker} role="group" aria-label="Active days">
                        {DAYS.map((day) => (
                          <button
                            key={day.key}
                            type="button"
                            aria-pressed={days.includes(day.key)}
                            onClick={() => toggleDay(day.key)}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                      <div className={styles.presets} role="group" aria-label="Schedule presets">
                        <button type="button" onClick={() => preset("weekdays")}>
                          Weekdays
                        </button>
                        <button type="button" onClick={() => preset("everyday")}>
                          Every day
                        </button>
                        <button type="button" onClick={() => preset("clear")}>
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className={styles.timeGrid}>
                      <label>
                        <span>Start</span>
                        <input
                          type="time"
                          value={start}
                          onChange={(event) => updateDraft({ start: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          type="time"
                          value={end}
                          onChange={(event) => updateDraft({ end: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Timezone</span>
                        <input
                          value={timezone}
                          onChange={(event) => updateDraft({ timezone: event.target.value })}
                          placeholder="Europe/Amsterdam"
                          spellCheck={false}
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <p className={styles.alwaysNote}>
                    Every workspace stays connected all the time. Manual away is still left
                    alone. Use a scheduled window when you want the dot to end on its own.
                  </p>
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
                    disabled={busy === "schedule" || !dirty || invalidWindow}
                  >
                    {busy === "schedule" ? "Saving…" : dirty ? "Save schedule" : "Saved"}
                    {!busy && dirty && <Check width={14} height={14} />}
                  </button>
                </div>
              </form>
            </section>

            <section className={styles.keepCard} aria-labelledby="keep-heading">
              <div className={styles.cardHead}>
                <div>
                  <p className={styles.kicker}>Override</p>
                  <h2 id="keep-heading">Keep me online</h2>
                </div>
                <span className={styles.pill} data-tone={state.stay_active ? "green" : "muted"}>
                  {state.stay_active ? "Active" : "Off"}
                </span>
              </div>
              <p className={styles.keepCopy}>
                A temporary override ignores the global pause and the schedule (a paused
                workspace stays paused). It expires on its own.
              </p>
              {state.stay_active && state.stay_until ? (
                <div className={styles.stayActive}>
                  <span>
                    Online until <strong>{workspaceTime(state.stay_until)}</strong>
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
                </div>
              ) : (
                <div className={styles.stayGrid}>
                  {stays.map((duration) => (
                    <button
                      key={duration}
                      type="button"
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
              <p className={styles.keepNote}>
                {pauseNote}
              </p>
            </section>

            <section className={styles.activityCard} aria-labelledby="activity-heading">
              <div className={styles.cardHead}>
                <div>
                  <p className={styles.kicker}>Activity</p>
                  <h2 id="activity-heading">What the daemon is doing</h2>
                </div>
                <span className={styles.activityCount}>
                  {state.activity.length} {state.activity.length === 1 ? "event" : "events"}
                </span>
              </div>
              {state.activity.length === 0 ? (
                <p className={styles.emptyActivity}>
                  No events yet. The daemon writes here when a session starts, connects, or
                  checks presence.
                </p>
              ) : (
                <ol className={styles.log}>
                  {state.activity.slice(0, ACTIVITY_LIMIT).map((entry, index) => (
                    <li key={`${entry.date}-${entry.time}-${index}`}>
                      <time>{entry.time}</time>
                      <i data-tone={entry.tone} aria-hidden="true" />
                      <span>
                        {entry.text}
                        {entry.workspace && <em>{entry.workspace}</em>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={styles.securityCard}>
              <div className={styles.securityIcon} aria-hidden="true">
                <Shield width={18} height={18} />
              </div>
              <div>
                <h2>Tokens never touch this page.</h2>
                <p>
                  The dashboard has your daemon URL and access code, not your Slack
                  credentials. Tokens live in config.json wherever the daemon runs (this
                  computer or your own server); the browser talks to the daemon directly
                  and sends only schedule and presence commands.
                </p>
              </div>
              <Link href="/start" className={styles.securityLink}>
                Setup notes
                <ArrowRight width={14} height={14} />
              </Link>
            </section>
          </div>
        </div>

        <p className={styles.liveRegion} role="status" aria-live="polite">
          {announcement}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
