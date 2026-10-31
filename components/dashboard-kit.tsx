"use client";

// Building blocks shared by the preview and live dashboards: the presence orb,
// spotlight cards, a segmented control with a sliding pill, a rolling value and
// the activity log. Everything animates with transform and opacity only.

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./dashboard-shared.module.css";

export const EASE = [0.16, 1, 0.3, 1] as const;

export type OrbTone = "green" | "amber" | "muted";

/** Props that fade an element in when it scrolls into view (see RevealObserver). */
export function reveal(delay = 0) {
  return {
    "data-reveal": "",
    style: { "--reveal-delay": `${delay}ms` } as CSSProperties,
  };
}

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "aside" | "div";
  delay?: number;
};

/**
 * A dark card whose border and fill light up under the pointer. The pointer
 * position is written to CSS variables through a ref (at most once a frame),
 * so hovering never re-renders React.
 */
export function Card({ as: Tag = "section", className = "", delay = 0, style, children, ...rest }: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || frame.current) return;
    const { clientX, clientY } = event;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${clientX - box.left}px`);
      el.style.setProperty("--my", `${clientY - box.top}px`);
    });
  }

  return (
    <Tag
      ref={ref as React.Ref<HTMLElement & HTMLDivElement>}
      className={`${styles.card} ${className}`}
      data-reveal=""
      style={{ "--reveal-delay": `${delay}ms`, ...style } as CSSProperties}
      onPointerMove={onPointerMove}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Label({ children, tone }: { children: ReactNode; tone?: OrbTone }) {
  return (
    <span className={styles.label} data-tone={tone}>
      {tone && <i aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A value that rolls up when it changes. */
export function Ticker({ value, className = "" }: { value: ReactNode; className?: string }) {
  const key = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  return (
    <span className={`${styles.ticker} ${className}`}>
      <AnimatePresence initial={false}>
        <motion.span
          key={key}
          initial={{ y: "80%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-80%", opacity: 0 }}
          transition={{ duration: 0.38, ease: EASE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  tone?: OrbTone;
  className?: string;
};

/** A row of toggle buttons with a pill that slides to the pressed one. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  tone = "green",
  className = "",
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div className={`${styles.seg} ${className}`} role="group" aria-label={label} data-tone={tone}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={styles.segButton}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {value === option.id && (
              <motion.span
                layoutId="pill"
                className={styles.segPill}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className={styles.segText}>{option.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

type OrbProps = {
  tone: OrbTone;
  /** 0–1: how far through today's window. Null hides the arc. */
  progress?: number | null;
  /** Faster ripples, for "always on". */
  fast?: boolean;
  children?: ReactNode;
};

/**
 * The presence orb: a rotating tick ring, a radar sweep, a progress arc and a
 * glowing core that breathes and sends out ripples while the dot is green.
 * Its loops pause while it is off screen.
 */
export function PresenceOrb({ tone, progress = null, fast = false, children }: OrbProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      el.dataset.offscreen = entry.isIntersecting ? "false" : "true";
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const arc = progress === null ? null : Math.max(0, Math.min(1, progress));

  return (
    <motion.div
      ref={ref}
      className={styles.orb}
      data-tone={tone}
      data-fast={fast}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 1.2, delay: 0.2, ease: EASE }}
      aria-hidden="true"
    >
      <div className={styles.orbTicks} />
      <div className={styles.orbSweep} />
      {arc !== null && (
        <>
          <svg className={styles.orbArc} viewBox="0 0 100 100">
            <circle className={styles.orbTrack} cx="50" cy="50" r="47" pathLength={100} />
            <AnimatePresence initial={false}>
              <motion.circle
                key={`${arc}-${tone}`}
                className={styles.orbFill}
                cx="50"
                cy="50"
                r="47"
                pathLength={100}
                strokeDasharray={`${arc * 100} 100`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              />
            </AnimatePresence>
          </svg>
          <motion.div
            className={styles.orbMarker}
            initial={false}
            animate={{ rotate: arc * 360 }}
            transition={{ type: "spring", stiffness: 60, damping: 14 }}
          >
            <i />
          </motion.div>
        </>
      )}
      <motion.div
        key={tone}
        className={styles.orbCoreWrap}
        initial={{ scale: 0.82 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 14 }}
      >
        <span className={styles.orbRipple} />
        <span className={styles.orbRipple} />
        <span className={styles.orbRipple} />
        <div className={styles.orbCore} />
        {children && <div className={styles.orbFace}>{children}</div>}
      </motion.div>
    </motion.div>
  );
}

export type LogItem = {
  key: string;
  time: string;
  text: ReactNode;
  tone: string;
};

/** Activity entries; new ones slide in from the left. */
export function LogList({ entries }: { entries: LogItem[] }) {
  return (
    <ol className={styles.log}>
      <AnimatePresence initial={false}>
        {entries.map((entry) => (
          <motion.li
            key={entry.key}
            layout="position"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <time>{entry.time}</time>
            <i data-tone={entry.tone} aria-hidden="true" />
            <span>{entry.text}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** Splits a daily window into bar segments (percent of 24h); overnight windows wrap. */
export function windowSegments(startMin: number, endMin: number): Array<[number, number]> {
  const day = 1440;
  if (startMin === endMin) return [];
  if (endMin > startMin) return [[(startMin / day) * 100, ((endMin - startMin) / day) * 100]];
  const parts: Array<[number, number]> = [];
  if (endMin > 0) parts.push([0, (endMin / day) * 100]);
  parts.push([(startMin / day) * 100, ((day - startMin) / day) * 100]);
  return parts;
}
