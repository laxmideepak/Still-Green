import Link from "next/link";
import { HeroPresence } from "@/components/hero-presence";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ArrowRight, ArrowUpRight, Check, Lock, Pause } from "@/components/icons";
import styles from "./page.module.css";

const signalFacts = [
  { label: "Ping", value: "30 seconds" },
  { label: "Activity tickle", value: "5 minutes" },
  { label: "Presence check", value: "60 seconds" },
  { label: "Manual away", value: "Left alone" },
];

const day = [
  {
    time: "08:58",
    title: "The daemon wakes",
    body: "Reads your local config and checks today's window.",
  },
  {
    time: "09:00",
    title: "The dot turns green",
    body: "Connects to Slack and keeps the session alive in the background.",
  },
  {
    time: "13:20",
    title: "Lunch, uninterrupted",
    body: "Presence checks continue. A manual away is never overridden.",
  },
  {
    time: "17:00",
    title: "Off, on time",
    body: "The session closes and waits for the next scheduled window.",
  },
];

const activity = [
  { time: "09:00", text: "Session started for Fieldwork", tone: "green" },
  { time: "09:01", text: "Presence check: active", tone: "green" },
  { time: "12:30", text: "Activity tickle sent", tone: "muted" },
  { time: "17:00", text: "Outside schedule. Session stopped.", tone: "amber" },
];

const week = [
  { day: "Mon", active: true },
  { day: "Tue", active: true },
  { day: "Wed", active: true },
  { day: "Thu", active: true },
  { day: "Fri", active: true },
  { day: "Sat", active: false },
  { day: "Sun", active: false },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className={styles.hero}>
          <div className={`container ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <h1>
                Your green dot,
                <br />
                on your schedule<span className={styles.stop}>.</span>
              </h1>
              <p className={styles.lede}>
                Stillgreen keeps Slack presence active during the hours you choose.
                Run one small daemon on your own always-on cloud host — close the
                laptop and the dot stays green.
              </p>
              <div className={styles.heroActions}>
                <Link href="/dashboard" className="button buttonPrimary">
                  Open the dashboard
                  <ArrowUpRight width={16} height={16} />
                </Link>
                <Link href="/start" className="button buttonSecondary">
                  Set up the cloud
                </Link>
              </div>
              <p className={styles.previewNote}>
                The dashboard goes live when paired with your daemon. Without one, it
                stays an honest sample.
              </p>
              <ul className={styles.proof} aria-label="Product principles">
                {["Your own host", "No cloud relay", "No telemetry"].map((item) => (
                  <li key={item}>
                    <Check width={13} height={13} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.heroVisual}>
              <HeroPresence />
            </div>
          </div>
        </section>

        <section className={styles.signalBar} aria-label="How the daemon behaves">
          <div className={`container ${styles.signalGrid}`}>
            {signalFacts.map((fact) => (
              <div key={fact.label} className={styles.signalItem}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className={styles.daySection}>
          <div className={`container ${styles.dayGrid}`}>
            <div>
              <div className={styles.sectionHead}>
                <h2>A day, handled.</h2>
                <p>
                  Presence follows the decision you made once, not the tab you keep
                  checking. The daemon handles the hours in between.
                </p>
              </div>
              <ol className={styles.timeline}>
                {day.map((item) => (
                  <li key={item.time} className={styles.timelineItem}>
                    <time>{item.time}</time>
                    <span className={styles.timelineDot} aria-hidden="true" />
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <aside className={styles.dayAside}>
              <div className={styles.asideMark} aria-hidden="true">
                <span />
              </div>
              <blockquote>
                Presence should follow a decision you made once, not a tab you keep
                checking.
              </blockquote>
              <p>
                Set a schedule, close the laptop lid when you&apos;re done, and stop
                negotiating with a status indicator.
              </p>
              <Link href="/dashboard" className="textLink">
                See the control surface
                <ArrowRight width={14} height={14} />
              </Link>
            </aside>
          </div>
        </section>

        <section id="control" className={styles.controlSection}>
          <div className={`container ${styles.controlInner}`}>
            <div className={styles.sectionHead}>
              <h2>Control without the ceremony.</h2>
              <p>
                A schedule that respects timezones, a pause that actually disconnects,
                and a log that tells you what happened.
              </p>
            </div>

            <div className={styles.controlGrid}>
              <article className={styles.schedulePanel}>
                <div className={styles.panelCopy}>
                  <h3>A week that knows your timezone.</h3>
                  <p>
                    Set weekdays or a custom pattern, including overnight windows. The
                    daemon follows the clock in the timezone you choose.
                  </p>
                </div>
                <div className={styles.miniWeek} aria-hidden="true">
                  {week.map((item) => (
                    <div key={item.day} className={styles.miniDay}>
                      <span>{item.day}</span>
                      <div className={styles.miniTrack}>
                        {item.active && <i />}
                      </div>
                    </div>
                  ))}
                  <div className={styles.miniAxis}>
                    <span>08:00</span>
                    <span>17:00</span>
                  </div>
                </div>
              </article>

              <article className={styles.pausePanel}>
                <div className={styles.pauseTop}>
                  <span className={styles.pauseIcon} aria-hidden="true">
                    <Pause width={18} height={18} />
                  </span>
                  <span className={styles.panelLabel}>Pause</span>
                </div>
                <h3>Pause means pause.</h3>
                <p>
                  Manual away stays manual. Pausing stops the session instead of
                  fighting Slack for a status you didn&apos;t ask for.
                </p>
                <code>sg-local pause --for 2h</code>
              </article>

              <article className={styles.activityPanel}>
                <div className={styles.activityHead}>
                  <h3>A log you can read.</h3>
                  <span>Last session</span>
                </div>
                <ul>
                  {activity.map((entry) => (
                    <li key={`${entry.time}-${entry.text}`}>
                      <time>{entry.time}</time>
                      <i data-tone={entry.tone} aria-hidden="true" />
                      <span>{entry.text}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.localSection}>
          <div className={`container ${styles.localPanel}`}>
            <div className={styles.localCopy}>
              <div className={styles.localKicker}>
                <Lock width={14} height={14} />
                Local by construction
              </div>
              <h2>Your tokens don&apos;t need our server.</h2>
              <p>
                Credentials live in a file with permissions set to 0600 on the host you
                control. The daemon talks to Slack and nothing else. There is no
                Stillgreen account, no relay and no telemetry to opt out of.
              </p>
              <ul>
                <li>Tokens entered on the daemon, never on Vercel</li>
                <li>Outbound traffic only to Slack</li>
                <li>One process you can stop at any time</li>
              </ul>
              <Link href="/setup#security" className="textLink">
                Read the security notes
                <ArrowRight width={14} height={14} />
              </Link>
            </div>
            <div className={styles.terminal} aria-label="Example terminal session">
              <div className={styles.terminalBar}>
                <span />
                <span />
                <span />
                <em>stillgreen — local</em>
              </div>
              <div className={styles.terminalBody}>
                <p>
                  <span className={styles.prompt}>$</span> ./sg-local add
                </p>
                <p className={styles.ok}>✓ tokens verified · saved locally</p>
                <p>
                  <span className={styles.prompt}>$</span> ./sg-local start
                </p>
                <p className={styles.output}>daemon running · pid 4128</p>
                <p className={styles.output}>schedule: weekdays 09:00–17:00</p>
                <p className={styles.output}>transport: Slack WebSocket</p>
                <p className={styles.cursor}>
                  <span className={styles.prompt}>$</span> <i />
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.detailsSection}>
          <div className={`container ${styles.detailsGrid}`}>
            <div className={styles.sectionHead}>
              <h2>The unglamorous parts.</h2>
              <p>
                No magic status API. Just the same long-lived connection the Slack web
                client uses, with a small amount of care around it.
              </p>
            </div>
            <dl className={styles.specList}>
              <div>
                <dt>Transport</dt>
                <dd>WebSocket to wss-primary.slack.com</dd>
              </div>
              <div>
                <dt>Keepalive</dt>
                <dd>Ping every 30 seconds, activity tickle every 5 minutes</dd>
              </div>
              <div>
                <dt>Presence</dt>
                <dd>users.getPresence every 60 seconds; reconnect when away</dd>
              </div>
              <div>
                <dt>Schedule</dt>
                <dd>Weekly windows, IANA timezones, overnight support</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>Daemon volume, mode 0600, outside this repository</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={styles.closing}>
          <div className={`container ${styles.closingInner}`}>
            <div>
              <h2>Put your presence on a schedule.</h2>
              <p>Set it up once. Let the daemon handle the green dot.</p>
            </div>
            <div className={styles.closingActions}>
              <Link href="/start" className="button buttonPrimary">
                Put it in the cloud
                <ArrowUpRight width={16} height={16} />
              </Link>
              <Link href="/dashboard" className="button buttonSecondary">
                Open the dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
