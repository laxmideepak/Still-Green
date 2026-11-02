"use client";

import { motion, useReducedMotion, useScroll, useSpring, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import styles from "../setup-guide.module.css";

export type TocItem = { id: string; label: string; index: string; sub?: boolean };

/**
 * Watches the sections and reports the one crossing a thin band near the top of
 * the viewport. State changes only when the section changes, never per scroll event.
 */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-32% 0px -62% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // ids are a static list for the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return active;
}

export function Toc({
  items,
  active,
  target,
}: {
  items: TocItem[];
  active: string;
  target: RefObject<HTMLElement | null>;
}) {
  const calm = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target, offset: ["start 40%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.4 });

  // On narrow screens the list scrolls sideways; keep the active chip in view.
  useEffect(() => {
    const el = list.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    const link = el.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!link) return;
    el.scrollTo({ left: link.offsetLeft - 16, behavior: calm ? "auto" : "smooth" });
  }, [active, calm]);

  const activeIndex = items.findIndex((item) => item.id === active);

  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.tocTitle}>
        <span aria-hidden="true">~/</span>setup
        <span className={styles.tocCount} aria-hidden="true">
          {String(activeIndex + 1).padStart(2, "0")}/{String(items.length).padStart(2, "0")}
        </span>
      </p>
      <div className={styles.tocBody}>
        <ProgressTrack progress={progress} />
        <ol ref={list} className={styles.tocList}>
          {items.map((item) => {
            const on = item.id === active;
            return (
              <li key={item.id} className={item.sub ? styles.tocSub : undefined}>
                <a
                  href={`#${item.id}`}
                  data-id={item.id}
                  className={styles.tocLink}
                  aria-current={on ? "location" : undefined}
                >
                  {on && (
                    <motion.span
                      layoutId="toc-pill"
                      className={styles.tocPill}
                      transition={
                        calm ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }
                      }
                    />
                  )}
                  <span className={styles.tocIndex}>{item.index}</span>
                  <span className={styles.tocLabel}>{item.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

function ProgressTrack({ progress }: { progress: MotionValue<number> }) {
  return (
    <span className={styles.tocTrack} aria-hidden="true">
      <motion.span className={styles.tocFill} style={{ scaleY: progress }} />
    </span>
  );
}
