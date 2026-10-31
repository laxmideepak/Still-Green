"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ArrowUpRight } from "../icons";
import { Magnetic } from "../motion/magnetic";
import styles from "./closing.module.css";

export function Closing() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  // The green copy is revealed by sliding a clipping box one way and its
  // contents the other way: transforms only, so nothing is repainted.
  const clipX = useTransform(scrollYProgress, [0.1, 0.75], ["-100%", "0%"]);
  const textX = useTransform(scrollYProgress, [0.1, 0.75], ["100%", "0%"]);
  const scale = useTransform(scrollYProgress, [0, 0.8], [0.82, 1]);
  const dot = useTransform(scrollYProgress, [0.55, 0.85], [0, 1]);

  return (
    <section ref={ref} className={styles.section}>
      <div className="container">
        <motion.h2 className={styles.giant} style={{ scale }}>
          <span className={styles.words}>
            <span className={styles.base}>Stay green</span>
            <motion.span className={styles.clip} style={{ x: clipX }} aria-hidden="true">
              <motion.span className={styles.lit} style={{ x: textX }}>
                Stay green
              </motion.span>
            </motion.span>
          </span>
          <motion.span className={styles.dot} style={{ scale: dot }} aria-hidden="true" />
        </motion.h2>
        <div className={styles.row}>
          <p>Set it up once. Close the laptop lid. Let the small program handle the dot.</p>
          <div className={styles.actions}>
            <Magnetic>
              <Link href="/start" className={styles.primary} data-cursor="go">
                Set it up
                <ArrowUpRight width={18} height={18} />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/dashboard" className={styles.secondary}>
                Open the dashboard
              </Link>
            </Magnetic>
          </div>
        </div>
      </div>
    </section>
  );
}
