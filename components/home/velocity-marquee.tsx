"use client";

import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import { useRef } from "react";
import styles from "./velocity-marquee.module.css";

const wrap = (min: number, max: number, v: number) => {
  const range = max - min;
  return ((((v - min) % range) + range) % range) + min;
};

/** A strip of text that drifts on its own and speeds up and leans with scroll speed. */
export function VelocityMarquee({
  items,
  baseVelocity = -2,
  outline = false,
}: {
  items: string[];
  baseVelocity?: number;
  outline?: boolean;
}) {
  const calm = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const visible = useInView(strip);
  const base = useMotionValue(0);
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const smooth = useSpring(velocity, { damping: 50, stiffness: 400 });
  const factor = useTransform(smooth, [0, 1000], [0, 5], { clamp: false });
  const skew = useTransform(smooth, [-2500, 2500], [12, -12]);
  const x = useTransform(base, (v) => `${wrap(-25, 0, v)}%`);
  const direction = useRef(1);

  useAnimationFrame((_, delta) => {
    if (calm || !visible) return;
    let move = direction.current * baseVelocity * (delta / 1000);
    const f = factor.get();
    if (f < 0) direction.current = -1;
    else if (f > 0) direction.current = 1;
    move += direction.current * move * f;
    base.set(base.get() + move);
  });

  const row = (
    <>
      {items.map((item, i) => (
        <span key={i} className={styles.item}>
          {item}
          <i className={styles.star} aria-hidden="true">
            ✳
          </i>
        </span>
      ))}
    </>
  );

  return (
    <div ref={strip} className={`${styles.strip} ${outline ? styles.outline : ""}`} aria-hidden="true">
      <motion.div className={styles.track} style={{ x, skewX: calm ? 0 : skew }}>
        {row}
        {row}
        {row}
        {row}
      </motion.div>
    </div>
  );
}
