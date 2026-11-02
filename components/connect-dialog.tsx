"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Lock, Signal } from "./icons";
import { Banner, Button, Dialog, Field, Input } from "./ui";
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
  /** Why it opened: "code" clears the saved code and focuses that field. */
  reason?: "code" | "url";
};

export function ConnectDialog({ open, onClose, onConnected, initialUrl = "", reason }: Props) {
  const formId = useId();
  const [url, setUrl] = useState(initialUrl || DEFAULT_DAEMON_URL);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Fill in what this browser already knows each time the dialog opens, so a
  // failed reconnect can be fixed without retyping everything.
  useEffect(() => {
    if (!open) return;
    const saved = loadBridge();
    setUrl(initialUrl || saved?.url || DEFAULT_DAEMON_URL);
    setCode(reason === "code" ? "" : saved?.code || "");
    setCodeError("");
    setError("");
    setBusy(false);
  }, [open, initialUrl, reason]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCodeError("");
    const cleanUrl = normalizeUrl(url) || DEFAULT_DAEMON_URL;
    const cleanCode = normalizeCode(code);
    setUrl(cleanUrl);
    setCode(cleanCode);
    if (!cleanCode) {
      setCodeError("Enter the access code from your Stillgreen control page.");
      return;
    }
    setBusy(true);
    try {
      const state = await connectBridge(cleanUrl, cleanCode);
      const config = { url: cleanUrl, code: cleanCode };
      saveBridge(config);
      onConnected(config, state);
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not connect.";
      if (/access code was not accepted/i.test(message)) {
        setCodeError("That access code was not accepted. Copy it again from your control page.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Signal />}
      title="Connect your Stillgreen"
      description="This page talks straight to Stillgreen on your computer or your own server. The address and code are saved in this browser only."
      closeOnBackdrop={!busy}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {busy ? "Connecting" : "Connect"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className={styles.form}>
        <Field
          label="Stillgreen address"
          hint={
            <>
              On this computer it&apos;s <span className="mono">{DEFAULT_DAEMON_URL}</span>. On a cloud server, use its
              https:// address.
            </>
          }
        >
          <Input
            mono
            name="url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => url.trim() && setUrl(normalizeUrl(url))}
            placeholder={DEFAULT_DAEMON_URL}
            autoComplete="url"
            spellCheck={false}
            data-autofocus={reason === "code" ? undefined : true}
          />
        </Field>
        <Field
          label="Access code"
          error={codeError || undefined}
          hint={
            <>
              Shown on your control page. Or run <span className="mono">./sg-local web --show-code</span>.
            </>
          }
        >
          <Input
            mono
            name="code"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onBlur={() => setCode(normalizeCode(code))}
            placeholder="SG-XXXX-XXXX-XXXX"
            autoComplete="current-password"
            spellCheck={false}
            data-autofocus={reason === "code" ? true : undefined}
          />
        </Field>
        {error && (
          <Banner tone="danger" title="Couldn't connect">
            {error}
          </Banner>
        )}
        <p className={styles.note}>
          <Lock aria-hidden="true" />
          <span>
            Your Slack login stays on your Stillgreen. This website never sees it. Not set up yet?{" "}
            <Link href="/setup" className={styles.link}>
              Read the setup guide
            </Link>
            .
          </span>
        </p>
      </form>
    </Dialog>
  );
}
