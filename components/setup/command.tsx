"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "../icons";
import styles from "../setup-guide.module.css";

/** Copies text and reports a short "copied" window plus a counter that replays effects. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCount((c) => c + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return { copied, count, copy };
}

export function CopyButton({
  text,
  copied,
  count,
  onCopy,
  small = false,
}: {
  text: string;
  copied: boolean;
  count: number;
  onCopy: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.copyButton} ${small ? styles.copySmall : ""}`}
      data-copied={copied ? "" : undefined}
      onClick={onCopy}
      aria-label={`Copy command: ${text}`}
    >
      <span className={styles.copyFill} aria-hidden="true" />
      {count > 0 && <span key={count} className={styles.copyRing} aria-hidden="true" />}
      <span className={styles.copySlot}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={copied ? "done" : "idle"}
            className={styles.copyFace}
            initial={{ y: "120%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            exit={{ y: "-120%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 32 }}
          >
            {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
            {!small && (copied ? "Copied" : "Copy")}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="visuallyHidden" role="status">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

type CommandProps = {
  command: string;
  label?: string;
  compact?: boolean;
};

/** A command shown as a small terminal window with a copy button. */
export function Command({ command, label, compact = false }: CommandProps) {
  const { copied, count, copy } = useCopy(command);
  const lines = command.split("\n");

  return (
    <div
      className={`${styles.command} ${compact ? styles.commandCompact : ""}`}
      data-copied={copied ? "" : undefined}
    >
      {count > 0 && <span key={count} className={styles.sweep} aria-hidden="true" />}
      <div className={styles.commandTop}>
        <span className={styles.lights} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {label && <span className={styles.commandLabel}>{label}</span>}
        <CopyButton text={command} copied={copied} count={count} onCopy={copy} />
      </div>
      <pre>
        <code>
          {lines.map((line, i) => (
            <span key={i} className={styles.commandLine}>
              <span className={styles.prompt} aria-hidden="true">
                ${" "}
              </span>
              {line}
              {i < lines.length - 1 ? "\n" : null}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
