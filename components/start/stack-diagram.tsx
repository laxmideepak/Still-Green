"use client";

import { motion, useReducedMotion } from "motion/react";
import styles from "../start-guide.module.css";

const layers = [
  { label: "Vercel", title: "This dashboard", sub: "static UI · no tokens", hot: false },
  { label: "Your machine", title: "Presence daemon", sub: "WebSocket · schedule · tokens", hot: true },
  { label: "Slack", title: "Green dot", sub: "one session per workspace", hot: false },
];

const wires = ["loopback · access code", "wss-primary.slack.com"];

const ease = [0.16, 1, 0.3, 1] as const;

/** Vercel → your machine → Slack, drawn in on load with packets riding the wires. */
export function StackDiagram() {
  const calm = useReducedMotion();
  const from = (y: number, scale = 0.94) => (calm ? false : { opacity: 0, y, scale });

  return (
    <div className={styles.stack} aria-hidden="true">
      {layers.map((layer, i) => (
        <div key={layer.label} className={styles.stackRow}>
          <motion.div
            className={`${styles.stackCard} ${layer.hot ? styles.stackHot : ""}`}
            initial={from(28)}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.32, type: "spring", stiffness: 170, damping: 20 }}
          >
            {layer.hot && <span className={styles.stackBeam} />}
            <span className={styles.stackFace}>
              <span className={styles.stackLabel}>
                {layer.hot && <span className={styles.liveDot} />}
                {layer.label}
              </span>
              <strong>{layer.title}</strong>
              <em>{layer.sub}</em>
            </span>
          </motion.div>
          {i < wires.length && (
            <div className={styles.stackWire}>
              <motion.span
                className={styles.stackWireLine}
                initial={calm ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: 0.75 + i * 0.32, duration: 0.7, ease: [0.7, 0, 0.2, 1] }}
              />
              <span className={styles.packet} style={{ animationDelay: `${1.4 + i * 0.5}s` }} />
              <span className={styles.packet} style={{ animationDelay: `${2.6 + i * 0.5}s` }} />
              <motion.span
                className={styles.stackWireLabel}
                initial={calm ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.1 + i * 0.32, duration: 0.6, ease }}
              >
                {wires[i]}
              </motion.span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
