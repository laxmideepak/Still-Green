"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";
import { ArrowUpRight, Github } from "./icons";
import styles from "./site-header.module.css";

const nav = [
  { href: "/#how", label: "How it works", match: "/#" },
  { href: "/start", label: "Setup", match: "/start" },
  { href: "/setup", label: "CLI", match: "/setup" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    // Only flips state when the direction changes, not on every scroll event.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last.current;
        if (Math.abs(delta) > 6) {
          setHidden(delta > 0 && y > 160);
          last.current = y;
        }
        setScrolled(y > 8);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      className={styles.header}
      data-hidden={hidden}
      data-scrolled={scrolled}
      onFocusCapture={() => setHidden(false)}
    >
      <div className={`container ${styles.inner}`}>
        <Brand />
        <nav className={styles.nav} aria-label="Primary navigation">
          {nav.map((item) => {
            const active = item.match !== "/#" && pathname?.startsWith(item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navLink}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.actions}>
          <a
            href="https://github.com/laxmideepak/slack"
            className={styles.source}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
          >
            <Github width={17} height={17} />
          </a>
          <Link href="/dashboard" className={`button buttonPrimary buttonSmall ${styles.cta}`}>
            Open dashboard
            <ArrowUpRight width={15} height={15} />
          </Link>
        </div>
      </div>
    </header>
  );
}
