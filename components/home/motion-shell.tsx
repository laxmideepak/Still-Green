"use client";

import Lenis from "lenis";
import { useEffect, useRef, useState } from "react";
import styles from "./motion-shell.module.css";

/**
 * Smooth scrolling, a custom cursor and a film-grain layer for the home page.
 * Everything here turns itself off for touch screens and reduced motion.
 */
export function MotionShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

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

    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      const target = event.target as Element | null;
      const hot = target?.closest("a, button, [data-cursor]");
      const label = hot?.getAttribute("data-cursor") ?? "";
      ring.current?.setAttribute("data-hot", hot ? "true" : "false");
      ring.current?.setAttribute("data-label", label);
      if (ring.current) ring.current.dataset.text = label;
    };
    const down = () => ring.current?.setAttribute("data-down", "true");
    const up = () => ring.current?.setAttribute("data-down", "false");
    const leave = () => {
      x = -100;
      y = -100;
    };

    const tick = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

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
