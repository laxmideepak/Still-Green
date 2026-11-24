import Link from "next/link";
import { Brand } from "./brand";
import { GITHUB_URL, ISSUES_URL, README_URL } from "@/lib/site";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div className={styles.identity}>
          <Brand />
          <p>Helps keep your Slack status active on your schedule. Free, and it runs on your own computer.</p>
        </div>
        <nav className={styles.column} aria-label="Product">
          <p className={styles.heading}>Product</p>
          <ul>
            <li><Link href="/dashboard">Dashboard</Link></li>
            <li><Link href="/setup">Setup guide</Link></li>
            <li><Link href="/start">Commands</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
          </ul>
        </nav>
        <nav className={styles.column} aria-label="Project">
          <p className={styles.heading}>Project</p>
          <ul>
            <li><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a></li>
            <li><a href={README_URL} target="_blank" rel="noreferrer">Documentation</a></li>
            <li><a href={ISSUES_URL} target="_blank" rel="noreferrer">Report a problem</a></li>
          </ul>
        </nav>
      </div>
      <div className="container">
        <div className={styles.bottom}>
          <p>Not made by or connected to Slack, and Slack does not officially support it. Only use it on workspaces where you are allowed to.</p>
          <p>Your Slack login stays on your own computer or server. It never goes to this website.</p>
        </div>
      </div>
    </footer>
  );
}
