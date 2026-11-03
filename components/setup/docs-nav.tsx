"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../ui";
import styles from "./docs.module.css";

export type DocsNavItem = {
  id: string;
  label: string;
  /** Step number shown in a small circle. */
  number?: string;
  /** A small icon in place of the number. */
  icon?: ReactNode;
  /** Indented sub-item, no number. */
  sub?: boolean;
};

/** Distance from the top of the window at which a section counts as "current". */
const OFFSET = 120;

/**
 * The left "On this page" list. On wide screens it sticks beside the content
 * and marks the section being read; on phones it is a plain list at the top.
 */
export function DocsNav({ items, label = "On this page" }: { items: DocsNavItem[]; label?: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) current = item.id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atEnd && items.length) current = items[items.length - 1].id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  const numbered = items.some((item) => item.number || item.icon);

  return (
    <nav className={styles.nav} aria-label={label}>
      <p className={styles.navTitle}>{label}</p>
      <ol className={cx(styles.navList, !numbered && styles.navPlain)}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cx(styles.navLink, item.sub && styles.navSub)}
              aria-current={active === item.id ? "location" : undefined}
            >
              {(item.number || item.icon) && (
                <span className={styles.navNumber} aria-hidden="true">
                  {item.icon ?? item.number}
                </span>
              )}
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
