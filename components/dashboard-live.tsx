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
  stayOnline,
  statusLabel,
  workspaceTime,
  type BridgeConfig,
  type DaemonState,
  type WorkspaceState,
} from "@/lib/bridge";
import styles from "./dashboard-live.module.css";

const DAYS = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

const stays = ["30m", "1h", "2h", "4h", "8h"];

type Props = {
  config: BridgeConfig;
  initialState: DaemonState;
  onDisconnect: () => void;
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "S"
  );
}

function toMinutes(value: string) {
  const [hours, minutes] = (value || "0:0").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function weeklyHours(days: string[], start: string, end: string) {
  if (!days.length) return 0;
  const span = toMinutes(end) - toMinutes(start);
  const hours = (span > 0 ? span : span + 1440) / 60;
  return days.length * hours;
}

function statusTone(status: string) {
  if (status === "active" || status === "connected") return "green";
  if (["manual_away", "paused", "daemon_stopped", "scheduled_off"].includes(status)) {
    return "muted";
  }
  if (["invalid_token", "invalid_config", "error", "away", "auto_away"].includes(status)) {
    return "amber";
  }
  return "green";
}

export function DashboardLive({ config, initialState, onDisconnect }: Props) {
  const [state, setState] = useState<DaemonState>(initialState);
  const [selectedId, setSelectedId] = useState(initialState.workspaces[0]?.team_id || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("Connected to your daemon.");
  const [mode, setMode] = useState<"always" | "scheduled">(initialState.schedule.mode);
  const [days, setDays] = useState<string[]>(initialState.schedule.active_days || []);
  const [start, setStart] = useState(initialState.schedule.start_time || "09:00");
  const [end, setEnd] = useState(initialState.schedule.end_time || "17:00");
  const [timezone, setTimezone] = useState(initialState.schedule.timezone || "local");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

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
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const next = await fetchState(config);
        if (cancelled) return;
        setState(next);
        setError("");
        if (!dirtyRef.current) {
          setMode(next.schedule.mode);
          setDays(next.schedule.active_days || []);
          setStart(next.schedule.start_time || "09:00");
          setEnd(next.schedule.end_time || "17:00");
          setTimezone(next.schedule.timezone || "local");
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not refresh the daemon.");
        }
      }
    }, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config]);

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  async function run(
    label: string,
    action: () => Promise<DaemonState>,
    message: string,
  ) {
    setBusy(label);
    setError("");
    try {
      const next = await action();
      setState(next);
      setAnnouncement(message);
      if (!next.workspaces.some((item) => item.team_id === selectedId)) {
        setSelectedId(next.workspaces[0]?.team_id || "");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The daemon rejected that action.");
    } finally {
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
    setBusy(`remove-${workspace.team_id}`);
    removeWorkspace(config, workspace.team_id)
      .then((next) => {
        setState(next);
        setSelectedId(next.workspaces[0]?.team_id || "");
        setAnnouncement(`${workspace.name} removed.`);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not remove it."))
      .finally(() => setBusy(""));
  }

  async function submitSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("schedule");
    setError("");
    try {
      const next = await saveSchedule(config, {
        mode,
        active_days: days.length ? days : ["monday", "tuesday", "wednesday", "thursday", "friday"],
        start_time: start,
        end_time: end,
        timezone: timezone.trim() || "local",
      });
      setState(next);
      dirtyRef.current = false;
      setDirty(false);
      setAnnouncement("Schedule saved. The daemon applies it within a few seconds.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the schedule.");
    } finally {
      setBusy("");
    }
  }

  function toggleDay(key: string) {
    markDirty();
    setDays((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key],
    );
  }

  function preset(kind: "weekdays" | "everyday" | "clear") {
    markDirty();
    setDays(
      kind === "weekdays"
        ? DAYS.slice(0, 5).map((day) => day.key)
        : kind === "everyday"
          ? DAYS.map((day) => day.key)
          : [],
    );
    if (kind !== "clear") setMode("scheduled");
  }

  function disconnect() {
    if (!window.confirm("Disconnect this browser from the daemon? The daemon keeps running.")) {
      return;
    }
    clearBridge();
    onDisconnect();
  }

  const online = state.connected_count;
  const scheduleDirty = dirty;

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span className={styles.liveDot} aria-hidden="true" />
                Live daemon · {host}
              </p>
              <h1>
                Your dot,
                <br />
                live<span className={styles.stop}>.</span>
              </h1>
              <p className={styles.lede}>
                {online > 0
                  ? `${online} ${online === 1 ? "workspace is" : "workspaces are"} holding a Slack session. This page only sends schedule and presence commands.`
                  : "The daemon is connected. Add a workspace or resume a session to turn the dot green."}
              </p>
            </div>
            <div className={styles.mastheadMeta}>
              <span className={styles.metaRow}>
                <Signal width={15} height={15} />
                {state.daemon.running ? `Daemon running · pid ${state.daemon.pid}` : "Daemon stopped"}
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
          {!state.daemon.running && (
            <div className={styles.alert} role="alert">
              <strong>The daemon process is not running.</strong>
              <span>
                Restart it with <code>./sg-local start</code>. If it keeps stopping,
                check <code>./sg-local logs</code>.
              </span>
            </div>
          )}
          {error && (
            <div className={styles.alert} role="alert">
              <strong>Daemon error.</strong>
              <span>{error}</span>
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
              {state.workspaces.length === 0 ? (
                <a className={styles.emptyWorkspace} href={`${config.url}/#add`} target="_blank" rel="noreferrer">
                  <span className={styles.emptyPlus} aria-hidden="true">
                    +
                  </span>
                  <span>
                    <strong>Add your first workspace</strong>
                    <em>Tokens are entered on the daemon, never here.</em>
                  </span>
                </a>
              ) : (
                state.workspaces.map((workspace) => {
                  const tone = statusTone(workspace.status);
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
                      data-online={selected.connected && selected.status === "active"}
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
                        {selected.status === "active"
                          ? "Green."
                          : selected.paused
                            ? "Paused."
                            : statusLabel(selected.status)}
                      </h2>
                      <p>
                        {selected.last_error
                          ? selected.last_error
                          : selected.connected
                            ? "The daemon holds a WebSocket session to Slack and checks presence every minute."
                            : selected.reason || "Waiting for the next scheduled window."}
                      </p>
                      <div className={styles.presenceStatus}>
                        <span data-tone={statusTone(selected.status)} aria-hidden="true" />
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
                      Manage tokens
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
                      Open the daemon, paste your <code>xoxc</code> token and <code>xoxd</code>{" "}
                      cookie, and the session will start here.
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
                <span className={styles.pill} data-tone={state.daemon.running ? "green" : "amber"}>
                  <span aria-hidden="true" />
                  {state.daemon.running ? "Running" : "Stopped"}
                </span>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>Transport</dt>
                  <dd>Slack WebSocket</dd>
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
                    onClick={() => {
                      setMode("always");
                      markDirty();
                    }}
                  >
                    Always on
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "scheduled"}
                    onClick={() => {
                      setMode("scheduled");
                      markDirty();
                    }}
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
                          onChange={(event) => {
                            setStart(event.target.value);
                            markDirty();
                          }}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          type="time"
                          value={end}
                          onChange={(event) => {
                            setEnd(event.target.value);
                            markDirty();
                          }}
                        />
                      </label>
                      <label>
                        <span>Timezone</span>
                        <input
                          value={timezone}
                          onChange={(event) => {
                            setTimezone(event.target.value);
                            markDirty();
                          }}
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
                    {mode === "scheduled"
                      ? `${weeklyHours(days, start, end).toFixed(1)}h / week · ${days.length} days`
                      : "24 / 7"}
                  </span>
                  <span>
                    <Sliders width={14} height={14} />
                    {timezone || "local"}
                  </span>
                  <button
                    type="submit"
                    className="button buttonPrimary buttonSmall"
                    disabled={busy === "schedule" || (!scheduleDirty && mode === state.schedule.mode)}
                  >
                    {busy === "schedule" ? "Saving…" : scheduleDirty ? "Save schedule" : "Saved"}
                    {!busy && scheduleDirty && <Check width={14} height={14} />}
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
                A temporary override ignores pause and schedule. It expires on its own.
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
                  onClick={() =>
                    void run(
                      "pause-all",
                      () => pausePresence(config, { duration: "1h" }),
                      "All presence paused for 1 hour.",
                    )
                  }
                  disabled={Boolean(busy)}
                >
                  <Pause width={14} height={14} />
                  Pause all 1h
                </button>
                <button
                  type="button"
                  className="button buttonQuiet buttonSmall"
                  onClick={() =>
                    void run("resume-all", () => resumePresence(config, {}), "All presence resumed.")
                  }
                  disabled={Boolean(busy)}
                >
                  <Play width={14} height={14} />
                  Resume all
                </button>
              </div>
              <p className={styles.keepNote}>
                {state.paused && state.pause_until
                  ? `Paused until ${workspaceTime(state.pause_until)}.`
                  : "Manual away in Slack is never overridden."}
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
                  {state.activity.slice(0, 14).map((entry, index) => (
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
                  credentials. Tokens live on the daemon&apos;s volume. The browser sends
                  only schedule and presence commands over TLS.
                </p>
              </div>
              <Link href="/start" className={styles.securityLink}>
                Deployment notes
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
