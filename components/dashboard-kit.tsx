"use client";

// The dashboard layout, shared by the live dashboard and the preview. Both
// pass a DaemonState and a DashboardApi; the preview's API changes sample
// data in memory, the live one calls the daemon (lib/bridge.ts).

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Brand } from "./brand";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Pause,
  Signal,
  Play,
  Plus,
  Puzzle,
  Trash,
} from "./icons";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChipGroup,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Skeleton,
  TimeInput,
  copyText,
  cx,
  useToast,
  type BannerTone,
} from "./ui";
import { scheduleTimezone, todayAt, type DaemonState, type WorkspaceState } from "@/lib/bridge";
import {
  DAYS,
  STAY_CHOICES,
  WEEKDAY_KEYS,
  activityDate,
  activityLine,
  afterStay,
  ago,
  atWhen,
  avatarTone,
  browserTimezone,
  capitalize,
  clock,
  clockFromHHMM,
  dayHeading,
  daysSummary,
  defaultUntil,
  duration,
  initial,
  isOvernight,
  knownTimezone,
  longDate,
  modeLabel,
  nextChangeText,
  onlineCount,
  presenceSummary,
  since,
  weeklyHours,
  when,
  workspaceBadge,
  workspaceNote,
  type StayChoice,
} from "@/lib/dashboard";
import { GITHUB_URL } from "@/lib/site";
import styles from "./dashboard-kit.module.css";

export type SchedulePayload = {
  mode: "always" | "scheduled";
  active_days: string[];
  start_time: string;
  end_time: string;
  timezone: string;
};

/** What the dashboard can ask for. Each call returns the new state or throws. */
export type DashboardApi = {
  pause: (payload: { duration?: string; workspace?: string }) => Promise<DaemonState>;
  resume: (payload: { workspace?: string }) => Promise<DaemonState>;
  stay: (choice: string | { until: Date } | null) => Promise<DaemonState>;
  saveSchedule: (payload: SchedulePayload) => Promise<DaemonState>;
  removeWorkspace: (teamId: string) => Promise<DaemonState>;
};

export type DashboardNotice = {
  tone: BannerTone;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
};

type ViewProps = {
  state: DaemonState;
  api: DashboardApi;
  /** Called with the state a successful action returned. */
  onState: (next: DaemonState) => void;
  preview?: boolean;
  /** The saved state is old because the daemon stopped answering. */
  unreachable?: boolean;
  /** When the daemon last answered (ms). */
  lastOkAt: number | null;
  /** Daemon base URL, e.g. http://127.0.0.1:8765. */
  daemonUrl: string;
  host: string;
  accessCode: string;
  notices?: DashboardNotice[];
  /** Live: forget the daemon. */
  onDisconnect?: () => void;
  /** Preview: open the connect dialog. */
  onConnect?: () => void;
};

// ------------------------------------------------------------------ helpers

function errorMessage(caught: unknown, fallback = "Something went wrong. Try again.") {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** A ticking clock for countdowns and "12 s ago" labels. */
function useNow(intervalMs = 10000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type Runner = <T extends DaemonState>(
  key: string,
  call: () => Promise<T>,
  success: (next: T) => { title: string; description?: string },
) => Promise<T | null>;

/** "SG-E2E1-TEST-CODE" -> "SG-••••-••••-••••". Same as the control page. */
function maskCode(code: string) {
  const body = (code || "SG-XXXX-XXXX-XXXX").replace(/^SG-/i, "");
  return `SG-${body.replace(/[^-]/g, "•")}`;
}

// ------------------------------------------------------------------ top bar

function TopBar({
  host,
  version,
  preview,
  unreachable,
  onDisconnect,
  onConnect,
}: {
  host: string;
  version: string;
  preview?: boolean;
  unreachable?: boolean;
  onDisconnect?: () => void;
  onConnect?: () => void;
}) {
  return (
    <header className={styles.topbar}>
      <div className={cx("container", styles.topbarInner)}>
        <Brand size="sm" />
        <span className={styles.crumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.crumb}>Dashboard</span>
        {preview ? (
          <span className={styles.hostPill} data-tone="neutral">
            <span className={styles.hostDot} aria-hidden="true" />
            Not connected
          </span>
        ) : (
          <span
            className={styles.hostPill}
            data-tone={unreachable ? "warning" : "success"}
            title={unreachable ? `Can't reach ${host}` : `Connected to ${host}`}
          >
            <span className={styles.hostDot} aria-hidden="true" />
            <span className="visually-hidden">{unreachable ? "Can't reach Stillgreen at" : "Connected to Stillgreen at"}</span>
            <span className={cx("mono", styles.hostName)}>{host}</span>
            {version && <span className={cx("mono", styles.hostVersion)}>v{version}</span>}
          </span>
        )}
        <div className={styles.topbarActions}>
          <Button href="/setup" variant="ghost" size="sm" className={styles.hideSmall}>
            Setup guide
          </Button>
          {preview ? (
            <Button size="sm" onClick={onConnect}>
              Connect Stillgreen
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ status card

function StatusCard({
  state,
  unreachable,
  lastOkAt,
  now,
  busy,
  run,
  api,
}: {
  state: DaemonState;
  unreachable: boolean;
  lastOkAt: number | null;
  now: number;
  busy: string;
  run: Runner;
  api: DashboardApi;
}) {
  const summary = presenceSummary(state, unreachable, now);
  const total = state.workspaces.length;

  const pauseFor = () =>
    run("pause-all", () => api.pause({ duration: "1h" }), (next) => ({
      title: "Paused for 1 hour",
      description:
        next.stay_active && next.stay_until
          ? `Keep me online is on until ${when(next.stay_until)}, so the pause starts after that.`
          : `Stillgreen starts again ${atWhen(next.pause_until)}.`,
    }));
  const pauseUntil = () =>
    run("pause-all-open", () => api.pause({}), (next) => ({
      title: "Paused until you resume",
      description: next.stay_active
        ? "Keep me online is still on. The pause starts when it ends."
        : "Slack will set you away as usual.",
    }));
  const resumeAll = () =>
    run("resume-all", () => api.resume({}), () => ({
      title: "Resumed",
      description: "Stillgreen is keeping you green again.",
    }));

  return (
    <Card className={styles.status} data-tone={summary.tone} aria-labelledby="status-title">
      <div className={styles.statusMain}>
        <span className={styles.pulse} data-tone={summary.tone} aria-hidden="true">
          <i />
        </span>
        <div className={styles.statusText}>
          <h2 id="status-title" className={styles.statusTitle}>
            <span>{summary.title}</span>
            {summary.detail && (
              <>
                <span className={styles.statusSep}> · </span>
                <span className={styles.statusDetail}>{summary.detail}</span>
              </>
            )}
          </h2>
          <p className={styles.statusDescription}>{summary.description}</p>
        </div>
        {total > 0 && (
          <div className={styles.statusActions}>
            {state.paused ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Play fill="currentColor" />}
                loading={busy === "resume-all"}
                disabled={Boolean(busy) && busy !== "resume-all"}
                onClick={resumeAll}
              >
                Resume all
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  icon={<Pause fill="currentColor" />}
                  loading={busy === "pause-all"}
                  disabled={Boolean(busy) && busy !== "pause-all"}
                  onClick={pauseFor}
                >
                  Pause 1 h
                </Button>
                <Button
                  size="sm"
                  loading={busy === "pause-all-open"}
                  disabled={Boolean(busy) && busy !== "pause-all-open"}
                  onClick={pauseUntil}
                >
                  Pause until I resume
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Online now</dt>
          <dd>{unreachable ? "Unknown" : total ? `${onlineCount(state)} of ${total}` : "None yet"}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{modeLabel(state)}</dd>
        </div>
        <div>
          <dt>Next change</dt>
          <dd>{nextChangeText(state, now)}</dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>{lastOkAt ? ago(lastOkAt, now) : "Sample"}</dd>
        </div>
      </dl>
    </Card>
  );
}

// ------------------------------------------------------------------ keep me online

function KeepOnlineCard({
  state,
  now,
  busy,
  run,
  api,
}: {
  state: DaemonState;
  now: number;
  busy: string;
  run: Runner;
  api: DashboardApi;
}) {
  const active = state.stay_active;
  const [pick, setPick] = useState<StayChoice | "until" | null>(active ? null : "1h");
  const [untilTime, setUntilTime] = useState(() => defaultUntil());
  const [untilError, setUntilError] = useState("");
  const untilId = useId();

  // A finished change anywhere on the page clears an old "Pick a time" error,
  // and an emptied Until field goes back to a sensible pick.
  const stamp = JSON.stringify([state.paused, state.pause_until, state.stay_until, state.schedule, state.workspaces.map((w) => w.paused)]);
  const lastStamp = useRef(stamp);
  useEffect(() => {
    if (lastStamp.current === stamp) return;
    lastStamp.current = stamp;
    setUntilError((error) => {
      if (error) {
        setUntilTime((value) => value || defaultUntil());
        setPick((value) => (value === "until" ? (active ? null : "1h") : value));
      }
      return "";
    });
  }, [stamp, active]);

  // After the override starts or ends, reset the picker for the next time.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current !== active) {
      wasActive.current = active;
      setPick(active ? null : "1h");
      setUntilError("");
    }
  }, [active]);

  const choice = STAY_CHOICES.find((item) => item.value === pick);
  const untilDate = pick === "until" ? todayAt(untilTime) : null;
  const endsAt = choice ? now + choice.minutes * 60000 : untilDate ? untilDate.getTime() : null;
  const label = choice
    ? `Keep on for ${choice.label}`
    : pick === "until"
      ? `Keep on until ${untilTime ? clockFromHHMM(untilTime) : "…"}`
      : "Keep on";

  function start() {
    if (pick === "until") {
      const until = todayAt(untilTime);
      if (!until) {
        setUntilError(
          untilTime ? "That time has already passed today. Pick a later time." : "Pick a time.",
        );
        return;
      }
      setUntilError("");
      void run("stay", () => api.stay({ until }), () => ({
        title: "Staying online",
        description: `Until ${clock(until)} today`,
      }));
      return;
    }
    if (!choice) return;
    void run("stay", () => api.stay(choice.value), (next) => ({
      title: "Staying online",
      description: `Until ${when(next.stay_until) || `${choice.long} from now`}`,
    }));
  }

  function cancel() {
    void run("stay-cancel", () => api.stay(null), () => ({
      title: "Keep me online is off",
      description: "Your normal settings apply again.",
    }));
  }

  const left = active && state.stay_until ? Date.parse(state.stay_until) - now : NaN;

  return (
    <Card aria-labelledby="keep-title">
      <CardHeader
        titleId="keep-title"
        title="Keep me online"
        description="Stay green past your schedule or a pause, just for now. It ends on its own."
        actions={active ? <Badge tone="success" dot>On</Badge> : undefined}
      />
      <CardBody>
        <div className={styles.keepRow}>
          <ChipGroup
            label="Keep me online for"
            value={pick === "until" ? null : pick}
            onChange={(value) => {
              setPick(value);
              setUntilError("");
            }}
            options={STAY_CHOICES.map((item) => ({ value: item.value, label: item.label, ariaLabel: item.long }))}
          />
          <span className={styles.vsep} aria-hidden="true" />
          <div className={styles.untilGroup} data-active={pick === "until"}>
            <label htmlFor={untilId} className={styles.untilLabel}>
              Until
            </label>
            <TimeInput
              id={untilId}
              size="sm"
              value={untilTime}
              className={styles.untilInput}
              aria-invalid={untilError ? true : undefined}
              aria-describedby={untilError ? `${untilId}-error` : undefined}
              onFocus={() => setPick("until")}
              onChange={(event) => {
                setUntilTime(event.target.value);
                setPick("until");
                setUntilError("");
              }}

            />
            <span className={styles.untilLabel}>today</span>
          </div>
        </div>
        {untilError && (
          <p className={styles.fieldError} id={`${untilId}-error`} role="alert">
            {untilError}
          </p>
        )}
      </CardBody>
      <CardFooter className={styles.keepFoot}>
        <span className={styles.keepNote}>
          {active && state.stay_until ? (
            <>
              You&apos;re staying online until <strong>{when(state.stay_until, now)}</strong>
              {Number.isFinite(left) && left > 0 && <> · {duration(left)} left</>}.
            </>
          ) : active ? (
            <>Keep me online is on.</>
          ) : endsAt ? (
            <>
              You&apos;ll stay online until <strong>{clock(endsAt)}</strong>, {afterStay(state)}.
            </>
          ) : (
            <>Pick how long to stay online.</>
          )}
        </span>
        <div className={styles.footActions}>
          {active && (
            <Button
              size="sm"
              onClick={cancel}
              loading={busy === "stay-cancel"}
              disabled={Boolean(busy) && busy !== "stay-cancel"}
            >
              Cancel
            </Button>
          )}
          {(!active || pick) && (
            <Button
              variant="primary"
              size="sm"
              onClick={start}
              loading={busy === "stay"}
              disabled={!pick || (Boolean(busy) && busy !== "stay")}
            >
              {label}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

// ------------------------------------------------------------------ workspaces

function WorkspaceRow({
  workspace,
  state,
  unreachable,
  busy,
  onPause,
  onResume,
  onRemove,
}: {
  workspace: WorkspaceState;
  state: DaemonState;
  unreachable: boolean;
  busy: string;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const badge = workspaceBadge(workspace, state, unreachable);
  const pauseKey = `pause-${workspace.team_id}`;
  const resumeKey = `resume-${workspace.team_id}`;
  return (
    <li className={styles.wsRow}>
      <span className={styles.avatar} data-tone={avatarTone(workspace.team_id)} aria-hidden="true">
        {initial(workspace.name)}
      </span>
      <div className={styles.wsMain}>
        <div className={styles.wsName}>
          <span id={nameId}>{workspace.name}</span>
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
        </div>
        <div className={styles.wsMeta}>
          <span>{workspaceNote(workspace)}</span>
        </div>
        {workspace.last_error && workspace.status !== "active" && (
          <p className={styles.wsError}>
            <AlertTriangle aria-hidden="true" />
            <span>{capitalize(workspace.last_error)}</span>
          </p>
        )}
      </div>
      <div className={styles.wsActions}>
        {workspace.paused ? (
          <Button
            size="sm"
            icon={<Play fill="currentColor" />}
            aria-describedby={nameId}
            loading={busy === resumeKey}
            disabled={Boolean(busy) && busy !== resumeKey}
            onClick={onResume}
          >
            Resume
          </Button>
        ) : (
          <Button
            size="sm"
            icon={<Pause fill="currentColor" />}
            aria-describedby={nameId}
            loading={busy === pauseKey}
            disabled={Boolean(busy) && busy !== pauseKey}
            onClick={onPause}
          >
            Pause
          </Button>
        )}
        <Button
          size="sm"
          variant="destructive-ghost"
          icon={<Trash />}
          aria-describedby={nameId}
          disabled={Boolean(busy)}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

function WorkspacesCard({
  state,
  unreachable,
  busy,
  run,
  api,
  onAdd,
}: {
  state: DaemonState;
  unreachable: boolean;
  busy: string;
  run: Runner;
  api: DashboardApi;
  onAdd: () => void;
}) {
  const [removing, setRemoving] = useState<WorkspaceState | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const total = state.workspaces.length;
  const online = onlineCount(state);

  async function confirmRemove() {
    if (!removing) return;
    const target = removing;
    const next = await run(`remove-${target.team_id}`, () => api.removeWorkspace(target.team_id), () => ({
      title: `${target.name} removed`,
      description: "Its saved Slack login was deleted from your Stillgreen.",
    }));
    if (next) setRemoving(null);
  }

  return (
    <Card aria-labelledby="workspaces-title">
      <div ref={headingRef} tabIndex={-1} className={styles.focusTarget}>
        <CardHeader
          titleId="workspaces-title"
          title="Workspaces"
          description={
            total === 0
              ? "Slack workspaces Stillgreen keeps green."
              : `${unreachable ? "?" : online} of ${total} online. Your Slack login stays on your Stillgreen.`
          }
          actions={total > 0 ? <Badge className="tnum">{total}</Badge> : undefined}
        />
      </div>
      {total === 0 ? (
        <CardBody>
          {state.config_error ? (
            <EmptyState
              compact
              icon={<AlertTriangle />}
              title="Workspaces can't be read"
              description="They are still in Stillgreen's settings file. Fix the file, and they'll show up here."
            />
          ) : (
            <EmptyState
              compact
              icon={<Puzzle />}
              title="No workspaces yet"
              description="Open Slack in Chrome and click Capture from Slack in the Stillgreen extension."
              actions={
                <Button size="sm" icon={<Plus />} onClick={onAdd} data-focus-after-remove>
                  Add workspace
                </Button>
              }
            />
          )}
        </CardBody>
      ) : (
        <CardBody flush>
          <ul className={styles.wsList}>
            {state.workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.team_id}
                workspace={workspace}
                state={state}
                unreachable={unreachable}
                busy={busy}
                onPause={() =>
                  void run(`pause-${workspace.team_id}`, () => api.pause({ workspace: workspace.team_id }), () => ({
                    title: `${workspace.name} paused`,
                    description: "It stays paused until you resume it.",
                  }))
                }
                onResume={() =>
                  void run(`resume-${workspace.team_id}`, () => api.resume({ workspace: workspace.team_id }), () => ({
                    title: `${workspace.name} resumed`,
                    description: "It reconnects in a few seconds.",
                  }))
                }
                onRemove={() => setRemoving(workspace)}
              />
            ))}
          </ul>
        </CardBody>
      )}
      <ConfirmDialog
        open={removing !== null}
        destructive
        title={`Remove ${removing?.name ?? "this workspace"}?`}
        description="Stillgreen will stop keeping you green there and delete its saved Slack login. You can add it again any time."
        confirmLabel="Remove workspace"
        loading={Boolean(removing) && busy === `remove-${removing?.team_id}`}
        returnFocus={() =>
          document.querySelector<HTMLElement>("[data-focus-after-remove]") ?? headingRef.current
        }
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ schedule

type ScheduleDraft = {
  mode: "always" | "scheduled";
  days: string[];
  start: string;
  end: string;
  timezone: string;
};

function draftFrom(schedule: DaemonState["schedule"]): ScheduleDraft {
  return {
    mode: schedule.mode === "scheduled" ? "scheduled" : "always",
    days: DAYS.map((day) => day.key).filter((key) => (schedule.active_days || []).includes(key)),
    start: schedule.start_time || "09:00",
    end: schedule.end_time || "17:00",
    // "local" means the daemon's own clock. Show the zone that will be saved.
    timezone: scheduleTimezone(schedule.timezone || ""),
  };
}

function ScheduleCard({
  state,
  busy,
  run,
  api,
}: {
  state: DaemonState;
  busy: string;
  run: Runner;
  api: DashboardApi;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFrom(state.schedule));
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const browserZone = useMemo(() => browserTimezone(), []);

  // Follow the daemon while nothing is being edited.
  const savedKey = JSON.stringify([
    state.schedule.mode,
    state.schedule.active_days,
    state.schedule.start_time,
    state.schedule.end_time,
    state.schedule.timezone,
  ]);
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(state.schedule));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  function update(patch: Partial<ScheduleDraft>) {
    setDirty(true);
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  const { mode, days, start, end, timezone } = draft;
  const scheduled = mode === "scheduled";
  const daysError = scheduled && days.length === 0 ? "Pick at least one day." : "";
  const timeError = !scheduled
    ? ""
    : !start || !end
      ? "Enter a start and an end time."
      : start === end
        ? "The end time must be different from the start time."
        : "";
  const zoneError = timezone.trim() && !knownTimezone(timezone) ? "Unknown time zone. Use a name like America/New_York." : "";
  const invalid = Boolean(daysError || timeError || zoneError);
  const hours = weeklyHours(days.length, start, end);
  const hoursText = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    setTried(true);
    if (invalid) return;
    const next = await run(
      "schedule",
      () =>
        api.saveSchedule({
          mode,
          active_days: days.length ? days : [...WEEKDAY_KEYS],
          start_time: start,
          end_time: end,
          timezone: scheduleTimezone(timezone),
        }),
      () => ({ title: "Schedule saved", description: "Stillgreen uses it within a few seconds." }),
    );
    if (next) {
      setDirty(false);
      setTried(false);
      setDraft(draftFrom(next.schedule));
    }
  }

  function discard() {
    setDirty(false);
    setTried(false);
    setDraft(draftFrom(state.schedule));
  }

  return (
    <Card aria-labelledby="schedule-title">
      <CardHeader
        titleId="schedule-title"
        title="Schedule"
        description="When Stillgreen keeps you green."
        actions={
          <SegmentedControl
            label="Schedule mode"
            value={mode}
            onChange={(value) => update({ mode: value })}
            options={[
              { value: "always", label: "Always on" },
              { value: "scheduled", label: "Scheduled" },
            ]}
          />
        }
        className={styles.scheduleHeader}
      />
      <form onSubmit={save} noValidate className={styles.scheduleForm}>
        <CardBody className={styles.scheduleBody}>
          {scheduled ? (
            <>
              <div className={styles.daysHead}>
                <span className={styles.groupLabel} id="schedule-days-label">
                  Days
                </span>
                <span className={styles.presets}>
                  <button type="button" className={styles.presetLink} onClick={() => update({ days: [...WEEKDAY_KEYS] })}>
                    Weekdays
                  </button>
                  <button
                    type="button"
                    className={styles.presetLink}
                    onClick={() => update({ days: DAYS.map((day) => day.key) })}
                  >
                    Every day
                  </button>
                </span>
              </div>
              <ChipGroup
                multiple
                label="Active days"
                className={styles.days}
                value={days}
                onChange={(value) => update({ days: value })}
                options={DAYS.map((day) => ({ value: day.key, label: day.label, ariaLabel: day.long }))}
              />
              {tried && daysError && (
                <p className={styles.fieldError} role="alert">
                  {daysError}
                </p>
              )}
              <div className={styles.timeGrid}>
                <Field label="Start">
                  <TimeInput value={start} onChange={(event) => update({ start: event.target.value })} />
                </Field>
                <Field label="End" error={tried || (start && end && start === end) ? timeError : undefined}>
                  <TimeInput value={end} onChange={(event) => update({ end: event.target.value })} />
                </Field>
              </div>
              <Field
                label="Time zone"
                hint={
                  browserZone && timezone.trim() !== browserZone
                    ? `This browser is in ${browserZone}. An end before the start runs overnight.`
                    : "Start and end follow this time zone. An end before the start runs overnight."
                }
                error={zoneError || undefined}
              >
                <Input
                  mono
                  value={timezone}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={browserZone || "America/New_York"}
                  onChange={(event) => update({ timezone: event.target.value })}
                />
              </Field>
              <p className={styles.summary} data-invalid={Boolean(daysError || timeError) || undefined}>
                {daysError || timeError ? (
                  <>
                    <AlertTriangle aria-hidden="true" />
                    {daysError ? "No days picked yet" : "Fix the times above to save"}
                  </>
                ) : (
                  <>
                    <Check aria-hidden="true" />
                    <span>
                      {daysSummary(days)}, {clockFromHHMM(start)} to {clockFromHHMM(end)}
                      {isOvernight(start, end) && " (ends the next day)"} · {hoursText} hours a week
                    </span>
                  </>
                )}
              </p>
            </>
          ) : (
            <p className={styles.alwaysNote}>
              Stillgreen keeps you green all day, every day, until you pause it. Pick
              <strong> Scheduled </strong>
              to keep you green only during work hours.
            </p>
          )}
        </CardBody>
        <CardFooter>
          <span className={styles.saveState} data-dirty={dirty || undefined}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <div className={styles.footActions}>
            {dirty && (
              <Button size="sm" variant="ghost" onClick={discard} disabled={busy === "schedule"}>
                Discard
              </Button>
            )}
            <Button
              type="submit"
              variant={dirty ? "primary" : "secondary"}
              size="sm"
              loading={busy === "schedule"}
              disabled={!dirty || (Boolean(busy) && busy !== "schedule")}
            >
              {busy === "schedule" ? "Saving" : "Save schedule"}
            </Button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------ activity

const ACTIVITY_SHORT = 6;

function ActivityCard({ state, preview, now }: { state: DaemonState; preview?: boolean; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const entries = state.activity;
  const shown = expanded ? entries : entries.slice(0, ACTIVITY_SHORT);
  const dated = shown.map((entry) => ({ entry, at: activityDate(entry) }));
  // Day headings only when the list spans more than today.
  const days = new Set(dated.map(({ at }) => (at ? dayHeading(at, now) : "")));
  const withDays = days.size > 1 || (days.size === 1 && !days.has("Today"));
  const rows: ReactNode[] = [];
  let lastDay = "";
  dated.forEach(({ entry, at }, index) => {
    const day = at ? dayHeading(at, now) : "";
    if (withDays && day && day !== lastDay) {
      lastDay = day;
      rows.push(
        <li key={`day-${day}-${index}`} className={styles.activityDay}>
          {day}
        </li>,
      );
    }
    rows.push(
      <li key={`${entry.date}-${entry.time}-${index}`} className={styles.activityRow}>
        <span className={styles.activityIcon} data-tone={entry.tone} aria-hidden="true">
          {entry.tone === "green" ? <Check /> : entry.tone === "amber" ? <AlertTriangle /> : <i />}
        </span>
        <span className={styles.activityText}>
          <span title={entry.text}>{activityLine(entry)}</span>
          {entry.workspace && <span className={styles.activitySub}>{entry.workspace}</span>}
        </span>
        <time className={cx("mono", styles.activityTime)} dateTime={entry.at || `${entry.date}T${entry.time}`}>
          {at ? clock(at) : entry.time}
        </time>
      </li>,
    );
  });

  return (
    <Card aria-labelledby="activity-title">
      <CardHeader
        titleId="activity-title"
        title="Activity"
        description={preview ? "Sample events, newest first." : "What Stillgreen did lately, newest first."}
      />
      {entries.length === 0 ? (
        <CardBody>
          <p className={styles.muted}>
            Nothing yet. Events show up here when Stillgreen connects to Slack or checks your status.
          </p>
        </CardBody>
      ) : (
        <CardBody flush>
          <ol className={styles.activity}>{rows}</ol>
        </CardBody>
      )}
      {entries.length > ACTIVITY_SHORT && (
        <CardFooter>
          <span>
            Showing {shown.length} of {entries.length}
          </span>
          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : "Show all"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ connection

function ConnectionCard({
  state,
  preview,
  unreachable,
  lastOkAt,
  now,
  host,
  accessCode,
  daemonUrl,
}: {
  state: DaemonState;
  preview?: boolean;
  unreachable: boolean;
  lastOkAt: number | null;
  now: number;
  host: string;
  accessCode: string;
  daemonUrl: string;
}) {
  const [reveal, setReveal] = useState(false);
  const { toast } = useToast();
  const masked = maskCode(accessCode);

  async function copy() {
    if (await copyText(accessCode)) {
      toast({ tone: "success", title: "Access code copied" });
    } else {
      toast({ tone: "danger", title: "Couldn't copy", description: "Select the code and copy it by hand." });
    }
  }

  const badge = preview ? (
    <Badge>Not connected</Badge>
  ) : unreachable ? (
    <Badge tone="warning" dot>
      Can&apos;t reach
    </Badge>
  ) : (
    <Badge tone="info" dot>
      Connected
    </Badge>
  );

  return (
    <Card aria-labelledby="connection-title">
      <CardHeader
        titleId="connection-title"
        title="Connection"
        description={preview ? "Connect to control your own Stillgreen." : "This browser talks straight to your Stillgreen."}
        actions={badge}
      />
      <CardBody className={styles.connBody}>
        <dl className={styles.facts}>
          <div>
            <dt>Address</dt>
            <dd className="mono">{host}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd className="mono">{state.version}</dd>
          </div>
          <div>
            <dt>Running for</dt>
            <dd>{state.daemon.running ? since(state.daemon.started_at, now) || "Just started" : "Not running"}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{lastOkAt ? ago(lastOkAt, now) : "Sample"}</dd>
          </div>
        </dl>
        {!preview && accessCode && (
          <div className={styles.codeWrap}>
            <span className={styles.groupLabel}>Access code</span>
            <div className={styles.codeBox}>
              <span className={cx("mono", styles.codeText)}>
                {reveal ? accessCode : masked}
                {!reveal && <span className="visually-hidden"> (partly hidden)</span>}
              </span>
              <IconButton size="sm" label={reveal ? "Hide access code" : "Show access code"} onClick={() => setReveal((v) => !v)}>
                {reveal ? <EyeOff /> : <Eye />}
              </IconButton>
              <IconButton size="sm" label="Copy access code" onClick={() => void copy()}>
                <Copy />
              </IconButton>
            </div>
          </div>
        )}
        <p className={styles.privacy}>
          <Lock aria-hidden="true" />
          <span>Your Slack login stays on your Stillgreen. It never goes to this website.</span>
        </p>
      </CardBody>
      <CardFooter>
        {preview ? (
          <span>Free, and runs on your own computer or server.</span>
        ) : (
          <>
            <span>Change the code on your control page.</span>
            <Button size="sm" variant="ghost" href={daemonUrl} target="_blank" rel="noreferrer" iconRight={<ArrowUpRight />}>
              Open control page
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}

// ------------------------------------------------------------------ add workspace

function AddWorkspaceDialog({
  open,
  onClose,
  preview,
  daemonUrl,
  onConnect,
}: {
  open: boolean;
  onClose: () => void;
  preview?: boolean;
  daemonUrl: string;
  onConnect?: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Puzzle />}
      title="Add a Slack workspace"
      description="The quickest way is the Stillgreen extension for Chrome. It reads your Slack login in your browser and sends it straight to your Stillgreen."
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          {preview ? (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                onConnect?.();
              }}
            >
              Connect Stillgreen
            </Button>
          ) : (
            <Button variant="primary" href={`${daemonUrl}/#add`} target="_blank" rel="noreferrer" iconRight={<ArrowUpRight />}>
              Open control page
            </Button>
          )}
        </>
      }
    >
      <ol className={styles.steps}>
        <li>
          <span className={styles.stepNum} aria-hidden="true">1</span>
          <span>Open Slack in Chrome and sign in to the workspace.</span>
        </li>
        <li>
          <span className={styles.stepNum} aria-hidden="true">2</span>
          <span>
            Click the Stillgreen extension, then <strong>Capture from Slack</strong>.
          </span>
        </li>
        <li>
          <span className={styles.stepNum} aria-hidden="true">3</span>
          <span>The workspace shows up here in a few seconds.</span>
        </li>
      </ol>
      <p className={styles.dialogNote}>
        {preview
          ? "Connect your Stillgreen first. "
          : "No extension? You can also paste the two Slack values on your control page. "}
        <Link href="/setup#add-slack" className={styles.inlineLink}>
          Read the setup guide
        </Link>
      </p>
    </Dialog>
  );
}

// ------------------------------------------------------------------ the view

export function DashboardView({
  state,
  api,
  onState,
  preview,
  unreachable = false,
  lastOkAt,
  daemonUrl,
  host,
  accessCode,
  notices = [],
  onDisconnect,
  onConnect,
}: ViewProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const now = useNow();
  const zone = useMemo(() => browserTimezone(), []);

  const run: Runner = async (key, call, success) => {
    setBusy(key);
    try {
      const next = await call();
      onState(next);
      const message = success(next);
      toast({
        tone: "success",
        title: message.title,
        description: preview ? `${message.description ? `${message.description} ` : ""}Sample only, nothing was sent.` : message.description,
      });
      return next;
    } catch (caught) {
      toast({ tone: "danger", title: "That didn't work", description: errorMessage(caught), duration: 8000 });
      return null;
    } finally {
      setBusy("");
    }
  };

  const shared = { state, busy, run, api };

  return (
    <>
      <TopBar
        host={host}
        version={state.version}
        preview={preview}
        unreachable={unreachable}
        onDisconnect={() => setDisconnecting(true)}
        onConnect={onConnect}
      />
      <main id="main" className={styles.main}>
        <div className={cx("container", styles.page)}>
          {notices.length > 0 && (
            <div className={styles.notices}>
              {notices.map((notice, index) => (
                <Banner key={index} tone={notice.tone} title={notice.title} actions={notice.actions}>
                  {notice.body}
                </Banner>
              ))}
            </div>
          )}

          <div className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageTitle}>Overview</h1>
              <p className={styles.pageSubtitle}>
                {preview ? (
                  "Sample data. Connect your Stillgreen to see your own."
                ) : (
                  <>
                    {longDate(now)}
                    {zone && <> · Times shown in {zone}</>}
                  </>
                )}
              </p>
            </div>
            <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
              Add workspace
            </Button>
          </div>

          <StatusCard {...shared} unreachable={unreachable} lastOkAt={lastOkAt} now={now} />

          <div className={styles.grid}>
            <div className={styles.col}>
              <KeepOnlineCard {...shared} now={now} />
              <WorkspacesCard {...shared} unreachable={unreachable} onAdd={() => setAdding(true)} />
              <ScheduleCard {...shared} />
            </div>
            <div className={styles.col}>
              <ActivityCard state={state} preview={preview} now={now} />
              <ConnectionCard
                state={state}
                preview={preview}
                unreachable={unreachable}
                lastOkAt={lastOkAt}
                now={now}
                host={host}
                accessCode={accessCode}
                daemonUrl={daemonUrl}
              />
            </div>
          </div>

          <footer className={styles.footer}>
            <span>
              Stillgreen{state.version && !preview ? <span className="mono"> v{state.version}</span> : null} is free and open
              source. Not made by or connected to Slack.
            </span>
            <span className={styles.footerLinks}>
              <Link href="/setup">Setup guide</Link>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </span>
          </footer>
        </div>
      </main>

      <AddWorkspaceDialog
        open={adding}
        onClose={() => setAdding(false)}
        preview={preview}
        daemonUrl={daemonUrl}
        onConnect={onConnect}
      />
      <ConfirmDialog
        open={disconnecting}
        title="Disconnect this browser?"
        description="This browser forgets your Stillgreen address and access code. Stillgreen keeps running and keeps you green."
        confirmLabel="Disconnect"
        icon={<Signal />}
        onConfirm={() => {
          setDisconnecting(false);
          onDisconnect?.();
        }}
        onCancel={() => setDisconnecting(false)}
      />
    </>
  );
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card as="div" aria-hidden="true">
      <div className={styles.skeletonHead}>
        <Skeleton width="32%" height={14} />
        <Skeleton width="58%" height={12} />
      </div>
      <div className={styles.skeletonBody}>
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} width={`${88 - index * 14}%`} height={12} />
        ))}
      </div>
    </Card>
  );
}

/**
 * The first paint, before the browser takes over. The real view depends on
 * the browser's clock, locale and saved daemon, so the server never renders it.
 */
export function DashboardSkeleton({ message = "Loading the dashboard…" }: { message?: string }) {
  return (
    <>
      <header className={styles.topbar}>
        <div className={cx("container", styles.topbarInner)}>
          <Brand size="sm" />
          <span className={styles.crumbSep} aria-hidden="true">
            /
          </span>
          <span className={styles.crumb}>Dashboard</span>
        </div>
      </header>
      <main id="main" className={styles.main} aria-busy="true">
        <div className={cx("container", styles.page)}>
          <div className={styles.pageHeader}>
            <div>
              <h1 className={styles.pageTitle}>Overview</h1>
              <p className={styles.pageSubtitle} role="status">
                {message}
              </p>
            </div>
          </div>
          <SkeletonCard lines={2} />
          <div className={styles.grid}>
            <div className={styles.col}>
              <SkeletonCard />
              <SkeletonCard lines={4} />
            </div>
            <div className={styles.col}>
              <SkeletonCard lines={5} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

/** Inline code for banners. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}
