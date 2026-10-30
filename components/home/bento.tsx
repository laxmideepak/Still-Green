"use client";

import { AnimatePresence, motion, useInView, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Lock } from "../icons";
import { SplitText } from "./split-text";
import styles from "./bento.module.css";

const week = [
  { day: "Mon", from: 9, to: 17 },
  { day: "Tue", from: 9, to: 17 },
  { day: "Wed", from: 8, to: 16 },
  { day: "Thu", from: 9, to: 17 },
  { day: "Fri", from: 9, to: 15 },
  { day: "Sat", from: 0, to: 0 },
  { day: "Sun", from: 22, to: 24 },
];

const logLines = [
  { t: "09:00:00", text: "session started · Fieldwork", tone: "green" },
  { t: "09:00:01", text: "presence check → active", tone: "green" },
  { t: "09:00:30", text: "ping", tone: "muted" },
  { t: "09:05:00", text: "activity tickle sent", tone: "muted" },
  { t: "11:42:13", text: "slack says away → reconnecting", tone: "amber" },
  { t: "11:42:15", text: "presence check → active", tone: "green" },
  { t: "14:40:02", text: "manual away found · leaving it alone", tone: "amber" },
  { t: "17:00:00", text: "outside schedule · session stopped", tone: "muted" },
];

export function Bento() {
  return (
    <section id="control" className={styles.section}>
      <div className="container">
        <h2 className={styles.title}>
          <SplitText text="Control without" inView />
          <br />
          <span className={styles.dim}>
            <SplitText text="the ceremony." inView delay={0.2} />
          </span>
        </h2>

        <div className={styles.grid}>
          <Card className={styles.schedule}>
            <Label>Schedule</Label>
            <h3>A week that knows your timezone.</h3>
            <p>Weekdays, custom days, even windows that cross midnight.</p>
            <WeekBars />
          </Card>

          <Card className={styles.pause}>
            <PauseToggle />
          </Card>

          <Card className={styles.log}>
            <Label>Activity</Label>
            <h3>A log you can read.</h3>
            <LiveLog />
          </Card>

          <Card className={styles.manual}>
            <Label>Respect</Label>
            <h3>Your “away” stays away.</h3>
            <p>If you set yourself away in Slack, Stillgreen never changes it back.</p>
            <div className={styles.awayChip}>
              <span className={styles.awayDot} />
              Away · set by you
              <Lock width={13} height={13} />
            </div>
          </Card>

          <Card className={styles.workspaces}>
            <Label>Workspaces</Label>
            <h3>All of them, at once.</h3>
            <p>
              Add every Slack workspace you belong to. Each one gets its own connection,
              its own schedule and its own log.
            </p>
            <Orbit />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}

/** A card with a light that follows the pointer and a slight 3D tilt. */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 160, damping: 18 });
  const sry = useSpring(ry, { stiffness: 160, damping: 18 });

  return (
    <motion.article
      ref={ref}
      className={`${styles.card} ${className}`}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 1100 }}
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !ref.current) return;
        const box = ref.current.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width;
        const py = (event.clientY - box.top) / box.height;
        ref.current.style.setProperty("--mx", `${px * 100}%`);
        ref.current.style.setProperty("--my", `${py * 100}%`);
        rx.set((0.5 - py) * 6);
        ry.set((px - 0.5) * 6);
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      {children}
    </motion.article>
  );
}

function WeekBars() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  return (
    <div ref={ref} className={styles.week}>
      {week.map((d, i) => (
        <div key={d.day} className={styles.weekRow}>
          <span>{d.day}</span>
          <div className={styles.weekTrack}>
            {d.to > d.from && (
              <motion.i
                style={{ left: `${(d.from / 24) * 100}%`, width: `${((d.to - d.from) / 24) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={inView ? { scaleX: 1 } : {}}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
          </div>
        </div>
      ))}
      <div className={styles.now} aria-hidden="true" />
      <div className={styles.axis}>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

function PauseToggle() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={styles.pauseInner} data-paused={paused}>
      <Label>Pause</Label>
      <h3>Pause means pause.</h3>
      <p>It closes the connection. It doesn&apos;t fight Slack.</p>
      <button
        type="button"
        className={styles.toggle}
        role="switch"
        aria-checked={!paused}
        aria-label="Keep my status green"
        onClick={() => setPaused((p) => !p)}
        data-cursor={paused ? "on" : "off"}
      >
        <motion.span
          className={styles.knob}
          layout
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
        />
      </button>
      <div className={styles.pauseState}>
        <AnimatePresence mode="wait">
          <motion.span
            key={String(paused)}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {paused ? "Paused · connection closed" : "Live · connected to Slack"}
          </motion.span>
        </AnimatePresence>
      </div>
      <code>sg-local pause --for 2h</code>
    </div>
  );
}

function LiveLog() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const id = window.setInterval(() => setCount((c) => c + 1), 1100);
    return () => window.clearInterval(id);
  }, [inView]);

  const shown = Array.from({ length: Math.min(count + 1, 5) }, (_, i) => {
    const n = count - Math.min(count, 4) + i;
    return { ...logLines[n % logLines.length], key: n };
  });

  return (
    <div ref={ref} className={styles.logBody}>
      <AnimatePresence initial={false}>
        {shown.map((line) => (
          <motion.div
            key={line.key}
            layout
            className={styles.logLine}
            data-tone={line.tone}
            initial={{ opacity: 0, x: -20, filter: "blur(6px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <time>{line.t}</time>
            <i />
            <span>{line.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      <div className={styles.logCursor}>
        <span>›</span>
        <i />
      </div>
    </div>
  );
}

function Orbit() {
  return (
    <div className={styles.orbit} aria-hidden="true">
      <span className={styles.orbitCenter}>
        <span />
      </span>
      {[
        { l: "F", r: 1, d: 14 },
        { l: "A", r: 2, d: 22 },
        { l: "N", r: 3, d: 30 },
      ].map((o) => (
        <span
          key={o.l}
          className={styles.ring}
          style={{ "--r": o.r, "--d": `${o.d}s` } as React.CSSProperties}
        >
          <b>{o.l}</b>
        </span>
      ))}
    </div>
  );
}
