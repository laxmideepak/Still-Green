"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { Check, Lock } from "../icons";
import styles from "../setup-guide.module.css";

const spring = { type: "spring", stiffness: 190, damping: 20 } as const;

/** Hosted site → your machine → Slack, with packets running along the wires. */
export function WhereDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const calm = useReducedMotion();
  const entered = useInView(ref, { once: true, margin: "-15% 0px" });
  // Packets only run while the diagram is on screen.
  const visible = useInView(ref);
  const show = calm || entered;
  const flowing = !calm && entered && visible;

  return (
    <div ref={ref} className={styles.diagram}>
      <motion.div
        className={`${styles.node} ${styles.nodeSite}`}
        initial={calm ? false : { opacity: 0, y: 30, scale: 0.94 }}
        animate={show ? { opacity: 1, y: 0, scale: 1 } : undefined}
        transition={{ ...spring, delay: 0 }}
      >
        <div className={styles.nodeHead}>
          <span className={styles.nodeHollow} aria-hidden="true" />
          This Vercel site
        </div>
        <ul>
          <li>
            <Check width={13} height={13} /> Interface and documentation
          </li>
          <li>
            <Check width={13} height={13} /> Live controls, once paired with your daemon
          </li>
          <li className={styles.nodeNo}>
            <Lock width={13} height={13} /> No tokens, never talks to Slack
          </li>
        </ul>
      </motion.div>

      <Wire className={styles.wireA} label="commands · from your browser" show={show} flowing={flowing} delay={0.35} />

      <motion.div
        className={`${styles.node} ${styles.nodeMachine}`}
        initial={calm ? false : { opacity: 0, y: 30, scale: 0.94 }}
        animate={show ? { opacity: 1, y: 0, scale: 1 } : undefined}
        transition={{ ...spring, delay: 0.2 }}
      >
        <div className={styles.nodeHead}>
          <span className={styles.nodeDot} aria-hidden="true" />
          Your machine
          <code className={styles.nodeAddr}>127.0.0.1:8765</code>
        </div>
        <ul>
          <li>
            <Check width={13} height={13} /> Tokens in a 0600 config
          </li>
          <li>
            <Check width={13} height={13} /> The long-lived daemon
          </li>
          <li>
            <Check width={13} height={13} /> The Slack WebSocket
          </li>
        </ul>
      </motion.div>

      <Wire className={styles.wireB} label="WebSocket" vertical show={show} flowing={flowing} delay={0.7} />

      <motion.div
        className={styles.slackNode}
        initial={calm ? false : { opacity: 0, y: 20, scale: 0.9 }}
        animate={show ? { opacity: 1, y: 0, scale: 1 } : undefined}
        transition={{ ...spring, delay: 0.5 }}
        aria-hidden="true"
      >
        <span className={styles.slackHash}>#</span>
        <span>
          <strong>Slack</strong>
          <small>wss-primary.slack.com</small>
        </span>
      </motion.div>
    </div>
  );
}

function Wire({
  className,
  label,
  show,
  flowing,
  delay,
  vertical = false,
}: {
  className: string;
  label: string;
  show: boolean;
  flowing: boolean;
  delay: number;
  vertical?: boolean;
}) {
  return (
    <div
      className={`${styles.wire} ${vertical ? styles.wireVertical : ""} ${className}`}
      aria-hidden="true"
    >
      <span className={styles.wireLabel}>{label}</span>
      <span className={styles.wireTrack}>
        <motion.span
          className={styles.wireLine}
          initial={{ scaleX: 0, scaleY: 0 }}
          animate={show ? { scaleX: 1, scaleY: 1 } : undefined}
          transition={{ delay, duration: 0.8, ease: [0.7, 0, 0.2, 1] }}
        />
        {flowing && (
          <>
            <span className={styles.packet} style={{ animationDelay: `${delay + 0.6}s` }} />
            <span className={styles.packet} style={{ animationDelay: `${delay + 1.8}s` }} />
          </>
        )}
      </span>
    </div>
  );
}
