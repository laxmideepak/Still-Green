"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ConnectDialog } from "./connect-dialog";
import { DashboardLive } from "./dashboard-live";
import { DashboardPreview } from "./dashboard-preview";
import { ArrowRight, Signal } from "./icons";
import {
  fetchState,
  loadBridge,
  type BridgeConfig,
  type DaemonState,
} from "@/lib/bridge";
import styles from "./dashboard-route.module.css";

type PreviewBannerProps = {
  error: string;
  connecting: boolean;
  onConnect: () => void;
};

function PreviewBanner({ error, connecting, onConnect }: PreviewBannerProps) {
  return (
    <div className={`container ${styles.bannerWrap}`}>
      <div className={styles.banner}>
        <span className={styles.bannerIcon} aria-hidden="true">
          <Signal width={16} height={16} />
        </span>
        <div className={styles.bannerCopy}>
          <strong>{connecting ? "Checking your daemon…" : "Preview mode · sample data"}</strong>
          <span>
            {error ||
              "Connect the daemon to turn this page live. Until then, every control here is a simulation."}
          </span>
        </div>
        <div className={styles.bannerActions}>
          <button type="button" className="button buttonPrimary buttonSmall" onClick={onConnect}>
            Connect daemon
            <ArrowRight width={14} height={14} />
          </button>
          <Link href="/start" className="button buttonQuiet buttonSmall">
            Deploy one
          </Link>
        </div>
      </div>
    </div>
  );
}

export function DashboardRoute() {
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [state, setState] = useState<DaemonState | null>(null);
  const [live, setLive] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const saved = loadBridge();
    if (!saved) return;
    setConnecting(true);
    fetchState(saved)
      .then((next) => {
        setConfig(saved);
        setState(next);
        setLive(true);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? `${caught.message} Use Connect daemon to update the URL or code.`
            : "Could not reach the saved daemon.",
        );
      })
      .finally(() => setConnecting(false));
  }, []);

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
  }

  const content: ReactNode = live && config && state ? (
    <DashboardLive config={config} initialState={state} onDisconnect={disconnected} />
  ) : (
    <DashboardPreview
      topSlot={
        <PreviewBanner
          error={error}
          connecting={connecting}
          onConnect={() => setDialog(true)}
        />
      }
    />
  );

  return (
    <>
      {content}
      <ConnectDialog
        open={dialog}
        onClose={() => setDialog(false)}
        onConnected={connected}
      />
    </>
  );
}
