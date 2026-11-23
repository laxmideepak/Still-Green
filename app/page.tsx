import Link from "next/link";
import type { ReactNode } from "react";
import { CopyPromptButton } from "@/components/copy-prompt";
import { ProductPreview } from "@/components/home/product-preview";
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  AlertTriangle,
  Github,
  Grid,
  Info,
  Laptop,
  Lock,
  Moon,
  Pause,
  Puzzle,
  Shield,
  X,
} from "@/components/icons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge, Button } from "@/components/ui";
import { CLOUD_GUIDE_URL, GITHUB_URL, ISSUES_URL } from "@/lib/site";
import styles from "./page.module.css";

const features: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Clock />,
    title: "Keep me online",
    body: "Working late? Keep helping for 30 min, 1 h, 2 h, 3 h, or until a time today. It ends on its own.",
  },
  {
    icon: <Calendar />,
    title: "Weekly schedule",
    body: "Pick your days and hours once, like weekdays from 9 AM to 5 PM. Late-night hours work too.",
  },
  {
    icon: <Pause />,
    title: "Pause anytime",
    body: "Pause for 1 hour or until you resume. Do it for one workspace or for all of them.",
  },
  {
    icon: <Moon />,
    title: "Respects your away",
    body: "If you set yourself away in Slack, Stillgreen leaves it alone. It never switches you back.",
  },
  {
    icon: <Grid />,
    title: "Many workspaces",
    body: "Add every workspace you use. Each one shows its own status and can be paused on its own.",
  },
  {
    icon: <Lock />,
    title: "Private: your login stays with you",
    body: "Your Slack login is saved on your own computer and sent only to Slack. Never to this website. No analytics, no tracking.",
  },
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "Is Stillgreen really free?",
    a: "Yes. There is no account and no paid plan. Running it on your own computer costs nothing. The optional always-on setup uses a small Google Cloud server. It is free within Google's limits, but Google needs a card on file.",
  },
  {
    q: "Does my computer need to stay on?",
    a: (
      <>
        On your own computer, yes. Stillgreen stops when the computer sleeps or shuts down. To keep it running with
        your laptop closed, you can <a href="#cloud">run it on a small cloud server</a> instead.
      </>
    ),
  },
  {
    q: "Does Slack support this? Will I always show as active?",
    a: "No, and no. Slack has no official way to keep someone active, so Stillgreen signs in as you and keeps Slack open, the same way Slack in your browser does. Slack decides your final status. It may stop working if Slack changes, and Slack does not officially support it.",
  },
  {
    q: "What if I set myself away in Slack?",
    a: "Stillgreen leaves it alone. It never changes an away status you set yourself. Set yourself active in Slack when you are back.",
  },
  {
    q: "Can this website see my Slack login?",
    a: "No. The dashboard page runs in your browser and talks straight to your own Stillgreen. Your login is only ever sent to Slack.",
  },
  {
    q: "Is it OK to use at work?",
    a: "It depends on where you work. Keeping your status active automatically may be against your employer's rules or Slack's terms. Check first, and use it only where you are allowed to.",
  },
];

function SectionHead({
  eyebrow,
  title,
  lead,
  id,
  align = "start",
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
  align?: "start" | "center";
}) {
  return (
    <div className={`${styles.sectionHead} ${align === "center" ? styles.center : ""}`}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 className={styles.h2} id={id}>
        {title}
      </h2>
      {lead && <p className={styles.lead}>{lead}</p>}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        {/* Hero */}
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <Link href="#how" className={styles.announce}>
                <span className={styles.announcePill}>Free</span>
                <span className={styles.announceText}>Runs on your own computer, no account</span>
                <ChevronRight />
              </Link>
              <h1 className={styles.h1} id="hero-title">
                Help keep Slack <span className={styles.green}>green</span>,
                <br /> on your schedule.
              </h1>
              <p className={styles.heroLead}>
                Stillgreen helps you show as active in Slack during the hours you choose: your work day, a late
                night, or just until 6 PM. It runs on your own computer, so your Slack login stays with you.
              </p>
              <div className={styles.ctas}>
                <Button href="/setup" variant="primary" size="lg" iconRight={<ArrowRight />}>
                  Set it up
                </Button>
                <CopyPromptButton />
              </div>
              <ul className={styles.meta}>
                <li>
                  <Check />
                  Free, no account
                </li>
                <li>
                  <Check />
                  Works with many workspaces
                </li>
                <li>
                  <Check />
                  Your login stays with you
                </li>
              </ul>
              <p className={styles.honest}>
                <Info aria-hidden="true" />
                <span>
                  Slack decides your final status. This isn&apos;t an official Slack feature, so it may stop working
                  if Slack changes, and your workplace may not allow it.
                </span>
              </p>
            </div>
            <div className={styles.heroVisual}>
              <ProductPreview />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className="container">
            <SectionHead
              id="how-title"
              eyebrow="How it works"
              title="Three steps. About five minutes."
              lead="Download it, add your Slack with one click, and pick your hours. The setup guide walks you through each step."
            />
            <ol className={styles.steps}>
              <li className={styles.step}>
                <div className={styles.stepHead}>
                  <span className={styles.stepNumber}>1</span>
                  <span className={styles.stepIcon}>
                    <Laptop />
                  </span>
                </div>
                <h3 className={styles.h3}>Run it on your computer</h3>
                <p className={styles.body}>
                  Download Stillgreen and start it. It sets itself up the first time and opens its own page, where you
                  can see that it&apos;s running. An AI assistant can do this step for you.
                </p>
                <div className={styles.stepVisual} aria-hidden="true">
                  <div className={styles.miniPopup}>
                    <div className={styles.miniRow}>
                      <span>Stillgreen</span>
                      <span className={styles.miniOn}>Running</span>
                    </div>
                    <span className={styles.miniButton}>
                      <Laptop />
                      On this computer
                    </span>
                  </div>
                </div>
              </li>
              <li className={styles.step}>
                <div className={styles.stepHead}>
                  <span className={styles.stepNumber}>2</span>
                  <span className={styles.stepIcon}>
                    <Puzzle />
                  </span>
                </div>
                <h3 className={styles.h3}>Add Slack with the extension</h3>
                <p className={styles.body}>
                  Open Slack in Chrome and click <strong>Capture from Slack</strong>. The extension hands your login to
                  your own Stillgreen, not to us.
                </p>
                <div className={styles.stepVisual} aria-hidden="true">
                  <div className={styles.miniPopup}>
                    <div className={styles.miniRow}>
                      <span>Slack</span>
                      <span className={styles.miniOn}>Signed in</span>
                    </div>
                    <span className={styles.miniButton}>
                      <Puzzle />
                      Capture from Slack
                    </span>
                  </div>
                </div>
              </li>
              <li className={styles.step}>
                <div className={styles.stepHead}>
                  <span className={styles.stepNumber}>3</span>
                  <span className={styles.stepIcon}>
                    <Calendar />
                  </span>
                </div>
                <h3 className={styles.h3}>Set your schedule</h3>
                <p className={styles.body}>
                  Choose the days and hours you want to look active. Stillgreen starts helping when they start and
                  steps back when they end. The dashboard shows when Slack confirms your status.
                </p>
                <div className={styles.stepVisual} aria-hidden="true">
                  <div className={styles.miniDays}>
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
                      <span key={day} className={i < 5 ? styles.dayOn : styles.day}>
                        {day}
                      </span>
                    ))}
                  </div>
                  <div className={styles.miniHours}>
                    <Clock />
                    <span className={styles.miniMono}>9:00 AM – 5:00 PM</span>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className={styles.section} aria-labelledby="features-title">
          <div className="container">
            <SectionHead
              id="features-title"
              eyebrow="Features"
              title="Everything you need. Nothing you don't."
              lead="Simple controls for the moments that matter: the work day, a late night, and a break."
            />
            <ul className={styles.features}>
              {features.map((feature) => (
                <li key={feature.title} className={styles.feature}>
                  <span className={styles.featureIcon}>{feature.icon}</span>
                  <h3 className={styles.h3}>{feature.title}</h3>
                  <p className={styles.body}>{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Cloud */}
        <section id="cloud" className={`${styles.section} ${styles.cloud}`} aria-labelledby="cloud-title">
          <div className={`container ${styles.split}`}>
            <div>
              <SectionHead
                id="cloud-title"
                eyebrow="Optional: always on"
                title="Keep it running with your laptop closed."
                lead="On your own computer, Stillgreen stops when the computer sleeps. If you are comfortable looking after a small online server, you can run it there instead. Most people should start on their own computer."
              />
              <ul className={styles.checks}>
                <li>
                  <Check />
                  A step-by-step guide, about 15 minutes
                </li>
                <li>
                  <Check />
                  Same dashboard and extension as before
                </li>
              </ul>
              <ul className={styles.cautions} aria-label="Before you choose the cloud">
                <li>
                  <AlertTriangle aria-hidden="true" />
                  Google needs a card on file, even for the free server.
                </li>
                <li>
                  <AlertTriangle aria-hidden="true" />
                  Going past Google&apos;s free limits can cost money.
                </li>
                <li>
                  <AlertTriangle aria-hidden="true" />
                  You keep the server updated and safe.
                </li>
                <li>
                  <AlertTriangle aria-hidden="true" />
                  Your Slack login lives on that server. That is more risk than keeping it on your own computer.
                </li>
              </ul>
              <div className={styles.ctas}>
                <Button href={CLOUD_GUIDE_URL} iconRight={<ArrowUpRight />}>
                  Read the cloud guide
                </Button>
              </div>
            </div>

            <div className={styles.serverCard}>
              <div className={styles.serverHead}>
                <span className={styles.serverIcon}>
                  <Cloud />
                </span>
                <div className={styles.serverTitle}>
                  <h3 className={styles.h3}>Always-on server</h3>
                  <p>Google Cloud, from our guide</p>
                </div>
                <Badge tone="warning">Advanced</Badge>
              </div>
              <dl className={styles.specs}>
                <div>
                  <dt>Runs</dt>
                  <dd>All day, every day</dd>
                </div>
                <div>
                  <dt>Laptop</dt>
                  <dd>Can be closed</dd>
                </div>
                <div>
                  <dt>Cost</dt>
                  <dd>Free within limits</dd>
                </div>
                <div>
                  <dt>Setup time</dt>
                  <dd>About 15 minutes</dd>
                </div>
              </dl>
              <div className={styles.serverFoot}>
                <p>The guide has every step, from creating the server to connecting your dashboard.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Security and privacy */}
        <section className={styles.section} aria-labelledby="privacy-title">
          <div className={`container ${styles.split}`}>
            <div>
              <SectionHead
                id="privacy-title"
                eyebrow="Security and privacy"
                title="Your Slack login never leaves your hands."
                lead={
                  <>
                    There is no Stillgreen server in the middle. Your browser talks to your own Stillgreen, and only
                    Stillgreen talks to Slack. Read the <Link href="/privacy">privacy policy</Link>.
                  </>
                }
              />
              <ul className={styles.points}>
                <li>
                  <span className={styles.pointIcon}>
                    <Lock />
                  </span>
                  <div>
                    <h3 className={styles.h3}>Saved only on your computer</h3>
                    <p className={styles.body}>
                      Your Slack login is saved on your computer, where only you can read it. Anyone who gets it could
                      act as you in Slack, so keep that computer safe.
                    </p>
                  </div>
                </li>
                <li>
                  <span className={styles.pointIcon}>
                    <Shield />
                  </span>
                  <div>
                    <h3 className={styles.h3}>Locked with an access code</h3>
                    <p className={styles.body}>Only you can control it. The dashboard needs your private access code.</p>
                  </div>
                </li>
                <li>
                  <span className={styles.pointIcon}>
                    <Github />
                  </span>
                  <div>
                    <h3 className={styles.h3}>Open for anyone to check</h3>
                    <p className={styles.body}>
                      All the code is public on{" "}
                      <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                        GitHub
                      </a>
                      . No account, no tracking.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <figure className={styles.flow} aria-labelledby="flow-caption">
              <figcaption id="flow-caption" className={styles.flowCaption}>
                Where your Slack login goes
              </figcaption>
              <ol className={styles.flowNodes}>
                <li className={styles.flowNode}>
                  <span className={styles.flowIcon}>
                    <Laptop />
                  </span>
                  <span className={styles.flowText}>
                    <strong>Your browser</strong>
                    <span>Dashboard or extension</span>
                  </span>
                </li>
                <li className={styles.flowLink}>
                  <span className={styles.flowLine} />
                  <span className={styles.flowLabel}>
                    <span className="visually-hidden">sends your </span>access code
                  </span>
                </li>
                <li className={`${styles.flowNode} ${styles.flowNodeAccent}`}>
                  <span className={styles.flowIcon}>
                    <Shield />
                  </span>
                  <span className={styles.flowText}>
                    <strong>Your Stillgreen</strong>
                    <span>Your computer or server</span>
                  </span>
                  <span className={styles.flowBadge}>
                    <Badge tone="success" dot>
                      Login saved here
                    </Badge>
                  </span>
                </li>
                <li className={styles.flowLink}>
                  <span className={styles.flowLine} />
                  <span className={styles.flowLabel}>
                    <span className="visually-hidden">sends </span>your Slack login
                  </span>
                </li>
                <li className={styles.flowNode}>
                  <span className={styles.flowIcon}>
                    <Grid />
                  </span>
                  <span className={styles.flowText}>
                    <strong>Slack</strong>
                    <span className={styles.miniMono}>slack.com</span>
                  </span>
                </li>
              </ol>
              <div className={styles.flowNever}>
                <span className={styles.flowNeverIcon}>
                  <X />
                </span>
                <span>
                  <strong>This website</strong> only sends you the dashboard page. It never sees your Slack login.
                </span>
              </div>
            </figure>
          </div>
        </section>

        {/* FAQ */}
        <section className={styles.section} aria-labelledby="faq-title">
          <div className={`container ${styles.faqGrid}`}>
            <SectionHead
              id="faq-title"
              eyebrow="FAQ"
              title="Questions, answered."
              lead={
                <>
                  Something else? <a href={ISSUES_URL} target="_blank" rel="noreferrer">Ask on GitHub</a>.
                </>
              }
            />
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

        {/* Final call to action */}
        <section className={styles.final} aria-labelledby="final-title">
          <div className="container">
            <div className={styles.finalCard}>
              <h2 className={styles.h2} id="final-title">
                Set it up once. Let it run all week.
              </h2>
              <p className={styles.lead}>Free, no account, and about five minutes to set up.</p>
              <div className={`${styles.ctas} ${styles.ctasCenter}`}>
                <Button href="/setup" variant="primary" size="lg" iconRight={<ArrowRight />}>
                  Set it up
                </Button>
                <Button href="/dashboard" size="lg">
                  Open dashboard
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
