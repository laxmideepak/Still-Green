"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "../icons";
import styles from "../start-guide.module.css";

/**
 * A terminal-styled command block. When `typeOnView` is set, the command types
 * itself out the first time the block scrolls into view. The real, selectable
 * text is always in the DOM (and in the accessibility tree) underneath, so the
 * layout never shifts and screen readers get the whole command at once.
 */
export function CommandBlock({
  command,
  label,
  typeOnView = false,
  onTyped,
}: {
  command: string;
  label: string;
  typeOnView?: boolean;
  onTyped?: () => void;
}) {
  const calm = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const shouldType = typeOnView && !calm;
  const [typed, setTyped] = useState(shouldType ? 0 : command.length);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typing = typed < command.length;

  useEffect(() => {
    if (!shouldType) {
      setTyped(command.length);
      return;
    }
    if (!inView) return;
    if (typed >= command.length) {
      onTyped?.();
      return;
    }
    const next = command[typed];
    const wait = next === "\n" ? 320 : 22 + Math.random() * 34;
    const id = window.setTimeout(() => setTyped((t) => t + 1), wait);
    return () => window.clearTimeout(id);
  }, [shouldType, inView, typed, command, onTyped]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setFlash((f) => f + 1);
      setTyped(command.length);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const lines = command.split("\n");
  const typedLines = command.slice(0, typed).split("\n");

  return (
    <div ref={ref} className={styles.term} data-copied={copied || undefined}>
      <div className={styles.termBar}>
        <span className={styles.termDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <em>{label}</em>
        <button
          type="button"
          onClick={copy}
          className={styles.copyButton}
          aria-label={`Copy ${label} commands`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={copied ? "done" : "idle"}
              className={styles.copyInner}
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
            >
              {copied ? (
                <motion.span
                  className={styles.copyCheck}
                  initial={{ scale: 0.2, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 14 }}
                >
                  <Check width={12} height={12} strokeWidth={2.6} />
                </motion.span>
              ) : (
                <Copy width={13} height={13} />
              )}
              {copied ? "Copied" : "Copy"}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>

      <div className={styles.termBody}>
        <pre className={styles.termFull} data-typing={typing || undefined}>
          <code>
            {lines.map((line, i) => (
              <span key={i} className={styles.termLine}>
                {line}
                {i < lines.length - 1 ? "\n" : null}
              </span>
            ))}
          </code>
        </pre>
        {typing && (
          <pre className={styles.termTyped} aria-hidden="true">
            <code>
              {typedLines.map((line, i) => (
                <span key={i} className={styles.termLine}>
                  {line}
                  {i === typedLines.length - 1 ? <i className={styles.caret} /> : "\n"}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>

      {flash > 0 && (
        <motion.span
          key={flash}
          className={styles.termFlash}
          aria-hidden="true"
          initial={{ x: "-100%", opacity: 1 }}
          animate={{ x: "100%", opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.7, 0, 0.2, 1] }}
        />
      )}
    </div>
  );
}
