import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight, Check, Clock, Github, Info, Laptop, Shield, Terminal } from "./icons";
import { Badge, Banner, Button, CodeBlock, Kbd } from "./ui";
import { DocsNav, type DocsNavItem } from "./setup/docs-nav";
import { CLOUD_GUIDE_URL, GITHUB_URL, ISSUES_URL } from "@/lib/site";
import docs from "./setup/docs.module.css";
import styles from "./setup-guide.module.css";

const REPO_GIT = `${GITHUB_URL}.git`;
const LOCAL_URL = "http://127.0.0.1:8765";

const navItems: DocsNavItem[] = [
  { id: "install", label: "Install", number: "1" },
  { id: "start", label: "Start", number: "2" },
  { id: "add-slack", label: "Add your Slack", number: "3" },
  { id: "dashboard", label: "Connect the dashboard", number: "4" },
  { id: "cloud", label: "Run it in the cloud", number: "5" },
  { id: "troubleshooting", label: "Troubleshooting", icon: <Info /> },
];

/** A command with a copy button. The "$" prompt is not copied. */
function Cmd({ code, label }: { code: string; label?: string }) {
  return <CodeBlock prompt="$" code={code} copyLabel={label ?? `Copy: ${code}`} />;
}

/** A link to another site. Opens in a new tab. */
function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Step({
  id,
  number,
  title,
  lead,
  children,
}: {
  id: string;
  number: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={docs.section} aria-labelledby={`${id}-title`}>
      <div className={docs.sectionHead}>
        <span className={docs.stepNumber} aria-hidden="true">
          {number}
        </span>
        <h2 id={`${id}-title`} className={docs.h2}>
          <span className="visually-hidden">Step {number}: </span>
          {title}
        </h2>
      </div>
      {lead && <p className={docs.sectionLead}>{lead}</p>}
      <div className={`${docs.prose} ${styles.stepBody}`}>{children}</div>
    </section>
  );
}

const troubles: Array<{ problem: ReactNode; fix: ReactNode }> = [
  {
    problem: (
      <>
        <code>No module named &apos;websockets&apos;</code>
      </>
    ),
    fix: (
      <>
        Install the one package Stillgreen needs:{" "}
        <code className={docs.wrap}>python3 -m pip install --user websockets</code>
      </>
    ),
  },
  {
    problem: "The dashboard can't reach Stillgreen",
    fix: (
      <>
        Start it with <code>./sg-local web --daemon --open</code>, then check that the Stillgreen address is{" "}
        <code>{LOCAL_URL}</code> (or your server&apos;s <code>https://</code> address).
      </>
    ),
  },
  {
    problem: "The access code isn't accepted",
    fix: (
      <>
        Print it again with <code>./sg-local web --show-code</code> and paste it. After 10 wrong codes in a minute, wait
        one minute before you try again.
      </>
    ),
  },
  {
    problem: "The dashboard says the origin is not allowed",
    fix: (
      <>
        You opened the dashboard from a different web address. Use{" "}
        <Ext href="https://stillgreen.vercel.app/dashboard">stillgreen.vercel.app/dashboard</Ext>, or start Stillgreen
        with <code className={docs.wrap}>SG_LOCAL_WEB_ORIGIN=https://your-address ./sg-local start</code>.
      </>
    ),
  },
  {
    problem: (
      <>
        Status says <strong>Signed out</strong>
      </>
    ),
    fix: (
      <>
        Your Slack login expired, for example because you signed out. Sign in at app.slack.com and click{" "}
        <strong>Capture from Slack</strong> in the extension again.
      </>
    ),
  },
  {
    problem: (
      <>
        Status says <strong>Away (set by you)</strong>
      </>
    ),
    fix: "You set yourself away in Slack. Stillgreen never changes that. Set yourself active in Slack when you're back.",
  },
  {
    problem: (
      <>
        Status says <strong>Off schedule</strong>
      </>
    ),
    fix: (
      <>
        It's outside the hours you chose. Use <strong>Keep me online</strong>, or change your schedule.
      </>
    ),
  },
  {
    problem: (
      <>
        The extension says <strong>No Slack token found</strong>
      </>
    ),
    fix: (
      <>
        Reload app.slack.com while you are signed in, then try again. Still nothing?{" "}
        <a href="#tokens">Add the workspace by hand</a>.
      </>
    ),
  },
  {
    problem: "I go away when my laptop sleeps",
    fix: (
      <>
        A sleeping computer can&apos;t keep the connection open. <a href="#cloud">Run Stillgreen in the cloud</a> to
        stay green with the lid closed.
      </>
    ),
  },
  {
    problem: (
      <>
        Cloud: the <code>https://</code> address doesn&apos;t open
      </>
    ),
    fix: (
      <>
        Check that ports 80 and 443 are open (on Google Cloud: <strong>Allow HTTP traffic</strong> and{" "}
        <strong>Allow HTTPS traffic</strong>) and run <code>sudo docker compose logs caddy</code> on the server. The
        first certificate can take a minute.
      </>
    ),
  },
];

export function SetupGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={docs.main}>
        <header className={docs.hero}>
          <div className={`container ${docs.heroInner}`}>
            <p className={docs.eyebrow}>
              <span>Setup guide</span>
            </p>
            <h1 className={docs.title}>Set up Stillgreen</h1>
            <p className={docs.lead}>
              Stillgreen runs on your own computer or your own cloud server. This guide takes you from download to a
              green dot in Slack.
            </p>
            <ul className={docs.facts} aria-label="At a glance">
              <li>
                <Clock />
                About 5 minutes
              </li>
              <li>
                <Laptop />
                macOS or Linux
              </li>
              <li>
                <Terminal />
                Python 3.11 or newer
              </li>
              <li>
                <Shield />
                Free, no account
              </li>
            </ul>
            <div className={docs.heroActions}>
              <Button href="/start" iconRight={<ArrowRight />}>
                Quick start
              </Button>
              <Button href={GITHUB_URL} variant="ghost" icon={<Github />}>
                GitHub
              </Button>
            </div>
          </div>
        </header>

        <div className={`container ${docs.layout}`}>
          <aside className={docs.aside}>
            <DocsNav items={navItems} label="Steps" />
          </aside>

          <div className={docs.content}>
            <Step
              id="install"
              number="1"
              title="Install"
              lead="Download Stillgreen and the one Python package it needs."
            >
              <ul className={docs.checklist} aria-label="What you need">
                <li>
                  <Check />
                  <span>A Mac or Linux computer</span>
                </li>
                <li>
                  <Check />
                  <span>Python 3.11 or newer</span>
                </li>
                <li>
                  <Check />
                  <span>Chrome, Edge or Brave</span>
                </li>
                <li>
                  <Check />
                  <span>A Slack workspace you can sign in to</span>
                </li>
              </ul>
              <p>Check your Python version first:</p>
              <Cmd code="python3 --version" />
              <p>Then run these one at a time:</p>
              <div className={docs.commands}>
                <Cmd code={`git clone ${REPO_GIT}`} label="Copy the download command" />
                <Cmd code="cd Still-Green" />
                <Cmd code="python3 -m pip install --user websockets" />
              </div>
              <p className={docs.small}>
                Optional: run <code>./install.sh</code> so you can type <code>sg-local</code> from any folder. This
                guide uses <code>./sg-local</code>, which works from inside the <code>Still-Green</code> folder.
              </p>
            </Step>

            <Step id="start" number="2" title="Start" lead="Start Stillgreen and open its control page.">
              <Cmd code="./sg-local web --daemon --open" />
              <p>
                The control page opens at <code>{LOCAL_URL}</code>. You can close the terminal; Stillgreen keeps
                running in the background.
              </p>
              <p>
                The page shows your <strong>access code</strong>. It looks like <code>SG-ABCD-EFGH-JKLM</code>. You need
                it in the next two steps. Lost it? Print it again:
              </p>
              <Cmd code="./sg-local web --show-code" />
              <h3 className={docs.h3}>Start it when you log in (macOS)</h3>
              <Cmd code="./sg-local install-launchd" />
              <p className={docs.small}>
                Without this, run <code>./sg-local web --daemon --open</code> again after a restart. To stop
                Stillgreen, run <code>./sg-local stop</code>.
              </p>
            </Step>

            <Step
              id="add-slack"
              number="3"
              title="Add your Slack"
              lead="Give Stillgreen your Slack login. The extension does it in one click."
            >
              <h3 className={docs.h3}>
                With the Chrome extension <Badge tone="success">Recommended</Badge>
              </h3>
              <ol className={docs.list}>
                <li>
                  <p>In Chrome, open the extensions page:</p>
                  <CodeBlock code="chrome://extensions" copyLabel="Copy the extensions page address" />
                </li>
                <li>
                  <p>
                    Turn on <strong>Developer mode</strong> (top right).
                  </p>
                </li>
                <li>
                  <p>
                    Click <strong>Load unpacked</strong> and choose the <code>extension</code> folder inside the{" "}
                    <code>Still-Green</code> folder.
                  </p>
                </li>
                <li>
                  <p>
                    Click the Stillgreen icon in the toolbar. Pin it from the puzzle-piece menu so it&apos;s easy to
                    find.
                  </p>
                </li>
                <li>
                  <p>
                    Leave <strong>Stillgreen address</strong> as <code>{LOCAL_URL}</code> and paste your access code.
                    It saves by itself.
                  </p>
                </li>
                <li>
                  <p>
                    Open <Ext href="https://app.slack.com">app.slack.com</Ext> in the same Chrome window and sign in.
                  </p>
                </li>
                <li>
                  <p>
                    Click <strong>Capture from Slack</strong>.
                  </p>
                </li>
              </ol>
              <p>
                The extension sends your Slack login to your Stillgreen, which checks it with Slack. The workspace shows up
                on the control page and turns <strong>Active</strong> within a few seconds. Signed in to more than one
                workspace? They are all added at once.
              </p>

              <h3 className={docs.h3} id="tokens">
                Without the extension
              </h3>
              <p>Run this, then paste two values when it asks. What you paste stays hidden.</p>
              <Cmd code="./sg-local add" />
              <ol className={docs.list}>
                <li>
                  <p>
                    Open your workspace at <Ext href="https://app.slack.com">app.slack.com</Ext> in Chrome and sign in.
                  </p>
                </li>
                <li>
                  <p>
                    Open DevTools (<Kbd>Cmd</Kbd> <Kbd>Option</Kbd> <Kbd>I</Kbd> on a Mac, <Kbd>Ctrl</Kbd>{" "}
                    <Kbd>Shift</Kbd> <Kbd>I</Kbd> elsewhere) and go to the <strong>Network</strong> tab. Reload the
                    page.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Token:</strong> type <code>api</code> in the filter box, click a request such as{" "}
                    <code>client.boot</code>, and open <strong>Payload</strong>. Copy the <code>token</code> value. It
                    starts with <code>xoxc-</code>.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Cookie:</strong> go to <strong>Application → Cookies → https://app.slack.com</strong> and
                    copy the value of the cookie named <code>d</code>. It starts with <code>xoxd-</code>.
                  </p>
                </li>
              </ol>
              <Banner tone="warning" title="Treat these like a password">
                Both values give full access to your Slack account. Never paste them into a website, chat, issue or
                screenshot. Stillgreen keeps them only on your computer and sends them only to Slack.
              </Banner>
            </Step>

            <Step
              id="dashboard"
              number="4"
              title="Connect the dashboard"
              lead="Optional. The control page already has every control; the dashboard is the same, on this website."
            >
              <ol className={docs.list}>
                <li>
                  <p>
                    Open the <Link href="/dashboard">dashboard</Link> and click <strong>Connect Stillgreen</strong>.
                  </p>
                </li>
                <li>
                  <p>
                    Enter the <strong>Stillgreen address</strong> <code>{LOCAL_URL}</code> and your{" "}
                    <strong>access code</strong>.
                  </p>
                </li>
              </ol>
              <p>Your browser remembers both, so you only do this once.</p>
              <Banner tone="info">
                Your browser talks to your Stillgreen directly. This website only shows the page, and your Slack login never
                goes to it.
              </Banner>
              <div>
                <Button href="/dashboard" iconRight={<ArrowRight />}>
                  Open dashboard
                </Button>
              </div>
              <p>
                That&apos;s it. Your status stays green while Stillgreen runs. On a laptop, it stops when the computer
                sleeps. To stay green with the lid closed, <a href="#cloud">run it in the cloud</a>.
              </p>
            </Step>

            <Step
              id="cloud"
              number="5"
              title="Run it in the cloud"
              lead="Keep Stillgreen on a small server that never sleeps. Google Cloud's e2-micro is free within its limits."
            >
              <p>
                Stillgreen keeps one connection to Slack open all the time. This website can show the dashboard, but it
                can&apos;t hold that connection, so Stillgreen needs an always-on server. Google Cloud asks for a card
                on file, but the e2-micro stays free within the limits. It takes about 15 minutes.
              </p>
              <ol className={docs.list}>
                <li>
                  <p>
                    Open{" "}
                    <Ext href="https://console.cloud.google.com/compute/instances">Google Cloud → VM instances</Ext> and
                    click <strong>Create instance</strong>.
                  </p>
                </li>
                <li>
                  <p>
                    Pick <strong>Region</strong> <code>us-central1</code> (or <code>us-west1</code> or{" "}
                    <code>us-east1</code>) and <strong>Machine type</strong> <code>e2-micro</code>. Only these regions
                    are free.
                  </p>
                </li>
                <li>
                  <p>
                    Under <strong>Boot disk</strong>, click <strong>Change</strong> and choose{" "}
                    <strong>Standard persistent disk</strong>. Keep Debian and 10 GB. The default &ldquo;Balanced&rdquo;
                    disk is not free.
                  </p>
                </li>
                <li>
                  <p>
                    Under <strong>Firewall</strong>, tick <strong>Allow HTTP traffic</strong> and{" "}
                    <strong>Allow HTTPS traffic</strong>. Then create the instance.
                  </p>
                </li>
                <li>
                  <p>
                    Click <strong>SSH</strong> next to the new instance. In the window that opens, run:
                  </p>
                  <div className={docs.commands}>
                    <Cmd
                      code="sudo apt-get update && sudo apt-get install -y git"
                      label="Copy the git install command"
                    />
                    <Cmd code={`git clone ${REPO_GIT} && cd Still-Green`} label="Copy the download command" />
                    <Cmd code="sudo sh deploy/setup-vm.sh" />
                  </div>
                </li>
                <li>
                  <p>
                    The script installs Docker, starts Stillgreen with a free HTTPS address made from the server&apos;s
                    IP, and prints something like:
                  </p>
                  <CodeBlock noCopy code={"Address:      https://34-1-2-3.sslip.io\nAccess code:  SG-ABCD-EFGH-JKLM"} />
                </li>
                <li>
                  <p>
                    Use that address and access code in the dashboard (<strong>Connect Stillgreen</strong>) and in the
                    extension, instead of <code>{LOCAL_URL}</code>. Then click <strong>Capture from Slack</strong> as
                    usual.
                  </p>
                </li>
              </ol>

              <h3 className={docs.h3}>Good to know</h3>
              <ul className={docs.bullets}>
                <li>
                  <p>Have your own domain? Point it at the server, then run:</p>
                  <Cmd code="sudo sh deploy/setup-vm.sh stillgreen.example.com" />
                </li>
                <li>
                  <p>
                    To update later, run this in the <code>Still-Green</code> folder on the server:
                  </p>
                  <Cmd code="git pull && sudo docker compose up -d --build" label="Copy the update command" />
                </li>
                <li>
                  <p>
                    The address changes if you stop and start the server (<code>sudo reboot</code> keeps it). If it
                    changes, run <code>sudo sh deploy/setup-vm.sh</code> again and update the Stillgreen address in
                    the dashboard and the extension.
                  </p>
                </li>
                <li>
                  <p>
                    Slack may sign out a session that runs from a data centre. If you keep seeing{" "}
                    <strong>Signed out</strong>, run Stillgreen at home instead.
                  </p>
                </li>
              </ul>
              <p>
                Other options, like Oracle Cloud and Fly.io, are in the{" "}
                <Ext href={CLOUD_GUIDE_URL}>full cloud guide on GitHub</Ext>.
              </p>
            </Step>

            <section id="troubleshooting" className={docs.section} aria-labelledby="troubleshooting-title">
              <div className={docs.sectionHead}>
                <span className={docs.stepNumber} aria-hidden="true">
                  <Info />
                </span>
                <h2 id="troubleshooting-title" className={docs.h2}>
                  Troubleshooting
                </h2>
              </div>
              <p className={docs.sectionLead}>What you might see, and what to do.</p>
              <div className={`${docs.prose} ${styles.stepBody}`}>
                <dl className={styles.trouble}>
                  {troubles.map((row, i) => (
                    <div key={i} className={styles.troubleRow}>
                      <dt>{row.problem}</dt>
                      <dd>{row.fix}</dd>
                    </div>
                  ))}
                </dl>
                <h3 className={docs.h3}>Anything else</h3>
                <p>Check the setup, then read the log:</p>
                <div className={docs.commands}>
                  <Cmd code="./sg-local doctor --check-tokens" />
                  <Cmd code="./sg-local logs -f" />
                </div>
                <p>
                  Still stuck? <Ext href={ISSUES_URL}>Report a problem on GitHub</Ext>. Never include your tokens.
                </p>
              </div>
            </section>

            <nav className={docs.next} aria-label="Next">
              <Link href="/start" className={docs.nextLink}>
                <span className={docs.nextKicker}>Next</span>
                <span className={docs.nextTitle}>
                  Quick start
                  <ArrowRight aria-hidden="true" />
                </span>
                <span className={docs.nextText}>Every sg-local command on one page.</span>
              </Link>
              <Link href="/dashboard" className={docs.nextLink}>
                <span className={docs.nextKicker}>Ready?</span>
                <span className={docs.nextTitle}>
                  Open the dashboard
                  <ArrowRight aria-hidden="true" />
                </span>
                <span className={docs.nextText}>See your status, schedule and workspaces.</span>
              </Link>
            </nav>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
