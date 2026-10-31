"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowRight } from "../icons";
import { Magnetic } from "../motion/magnetic";
import styles from "@/app/not-found.module.css";

const rise = { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const };

/** A big 404 whose zero is an "away" presence dot that leans toward the pointer. */
export function Away404() {
  const calm = useReducedMotion();
  const path = usePathname();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 18, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 120, damping: 18, mass: 0.6 });
  const dotX = useTransform(sx, (v) => v * 26);
  const dotY = useTransform(sy, (v) => v * 26);
  const fourX = useTransform(sx, (v) => v * -10);
  const fourY = useTransform(sy, (v) => v * -10);

  return (
    <div
      className={styles.scene}
      onPointerMove={(event) => {
        if (calm || event.pointerType !== "mouse") return;
        px.set(event.clientX / window.innerWidth - 0.5);
        py.set(event.clientY / window.innerHeight - 0.5);
      }}
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      <div className={styles.grid} aria-hidden="true" />

      <div className={styles.code} aria-hidden="true">
        <motion.span
          className={styles.four}
          style={{ x: fourX, y: fourY }}
          initial={calm ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={rise}
        >
          <motion.span
            style={{ display: "inline-block" }}
            initial={calm ? false : { y: "60%", rotate: -8 }}
            animate={{ y: "0%", rotate: 0 }}
            transition={rise}
          >
            4
          </motion.span>
        </motion.span>

        <motion.span
          className={styles.zero}
          initial={calm ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 14, delay: 0.15 }}
        >
          <span className={styles.ring} />
          <span className={`${styles.pulse} ${styles.pulseA}`} />
          <span className={`${styles.pulse} ${styles.pulseB}`} />
          <motion.span className={styles.dot} style={{ x: dotX, y: dotY }} />
        </motion.span>

        <motion.span
          className={styles.four}
          style={{ x: fourX, y: fourY }}
          initial={calm ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...rise, delay: 0.1 }}
        >
          <motion.span
            style={{ display: "inline-block" }}
            initial={calm ? false : { y: "60%", rotate: 8 }}
            animate={{ y: "0%", rotate: 0 }}
            transition={{ ...rise, delay: 0.1 }}
          >
            4
          </motion.span>
        </motion.span>
      </div>

      <motion.div
        className={styles.copy}
        initial={calm ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...rise, delay: 0.35 }}
      >
        <p className={styles.kicker}>
          <span className={styles.awayDot} aria-hidden="true" />
          404 · Away · nothing here
        </p>
        <h1>This page is off the schedule.</h1>
        <p className={styles.body}>
          The address does not exist, or it moved. The green dot is still on the
          dashboard — the daemon is a separate process on your own host.
        </p>

        <div className={styles.term} aria-hidden="true">
          <p>
            <span className={styles.prompt}>$</span> sg-local open {path || "/"}
          </p>
          <p className={styles.termErr}>✕ route not found · presence: away</p>
          <p>
            <span className={styles.prompt}>$</span> <i className={styles.caret} />
          </p>
        </div>

        <div className={styles.actions}>
          <Magnetic>
            <Link href="/" className={styles.primary}>
              <span>Back home</span>
              <ArrowRight width={16} height={16} />
            </Link>
          </Magnetic>
          <Link href="/dashboard" className={styles.secondary}>
            Dashboard
          </Link>
          <Link href="/start" className={styles.quiet}>
            Local setup
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
