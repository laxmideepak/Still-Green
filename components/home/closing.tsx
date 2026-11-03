import Link from "next/link";
import { ArrowUpRight } from "../icons";
import { Magnetic } from "../motion/magnetic";
import styles from "./closing.module.css";

/**
 * "Stay green." fills with green as the section scrolls into view. The fill,
 * the scale-up and the dot are scroll-driven CSS animations (see the module
 * CSS), so they track the scroll exactly instead of trailing it.
 */
export function Closing() {
  return (
    <section className={styles.section}>
      <div className="container">
        <h2 className={styles.giant}>
          <span className={styles.words}>
            <span className={styles.base}>Stay green</span>
            <span className={styles.clip} aria-hidden="true">
              <span className={styles.lit}>Stay green</span>
            </span>
          </span>
          <span className={styles.dot} aria-hidden="true" />
        </h2>
        <div className={styles.row}>
          <p>Set it up once. Close the laptop lid. Let the small program handle the dot.</p>
          <div className={styles.actions}>
            <Magnetic>
              <Link href="/start" className={styles.primary}>
                Set it up
                <ArrowUpRight width={18} height={18} />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/dashboard" className={styles.secondary}>
                Open the dashboard
              </Link>
            </Magnetic>
          </div>
        </div>
      </div>
    </section>
  );
}
