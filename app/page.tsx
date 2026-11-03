import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Bento } from "@/components/home/bento";
import { Closing } from "@/components/home/closing";
import { DayScrub } from "@/components/home/day-scrub";
import { Hero } from "@/components/home/hero";
import { LocalFlow } from "@/components/home/local-flow";
import { Specs } from "@/components/home/specs";
import { VelocityMarquee } from "@/components/home/velocity-marquee";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main id="main">
        <Hero />
        <div className={styles.marquees}>
          <VelocityMarquee
            items={["Ping every 30 s", "Checks every minute", "Your away stays away", "No server"]}
            baseVelocity={-2.2}
          />
          <VelocityMarquee
            items={["Runs on your computer", "No account", "Any timezone", "Pause any time"]}
            baseVelocity={2.2}
            outline
          />
        </div>
        <DayScrub />
        <Bento />
        <LocalFlow />
        <Specs />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
