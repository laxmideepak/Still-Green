"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import styles from "./specs.module.css";

const specs = [
  { term: "Transport", value: "WebSocket to wss-primary.slack.com" },
  { term: "Keepalive", value: "Ping every 30 s, activity tickle every 5 min" },
  { term: "Presence", value: "users.getPresence every 60 s; reconnect when away" },
  { term: "Schedule", value: "Weekly windows, any timezone, overnight support" },
  { term: "Storage", value: "config.json on your computer, mode 0600" },
];

const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>";

/** Letters shuffle through random characters before settling on the word. */
function Scramble({ text, active }: { text: string; active: boolean }) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      const settled = Math.floor(frame / 2);
      setShown(
        text
          .split("")
          .map((ch, i) => (i < settled ? ch : glyphs[Math.floor(Math.random() * glyphs.length)]))
          .join(""),
      );
      if (settled >= text.length) window.clearInterval(id);
    }, 28);
    return () => {
      window.clearInterval(id);
      setShown(text);
    };
  }, [active, text]);

  return <>{shown}</>;
}

export function Specs() {
  const [hover, setHover] = useState(-1);
  return (
    <section className={styles.section}>
      <div className={`container ${styles.grid}`}>
        <div className={styles.head}>
          <h2>The unglamorous parts.</h2>
          <p>
            No magic. The same long-lived connection the Slack web app uses, with a
            little care around it.
          </p>
        </div>
        <dl className={styles.list}>
          {specs.map((spec, i) => (
            <motion.div
              key={spec.term}
              className={styles.row}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(-1)}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10% 0px" }}
              transition={{ delay: i * 0.07, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <dt>
                <span className={styles.index}>0{i + 1}</span>
                <Scramble text={spec.term} active={hover === i} />
              </dt>
              <dd>{spec.value}</dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </section>
  );
}
