"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

/**
 * Splits text into letters that rise out of a mask one after another.
 * Screen readers get the plain text once.
 */
export function SplitText({
  text,
  delay = 0,
  stagger = 0.028,
  className,
  inView = false,
}: {
  text: string;
  delay?: number;
  stagger?: number;
  className?: string;
  inView?: boolean;
}) {
  const calm = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  // Watch the whole line: single letters start clipped and never count as visible.
  const seen = useInView(ref, { once: true, margin: "-10% 0px" });
  const play = inView ? seen : true;
  const words = text.split(" ");
  let index = 0;

  return (
    <span ref={ref} className={className} aria-label={text} role="text">
      {words.map((word, w) => (
        <span
          key={`${word}-${w}`}
          aria-hidden="true"
          style={{ display: "inline-block", whiteSpace: "nowrap", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em", verticalAlign: "top" }}
        >
          {Array.from(word).map((char, c) => {
            const i = index++;
            const anim = {
              initial: calm ? false : { y: "110%", rotate: 8 },
              transition: {
                delay: delay + i * stagger,
                duration: 0.9,
                ease: [0.16, 1, 0.3, 1] as const,
              },
            };
            const target = { y: "0%", rotate: 0 };
            return (
              <motion.span
                key={c}
                style={{ display: "inline-block", transformOrigin: "0% 100%" }}
                {...anim}
                animate={play ? target : undefined}
              >
                {char}
              </motion.span>
            );
          })}
          {w < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}
