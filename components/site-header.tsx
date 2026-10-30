import Link from "next/link";
import { Brand } from "./brand";
import { ArrowUpRight, Github } from "./icons";
import styles from "./site-header.module.css";

const nav = [
  { href: "/#how", label: "How it works" },
  { href: "/start", label: "Setup" },
  { href: "/setup", label: "CLI" },
];

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Brand />
        <nav className={styles.nav} aria-label="Primary navigation">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </Link>
          ))}
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
