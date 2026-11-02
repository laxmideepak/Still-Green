import Link from "next/link";
import { Brand } from "./brand";
import { ArrowUpRight } from "./icons";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div className={styles.identity}>
          <Brand />
          <p>Presence on your schedule, running on your own machine.</p>
        </div>
        <div className={styles.column}>
          <p className={styles.heading}>Product</p>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/start">Local setup</Link>
          <Link href="/setup">CLI setup</Link>
        </div>
        <div className={styles.column}>
          <p className={styles.heading}>Project</p>
          <a href="https://github.com/laxmideepak/slack" target="_blank" rel="noreferrer">
            Source code
            <ArrowUpRight width={13} height={13} />
          </a>
          <a href="https://github.com/laxmideepak/slack#readme" target="_blank" rel="noreferrer">
            Documentation
            <ArrowUpRight width={13} height={13} />
          </a>
          <a href="https://github.com/laxmideepak/slack/issues" target="_blank" rel="noreferrer">
            Issues
            <ArrowUpRight width={13} height={13} />
          </a>
        </div>
      </div>
      <div className={`container ${styles.wordmarkWrap}`} aria-hidden="true">
        <p className={styles.wordmark} data-reveal>
          stillgreen<span>.</span>
        </p>
      </div>
      <div className={`container ${styles.bottom}`}>
        <p>Not affiliated with Slack. Use only on workspaces you have permission to automate.</p>
        <p>Built to run on your own machine.</p>
      </div>
    </footer>
  );
}
