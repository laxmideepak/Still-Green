import Link from "next/link";
import type { ReactNode } from "react";
import { CopyPromptButton } from "@/components/copy-prompt";
import { ProductPreview } from "@/components/home/product-preview";
import { ArrowRight, Calendar, ChevronDown, ChevronRight, Clock, Github, Lock, Moon, Pause, Shield } from "@/components/icons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui";
import { GITHUB_URL, ISSUES_URL, MAC_WAITLIST_URL } from "@/lib/site";
import styles from "./page.module.css";

const steps: { title: string; body: string }[] = [
  {
    title: "Install it",
    body: "One Homebrew command on a Mac, or let an AI assistant do it for you.",
  },
  {
    title: "Add your Slack",
    body: "Sign in to Slack in Chrome and click Capture in the extension. Your login goes to your own computer.",
  },
  {
    title: "Pick your hours",
    body: "Choose the days and times you want to show as active. Stillgreen does the rest.",
  },
];

const features: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <Calendar />, title: "Your hours", body: "Weekdays 9 to 5, late nights, any schedule." },
  { icon: <Clock />, title: "Keep me online", body: "For an hour or two, or until a time tonight." },
  { icon: <Pause />, title: "Pause anytime", body: "Everything, or one workspace at a time." },
  { icon: <Moon />, title: "Respects your away", body: "If you set yourself away, it stays that way." },
];

const privacy: { icon: ReactNode; title: string }[] = [
  { icon: <Lock />, title: "Saved only on your computer" },
  { icon: <Shield />, title: "Locked with your own access code" },
  { icon: <Github />, title: "Open source, no account, no tracking" },
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "Is it really free?",
    a: "Yes. No account and no paid plan. It runs on your own computer.",
  },
  {
    q: "Does my laptop need to stay on?",
    a: (
      <>
        Yes, Stillgreen stops when your computer sleeps. If you need it always on, you can{" "}
        <Link href="/setup#cloud">run it on a small cloud server</Link> instead.
      </>
    ),
  },
  {
    q: "Will I always show as active?",
    a: "Not always. Slack decides your final status, and this isn't an official Slack feature, so it may stop working if Slack changes.",
  },
  {
    q: "Can this website see my Slack login?",
    a: "No. The dashboard runs in your browser and talks straight to Stillgreen on your computer. Your login only ever goes to Slack.",
  },
  {
    q: "Is it OK to use at work?",
    a: "It depends on where you work. Keeping your status active automatically may be against your employer's rules or Slack's terms. Check first.",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroGrid}`}>
            <div>
              <a href={MAC_WAITLIST_URL} className={styles.announce} target="_blank" rel="noreferrer">
                <span className={styles.announcePill}>Soon</span>
                <span>A Mac app. Join the waitlist</span>
                <ChevronRight />
              </a>
              <h1 className={styles.h1} id="hero-title">
                Help keep Slack <span className={styles.green}>green</span>,
                <br /> on your schedule.
              </h1>
              <p className={styles.lead}>
                Show as active in Slack during the hours you choose. Free, and it runs on your own computer, so your
                Slack login stays with you.
              </p>
              <div className={styles.ctas}>
                <Button href="/setup" variant="primary" size="lg" iconRight={<ArrowRight />}>
                  Set it up
                </Button>
                <CopyPromptButton />
              </div>
              <p className={styles.note}>
                Slack decides your final status. This isn&apos;t an official Slack feature, and your workplace may
                not allow it.
              </p>
            </div>
            <div className={styles.heroVisual}>
              <ProductPreview />
            </div>
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <h2 className={styles.h2} id="how-title">
              Three steps. About five minutes.
            </h2>
            <ol className={styles.steps}>
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 className={styles.h3}>{step.title}</h3>
                  <p className={styles.body}>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="features-title">
          <div className="container">
            <h2 className={styles.h2} id="features-title">
              Simple controls for real days.
            </h2>
            <ul className={styles.features}>
              {features.map((feature) => (
                <li key={feature.title}>
                  <span className={styles.icon} aria-hidden="true">
                    {feature.icon}
                  </span>
                  <h3 className={styles.h3}>{feature.title}</h3>
                  <p className={styles.body}>{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="privacy-title">
          <div className={`container ${styles.narrow}`}>
            <h2 className={styles.h2} id="privacy-title">
              Your Slack login never leaves your computer.
            </h2>
            <p className={styles.lead}>
              There is no Stillgreen server in the middle. Your browser talks to Stillgreen on your computer, and only
              Stillgreen talks to Slack. <Link href="/privacy">Read the privacy policy</Link>.
            </p>
            <ul className={styles.points}>
              {privacy.map((point) => (
                <li key={point.title}>
                  {point.icon}
                  {point.title}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="faq-title">
          <div className={`container ${styles.faqGrid}`}>
            <div>
              <h2 className={styles.h2} id="faq-title">
                Questions
              </h2>
              <p className={styles.lead}>
                Something else?{" "}
                <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                  Ask on GitHub
                </a>
                .
              </p>
            </div>
            <div className={styles.faq}>
              {faqs.map((item) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary>
                    {item.q}
                    <ChevronDown />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.final} aria-labelledby="final-title">
          <div className={`container ${styles.narrow}`}>
            <h2 className={styles.h2} id="final-title">
              Set it up once. Let it run all week.
            </h2>
            <div className={`${styles.ctas} ${styles.ctasCenter}`}>
              <Button href="/setup" variant="primary" size="lg" iconRight={<ArrowRight />}>
                Set it up
              </Button>
              <CopyPromptButton />
            </div>
            <p className={styles.note}>
              Rather have a Mac app?{" "}
              <a href={MAC_WAITLIST_URL} target="_blank" rel="noreferrer">
                Join the waitlist
              </a>
              . Prefer the code? <a href={GITHUB_URL}>It&apos;s on GitHub</a>.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
