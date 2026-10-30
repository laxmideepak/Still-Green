"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import styles from "./day-scrub.module.css";

const START = 6 * 60; // 06:00
const END = 20 * 60; // 20:00
const ON = 9 * 60;
const OFF = 17 * 60;

const events = [
  { at: 8 * 60 + 58, time: "08:58", title: "The daemon wakes", body: "Reads your settings and checks today's hours.", tone: "muted" },
  { at: 9 * 60, time: "09:00", title: "The dot turns green", body: "Connects to Slack and keeps the connection open.", tone: "green" },
  { at: 10 * 60 + 15, time: "10:15", title: "Still checking", body: "Asks Slack every 60 seconds. If you show as away, it reconnects.", tone: "green" },
  { at: 12 * 60 + 30, time: "12:30", title: "Lunch, uninterrupted", body: "Your laptop stays quiet. Your dot stays green.", tone: "green" },
  { at: 14 * 60 + 40, time: "14:40", title: "You set “away” yourself", body: "Stillgreen leaves it alone. A status you choose is never changed.", tone: "amber" },
  { at: 17 * 60, time: "17:00", title: "Off, on time", body: "The connection closes and waits for tomorrow.", tone: "muted" },
];

const pad = (n: number) => String(n).padStart(2, "0");
// Rounded so the server and browser render identical numbers.
const r2 = (n: number) => Math.round(n * 100) / 100;

export function DayScrub() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [minutes, setMinutes] = useState(START);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setMinutes(Math.round(START + (END - START) * Math.min(1, Math.max(0, p))));
  });

  const sky = useTransform(
    scrollYProgress,
    [0, 0.2, 0.5, 0.8, 1],
    [
      "radial-gradient(120% 80% at 50% 120%, #1a1235 0%, transparent 60%)",
      "radial-gradient(120% 80% at 50% 110%, #0f3b2a 0%, transparent 60%)",
      "radial-gradient(120% 80% at 50% 100%, #0d4a31 0%, transparent 65%)",
      "radial-gradient(120% 80% at 50% 110%, #3a2410 0%, transparent 60%)",
      "radial-gradient(120% 80% at 50% 120%, #0d0a1a 0%, transparent 60%)",
    ],
  );

  const online = minutes >= ON && minutes < OFF;
  const manualAway = minutes >= 14 * 60 + 40 && minutes < 15 * 60 + 30;
  const status = manualAway ? "away" : online ? "active" : "off";
  const statusText = manualAway ? "Away · set by you" : online ? "Active" : "Away";

  const arc = (from: number, to: number, r: number) => {
    const a0 = (from / 1440) * Math.PI * 2 - Math.PI / 2;
    const a1 = (to / 1440) * Math.PI * 2 - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${r2(200 + r * Math.cos(a0))} ${r2(200 + r * Math.sin(a0))} A ${r} ${r} 0 ${large} 1 ${r2(200 + r * Math.cos(a1))} ${r2(200 + r * Math.sin(a1))}`;
  };
  const currentIndex = events.reduce((found, e, i) => (minutes >= e.at ? i : found), -1);
  const coveredEnd = Math.min(Math.max(minutes, ON), OFF);

  return (
    <section ref={ref} id="day" className={styles.section} aria-label="A day with Stillgreen">
      <div className={styles.sticky}>
        <motion.div className={styles.sky} style={{ background: sky }} aria-hidden="true" />
        <div className={`container ${styles.grid}`}>
          <div className={styles.left}>
            <p className={styles.kicker}>A day, handled</p>
            <div className={styles.clock} aria-hidden="true">
              <Digits value={pad(Math.floor(minutes / 60))} />
              <span className={styles.colon}>:</span>
              <Digits value={pad(minutes % 60)} />
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
              <circle cx="200" cy="200" r="170" className={styles.dialTrack} />
              <path d={arc(ON, OFF, 170)} className={styles.dialWindow} />
              {minutes > ON && <path d={arc(ON, coveredEnd, 170)} className={styles.dialDone} />}
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
              <g transform={`rotate(${r2((minutes / 1440) * 360)} 200 200)`}>
                <line x1="200" y1="200" x2="200" y2="40" className={styles.dialHand} />
                <circle cx="200" cy="30" r="9" className={styles.dialHead} data-status={status} />
              </g>
              <circle cx="200" cy="200" r="5" className={styles.dialPin} />
            </svg>
          </div>

          <ol className={styles.events}>
            {events.map((event, i) => {
              const reached = minutes >= event.at;
              const current = i === currentIndex;
              return (
                <li
                  key={event.time}
                  className={styles.event}
                  data-reached={reached}
                  data-current={current}
                  data-tone={event.tone}
                >
                  <time>{event.time}</time>
                  <div>
                    <h3>{event.title}</h3>
                    <p>{event.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <motion.span style={{ scaleX: scrollYProgress }} />
        </div>
      </div>
    </section>
  );
}

/** Two digits that roll like a flip counter when they change. */
function Digits({ value }: { value: string }) {
  return (
    <span className={styles.digits}>
      {value.split("").map((d, i) => (
        <span key={i} className={styles.digitSlot}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={d}
              initial={{ y: "-60%", opacity: 0, filter: "blur(4px)" }}
              animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
              exit={{ y: "60%", opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
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
