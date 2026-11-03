"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Brand } from "./brand";
import { ArrowRight, Github, Menu, X } from "./icons";
import { GITHUB_URL } from "@/lib/site";
import { Button, IconButton } from "./ui";
import styles from "./site-header.module.css";

// One name per page, used the same way in the footer and on the 404 page:
// /setup is the "Setup guide" (nav: "Setup"), /start is the "Quick start".
const nav = [
  { href: "/#how", label: "How it works", match: null },
  { href: "/setup", label: "Setup", match: "/setup" },
  { href: "/start", label: "Quick start", match: "/start" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isCurrent = (match: string | null) => (match && pathname?.startsWith(match) ? "page" : undefined);

  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Brand />
        <nav className={styles.nav} aria-label="Main">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink} aria-current={isCurrent(item.match)}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <IconButton href={GITHUB_URL} label="Stillgreen on GitHub" className={styles.github}>
            <Github />
          </IconButton>
          <Button href="/dashboard" variant="primary" size="sm" iconRight={<ArrowRight />} className={styles.cta}>
            Open dashboard
          </Button>
          <IconButton
            label={open ? "Close menu" : "Open menu"}
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </IconButton>
        </div>
      </div>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <nav className={`container ${styles.panelNav}`} aria-label="Main (mobile)">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.panelLink}
              aria-current={isCurrent(item.match)}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          <a href={GITHUB_URL} className={styles.panelLink} target="_blank" rel="noreferrer">
            <Github />
            GitHub
          </a>
          <Button href="/dashboard" variant="primary" size="lg" block iconRight={<ArrowRight />} className={styles.panelCta}>
            Open dashboard
          </Button>
        </nav>
      </div>
    </header>
  );
}
