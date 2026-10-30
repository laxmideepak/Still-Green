"use client";

import { useState, type CSSProperties } from "react";
import { Lock } from "./icons";
import styles from "./hero-presence.module.css";

type PreviewMode = "scheduled" | "always" | "paused";

const modes: Array<{ id: PreviewMode; label: string }> = [
  { id: "scheduled", label: "Scheduled" },
  { id: "always", label: "Always on" },
  { id: "paused", label: "Paused" },
];

const copy: Record<
  PreviewMode,
  { state: string; detail: string; time: string; progress: string }
> = {
  scheduled: {
    state: "Scheduled",
    detail: "Online today",
    time: "09:00 — 17:00",
    progress: "58%",
  },
  always: {
    state: "Always on",
    detail: "No end time",
    time: "Every day",
    progress: "100%",
  },
  paused: {
    state: "Paused",
    detail: "Until you resume",
    time: "No active session",
    progress: "0%",
  },
};

const week = ["M", "T", "W", "T", "F", "S", "S"];

export function HeroPresence() {
  const [mode, setMode] = useState<PreviewMode>("scheduled");
  const current = copy[mode];

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div className={styles.workspace}>
          <span className={styles.workspaceMark} aria-hidden="true">
            F
          </span>
          <span>
            <strong>Fieldwork</strong>
            <small>Product workspace</small>
          </span>
        </div>
        <span className={styles.sample}>
          <span className={styles.sampleDot} aria-hidden="true" />
          Sample day
        </span>
      </div>

      <div className={styles.sealWrap}>
        <div
          className={styles.seal}
          data-mode={mode}
          style={{ "--progress": current.progress } as CSSProperties}
        >
          <div className={styles.ticks} aria-hidden="true" />
          <div className={styles.sealFace}>
            <span className={styles.sealLabel}>Presence</span>
            <strong>{current.state}</strong>
            <span className={styles.sealDetail}>{current.detail}</span>
            <span className={styles.sealTime}>{current.time}</span>
          </div>
        </div>
      </div>

      <div className={styles.week} aria-hidden="true">
        {week.map((day, index) => {
          const weekend = index > 4;
          const active = mode === "always" || (mode === "scheduled" && !weekend);
          return (
            <span
              key={`${day}-${index}`}
              className={`${styles.day} ${active ? styles.dayActive : ""}`}
            >
              {day}
              <i />
            </span>
          );
        })}
      </div>

      <div className={styles.switcher} role="group" aria-label="Preview presence mode">
        {modes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.switchButton}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className={styles.note}>
        <Lock width={13} height={13} />
        Sample data. The live controls talk to your daemon.
      </p>
    </div>
  );
}
