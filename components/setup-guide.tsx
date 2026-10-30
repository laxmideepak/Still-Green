"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Github,
  Lock,
  Shield,
  Terminal,
} from "./icons";
import styles from "./setup-guide.module.css";

type CommandProps = {
  command: string;
  label?: string;
  compact?: boolean;
};

function Command({ command, label, compact = false }: CommandProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`${styles.command} ${compact ? styles.commandCompact : ""}`}>
      <div className={styles.commandTop}>
        {label && <span>{label}</span>}
        <button
          type="button"
          className={styles.copyButton}
          onClick={copy}
          aria-label={`Copy command: ${command}`}
        >
          {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          <span aria-hidden="true">$ </span>
          {command}
        </code>
      </pre>
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
        <div className={styles.exampleRow}>
          <code>sg-local web --show-code</code>
          <span>Print the access code for the extension and dashboard</span>
        </div>
        <div className={styles.exampleRow}>
          <code>sg-local logs -f</code>
          <span>Follow the activity log</span>
        </div>
        <div className={styles.exampleRow}>
          <code>sg-local install-launchd</code>
          <span>macOS only — restart automatically at login</span>
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
          <div className={styles.tokenCard}>
            <span className={styles.tokenTag}>xoxc</span>
            <h3>The workspace token</h3>
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
              <Command command={"JSON.parse(localStorage.localConfig_v2).teams"} compact />
            </details>
          </div>
          <div className={styles.tokenCard}>
            <span className={styles.tokenTag}>xoxd</span>
            <h3>The session cookie</h3>
            <p>
              DevTools → Application → Cookies → <code>app.slack.com</code> → copy the
              value of <code>d</code>.
            </p>
            <p className={styles.tokenFine}>
              It starts with <code>xoxd-</code>. The cookie is HttpOnly, so use the
              Application panel — <code>document.cookie</code> will not show it.
            </p>
          </div>
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
          These two values grant full access to your Slack account. Treat them like a
          password. Do not paste them into a website, chat, issue, or shell history.
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
        <div className={styles.exampleRow}>
          <code>sg-local schedule always</code>
          <span>Keep presence on around the clock</span>
        </div>
        <div className={styles.exampleRow}>
          <code>sg-local schedule show</code>
          <span>Check the current window and next change</span>
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

export function SetupGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Setup · about five minutes
              </p>
              <h1>
                From clone
                <br />
                to green<span className={styles.dot}>.</span>
              </h1>
              <p className={styles.lede}>
                Everything that touches Slack runs on your machine. This site is only the
                manual and a dashboard that talks to your daemon over loopback.
              </p>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Runtime</dt>
                <dd>Python 3.11+</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>macOS · Linux</dd>
              </div>
              <div>
                <dt>Dependency</dt>
                <dd>websockets</dd>
              </div>
              <div>
                <dt>Hosted piece</dt>
                <dd>This page only</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className={`container ${styles.layout}`}>
          <div className={styles.content}>
            <section className={styles.where} aria-labelledby="where-heading">
              <div className={styles.whereCopy}>
                <h2 id="where-heading">Where each piece runs.</h2>
                <p>
                  A hosted dashboard cannot hold a Slack connection open, and it should
                  never hold your tokens. So the daemon stays local and this site only sends
                  it commands from your browser.
                </p>
              </div>
              <div className={styles.diagram}>
                <div className={styles.machine}>
                  <div className={styles.diagramHead}>
                    <span className={styles.diagramDot} aria-hidden="true" />
                    Your machine
                  </div>
                  <ul>
                    <li>
                      <Check width={13} height={13} /> Tokens in a 0600 config
                    </li>
                    <li>
                      <Check width={13} height={13} /> The long-lived daemon
                    </li>
                    <li>
                      <Check width={13} height={13} /> The Slack WebSocket
                    </li>
                  </ul>
                </div>
                <div className={styles.connector} aria-hidden="true">
                  <span />
                  <ArrowRight width={16} height={16} />
                </div>
                <div className={styles.hosted}>
                  <div className={styles.diagramHead}>
                    <span className={styles.diagramHollow} aria-hidden="true" />
                    This Vercel site
                  </div>
                  <ul>
                    <li>
                      <Check width={13} height={13} /> Interface and documentation
                    </li>
                    <li>
                      <Check width={13} height={13} /> Live controls, once paired with your daemon
                    </li>
                    <li>
                      <Lock width={13} height={13} /> No tokens, never talks to Slack
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <section className={styles.stepsSection} aria-labelledby="steps-heading">
              <div className={styles.stepsHead}>
                <h2 id="steps-heading">A short setup.</h2>
                <p>Four steps, all local after the clone. Stop at any point — nothing starts until you do.</p>
              </div>
              <ol className={styles.steps}>
                {steps.map((step, index) => (
                  <li key={step.id} className={styles.step} id={step.id}>
                    <div className={styles.stepNumber} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className={styles.stepBody}>
                      <h3>{step.title}</h3>
                      {step.body}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className={styles.security} id="security" aria-labelledby="security-heading">
              <div className={styles.securityHead}>
                <span className={styles.securityTag}>
                  <Shield width={14} height={14} />
                  Security notes
                </span>
                <h2 id="security-heading">The security model, plainly.</h2>
                <p>
                  No account, no relay, no telemetry. The trade-off is that the tokens are
                  powerful, so the local file and machine matter.
                </p>
              </div>
              <div className={styles.securityGrid}>
                {securityNotes.map((note) => {
                  const Icon = note.icon;
                  return (
                    <article key={note.title} className={styles.securityCard}>
                      <Icon width={17} height={17} />
                      <h3>{note.title}</h3>
                      <p>{note.body}</p>
                    </article>
                  );
                })}
              </div>
              <div className={styles.never}>
                <h3>What Stillgreen never does</h3>
                <ul>
                  <li>Request your password, OAuth code, or Slack sign-in</li>
                  <li>Send tokens to Vercel or any third-party service</li>
                  <li>Accept connections from other machines (it listens only on 127.0.0.1)</li>
                  <li>Override a manual away status you set in Slack</li>
                </ul>
              </div>
            </section>

            <section className={styles.trouble} aria-labelledby="trouble-heading">
              <h2 id="trouble-heading">If something goes wrong.</h2>
              <details>
                <summary>Slack rejected the tokens</summary>
                <p>
                  Sign in at app.slack.com and press <strong>Capture from Slack</strong> in
                  the extension again, or run <code>sg-local add</code> with a fresh{" "}
                  <code>xoxc</code> and <code>xoxd</code>. Web sessions expire; signing out
                  of Slack invalidates them immediately.
                </p>
              </details>
              <details>
                <summary>The daemon starts but presence does not change</summary>
                <p>
                  Run <code>sg-local doctor --check-tokens</code>. Check that the schedule
                  window includes now and that you have not set a manual away in Slack.{" "}
                  <code>sg-local status</code> shows the next change.
                </p>
              </details>
              <details>
                <summary>The dot goes away when my laptop sleeps</summary>
                <p>
                  A suspended machine cannot keep a connection alive. Use an always-on
                  machine, or keep the laptop awake with <code>caffeinate</code> while the
                  window is active. This follows your employer&apos;s policy, not around it.
                </p>
              </details>
            </section>
          </div>

          <aside className={styles.aside} aria-label="Setup overview">
            <div className={styles.asideCard}>
              <h2>Before you start</h2>
              <ul className={styles.checklist}>
                <li>
                  <Check width={14} height={14} />
                  Python 3.11 or newer
                </li>
                <li>
                  <Check width={14} height={14} />
                  <code>websockets</code> installed
                </li>
                <li>
                  <Check width={14} height={14} />
                  Slack web access in a desktop browser
                </li>
                <li>
                  <Check width={14} height={14} />
                  Permission to automate this workspace
                </li>
              </ul>
              <p className={styles.asideNote}>
                Stillgreen is not affiliated with Slack. Automating presence may be
                against your workspace policy.
              </p>
            </div>

            <div className={styles.asideCard}>
              <h2>Daily commands</h2>
              <dl className={styles.commandList}>
                <div>
                  <dt>Pause for two hours</dt>
                  <dd>
                    <code>sg-local pause --for 2h</code>
                  </dd>
                </div>
                <div>
                  <dt>Resume</dt>
                  <dd>
                    <code>sg-local resume</code>
                  </dd>
                </div>
                <div>
                  <dt>Stay online once</dt>
                  <dd>
                    <code>sg-local stay 90m</code>
                  </dd>
                </div>
                <div>
                  <dt>See what is happening</dt>
                  <dd>
                    <code>sg-local status</code>
                  </dd>
                </div>
              </dl>
            </div>

            <div className={styles.asideDark}>
              <Github width={19} height={19} />
              <h2>Read the source.</h2>
              <p>
                The daemon, schedule logic, and tests are in the same public repository as
                this interface.
              </p>
              <a
                href="https://github.com/laxmideepak/slack"
                target="_blank"
                rel="noreferrer"
                className={styles.asideLink}
              >
                github.com/laxmideepak/slack
                <ArrowUpRight width={14} height={14} />
              </a>
            </div>
          </aside>
        </div>

        <section className={styles.closing}>
          <div className={`container ${styles.closingInner}`}>
            <div>
              <h2>Set it up once. Then close the tab.</h2>
              <p>The daemon keeps the schedule; you keep the rest of your day.</p>
            </div>
            <div className={styles.closingActions}>
              <a
                href="https://github.com/laxmideepak/slack"
                target="_blank"
                rel="noreferrer"
                className="button buttonPrimary"
              >
                Clone the repository
                <ArrowUpRight width={16} height={16} />
              </a>
              <Link href="/dashboard" className="button buttonSecondary">
                Preview the dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
