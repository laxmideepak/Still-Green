"use client";

import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useCallback, useRef, useState } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight, ArrowUpRight, Github, Lock, Shield, Terminal } from "./icons";
import { Magnetic } from "./motion/magnetic";
import { SplitText } from "./motion/split-text";
import { CommandBlock } from "./start/command-block";
import { ConnectForm } from "./start/connect-form";
import { SpotlightCard } from "./start/spotlight-card";
import { StackDiagram } from "./start/stack-diagram";
import styles from "./start-guide.module.css";

const commands = {
  install: {
    label: "Terminal",
    command: `git clone https://github.com/laxmideepak/slack.git
cd slack
./sg-local start
./sg-local web --show-code`,
    note: "`start` runs the presence daemon in the background, with its control page at http://127.0.0.1:8765. `web --show-code` prints the access code the extension and this dashboard ask for.",
  },
  autostart: {
    label: "Optional · macOS",
    command: `./sg-local install-launchd
./sg-local status`,
    note: "Starts the daemon and its control page at login, so the dot and this dashboard survive a reboot. Without it, run ./sg-local start again after a restart.",
  },
} as const;

type CommandKey = keyof typeof commands;

const tabs: Array<[CommandKey, string, string]> = [
  ["install", "First run", "clone, start, get the code"],
  ["autostart", "Keep it running", "macOS login item"],
];

const ticker = [
  "Python 3.11+",
  "one dependency",
  "127.0.0.1:8765",
  "no account",
  "no database",
  "no relay",
  "no telemetry",
  "about 3 minutes",
];

const runsWhere = [
  { dt: "Vercel", dd: "This static UI. It stores your daemon URL and access code in localStorage." },
  { dt: "Your machine", dd: "The daemon, the Slack WebSocket, the schedule, and the tokens.", hot: true },
  { dt: "The extension", dd: "Reads your Slack session once, then hands it to the daemon." },
  { dt: "Slack", dd: "The only service the daemon contacts for auth and presence." },
];

const ease = [0.16, 1, 0.3, 1] as const;

function delay(ms: number) {
  return { "--reveal-delay": `${ms}ms` } as React.CSSProperties;
}

export function StartGuide() {
  const [tab, setTab] = useState<CommandKey>("install");
  const typedOnce = useRef(false);
  const markTyped = useCallback(() => {
    typedOnce.current = true;
  }, []);
  const active = commands[tab];
  const calm = useReducedMotion();

  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: hero,
    offset: ["start start", "end start"],
  });
  const stackY = useTransform(heroProgress, [0, 1], ["0%", "-14%"]);
  const copyY = useTransform(heroProgress, [0, 1], ["0%", "18%"]);
  const heroFade = useTransform(heroProgress, [0, 0.85], [1, 0]);

  const stepsRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: stepsProgress } = useScroll({
    target: stepsRef,
    offset: ["start 60%", "end 60%"],
  });
  const railFill = useSpring(stepsProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        {/* ── Masthead ──────────────────────────────────────────────── */}
        <section ref={hero} className={styles.masthead}>
          <div className={styles.mastGlow} aria-hidden="true" />
          <div className={styles.mastGrid} aria-hidden="true" />
          <div className={`container ${styles.mastheadInner}`}>
            <motion.div style={calm ? undefined : { y: copyY, opacity: heroFade }}>
              <motion.p
                className={styles.eyebrow}
                initial={calm ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.05 }}
              >
                <span className={styles.liveDot} aria-hidden="true" />
                Local setup · about 3 minutes
              </motion.p>
              <h1 className={styles.title}>
                <SplitText text="Your dot," delay={0.1} />
                <br />
                <span className={styles.titleDim}>
                  <SplitText text="from this" delay={0.36} />
                </span>{" "}
                <span className={styles.titleAcid}>
                  <SplitText text="laptop." delay={0.6} />
                </span>
              </h1>
              <motion.p
                className={styles.lede}
                initial={calm ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.95, ease }}
              >
                Vercel hosts this dashboard and nothing else — it cannot hold a Slack
                connection, and it never sees a token. The presence daemon runs on your own
                machine, next to your Slack session.
              </motion.p>
              <motion.div
                className={styles.heroActions}
                initial={calm ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 1.1, ease }}
              >
                <Magnetic>
                  <a href="#setup" className={styles.primary}>
                    <span>Set it up</span>
                    <ArrowRight width={17} height={17} />
                  </a>
                </Magnetic>
                <Magnetic>
                  <a href="#connect" className={styles.secondary}>
                    I already run it
                  </a>
                </Magnetic>
              </motion.div>
            </motion.div>
            <motion.div
              className={styles.stackWrap}
              style={calm ? undefined : { y: stackY, opacity: heroFade }}
            >
              <StackDiagram />
            </motion.div>
          </div>
        </section>

        <Ticker />

        {/* ── Steps ─────────────────────────────────────────────────── */}
        <section className={styles.stepsSection} id="setup">
          <div className="container">
            <div className={styles.sectionHead}>
              <p className={styles.kicker} data-reveal>
                <Terminal width={14} height={14} />
                The whole install
              </p>
              <h2 className={styles.sectionTitle}>
                <SplitText text="Three steps," inView />{" "}
                <span className={styles.titleDim}>
                  <SplitText text="then close the tab." inView delay={0.25} />
                </span>
              </h2>
              <p className={styles.sectionLede} data-reveal style={delay(200)}>
                One Python process, one browser extension, one access code. No account
                system, no database, no relay.
              </p>
            </div>

            <div ref={stepsRef} className={styles.stepsWrap}>
              <div className={styles.rail} aria-hidden="true">
                <motion.span className={styles.railFill} style={{ scaleY: calm ? 1 : railFill }} />
              </div>

              <ol className={styles.steps}>
                <Step n="01" id="daemon">
                  <h3>Run the daemon on your machine</h3>
                  <p className={styles.stepText}>
                    Python 3.11+ and one dependency. The daemon holds the Slack session,
                    watches the clock, and serves a control page on loopback.
                  </p>
                  <div className={styles.tabs} role="tablist" aria-label="Command">
                    {tabs.map(([id, label, note]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={styles.tab}
                      >
                        {tab === id && (
                          <motion.span
                            layoutId="start-tab"
                            className={styles.tabPill}
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                        )}
                        <strong>{label}</strong>
                        <span>{note}</span>
                      </button>
                    ))}
                  </div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={tab}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.32, ease }}
                    >
                      <CommandBlock
                        command={active.command}
                        label={active.label}
                        typeOnView={tab === "install" && !typedOnce.current}
                        onTyped={markTyped}
                      />
                      <p className={styles.finePrint}>{active.note}</p>
                    </motion.div>
                  </AnimatePresence>
                </Step>

                <Step n="02" id="extension">
                  <h3>Let the extension capture your Slack session</h3>
                  <p className={styles.stepText}>
                    The <code>xoxc</code> token lives in the page; the <code>xoxd</code>{" "}
                    cookie is <code>HttpOnly</code>. Neither can be read by a bookmarklet, so
                    the repository ships a small unpacked extension that reads both from your
                    own browser and posts them to the daemon on loopback.
                  </p>
                  <CaptureFlow />
                  <div className={styles.tokenRow}>
                    <div data-reveal>
                      <span>Install</span>
                      <p>
                        Load <code>extension/</code> as an unpacked extension from{" "}
                        <code>chrome://extensions</code>.
                      </p>
                    </div>
                    <div data-reveal style={delay(120)}>
                      <span>Capture</span>
                      <p>
                        Paste the access code and press <strong>Capture from Slack</strong>.
                        Every signed-in workspace is added at once.
                      </p>
                    </div>
                  </div>
                  <p className={styles.finePrint}>
                    Prefer not to use the extension? Run <code>./sg-local add</code> and paste
                    the two values from DevTools.{" "}
                    <Link href="/setup#tokens">Manual walkthrough</Link>.
                  </p>
                </Step>

                <Step n="03" id="connect" last>
                  <h3>Connect this dashboard to the daemon</h3>
                  <p className={styles.stepText}>
                    The daemon listens on <code>127.0.0.1:8765</code>. Paste that URL and the
                    access code. Your browser stores both locally and talks to the daemon
                    directly.
                  </p>
                  <ConnectForm />
                </Step>
              </ol>
            </div>
          </div>
        </section>

        {/* ── Honesty ───────────────────────────────────────────────── */}
        <section className={styles.honestySection}>
          <div className={`container ${styles.honestyGrid}`}>
            <SpotlightCard as="article" className={styles.honestyCard} data-reveal>
              <span className={styles.cardLabel}>
                <Shield width={14} height={14} />
                Architecture
              </span>
              <h2>What runs where</h2>
              <dl className={styles.whereList}>
                {runsWhere.map((row, i) => (
                  <div key={row.dt} data-reveal style={delay(120 + i * 90)} data-hot={row.hot || undefined}>
                    <dt>
                      <i aria-hidden="true" />
                      {row.dt}
                    </dt>
                    <dd>{row.dd}</dd>
                  </div>
                ))}
              </dl>
            </SpotlightCard>

            <SpotlightCard
              as="article"
              className={`${styles.honestyCard} ${styles.costCard}`}
              data-reveal
              style={delay(140)}
            >
              <span className={styles.cardLabel}>
                <Lock width={14} height={14} />
                Price
              </span>
              <h2>What it costs</h2>
              <p className={styles.bigZero} aria-hidden="true">
                <span>$</span>0
              </p>
              <p className={styles.costLead}>
                Nothing. The daemon is one Python process and a WebSocket per workspace; the
                dashboard is a static site. There is no subscription and no account.
              </p>
              <p className={styles.finePrint}>
                The trade is the laptop: sleep it and the session ends. Keep the machine
                awake, or{" "}
                <a
                  href="https://github.com/laxmideepak/slack#run-it-in-the-cloud"
                  target="_blank"
                  rel="noreferrer"
                >
                  run the daemon in the cloud
                </a>{" "}
                on a free always-on server. Your Slack plan may also restrict automated
                presence — check your workspace rules.
              </p>
            </SpotlightCard>
          </div>
        </section>

        {/* ── Closing ───────────────────────────────────────────────── */}
        <section className={styles.closing}>
          <div className={styles.closingGlow} aria-hidden="true" />
          <div className="container">
            <p className={styles.kicker} data-reveal>
              <span className={styles.liveDot} aria-hidden="true" />
              Already running?
            </p>
            <h2 className={styles.closingTitle}>
              <SplitText text="Point the" inView />{" "}
              <span className={styles.titleDim}>
                <SplitText text="dashboard" inView delay={0.18} />
              </span>{" "}
              <span className={styles.titleAcid}>
                <SplitText text="at it." inView delay={0.42} />
              </span>
            </h2>
            <div className={styles.closingRow}>
              <p data-reveal>One URL, one code, live state. The same flow every time.</p>
              <div className={styles.closingActions} data-reveal style={delay(120)}>
                <Magnetic>
                  <a href="#connect" className={styles.primary}>
                    <span>Connect daemon</span>
                    <ArrowUpRight width={18} height={18} />
                  </a>
                </Magnetic>
                <Magnetic>
                  <Link href="/setup" className={styles.secondary}>
                    CLI reference
                  </Link>
                </Magnetic>
                <a
                  href="https://github.com/laxmideepak/slack"
                  className={styles.sourceLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github width={16} height={16} />
                  Source
                </a>
              </div>
            </div>
          </div>
        </section>

        <p className={styles.footNote}>
          <Terminal width={13} height={13} />
          Runs on Python 3.11+ with one dependency. No telemetry, no account, no relay.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

/** One numbered step. Its number lights up (once) when it reaches mid-screen. */
function Step({
  n,
  id,
  last = false,
  children,
}: {
  n: string;
  id: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const lit = useInView(ref, { once: true, margin: "0px 0px -45% 0px" });

  return (
    <li ref={ref} id={id} className={styles.step} data-lit={lit || undefined} data-last={last || undefined}>
      <div className={styles.stepNumber} aria-hidden="true">
        <span className={styles.stepRing} />
        <span className={styles.stepDigits}>{n}</span>
      </div>
      <SpotlightCard className={styles.stepCard}>{children}</SpotlightCard>
    </li>
  );
}

/** Slack tab → extension → daemon, with tokens riding the wire while in view. */
function CaptureFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });

  return (
    <div ref={ref} className={styles.capture} data-running={inView || undefined} aria-hidden="true">
      <span className={styles.captureNode}>
        <b>#</b>
        app.slack.com
      </span>
      <span className={styles.captureWire}>
        <span className={styles.token}>
          <b>xoxc</b>
        </span>
        <span className={styles.token} data-late>
          <b>xoxd</b>
        </span>
      </span>
      <span className={`${styles.captureNode} ${styles.captureHot}`}>
        <b>●</b>
        127.0.0.1:8765
      </span>
    </div>
  );
}

function Ticker() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const row = (
    <span className={styles.tickerRow}>
      {ticker.map((item) => (
        <span key={item}>
          {item}
          <i />
        </span>
      ))}
    </span>
  );

  return (
    <div ref={ref} className={styles.ticker} data-running={inView || undefined} aria-hidden="true">
      <div className={styles.tickerTrack}>
        {row}
        {row}
      </div>
    </div>
  );
}
