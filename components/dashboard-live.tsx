"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code, DashboardView, type DashboardApi, type DashboardNotice } from "./dashboard-kit";
import { Button } from "./ui";
import {
  clearBridge,
  fetchState,
  pausePresence,
  removeWorkspace,
  resumePresence,
  saveSchedule,
  stayOnline,
  type BridgeConfig,
  type DaemonState,
} from "@/lib/bridge";
import { clock } from "@/lib/dashboard";

type Props = {
  config: BridgeConfig;
  initialState: DaemonState;
  onDisconnect: () => void;
  /** Open the connect dialog, e.g. to re-enter the access code. */
  onReconnect: (reason?: "code" | "url") => void;
};

const POLL_MS = 12000;

function isCodeError(message: string) {
  return /access code was not accepted/i.test(message);
}

export function DashboardLive({ config, initialState, onDisconnect, onReconnect }: Props) {
  const [state, setState] = useState<DaemonState>(initialState);
  const [pollError, setPollError] = useState("");
  const [unreachableSince, setUnreachableSince] = useState<number | null>(null);
  const [lastOkAt, setLastOkAt] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  // Bumped when a change starts and ends, so a poll that raced it is dropped.
  const mutationSeq = useRef(0);
  const polling = useRef(false);

  const codeRejected = isCodeError(pollError);
  const unreachable = unreachableSince !== null;

  const host = useMemo(() => {
    try {
      return new URL(config.url).host;
    } catch {
      return config.url;
    }
  }, [config.url]);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const seq = mutationSeq.current;
    try {
      const next = await fetchState(config);
      if (seq !== mutationSeq.current) return;
      setState(next);
      setPollError("");
      setUnreachableSince(null);
      setLastOkAt(Date.now());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not refresh from your Stillgreen.";
      setPollError(message);
      if (!isCodeError(message)) setUnreachableSince((since) => since ?? Date.now());
    } finally {
      polling.current = false;
    }
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled && !document.hidden) void poll();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll]);

  // Every change goes through here: drop racing polls, and notice a rejected
  // code or a daemon that stopped answering.
  const api = useMemo<DashboardApi>(() => {
    function wrap<A extends unknown[]>(call: (...args: A) => Promise<DaemonState>) {
      return async (...args: A) => {
        mutationSeq.current += 1;
        try {
          const next = await call(...args);
          setPollError("");
          setUnreachableSince(null);
          setLastOkAt(Date.now());
          return next;
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "";
          if (isCodeError(message)) setPollError(message);
          throw caught;
        } finally {
          mutationSeq.current += 1;
        }
      };
    }
    return {
      pause: wrap((payload: { duration?: string; workspace?: string }) => pausePresence(config, payload)),
      resume: wrap((payload: { workspace?: string }) => resumePresence(config, payload)),
      stay: wrap((choice: string | { until: Date } | null) => stayOnline(config, choice)),
      saveSchedule: wrap((payload: Parameters<typeof saveSchedule>[1]) => saveSchedule(config, payload)),
      removeWorkspace: wrap((teamId: string) => removeWorkspace(config, teamId)),
    };
  }, [config]);

  async function tryAgain() {
    setChecking(true);
    await poll();
    setChecking(false);
  }

  const notices: DashboardNotice[] = [];
  if (codeRejected) {
    notices.push({
      tone: "danger",
      title: "Access code not accepted",
      body: "Your Stillgreen access code changed, or it was typed wrong. Enter the current code to keep using this page.",
      actions: (
        <Button size="sm" onClick={() => onReconnect("code")}>
          Re-enter access code
        </Button>
      ),
    });
  } else if (unreachable) {
    notices.push({
      tone: "warning",
      title: "Can't reach your Stillgreen",
      body: (
        <>
          {pollError} Showing what it last sent at {clock(lastOkAt)}. This page keeps trying.
        </>
      ),
      actions: (
        <>
          <Button size="sm" onClick={() => void tryAgain()} loading={checking}>
            {checking ? "Checking" : "Try again"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReconnect("url")}>
            Change address
          </Button>
        </>
      ),
    });
  }
  if (!unreachable && !state.daemon.running) {
    notices.push({
      tone: "warning",
      title: "Stillgreen isn't running",
      body: (
        <>
          Its control page answers, but the part that talks to Slack has stopped. Start it again with{" "}
          <Code>./sg-local start</Code>. If it keeps stopping, look at <Code>./sg-local logs</Code>.
        </>
      ),
    });
  }
  if (state.config_error) {
    notices.push({
      tone: "danger",
      title: "Stillgreen can't read its settings file",
      body: (
        <>
          Your workspaces are still saved in that file. Fix or restore it, then check it with{" "}
          <Code>./sg-local doctor</Code>. Details: {state.config_error}
        </>
      ),
    });
  }

  return (
    <DashboardView
      state={state}
      api={api}
      onState={setState}
      unreachable={unreachable}
      lastOkAt={lastOkAt}
      daemonUrl={config.url}
      host={host}
      accessCode={config.code}
      notices={notices}
      onDisconnect={() => {
        clearBridge();
        onDisconnect();
      }}
    />
  );
}
