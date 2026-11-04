"use client";

import { useRef } from "react";
import styles from "../start-guide.module.css";

/**
 * A dark card with a pointer-following glow. The pointer position is written
 * to CSS variables on the element directly; React never re-renders on move.
 */
export function SpotlightCard({
  children,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "article";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  const ref = useRef<HTMLElement | null>(null);
  const frame = useRef(0);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={`${styles.spot} ${className}`}
      onPointerMove={(event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType !== "mouse") return;
        const { clientX, clientY } = event;
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          const el = ref.current;
          if (!el) return;
          const box = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${clientX - box.left}px`);
          el.style.setProperty("--my", `${clientY - box.top}px`);
        });
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
