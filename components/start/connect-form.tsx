"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "../icons";
import {
  DEFAULT_DAEMON_URL,
  connectBridge,
  loadBridge,
  normalizeCode,
  normalizeUrl,
  saveBridge,
  type BridgeConfig,
} from "@/lib/bridge";
import styles from "../start-guide.module.css";

const swap = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

export function ConnectForm() {
  const router = useRouter();
  const [url, setUrl] = useState(DEFAULT_DAEMON_URL);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<BridgeConfig | null>(null);

  useEffect(() => {
    const existing = loadBridge();
    if (existing) {
      setSaved(existing);
      setUrl(existing.url);
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await connectBridge(url, code);
      const config = { url: normalizeUrl(url) || DEFAULT_DAEMON_URL, code: normalizeCode(code) };
      saveBridge(config);
      setSaved(config);
      router.push("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to the daemon.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {saved ? (
        <motion.div key="saved" className={styles.savedBox} {...swap}>
          <motion.div
            className={styles.savedIcon}
            aria-hidden="true"
            initial={{ scale: 0.3, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 14, delay: 0.1 }}
          >
            <Check width={17} height={17} strokeWidth={2.4} />
          </motion.div>
          <div>
            <h3>A daemon is already saved here.</h3>
            <p>
              <code>{saved.url}</code> is connected to this browser. Open the dashboard to
              see its live state, or use a different daemon or access code.
            </p>
          </div>
          <div className={styles.savedActions}>
            <Link href="/dashboard" className="button buttonPrimary buttonSmall">
              Open dashboard
              <ArrowRight width={14} height={14} />
            </Link>
            <button
              type="button"
              className="button buttonQuiet buttonSmall"
              onClick={() => setSaved(null)}
            >
              Use a different daemon
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.form key="form" className={styles.connectForm} onSubmit={submit} {...swap}>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="daemon-url">Daemon URL</label>
              <input
                id="daemon-url"
                type="text"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={DEFAULT_DAEMON_URL}
                autoComplete="url"
                spellCheck={false}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="daemon-code">Access code</label>
              <input
                id="daemon-code"
                type="password"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="SG-XXXX-XXXX-XXXX"
                autoComplete="current-password"
                spellCheck={false}
                required
              />
            </div>
          </div>
          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                key="error"
                className={styles.error}
                role="alert"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <div className={styles.submitRow}>
            <button type="submit" className="button buttonPrimary" disabled={busy}>
              {busy && <span className={styles.spinner} aria-hidden="true" />}
              {busy ? "Checking…" : "Connect dashboard"}
              {!busy && <ArrowRight width={15} height={15} />}
            </button>
            <p className={styles.finePrint}>
              The URL and code are stored in this browser. They are never sent to Vercel or
              any third party. Loopback addresses are allowed even though this page is HTTPS.
            </p>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
