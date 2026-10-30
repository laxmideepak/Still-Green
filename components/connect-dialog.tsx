"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lock, Shield } from "./icons";
import {
  DEFAULT_DAEMON_URL,
  connectBridge,
  loadBridge,
  normalizeCode,
  normalizeUrl,
  saveBridge,
  type BridgeConfig,
  type DaemonState,
} from "@/lib/bridge";
import styles from "./connect-dialog.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  onConnected: (config: BridgeConfig, state: DaemonState) => void;
  initialUrl?: string;
};

export function ConnectDialog({ open, onClose, onConnected, initialUrl = "" }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(initialUrl || DEFAULT_DAEMON_URL);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Re-read the saved URL each time the dialog opens, so a failed reconnect
      // can be fixed without retyping it.
      setUrl(initialUrl || loadBridge()?.url || DEFAULT_DAEMON_URL);
      setError("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialUrl]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const trimmedUrl = normalizeUrl(url) || DEFAULT_DAEMON_URL;
    try {
      const state = await connectBridge(trimmedUrl, code);
      const config = { url: trimmedUrl, code: normalizeCode(code) };
      saveBridge(config);
      onConnected(config, state);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-labelledby="connect-title"
    >
      <div className={styles.sheet}>
        <div className={styles.head}>
          <div className={styles.mark} aria-hidden="true">
            <span />
          </div>
          <div>
            <p className={styles.kicker}>Private connection</p>
            <h2 id="connect-title">Connect your daemon.</h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className={styles.lede}>
          Point this dashboard at the daemon running on this
          machine. The access code stays in this browser and is sent only to that daemon.
        </p>

        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="daemon-url">Daemon URL</label>
          <input
            id="daemon-url"
            name="url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={DEFAULT_DAEMON_URL}
            autoComplete="url"
            spellCheck={false}
          />

          <label htmlFor="daemon-code">Access code</label>
          <input
            id="daemon-code"
            name="code"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="SG-XXXX-XXXX-XXXX"
            autoComplete="current-password"
            spellCheck={false}
            required
          />

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className={`button buttonPrimary ${styles.submit}`} disabled={busy}>
            {busy ? "Checking the daemon…" : "Connect"}
            {!busy && <ArrowRight width={15} height={15} />}
          </button>
        </form>

        <div className={styles.foot}>
          <p>
            <Lock width={13} height={13} />
            Tokens are entered on the daemon, never here.
          </p>
          <p>
            <Shield width={13} height={13} />
            Use http://127.0.0.1:8765 on this computer, or your server&apos;s https:// address.
          </p>
        </div>

        <div className={styles.help}>
          <p>
            No daemon yet? <Link href="/start">Set it up locally</Link>. Already
            installed? Start it with <code>./sg-local start</code>, then read the code
            with <code>./sg-local web --show-code</code>.
          </p>
        </div>
      </div>
    </dialog>
  );
}
