"use client";

import Link from "next/link";
import { AnimatePresence, motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "../icons";
import { Magnetic } from "./magnetic";
import { SplitText } from "./split-text";
import styles from "./hero.module.css";

export type Mode = "scheduled" | "always" | "paused";

const modes: Array<{ id: Mode; label: string; state: string; detail: string }> = [
  { id: "scheduled", label: "Scheduled", state: "Active", detail: "Mon–Fri · 09:00 → 17:00" },
  { id: "always", label: "Always on", state: "Active", detail: "Every day · no end time" },
  { id: "paused", label: "Paused", state: "Away", detail: "Session closed until you resume" },
];

export function Hero() {
  const [mode, setMode] = useState<Mode>("scheduled");
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const copyY = useTransform(scrollYProgress, [0, 1], ["0%", "38%"]);
  const orbScale = useTransform(scrollYProgress, [0, 1], [1, 1.5]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const current = modes.find((item) => item.id === mode)!;

  return (
    <section ref={section} className={styles.hero} data-mode={mode}>
      <PresenceField mode={mode} />
      <div className={styles.vignette} aria-hidden="true" />

      <div className={`container ${styles.layout}`}>
      <motion.div className={styles.inner} style={{ y: copyY, opacity: fade }}>
        <motion.p
          className={styles.eyebrow}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
        >
          <span className={styles.liveDot} aria-hidden="true" />
          Runs on your machine · 127.0.0.1:8765
        </motion.p>

        <h1 className={styles.title}>
          <SplitText text="Your green dot," delay={0.15} />
          <br />
          <span className={styles.titleSoft}>
            <SplitText text="on your" delay={0.55} />
          </span>{" "}
          <span className={styles.titleAcid}>
            <SplitText text="schedule." delay={0.75} />
          </span>
        </h1>

        <div className={styles.lower}>
          <motion.p
            className={styles.lede}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
          >
            Stillgreen keeps your Slack status active during the hours you choose. One
            small program on your own computer holds the connection. No account. No
            server in the middle.
          </motion.p>
          <motion.div
            className={styles.actions}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 1.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <Magnetic>
              <Link href="/start" className={styles.primary} data-cursor="go">
                <span>Set it up</span>
                <ArrowUpRight width={18} height={18} />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/dashboard" className={styles.secondary}>
                Open the dashboard
              </Link>
            </Magnetic>
          </motion.div>
        </div>
      </motion.div>

      <motion.div className={styles.orbWrap} style={{ scale: orbScale, opacity: fade }}>
        <motion.div
          className={styles.orb}
          initial={{ scale: 0.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.ticks} aria-hidden="true" />
          <div className={styles.sweep} aria-hidden="true" />
          <div className={styles.core} aria-hidden="true">
            <span className={styles.ripple} />
            <span className={styles.ripple} />
            <span className={styles.ripple} />
          </div>
          <div className={styles.readout} aria-live="polite">
            <span className={styles.readoutLabel}>Slack shows</span>
            <AnimatePresence mode="wait">
              <motion.strong
                key={current.state}
                initial={{ y: 18, opacity: 0, filter: "blur(8px)" }}
                animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                exit={{ y: -18, opacity: 0, filter: "blur(8px)" }}
                transition={{ duration: 0.35 }}
              >
                {current.state}
              </motion.strong>
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.span
                key={current.detail}
                className={styles.readoutDetail}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {current.detail}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div
          className={styles.switcher}
          role="group"
          aria-label="Try a presence mode"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.7 }}
        >
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
              className={styles.switch}
            >
              {mode === item.id && (
                <motion.span
                  layoutId="hero-mode"
                  className={styles.switchPill}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
              <span className={styles.switchText}>{item.label}</span>
            </button>
          ))}
        </motion.div>
      </motion.div>

      </div>

      <motion.a
        href="#day"
        className={styles.scrollHint}
        style={{ opacity: fade }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
      >
        <span>Scroll to live a day</span>
        <i aria-hidden="true" />
      </motion.a>
    </section>
  );
}

/**
 * A grid of grey dots — the rest of your workspace. Green waves roll out from
 * the presence orb, and dots near the pointer swell and push away.
 */
function PresenceField({ mode }: { mode: Mode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let points: Array<{ x: number; y: number; heat: number; seed: number }> = [];
    const mouse = { x: -9999, y: -9999 };
    let frame = 0;
    let visible = true;
    let waves: Array<{ born: number }> = [];
    let lastWave = 0;
    const gap = 26;

    const origin = () => {
      const narrow = width < 900;
      return { x: narrow ? width * 0.5 : width * 0.74, y: narrow ? height * 0.78 : height * 0.5 };
    };

    const resize = () => {
      const box = el.getBoundingClientRect();
      width = box.width;
      height = box.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = width * dpr;
      el.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      points = [];
      for (let y = gap / 2; y < height; y += gap) {
        for (let x = gap / 2; x < width; x += gap) {
          points.push({ x, y, heat: 0, seed: Math.random() });
        }
      }
    };

    const draw = (time: number) => {
      const m = modeRef.current;
      const o = origin();
      const interval = m === "always" ? 1700 : 2600;
      if (m !== "paused" && time - lastWave > interval) {
        waves.push({ born: time });
        lastWave = time;
      }
      waves = waves.filter((w) => time - w.born < 5200);

      ctx.clearRect(0, 0, width, height);
      for (const p of points) {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const dist = Math.hypot(dx, dy);

        for (const w of waves) {
          const radius = (time - w.born) * 0.42;
          const band = Math.abs(dist - radius);
          if (band < 30) p.heat = Math.max(p.heat, (1 - band / 30) * (m === "always" ? 1 : 0.85));
        }
        // a few dots stay green for longer — teammates who are also online
        p.heat *= p.seed > 0.93 && m !== "paused" ? 0.996 : 0.955;

        const mx = p.x - mouse.x;
        const my = p.y - mouse.y;
        const md = Math.hypot(mx, my);
        const pull = md < 150 ? 1 - md / 150 : 0;
        const ox = pull ? (mx / (md || 1)) * pull * 14 : 0;
        const oy = pull ? (my / (md || 1)) * pull * 14 : 0;

        const heat = Math.min(1, p.heat + pull * 0.9);
        const r = 1.1 + heat * 2.2 + pull * 1.4;
        const fadeEdge = Math.min(1, p.y / (height * 0.15), (height - p.y) / (height * 0.25));
        if (heat > 0.04) {
          ctx.fillStyle = m === "paused"
            ? `rgba(255, 181, 71, ${(0.15 + heat * 0.6) * fadeEdge})`
            : `rgba(57, 255, 156, ${(0.12 + heat * 0.85) * fadeEdge})`;
        } else {
          ctx.fillStyle = `rgba(234, 245, 238, ${0.09 * fadeEdge})`;
        }
        ctx.beginPath();
        ctx.arc(p.x + ox, p.y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (time: number) => {
      if (visible) draw(time);
      frame = requestAnimationFrame(loop);
    };

    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      mouse.x = event.clientX - box.left;
      mouse.y = event.clientY - box.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(el);
    window.addEventListener("resize", resize);
    if (calm) {
      draw(0);
    } else {
      window.addEventListener("pointermove", onMove);
      document.addEventListener("pointerleave", onLeave);
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvas} className={styles.field} aria-hidden="true" />;
}
