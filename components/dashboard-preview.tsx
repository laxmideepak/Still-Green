"use client";

// The dashboard with sample data, shown until a daemon is connected. Every
// control works, but only on the sample data in this tab; nothing is sent.

import { useMemo, useRef, useState } from "react";
import { DashboardView, type DashboardApi, type DashboardNotice, type SchedulePayload } from "./dashboard-kit";
import { Button } from "./ui";
import type { ActivityEntry, DaemonState, WorkspaceState } from "@/lib/bridge";
import { DAYS, clockFromHHMM, daysSummary } from "@/lib/dashboard";

const SAMPLE_HOST = "127.0.0.1:8765";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function iso(date: Date) {
  return date.toISOString();
}

function hhmm(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60000);
}

function entry(at: Date, text: string, tone: ActivityEntry["tone"], workspace = ""): ActivityEntry {
  return { date: ymd(at), time: hhmm(at), at: iso(at), workspace, text, tone, level: "INFO" };
}

function scheduleSummary(schedule: Pick<SchedulePayload, "mode" | "active_days" | "start_time" | "end_time">) {
  if (schedule.mode === "always") return "always on";
  return `${daysSummary(schedule.active_days).toLowerCase()}, ${clockFromHHMM(schedule.start_time)} to ${clockFromHHMM(schedule.end_time)}`;
}

/**
 * Sample state: two workspaces, a few recent events, and a schedule that
 * agrees with the real clock. During weekday work hours it is a 9 to 5
 * schedule that ends at 5 PM; at any other time it is always on, so the
 * sample never claims a schedule that has already ended.
 */
function sampleState(): DaemonState {
  const now = new Date();
  const end = new Date(now);
  end.setHours(17, 0, 0, 0);
  const weekday = now.getDay() >= 1 && now.getDay() <= 5;
  const workHours = weekday && now.getHours() >= 9 && now.getTime() < end.getTime();
  const workspaces: WorkspaceState[] = [
    {
      team_id: "T01SAMPLE",
      name: "Acme Corp",
      user_id: "U01SAMPLE",
      paused: false,
      status: "active",
      connected: true,
      reason: "",
      last_presence: "active",
      last_error: null,
      stats: { pings: 412, presence_checks: 96, reconnects: 1 },
    },
    {
      team_id: "T02SAMPLE",
      name: "Northwind Studio",
      user_id: "U02SAMPLE",
      paused: true,
      status: "paused",
      connected: false,
      reason: "paused",
      last_presence: null,
      last_error: null,
      stats: {},
    },
  ];
  return settle({
    ok: true,
    app: "stillgreen",
    version: "1.4.2",
    server_time: iso(now),
    daemon: {
      running: true,
      pid: 4242,
      started_at: iso(new Date(now.getTime() - (6 * 24 + 3) * 3600000)),
      updated_at: iso(now),
      stopped_at: null,
    },
    schedule: {
      mode: workHours ? "scheduled" : "always",
      active_days: DAYS.slice(0, 5).map((day) => day.key),
      start_time: "09:00",
      end_time: "17:00",
      timezone: "local",
      summary: workHours ? `weekdays, ${clockFromHHMM("09:00")} to ${clockFromHHMM("17:00")}` : "always on",
      active: true,
      next_change: workHours ? iso(end) : null,
    },
    paused: false,
    pause_until: null,
    stay_active: false,
    stay_until: null,
    workspaces,
    connected_count: 1,
    activity: [
      entry(minutesAgo(now, 2), "Presence is active", "green", "Acme Corp"),
      entry(minutesAgo(now, 48), "Paused Northwind Studio", "amber"),
      entry(minutesAgo(now, 95), "Reconnected to Slack after a network change", "amber", "Acme Corp"),
      entry(minutesAgo(now, 140), "Connected to Slack", "green", "Acme Corp"),
      entry(minutesAgo(now, 141), workHours ? "mode: inside schedule" : "mode: always on", "muted"),
    ],
    config_error: null,
  });
}

/** Work out each workspace's status the way the daemon would. */
function settle(state: DaemonState): DaemonState {
  const pausedAll = state.paused && !state.stay_active;
  const workspaces = state.workspaces.map((workspace) => {
    const off = workspace.paused || pausedAll;
    return {
      ...workspace,
      status: off ? "paused" : "active",
      connected: !off,
      last_presence: off ? null : "active",
    };
  });
  return {
    ...state,
    server_time: new Date().toISOString(),
    workspaces,
    connected_count: workspaces.filter((item) => item.connected).length,
  };
}

function later<T>(value: T): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), 250));
}

type Props = {
  /** Replaces the "Preview mode" banner, e.g. while checking a saved daemon. */
  notice?: DashboardNotice;
  onConnect: () => void;
};

export function DashboardPreview({ notice, onConnect }: Props) {
  const [state, setState] = useState<DaemonState>(sampleState);

  // The view hands each result back through onState, so read the latest here.
  const latest = useRef(state);
  latest.current = state;

  const api = useMemo<DashboardApi>(() => {
    const nameOf = (current: DaemonState, teamId?: string) =>
      current.workspaces.find((item) => item.team_id === teamId)?.name ?? "a workspace";

    // Apply a change to the latest sample state and log it, after a short wait
    // so buttons show their busy state like they do with a real daemon.
    const apply = (
      change: (current: DaemonState) => DaemonState,
      text: (current: DaemonState) => string,
      tone: ActivityEntry["tone"],
    ) => {
      const current = latest.current;
      const changed = change(current);
      return later(
        settle({ ...changed, activity: [entry(new Date(), text(current), tone), ...changed.activity].slice(0, 30) }),
      );
    };

    return {
      pause: ({ duration, workspace }) =>
        apply(
          (current) =>
            workspace
              ? {
                  ...current,
                  workspaces: current.workspaces.map((item) =>
                    item.team_id === workspace ? { ...item, paused: true } : item,
                  ),
                }
              : {
                  ...current,
                  paused: true,
                  pause_until: duration ? new Date(Date.now() + 3600000).toISOString() : null,
                },
          (current) =>
            workspace
              ? `Paused ${nameOf(current, workspace)}`
              : duration
                ? "Paused all workspaces for 1 hour"
                : "Paused all workspaces",
          "amber",
        ),
      resume: ({ workspace }) =>
        apply(
          (current) =>
            workspace
              ? {
                  ...current,
                  workspaces: current.workspaces.map((item) =>
                    item.team_id === workspace ? { ...item, paused: false } : item,
                  ),
                }
              : {
                  ...current,
                  paused: false,
                  pause_until: null,
                  workspaces: current.workspaces.map((item) => ({ ...item, paused: false })),
                },
          (current) => (workspace ? `Resumed ${nameOf(current, workspace)}` : "Resumed all workspaces"),
          "green",
        ),
      stay: (choice) => {
        if (choice === null) {
          return apply(
            (current) => ({ ...current, stay_active: false, stay_until: null }),
            () => "Keep me online ended",
            "muted",
          );
        }
        const minutes: Record<string, number> = { "30m": 30, "1h": 60, "2h": 120, "3h": 180 };
        const until =
          typeof choice === "string" ? new Date(Date.now() + (minutes[choice] ?? 60) * 60000) : choice.until;
        return apply(
          (current) => ({ ...current, stay_active: true, stay_until: until.toISOString() }),
          () => "Keep me online started",
          "green",
        );
      },
      saveSchedule: (payload) =>
        apply(
          (current) => ({
            ...current,
            schedule: { ...current.schedule, ...payload, summary: scheduleSummary(payload) },
          }),
          () => "Schedule saved",
          "muted",
        ),
      removeWorkspace: (teamId) =>
        apply(
          (current) => ({
            ...current,
            workspaces: current.workspaces.filter((item) => item.team_id !== teamId),
          }),
          (current) => `Removed ${nameOf(current, teamId)}`,
          "muted",
        ),
    };
  }, []);

  const banner: DashboardNotice = notice ?? {
    tone: "info",
    title: "Preview mode · sample data",
    body: "Nothing here is real yet. Connect your Stillgreen to control your own Slack status. Stillgreen is free and runs on your own computer or cloud server.",
    actions: (
      <>
        <Button variant="primary" size="sm" onClick={onConnect}>
          Connect Stillgreen
        </Button>
        <Button size="sm" href="/setup">
          Set it up
        </Button>
      </>
    ),
  };

  return (
    <DashboardView
      preview
      state={state}
      api={api}
      onState={setState}
      lastOkAt={null}
      daemonUrl={`http://${SAMPLE_HOST}`}
      host={SAMPLE_HOST}
      accessCode=""
      notices={[banner]}
      onConnect={onConnect}
    />
  );
}
