import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ArrowRight } from "@/components/icons";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <div className={`container ${styles.inner}`}>
          <div className={styles.seal} aria-hidden="true">
            <span>404</span>
            <small>off schedule</small>
          </div>
          <div className={styles.copy}>
            <p className={styles.kicker}>Nothing here</p>
            <h1>This page is off the schedule.</h1>
            <p>
              The address does not exist, or it moved. The green dot is still on the
              dashboard — the daemon is a separate process on your own host.
            </p>
            <div className={styles.actions}>
              <Link href="/" className="button buttonPrimary">
                Back home
                <ArrowRight width={15} height={15} />
              </Link>
              <Link href="/dashboard" className="button buttonSecondary">
                Dashboard
              </Link>
              <Link href="/start" className="button buttonQuiet">
                Cloud setup
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
