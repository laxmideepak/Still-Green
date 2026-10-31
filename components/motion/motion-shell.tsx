"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./motion-shell.module.css";

/**
 * A custom cursor and a film-grain layer. Scrolling is left to the browser on
 * purpose: native scrolling runs off the main thread and never stutters.
 * The cursor turns itself off for touch screens and reduced motion.
 */
export function MotionShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Cursor />
      <div className={styles.grain} aria-hidden="true" />
    </>
  );
}

function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || calm) return;
    setEnabled(true);
    document.documentElement.classList.add(styles.hideNativeCursor);

    let x = -100;
    let y = -100;
    let rx = x;
    let ry = y;
    let frame = 0;
    let idle = true;
    let lastTarget: EventTarget | null = null;

    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (idle) {
        idle = false;
        frame = requestAnimationFrame(tick);
      }
      // Only touch the DOM when the hovered element changes.
      if (event.target === lastTarget || !ring.current) return;
      lastTarget = event.target;
      const hot = (event.target as Element | null)?.closest?.("a, button, label, [data-cursor]");
      const label = hot?.getAttribute("data-cursor") ?? "";
      const text = (event.target as Element | null)?.closest?.("input, textarea, select");
      const next = text ? "text" : hot ? "true" : "false";
      if (ring.current.dataset.hot !== next) ring.current.dataset.hot = next;
      if (ring.current.dataset.text !== label) ring.current.dataset.text = label;
    };
    const down = () => ring.current?.setAttribute("data-down", "true");
    const up = () => ring.current?.setAttribute("data-down", "false");
    const leave = () => {
      x = -100;
      y = -100;
    };

    // Runs only while the ring is still catching up with the pointer.
    const tick = () => {
      rx += (x - rx) * 0.22;
      ry += (y - ry) * 0.22;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      if (Math.abs(x - rx) + Math.abs(y - ry) < 0.3) {
        idle = true;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerleave", leave);
      document.documentElement.classList.remove(styles.hideNativeCursor);
    };
  }, []);

  if (!enabled) return null;
  return (
    <>
      <div ref={ring} className={styles.ring} aria-hidden="true">
        <span />
      </div>
      <div ref={dot} className={styles.dot} aria-hidden="true" />
    </>
  );
}
