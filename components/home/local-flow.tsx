"use client";

import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lock } from "../icons";
import styles from "./local-flow.module.css";

const script = [
  { kind: "cmd", text: "./sg-local start" },
  { kind: "out", text: "daemon running · pid 4128" },
  { kind: "out", text: "control page: http://127.0.0.1:8765" },
  { kind: "ok", text: "✓ extension: 1 workspace added" },
  { kind: "out", text: "schedule: weekdays 09:00–17:00" },
  { kind: "ok", text: "✓ presence: active" },
];

export function LocalFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });

  return (
    <section className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.kicker}>
          <Lock width={14} height={14} />
          Local by design
        </p>
        <h2 className={styles.title}>
          Your login never touches{" "}
          <span className={styles.strike}>
            our server
            <motion.i
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-20% 0px" }}
              transition={{ delay: 0.5, duration: 0.7, ease: [0.7, 0, 0.2, 1] }}
            />
          </span>
          <motion.span
            className={styles.reveal}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20% 0px" }}
            transition={{ delay: 1.1, duration: 0.6 }}
          >
            {" "}
            — there isn&apos;t one.
          </motion.span>
        </h2>

        <div ref={ref} className={styles.flow}>
          <Node label="Your browser" sub="Chrome extension" icon="◐" delay={0} show={inView} />
          <Wire show={inView} delay={0.3} />
          <Node label="Your computer" sub="sg-local · 0600 file" icon="●" delay={0.2} show={inView} hot />
          <Wire show={inView} delay={0.6} />
          <Node label="Slack" sub="WebSocket" icon="#" delay={0.4} show={inView} />
        </div>

        <div className={styles.bottom}>
          <ul className={styles.points}>
            {[
              "Your login goes from your browser to your computer. Nowhere else.",
              "The only outside traffic is to Slack.",
              "One program. Stop it any time.",
            ].map((point, i) => (
              <motion.li
                key={point}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 * i, duration: 0.6 }}
              >
                <span>0{i + 1}</span>
                {point}
              </motion.li>
            ))}
            <li className={styles.linkRow}>
              <Link href="/setup#security" className={styles.link}>
                Read the security notes
                <ArrowRight width={14} height={14} />
              </Link>
            </li>
          </ul>
          <Terminal />
        </div>
      </div>
    </section>
  );
}

function Node({
  label,
  sub,
  icon,
  delay,
  show,
  hot = false,
}: {
  label: string;
  sub: string;
  icon: string;
  delay: number;
  show: boolean;
  hot?: boolean;
}) {
  return (
    <motion.div
      className={`${styles.node} ${hot ? styles.nodeHot : ""}`}
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={show ? { opacity: 1, scale: 1, y: 0 } : {}}
      transition={{ delay, type: "spring", stiffness: 200, damping: 18 }}
    >
      <span className={styles.nodeIcon}>{icon}</span>
      <strong>{label}</strong>
      <small>{sub}</small>
    </motion.div>
  );
}

function Wire({ show, delay }: { show: boolean; delay: number }) {
  return (
    <div className={styles.wire} aria-hidden="true">
      <motion.span
        className={styles.wireLine}
        initial={{ scaleX: 0 }}
        animate={show ? { scaleX: 1 } : {}}
        transition={{ delay, duration: 0.8, ease: [0.7, 0, 0.2, 1] }}
      />
      {show && (
        <>
          <span className={styles.packet} style={{ animationDelay: `${delay + 0.8}s` }} />
          <span className={styles.packet} style={{ animationDelay: `${delay + 1.6}s` }} />
          <span className={styles.packet} style={{ animationDelay: `${delay + 2.4}s` }} />
        </>
      )}
    </div>
  );
}

function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);

  useEffect(() => {
    if (!inView || line >= script.length) return;
    const current = script[line];
    if (current.kind === "cmd" && chars < current.text.length) {
      const id = window.setTimeout(() => setChars((c) => c + 1), 55 + Math.random() * 60);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setLine((l) => l + 1);
      setChars(0);
    }, current.kind === "cmd" ? 420 : 260);
    return () => window.clearTimeout(id);
  }, [inView, line, chars]);

  return (
    <div ref={ref} className={styles.terminal} aria-label="Example terminal session" role="img">
      <div className={styles.terminalBar}>
        <span />
        <span />
        <span />
        <em>stillgreen — local</em>
      </div>
      <div className={styles.terminalBody}>
        {script.slice(0, line + 1).map((entry, i) => {
          if (i === line && line < script.length && entry.kind !== "cmd") return null;
          const text = i === line && entry.kind === "cmd" ? entry.text.slice(0, chars) : entry.text;
          return (
            <p key={i} data-kind={entry.kind}>
              {entry.kind === "cmd" && <span className={styles.prompt}>$ </span>}
              {text}
              {i === line && entry.kind === "cmd" && <i className={styles.caret} />}
            </p>
          );
        })}
        {line >= script.length && (
          <p>
            <span className={styles.prompt}>$ </span>
            <i className={styles.caret} />
          </p>
        )}
      </div>
    </div>
  );
}
