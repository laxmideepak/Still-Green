"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import styles from "../setup-guide.module.css";

type Line = { kind: "cmd" | "out" | "ok"; text: string };

const script: Line[] = [
  { kind: "cmd", text: "git clone https://github.com/laxmideepak/slack.git" },
  { kind: "out", text: "Cloning into 'slack'… done." },
  { kind: "cmd", text: "cd slack && ./install.sh" },
  { kind: "ok", text: "✓ sg-local is on your path" },
  { kind: "cmd", text: "sg-local add" },
  { kind: "out", text: "xoxc token: ••••••••••••  (hidden)" },
  { kind: "out", text: "xoxd cookie: ••••••••••••  (hidden)" },
  { kind: "ok", text: "✓ verified with Slack · config written 0600" },
  { kind: "cmd", text: "sg-local schedule set --days mon-fri --start 09:00 --end 17:00" },
  { kind: "ok", text: "✓ schedule: weekdays 09:00–17:00" },
  { kind: "cmd", text: "sg-local start" },
  { kind: "out", text: "daemon running · control page 127.0.0.1:8765" },
  { kind: "ok", text: "● presence: active" },
];

/** A terminal that types the whole setup, then turns its status dot green. */
export function BootTerminal() {
  const calm = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);
  const done = calm || line >= script.length;

  useEffect(() => {
    if (calm || !inView || line >= script.length) return;
    const current = script[line];
    if (current.kind === "cmd" && chars < current.text.length) {
      // Long commands type faster so the whole run stays short.
      const pace = current.text.length > 30 ? 12 : 40;
      const id = window.setTimeout(() => setChars((c) => c + 1), pace + Math.random() * pace);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(
      () => {
        setLine((l) => l + 1);
        setChars(0);
      },
      current.kind === "cmd" ? 380 : 200,
    );
    return () => window.clearTimeout(id);
  }, [calm, inView, line, chars]);

  const shown = done ? script : script.slice(0, line + 1);

  return (
    <div
      ref={ref}
      className={styles.boot}
      data-done={done ? "" : undefined}
      role="img"
      aria-label="Example terminal session: clone, install, add a workspace, set a schedule and start the daemon until presence is active."
    >
      <div className={styles.bootBar}>
        <span className={styles.lights} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <em>~/slack — sg-local</em>
        <span className={styles.bootState}>
          <i />
          {done ? "active" : "away"}
        </span>
      </div>
      <div className={styles.bootBody}>
        <div className={styles.bootScroll}>
          {shown.map((entry, i) => {
            const typing = !done && i === line;
            if (typing && entry.kind !== "cmd") return null;
            const text = typing ? entry.text.slice(0, chars) : entry.text;
            return (
              <p key={i} data-kind={entry.kind}>
                {entry.kind === "cmd" && <span className={styles.prompt}>$ </span>}
                {text}
                {typing && <i className={styles.caret} />}
              </p>
            );
          })}
          {done && (
            <p data-kind="cmd">
              <span className={styles.prompt}>$ </span>
              <i className={styles.caret} />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
