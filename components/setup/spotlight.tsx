"use client";

import { useRef } from "react";
import styles from "../setup-guide.module.css";

/**
 * A card lit by a soft light that follows the pointer. The position is written
 * straight to CSS variables, so moving the mouse never re-renders React.
 */
export function Spotlight({
  children,
  className = "",
  as: Tag = "article",
  style,
  reveal = true,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "article" | "div";
  style?: React.CSSProperties;
  reveal?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={`${styles.spot} ${className}`}
      style={style}
      data-reveal={reveal ? "" : undefined}
      onPointerMove={(event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType !== "mouse") return;
        const { clientX, clientY } = event;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const el = ref.current;
          if (!el) return;
          const box = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${clientX - box.left}px`);
          el.style.setProperty("--my", `${clientY - box.top}px`);
        });
      }}
    >
      {children}
    </Tag>
  );
}
