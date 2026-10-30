"use client";

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { memo, useRef, useState } from "react";
import styles from "./day-scrub.module.css";

const START = 6 * 60; // 06:00
const END = 20 * 60; // 20:00
const ON = 9 * 60;
const OFF = 17 * 60;
const AWAY_FROM = 14 * 60 + 40;
const AWAY_TO = 15 * 60 + 30;

const events = [
  { at: 8 * 60 + 58, time: "08:58", title: "The daemon wakes", body: "Reads your settings and checks today's hours.", tone: "muted" },
  { at: 9 * 60, time: "09:00", title: "The dot turns green", body: "Connects to Slack and keeps the connection open.", tone: "green" },
  { at: 10 * 60 + 15, time: "10:15", title: "Still checking", body: "Asks Slack every 60 seconds. If you show as away, it reconnects.", tone: "green" },
  { at: 12 * 60 + 30, time: "12:30", title: "Lunch, uninterrupted", body: "Your laptop stays quiet. Your dot stays green.", tone: "green" },
  { at: AWAY_FROM, time: "14:40", title: "You set “away” yourself", body: "Stillgreen leaves it alone. A status you choose is never changed.", tone: "amber" },
  { at: 17 * 60, time: "17:00", title: "Off, on time", body: "The connection closes and waits for tomorrow.", tone: "muted" },
];

type Status = "active" | "away" | "off";

const pad = (n: number) => String(n).padStart(2, "0");
// Rounded so the server and browser render identical numbers.
const r2 = (n: number) => Math.round(n * 100) / 100;
const toMinutes = (p: number) => Math.round(START + (END - START) * Math.min(1, Math.max(0, p)));
const statusAt = (m: number): Status =>
  m >= AWAY_FROM && m < AWAY_TO ? "away" : m >= ON && m < OFF ? "active" : "off";
const indexAt = (m: number) => events.reduce((found, e, i) => (m >= e.at ? i : found), -1);

const arc = (from: number, to: number, r: number) => {
  const a0 = (from / 1440) * Math.PI * 2 - Math.PI / 2;
  const a1 = (to / 1440) * Math.PI * 2 - Math.PI / 2;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${r2(200 + r * Math.cos(a0))} ${r2(200 + r * Math.sin(a0))} A ${r} ${r} 0 ${large} 1 ${r2(200 + r * Math.cos(a1))} ${r2(200 + r * Math.sin(a1))}`;
};

/**
 * Scrolling moves a clock through a working day. To stay smooth, scroll only
 * writes the minutes, the dial hand and the done arc straight to the DOM;
 * React re-renders just when the hour, the status or the current event change.
 */
export function DayScrub() {
  const ref = useRef<HTMLElement>(null);
  const minutesRef = useRef<HTMLSpanElement>(null);
  const handRef = useRef<SVGGElement>(null);
  const doneRef = useRef<SVGPathElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [hour, setHour] = useState(Math.floor(START / 60));
  const [status, setStatus] = useState<Status>("off");
  const [currentIndex, setCurrentIndex] = useState(-1);
  const lastMinute = useRef(START);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const m = toMinutes(p);
    if (m === lastMinute.current) return;
    lastMinute.current = m;
    if (minutesRef.current) minutesRef.current.textContent = pad(m % 60);
    handRef.current?.setAttribute("transform", `rotate(${r2((m / 1440) * 360)} 200 200)`);
    if (doneRef.current) {
      doneRef.current.setAttribute("d", m > ON ? arc(ON, Math.min(m, OFF), 170) : "");
    }
    setHour(Math.floor(m / 60));
    setStatus(statusAt(m));
    setCurrentIndex(indexAt(m));
  });


  const statusText = status === "away" ? "Away · set by you" : status === "active" ? "Active" : "Away";

  return (
    <section ref={ref} id="day" className={styles.section} aria-label="A day with Stillgreen">
      <div className={styles.sticky}>
        {skies.map((sky) => (
          <SkyLayer key={sky.color} sky={sky} progress={scrollYProgress} />
        ))}
        <div className={`container ${styles.grid}`}>
          <div className={styles.left}>
            <p className={styles.kicker}>A day, handled</p>
            <div className={styles.clock} aria-hidden="true">
              <Hour value={pad(hour)} />
              <span className={styles.colon}>:</span>
              <span ref={minutesRef} className={styles.minutes}>
                {pad(START % 60)}
              </span>
            </div>
            <div className={styles.status} data-status={status}>
              <span className={styles.statusDot} />
              <span>Slack shows</span>
              <AnimatePresence mode="wait">
                <motion.strong
                  key={statusText}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {statusText}
                </motion.strong>
              </AnimatePresence>
            </div>

            <svg className={styles.dial} viewBox="0 0 400 400" aria-hidden="true">
              <DialFace />
              <path ref={doneRef} d="" className={styles.dialDone} />
              <g ref={handRef} transform={`rotate(${r2((START / 1440) * 360)} 200 200)`}>
                <line x1="200" y1="200" x2="200" y2="40" className={styles.dialHand} />
                <circle cx="200" cy="30" r="9" className={styles.dialHead} data-status={status} />
              </g>
              <circle cx="200" cy="200" r="5" className={styles.dialPin} />
            </svg>
          </div>

          <ol className={styles.events}>
            {events.map((event, i) => (
              <li
                key={event.time}
                className={styles.event}
                data-reached={i <= currentIndex}
                data-current={i === currentIndex}
                data-tone={event.tone}
              >
                <time>{event.time}</time>
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <motion.span style={{ scaleX: scrollYProgress }} />
        </div>
      </div>
    </section>
  );
}

// Dawn, morning, midday, dusk, night. Each layer fades in around its point
// of the scroll; fading is cheap, repainting a gradient every frame is not.
const skies = [
  { at: 0, color: "#1a1235" },
  { at: 0.2, color: "#0f3b2a" },
  { at: 0.5, color: "#0d4a31" },
  { at: 0.8, color: "#3a2410" },
  { at: 1, color: "#0d0a1a" },
];

function SkyLayer({ sky, progress }: { sky: (typeof skies)[number]; progress: MotionValue<number> }) {
  // Fade points must stay inside 0..1 and keep increasing.
  const points = [sky.at - 0.3, sky.at, sky.at + 0.3];
  const values = [0, 1, 0];
  const keep = points.map((p, i) => i).filter((i) => points[i] >= 0 && points[i] <= 1);
  const opacity = useTransform(
    progress,
    keep.map((i) => points[i]),
    keep.map((i) => values[i]),
  );
  return (
    <motion.div
      className={styles.sky}
      style={{ opacity, "--sky": sky.color } as never}
      aria-hidden="true"
    />
  );
}

/** The parts of the dial that never change, drawn once. */
const DialFace = memo(function DialFace() {
  return (
    <>
      <circle cx="200" cy="200" r="170" className={styles.dialTrack} />
      <path d={arc(ON, OFF, 170)} className={styles.dialWindow} />
      {Array.from({ length: 24 }, (_, h) => {
        const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
        const r1 = h % 6 === 0 ? 146 : 154;
        return (
          <line
            key={h}
            x1={r2(200 + r1 * Math.cos(a))}
            y1={r2(200 + r1 * Math.sin(a))}
            x2={r2(200 + 160 * Math.cos(a))}
            y2={r2(200 + 160 * Math.sin(a))}
            className={styles.dialTick}
          />
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
        return (
          <text key={h} x={r2(200 + 124 * Math.cos(a))} y={r2(200 + 124 * Math.sin(a) + 4)} className={styles.dialLabel}>
            {pad(h)}
          </text>
        );
      })}
    </>
  );
});

/** Two digits that roll like a flip counter when the hour changes. */
function Hour({ value }: { value: string }) {
  return (
    <span className={styles.digits}>
      {value.split("").map((d, i) => (
        <span key={i} className={styles.digitSlot}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={d}
              initial={{ y: "-70%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={{ y: "70%", opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ display: "inline-block" }}
            >
              {d}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
