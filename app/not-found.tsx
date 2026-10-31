import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Away404 } from "@/components/setup/away-404";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <div className={`container ${styles.inner}`}>
          <Away404 />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
