"use client";

import { useEffect, useState } from "react";
import { ConnectDialog } from "./connect-dialog";
import { DashboardLive } from "./dashboard-live";
import { DashboardPreview } from "./dashboard-preview";
import { DashboardSkeleton, type DashboardNotice } from "./dashboard-kit";
import { Button } from "./ui";
import { fetchState, loadBridge, type BridgeConfig, type DaemonState } from "@/lib/bridge";

export function DashboardRoute() {
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [state, setState] = useState<DaemonState | null>(null);
  const [live, setLive] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; reason?: "code" | "url" }>({ open: false });
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Reconnect to the daemon saved in this browser, if any.
  useEffect(() => {
    const saved = loadBridge();
    if (!saved) return;
    let cancelled = false;
    // Only show "Checking" on the first try; retries stay quiet.
    if (attempt === 0) setConnecting(true);
    fetchState(saved)
      .then((next) => {
        if (cancelled) return;
        setConfig(saved);
        setState(next);
        setLive(true);
        setError("");
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not reach your saved Stillgreen.");
      })
      .finally(() => {
        if (!cancelled) setConnecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // While the saved daemon is unreachable, try again when the tab comes back
  // into view and every 30 seconds, so the page goes live once it is back.
  useEffect(() => {
    if (live || !error) return;
    const retry = () => {
      if (!document.hidden) setAttempt((value) => value + 1);
    };
    const timer = window.setInterval(retry, 30000);
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
    };
  }, [live, error]);

  function connected(nextConfig: BridgeConfig, nextState: DaemonState) {
    setConfig(nextConfig);
    setState(nextState);
    setLive(true);
    setError("");
  }

  function disconnected() {
    setLive(false);
    setConfig(null);
    setState(null);
    setError("");
  }

  const openDialog = (reason?: "code" | "url") => setDialog({ open: true, reason });

  let notice: DashboardNotice | undefined;
  if (error) {
    notice = {
      tone: "warning",
      title: "Couldn't reach your saved Stillgreen",
      body: `${error} Sample data is shown for now. This page tries again every 30 seconds.`,
      actions: (
        <>
          <Button variant="primary" size="sm" onClick={() => openDialog("url")}>
            Connect Stillgreen
          </Button>
          <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </>
      ),
    };
  }

  // Before the browser takes over, and while the saved daemon is first checked.
  if (!mounted || connecting) {
    return <DashboardSkeleton message={connecting ? "Connecting to your Stillgreen…" : undefined} />;
  }

  return (
    <>
      {live && config && state ? (
        <DashboardLive
          key={`${config.url} ${config.code}`}
          config={config}
          initialState={state}
          onDisconnect={disconnected}
          onReconnect={openDialog}
        />
      ) : (
        <DashboardPreview notice={notice} onConnect={() => openDialog()} />
      )}
      <ConnectDialog
        open={dialog.open}
        reason={dialog.reason}
        onClose={() => setDialog({ open: false })}
        onConnected={connected}
        initialUrl={config?.url}
      />
    </>
  );
}
