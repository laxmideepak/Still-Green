"use client";

import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowUpRight, Check, Clock, Github, Lock, Shield, Terminal } from "./icons";
import { Magnetic } from "./motion/magnetic";
import { SplitText } from "./motion/split-text";
import { BootTerminal } from "./setup/boot-terminal";
import { Command, CopyButton, useCopy } from "./setup/command";
import { Spotlight } from "./setup/spotlight";
import { Toc, useActiveSection, type TocItem } from "./setup/toc";
import { WhereDiagram } from "./setup/where-diagram";
import styles from "./setup-guide.module.css";

const reveal = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties;

function ExampleRow({ command, children }: { command: string; children: React.ReactNode }) {
  return (
    <div className={styles.exampleRow}>
      <code>{command}</code>
      <span>{children}</span>
    </div>
  );
}

const steps = [
  {
    id: "install",
    title: "Clone and install",
    body: (
      <>
        <p>
          The project is a small Python package with one dependency. Clone it, then run
          the installer to put <code>sg-local</code> on your path.
        </p>
        <Command
          command={"git clone https://github.com/laxmideepak/slack.git\ncd slack\n./install.sh"}
          label="Terminal"
        />
        <p className={styles.finePrint}>
          Prefer not to install? Run <code>./sg-local</code> from the repository instead.
          Python 3.11+ and <code>websockets</code> are required.
        </p>
      </>
    ),
  },
  {
    id: "run",
    title: "Start the daemon",
    body: (
      <>
        <p>
          That is the whole running system: one background process that talks to Slack
          and serves its control page on <code>127.0.0.1:8765</code>. Stop it whenever
          you want; nothing is left running anywhere else.
        </p>
        <Command command={"sg-local start\nsg-local status"} label="Start and check" />
        <div className={styles.examples}>
          <ExampleRow command="sg-local web --show-code">
            Print the access code for the extension and dashboard
          </ExampleRow>
          <ExampleRow command="sg-local logs -f">Follow the activity log</ExampleRow>
          <ExampleRow command="sg-local install-launchd">
            macOS only — restart automatically at login
          </ExampleRow>
        </div>
      </>
    ),
  },
  {
    id: "tokens",
    title: "Add your Slack workspace",
    body: (
      <>
        <p>
          Stillgreen uses the same session the Slack web client uses. The quickest way to
          hand it over is the bundled extension: load <code>extension/</code> as an
          unpacked extension, sign in at{" "}
          <a href="https://app.slack.com" target="_blank" rel="noreferrer">app.slack.com</a>,
          paste the access code and press <strong>Capture from Slack</strong>.{" "}
          <Link href="/start#extension">Extension steps</Link>.
        </p>
        <p>
          Prefer not to use the extension? Copy the two values from DevTools in a desktop
          browser, then add them with <code>sg-local add</code> below.
        </p>
        <div className={styles.tokenGrid}>
          <Spotlight className={styles.tokenCard} as="div">
            <span className={styles.tokenTag}>
              xoxc<span>-</span>
            </span>
            <h4>The workspace token</h4>
            <p>
              Newer Slack builds no longer keep this in localStorage. Read it from the
              network instead:
            </p>
            <ol className={styles.tokenSteps}>
              <li>
                Open <strong>Network</strong> in DevTools, filter by <code>api</code>,
                then reload Slack.
              </li>
              <li>
                Open <code>client.boot</code> or <code>users.getPresence</code> →
                Payload → copy the <code>token</code> field. It starts with{" "}
                <code>xoxc-</code>.
              </li>
              <li>
                No token field? Filter by <code>WS</code>, open{" "}
                <code>wss-primary.slack.com</code>, and copy <code>token=…</code> from
                the request URL.
              </li>
            </ol>
            <details className={styles.fallback}>
              <summary>Older Slack builds: try the console</summary>
              <div className={styles.fallbackBody}>
                <Command command={"JSON.parse(localStorage.localConfig_v2).teams"} compact />
              </div>
            </details>
          </Spotlight>
          <Spotlight className={styles.tokenCard} as="div" style={reveal(120)}>
            <span className={styles.tokenTag}>
              xoxd<span>-</span>
            </span>
            <h4>The session cookie</h4>
            <p>
              DevTools → Application → Cookies → <code>app.slack.com</code> → copy the
              value of <code>d</code>.
            </p>
            <p className={styles.tokenFine}>
              It starts with <code>xoxd-</code>. The cookie is HttpOnly, so use the
              Application panel — <code>document.cookie</code> will not show it.
            </p>
          </Spotlight>
        </div>
        <p>
          Run the command and paste the two values when prompted. Input is hidden, the
          tokens are verified with Slack, and the file is written with owner-only
          permissions.
        </p>
        <Command command="sg-local add" label="On your machine" />
        <div className={styles.pathRow}>
          <span>Config file</span>
          <code>~/.config/slack-green-local/config.json</code>
          <span className={styles.pathMode}>0600</span>
        </div>
        <p className={styles.warning}>
          <Lock width={15} height={15} />
          <span>
            These two values grant full access to your Slack account. Treat them like a
            password. Do not paste them into a website, chat, issue, or shell history.
          </span>
        </p>
      </>
    ),
  },
  {
    id: "schedule",
    title: "Choose the hours",
    body: (
      <>
        <p>
          Set a weekly window in your local timezone, or use an IANA name if the machine
          travels. Overnight windows belong to the day they start.
        </p>
        <Command
          command="sg-local schedule set --days mon-fri --start 09:00 --end 17:00 --timezone local"
          label="Weekdays, 9 to 5"
        />
        <div className={styles.examples}>
          <ExampleRow command="sg-local schedule always">Keep presence on around the clock</ExampleRow>
          <ExampleRow command="sg-local schedule show">
            Check the current window and next change
          </ExampleRow>
        </div>
      </>
    ),
  },
];

const securityNotes = [
  {
    icon: Lock,
    title: "Owner-only storage",
    body: "Tokens live in a JSON file outside this repository, written with mode 0600. Nothing is sent to a Stillgreen server.",
  },
  {
    icon: Shield,
    title: "Hidden input, verified locally",
    body: "Token prompts never echo, and values are never printed in output or logs. Verification goes directly to Slack.",
  },
  {
    icon: Terminal,
    title: "Loopback only",
    body: "The daemon opens a WebSocket to Slack and listens only on 127.0.0.1 for its control page. No relay, no analytics, no crash reporting.",
  },
  {
    icon: Clock,
    title: "Revoking is ordinary",
    body: "Sign out of Slack or change your password to invalidate the session. If tokens expire, capture again with the extension or run sg-local add.",
  },
];

const never = [
  "Request your password, OAuth code, or Slack sign-in",
  "Send tokens to Vercel or any third-party service",
  "Accept connections from other machines on your Mac (it listens only on 127.0.0.1; only the cloud setup listens on the network, behind HTTPS)",
  "Override a manual away status you set in Slack",
];

const prerequisites = [
  <>Python 3.11 or newer</>,
  <>
    <code>websockets</code> installed
  </>,
  <>Slack web access in a desktop browser</>,
  <>Permission to automate this workspace</>,
];

const dailyCommands = [
  { label: "Pause for two hours", command: "sg-local pause --for 2h" },
  { label: "Resume", command: "sg-local resume" },
  { label: "Stay online once", command: "sg-local stay 90m" },
  { label: "See what is happening", command: "sg-local status" },
];

const tocItems: TocItem[] = [
  { id: "before", label: "Before you start", index: "00" },
  { id: "where", label: "Where it runs", index: "01" },
  { id: "steps", label: "A short setup", index: "02" },
  { id: "install", label: "Clone and install", index: "2.1", sub: true },
  { id: "run", label: "Start the daemon", index: "2.2", sub: true },
  { id: "tokens", label: "Add your workspace", index: "2.3", sub: true },
  { id: "schedule", label: "Choose the hours", index: "2.4", sub: true },
  { id: "security", label: "Security model", index: "03" },
  { id: "trouble", label: "Troubleshooting", index: "04" },
  { id: "daily", label: "Daily commands", index: "05" },
  { id: "source", label: "Read the source", index: "06" },
];

const marquee = [
  "sg-local start",
  "sg-local status",
  "sg-local pause --for 2h",
  "sg-local resume",
  "sg-local stay 90m",
  "sg-local schedule show",
  "sg-local logs -f",
  "sg-local doctor --check-tokens",
];

export function SetupGuide() {
  const active = useActiveSection(tocItems.map((item) => item.id));
  const content = useRef<HTMLDivElement>(null);

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <Masthead />
        <CommandMarquee />

        <div className={`container ${styles.layout}`}>
          <aside className={styles.rail}>
            <Toc items={tocItems} active={active} target={content} />
          </aside>

          <div ref={content} className={styles.content}>
            <section id="before" className={styles.section} aria-labelledby="before-heading">
              <SectionHead index="00" kicker="Prerequisites" id="before-heading" title="Before you start." />
              <div className={styles.beforeGrid}>
                <ul className={styles.checklist}>
                  {prerequisites.map((item, i) => (
                    <li key={i} data-reveal="" style={reveal(i * 90)}>
                      <span className={styles.checkBox} aria-hidden="true">
                        <Check width={13} height={13} />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.policy} data-reveal="" style={reveal(300)}>
                  <span className={styles.policyTag}>Heads up</span>
                  Stillgreen is not affiliated with Slack. Automating presence may be
                  against your workspace policy.
                </p>
              </div>
            </section>

            <section id="where" className={styles.section} aria-labelledby="where-heading">
              <SectionHead
                index="01"
                kicker="Topology"
                id="where-heading"
                title="Where each piece runs."
                lede="A hosted dashboard cannot hold a Slack connection open, and it should never hold your tokens. So the daemon stays local and this site only sends it commands from your browser."
              />
              <WhereDiagram />
            </section>

            <section id="steps" className={styles.stepsSection} aria-labelledby="steps-heading">
              <SectionHead
                index="02"
                kicker="Install"
                id="steps-heading"
                title="A short setup."
                lede="Four steps, all local after the clone. Stop at any point — nothing starts until you do."
              />
              <Steps active={active} />
            </section>

            <section className={styles.section} id="security" aria-labelledby="security-heading">
              <SectionHead
                index="03"
                kicker={
                  <>
                    <Shield width={13} height={13} /> Security notes
                  </>
                }
                id="security-heading"
                title="The security model, plainly."
                lede="No account, no relay, no telemetry. The trade-off is that the tokens are powerful, so the local file and machine matter."
              />
              <div className={styles.securityGrid}>
                {securityNotes.map((note, i) => {
                  const Icon = note.icon;
                  return (
                    <Spotlight key={note.title} className={styles.securityCard} style={reveal(i * 90)}>
                      <span className={styles.securityIcon}>
                        <Icon width={18} height={18} />
                      </span>
                      <span className={styles.securityNum} aria-hidden="true">
                        0{i + 1}
                      </span>
                      <h3>{note.title}</h3>
                      <p>{note.body}</p>
                    </Spotlight>
                  );
                })}
              </div>
              <div className={styles.never} data-reveal="">
                <div className={styles.neverBar}>
                  <h3>What Stillgreen never does</h3>
                  <span aria-hidden="true">policy.deny</span>
                </div>
                <ul>
                  {never.map((item, i) => (
                    <li key={item} data-reveal="" style={reveal(120 + i * 90)}>
                      <span className={styles.deny} aria-hidden="true">
                        DENY
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="trouble" className={styles.section} aria-labelledby="trouble-heading">
              <SectionHead index="04" kicker="Troubleshooting" id="trouble-heading" title="If something goes wrong." />
              <div className={styles.trouble}>
                <Trouble code="01" title="Slack rejected the tokens">
                  Sign in at app.slack.com and press <strong>Capture from Slack</strong> in
                  the extension again, or run <code>sg-local add</code> with a fresh{" "}
                  <code>xoxc</code> and <code>xoxd</code>. Web sessions expire; signing out
                  of Slack invalidates them immediately.
                </Trouble>
                <Trouble code="02" title="The daemon starts but presence does not change">
                  Run <code>sg-local doctor --check-tokens</code>. Check that the schedule
                  window includes now and that you have not set a manual away in Slack.{" "}
                  <code>sg-local status</code> shows the next change.
                </Trouble>
                <Trouble code="03" title="The dot goes away when my laptop sleeps">
                  A suspended machine cannot keep a connection alive. Run the daemon on a
                  small always-on server instead (a free Google Cloud e2-micro works; see{" "}
                  <a
                    href="https://github.com/laxmideepak/slack#run-it-in-the-cloud"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Run it in the cloud
                  </a>
                  ), or keep the laptop awake with <code>caffeinate</code> while the window
                  is active. This follows your employer&apos;s policy, not around it.
                </Trouble>
              </div>
            </section>

            <section id="daily" className={styles.section} aria-labelledby="daily-heading">
              <SectionHead index="05" kicker="Cheat sheet" id="daily-heading" title="Daily commands." />
              <dl className={styles.dailyGrid}>
                {dailyCommands.map((item, i) => (
                  <DailyCommand key={item.command} {...item} delay={i * 80} />
                ))}
              </dl>
            </section>

            <section id="source" className={styles.section} aria-labelledby="source-heading">
              <Spotlight className={styles.source} as="div">
                <span className={styles.sourceIcon}>
                  <Github width={22} height={22} />
                </span>
                <h2 id="source-heading">Read the source.</h2>
                <p>
                  The daemon, schedule logic, and tests are in the same public repository
                  as this interface.
                </p>
                <a
                  href="https://github.com/laxmideepak/slack"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.sourceLink}
                >
                  github.com/laxmideepak/slack
                  <ArrowUpRight width={16} height={16} />
                </a>
                <pre className={styles.sourceTree} aria-hidden="true">
                  {"slack/\n├── sg-local\n├── install.sh\n├── extension/\n├── tests/\n└── app/"}
                </pre>
              </Spotlight>
            </section>
          </div>
        </div>

        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}

function Masthead() {
  const ref = useRef<HTMLElement>(null);
  const calm = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const gridY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const glowY = useTransform(scrollYProgress, [0, 1], ["0%", "60%"]);

  return (
    <section ref={ref} className={styles.masthead}>
      <motion.div className={styles.grid} style={calm ? undefined : { y: gridY }} aria-hidden="true" />
      <motion.div className={styles.glow} style={calm ? undefined : { y: glowY }} aria-hidden="true" />
      <div className={`container ${styles.mastheadInner}`}>
        <div className={styles.mastheadCopy}>
          <p className={`${styles.eyebrow} riseIn`}>
            <span className={styles.liveDot} aria-hidden="true" />
            Setup · about five minutes
          </p>
          <h1 className={styles.title}>
            <SplitText text="From clone" delay={0.1} />
            <br />
            <span className={styles.titleAcid}>
              <SplitText text="to green" delay={0.4} />
            </span>
            <motion.span
              className={styles.titleDot}
              aria-hidden="true"
              initial={calm ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.85, type: "spring", stiffness: 380, damping: 14 }}
            />
            <span className="visuallyHidden">.</span>
          </h1>
          <p className={`${styles.lede} riseIn`} style={{ "--rise-delay": "650ms" } as React.CSSProperties}>
            Everything that touches Slack runs on your machine. This site is only the
            manual and a dashboard that talks to your daemon over loopback.
          </p>
        </div>
        <div className={`${styles.bootWrap} riseIn`} style={{ "--rise-delay": "350ms" } as React.CSSProperties}>
          <BootTerminal />
        </div>
        <dl className={styles.facts}>
          {[
            ["Runtime", "Python 3.11+"],
            ["Platform", "macOS · Linux"],
            ["Dependency", "websockets"],
            ["Hosted piece", "This page only"],
          ].map(([term, value], i) => (
            <div
              key={term}
              className="riseIn"
              style={{ "--rise-delay": `${800 + i * 90}ms` } as React.CSSProperties}
            >
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function CommandMarquee() {
  const row = (hidden: boolean) => (
    <span className={styles.marqueeRow} aria-hidden={hidden || undefined}>
      {marquee.map((cmd) => (
        <span key={cmd} className={styles.marqueeItem}>
          <span className={styles.prompt}>$</span> {cmd}
          <i aria-hidden="true">✦</i>
        </span>
      ))}
    </span>
  );
  return (
    <div className={styles.marquee} aria-hidden="true">
      <div className={styles.marqueeTrack}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

function SectionHead({
  index,
  kicker,
  id,
  title,
  lede,
}: {
  index: string;
  kicker: React.ReactNode;
  id: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className={styles.sectionHead}>
      <p className={styles.kicker} data-reveal="">
        <span className={styles.kickerIndex}>{index}</span>
        {kicker}
      </p>
      <h2 id={id} data-reveal="" style={reveal(80)}>
        {title}
      </h2>
      {lede && (
        <p className={styles.sectionLede} data-reveal="" style={reveal(160)}>
          {lede}
        </p>
      )}
    </header>
  );
}

function Steps({ active }: { active: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const calm = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: wrap, offset: ["start 45%", "end 55%"] });

  return (
    <div ref={wrap} className={styles.stepsWrap}>
      <span className={styles.stepsRail} aria-hidden="true">
        <motion.span className={styles.stepsRailFill} style={{ scaleY: calm ? 1 : scrollYProgress }} />
      </span>
    <ol className={styles.steps}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={styles.step}
          id={step.id}
          data-active={active === step.id ? "" : undefined}
        >
          <div className={styles.stepNumber} aria-hidden="true">
            <span>{String(index + 1).padStart(2, "0")}</span>
          </div>
          <div className={styles.stepBody}>
            <p className={styles.stepKicker} aria-hidden="true">
              step {index + 1} of {steps.length}
            </p>
            <h3 data-reveal="">{step.title}</h3>
            <div data-reveal="" style={reveal(100)} className={styles.stepContent}>
              {step.body}
            </div>
          </div>
        </li>
      ))}
    </ol>
    </div>
  );
}

function Trouble({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <details className={styles.troubleItem} data-reveal="">
      <summary>
        <span className={styles.errCode} aria-hidden="true">
          ERR {code}
        </span>
        <span className={styles.troubleTitle}>{title}</span>
        <span className={styles.plus} aria-hidden="true" />
      </summary>
      <div className={styles.troubleBody}>
        <p>{children}</p>
      </div>
    </details>
  );
}

function DailyCommand({ label, command, delay }: { label: string; command: string; delay: number }) {
  const { copied, count, copy } = useCopy(command);
  return (
    <div className={styles.daily} data-reveal="" style={reveal(delay)} data-copied={copied ? "" : undefined}>
      <dt>{label}</dt>
      <dd>
        <code>
          <span className={styles.prompt} aria-hidden="true">
            ${" "}
          </span>
          {command}
        </code>
        <CopyButton text={command} copied={copied} count={count} onCopy={copy} small />
      </dd>
    </div>
  );
}

function Closing() {
  return (
    <section className={styles.closing}>
      <div className={`container ${styles.closingInner}`}>
        <h2 className={styles.closingTitle}>
          <SplitText text="Set it up once." inView />
          <br />
          <span className={styles.closingDim}>
            <SplitText text="Then close the tab." inView delay={0.25} />
          </span>
        </h2>
        <div className={styles.closingRow}>
          <p>The daemon keeps the schedule; you keep the rest of your day.</p>
          <div className={styles.closingActions}>
            <Magnetic>
              <a
                href="https://github.com/laxmideepak/slack"
                target="_blank"
                rel="noreferrer"
                className={styles.primary}
              >
                <span>Clone the repository</span>
                <ArrowUpRight width={18} height={18} />
              </a>
            </Magnetic>
            <Magnetic>
              <Link href="/dashboard" className={styles.secondary}>
                Preview the dashboard
              </Link>
            </Magnetic>
          </div>
        </div>
      </div>
    </section>
  );
}
