"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "../icons";
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
 * and marks the section being read. On phones it folds into one button that
 * names the current section, so the guide starts on the first screen.
 */
export function DocsNav({ items, label = "On this page" }: { items: DocsNavItem[]; label?: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

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
  const current = items.find((item) => item.id === active)?.label;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && open) {
      setOpen(false);
      toggleRef.current?.focus();
    }
  };

  return (
    <nav className={cx(styles.nav, open && styles.navOpen)} aria-label={label} onKeyDown={onKeyDown}>
      <p className={styles.navTitle}>{label}</p>
      {/* Phones only (see docs.module.css). */}
      <button
        ref={toggleRef}
        type="button"
        className={styles.navToggle}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.navToggleLabel}>{label}</span>
        {current && <span className={styles.navToggleCurrent}>{current}</span>}
        <ChevronDown className={styles.navToggleIcon} aria-hidden="true" />
      </button>
      <ol id={listId} className={cx(styles.navList, !numbered && styles.navPlain)}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cx(styles.navLink, item.sub && styles.navSub)}
              aria-current={active === item.id ? "location" : undefined}
              onClick={() => setOpen(false)}
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
