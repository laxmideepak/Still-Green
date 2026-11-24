import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight, Check, Clock, Info, Laptop, Lock, Shield, Terminal } from "./icons";
import { Badge, Banner, Button, CodeBlock, Kbd } from "./ui";
import { DocsNav, type DocsNavItem } from "./setup/docs-nav";
import { AI_SETUP_PROMPT } from "@/lib/ai-setup";
import { CopyPromptButton } from "./copy-prompt";
import { BREW_INSTALL, BREW_TAP, BREW_TRUST, CLOUD_GUIDE_URL, GITHUB_URL, ISSUES_URL } from "@/lib/site";
import docs from "./setup/docs.module.css";
import styles from "./setup-guide.module.css";

const REPO_GIT = `${GITHUB_URL}.git`;
const LOCAL_URL = "http://127.0.0.1:8765";

const navItems: DocsNavItem[] = [
  { id: "ai", label: "Set up with AI", icon: <Terminal /> },
  { id: "install", label: "Install", number: "1" },
  { id: "start", label: "Start", number: "2" },
  { id: "add-slack", label: "Add your Slack", number: "3" },
  { id: "dashboard", label: "Connect the dashboard", number: "4" },
  { id: "cloud", label: "Cloud (advanced)", number: "5" },
  { id: "remove", label: "Remove Stillgreen", icon: <Lock /> },
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
        <code>./sg-local</code> says Python is too old, or can&apos;t find Python
      </>
    ),
    fix: (
      <>
        Stillgreen needs Python 3.9 or newer. On a Mac, run <code>python3 --version</code>; if macOS offers to install
        the developer tools, click <strong>Install</strong>. Or install Python from{" "}
        <Ext href="https://www.python.org/downloads/">python.org</Ext>, then run <code>./sg-local</code> again.
      </>
    ),
  },
  {
    problem: "Stillgreen couldn't set itself up",
    fix: (
      <>
        The first run downloads two small packages, so it needs the internet once. The full message is in{" "}
        <code>.venv-setup.log</code> in the Stillgreen folder. Fix what it says, then run <code>./sg-local</code> again.
      </>
    ),
  },
  {
    problem: "Could not make a secure connection to Slack (certificate)",
    fix: (
      <>
        Your network may check secure traffic with its own certificate (common on work computers and VPNs). Run{" "}
        <code>./sg-local doctor</code> to see where Stillgreen looks for certificates. With Python 3.10 or newer it
        uses the same certificates as your Mac. Ask your IT team for the company certificate if needed. Stillgreen
        never turns the certificate check off.
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
        A sleeping computer can&apos;t keep the connection open. To keep it running with the lid closed, you can{" "}
        <a href="#cloud">run Stillgreen in the cloud</a> (advanced).
      </>
    ),
  },
  {
    problem: (
      <>
        The dashboard says <strong>Connected · waiting for Slack to confirm</strong>
      </>
    ),
    fix: "Stillgreen has a live connection and asks Slack about once a minute. If it stays like this for more than a few minutes, Slack may not be counting the connection. Slack decides your final status.",
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
              Stillgreen runs on your own computer. This guide takes you from download to a working setup. Slack
              decides your final status; the dashboard shows when Slack confirms it.
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
                Python 3.9 or newer
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
              <CopyPromptButton />
            </div>
          </div>
        </header>

        <div className={`container ${docs.layout}`}>
          <aside className={docs.aside}>
            <DocsNav items={navItems} label="Steps" />
          </aside>

          <div className={docs.content}>
            <section id="ai" className={docs.section} aria-labelledby="ai-title">
              <div className={docs.sectionHead}>
                <span className={docs.stepNumber} aria-hidden="true">
                  <Terminal />
                </span>
                <h2 id="ai-title" className={docs.h2}>
                  Set up with an AI assistant
                </h2>
              </div>
              <p className={docs.sectionLead}>
                Prefer help? Copy the prompt and paste it into Claude, ChatGPT, Cursor or Copilot. It walks you through
                the same steps as this guide.
              </p>
              <div className={`${docs.prose} ${styles.stepBody}`}>
                <div className={styles.promptActions}>
                  <CopyPromptButton />
                </div>
                <details className={styles.promptDetails}>
                  <summary>Show the prompt</summary>
                  <CodeBlock code={AI_SETUP_PROMPT} copyLabel="Copy the AI setup prompt" className={styles.aiPrompt} />
                </details>
                <ul className={docs.bullets}>
                  <li>
                    <strong>Claude Code, Cursor or Codex</strong> can run the steps for you. Paste the prompt and
                    approve each step.
                  </li>
                  <li>
                    <strong>ChatGPT or Claude</strong> in the browser give you one step at a time. Run it in Terminal
                    and paste back what it prints.
                  </li>
                  <li>You still add Slack yourself with the Chrome extension (step 3).</li>
                </ul>
                <Banner tone="warning" title="Keep your Slack login out of the chat">
                  Never paste your Slack token (<code>xoxc-...</code>), the <code>d</code> cookie (
                  <code>xoxd-...</code>) or your access code into any AI chat. The prompt tells the assistant not to ask
                  for them.
                </Banner>
              </div>
            </section>

            <Step
              id="install"
              number="1"
              title="Install"
              lead="Download Stillgreen. It sets itself up the first time you run it."
            >
              <ul className={docs.checklist} aria-label="What you need">
                <li>
                  <Check />
                  <span>A Mac or Linux computer</span>
                </li>
                <li>
                  <Check />
                  <span>Python 3.9 or newer. Macs already have it.</span>
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
              <h3 className={docs.h3}>On a Mac with Homebrew (easiest)</h3>
              <p>
                If you use <Ext href="https://brew.sh">Homebrew</Ext>, run these one at a time. Homebrew installs
                Python and everything else for you.
              </p>
              <div className={docs.commands}>
                <Cmd code={BREW_TAP} label="Copy the Homebrew tap command" />
                <Cmd code={BREW_TRUST} label="Copy the Homebrew trust command" />
                <Cmd code={BREW_INSTALL} />
              </div>
              <p className={docs.small}>
                The second command tells Homebrew you trust this source; newer Homebrew asks for it once. If yours
                says <code>trust</code> is an unknown command, skip it. Then type <code>sg-local</code> wherever this
                guide says <code>./sg-local</code>. Homebrew prints where the Chrome extension folder is. To start
                Stillgreen at every login, use <code>brew services start stillgreen</code>.
              </p>
              <h3 className={docs.h3}>Without Homebrew</h3>
              <p>Run these one at a time:</p>
              <div className={docs.commands}>
                <Cmd code={`git clone ${REPO_GIT}`} label="Copy the download command" />
                <Cmd code="cd Still-Green" />
                <Cmd code="./sg-local --version" />
              </div>
              <p>
                The first run sets up a private Python environment in a <code>.venv</code> folder inside{" "}
                <code>Still-Green</code>, with the exact package versions Stillgreen was tested with. It takes about a
                minute and needs the internet once. Nothing is installed system-wide and you don&apos;t need{" "}
                <code>pip</code> or <code>sudo</code>. After that, <code>./sg-local</code> starts at once.
              </p>
              <p className={docs.small}>
                On a new Mac, <code>git</code> or <code>python3</code> may first ask to install the developer tools.
                Click <strong>Install</strong>, then run the command again. Stillgreen uses Python 3.10 or newer if you
                have it, otherwise the Mac&apos;s own Python 3.9. Optional: run <code>./install.sh</code> so you can type{" "}
                <code>sg-local</code> from any folder.
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
              <Banner tone="info" title="What you are sharing">
                The extension reads your Slack session token and the &ldquo;d&rdquo; cookie. Together they let
                Stillgreen act as you in Slack, like being signed in. They go only to your own Stillgreen, never to this
                website. The first time, the extension explains this and asks you to agree. Read the{" "}
                <Link href="/privacy">privacy policy</Link>.
              </Banner>
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
                    Click <strong>Capture from Slack</strong>. The first time, read what the extension shares and click{" "}
                    <strong>I understand, continue</strong>.
                  </p>
                </li>
              </ol>
              <p>
                The extension sends your Slack login to your Stillgreen, which checks it with Slack. The workspace shows up
                on the control page within a few seconds. About a minute later, <strong>Presence confirmed</strong> turns
                green when Slack&apos;s own status check says you are active. Signed in to more than one workspace? They
                are all added at once.
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
                screenshot. Stillgreen keeps them only on your computer and sends them only to Slack. To end them,
                remove the workspace in Stillgreen, then in Slack use <strong>Sign out of all other sessions</strong>.
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
                That&apos;s it. While Stillgreen runs, it keeps a connection open like the Slack web app, which helps
                keep you active. The dashboard shows when Slack confirms it. On a laptop, Stillgreen stops when the
                computer sleeps.
              </p>
              <p className={docs.small}>
                Slack&apos;s official API can&apos;t force a person to be active, so this uses your web session. It may
                stop working if Slack changes, and your workspace may not allow it.
              </p>
              <h3 className={docs.h3}>Check my setup</h3>
              <p>
                If something isn&apos;t working, click <strong>Check my setup</strong> on the dashboard or the control
                page. It tests Python, your settings, the network, the certificate check, your clock and each
                workspace, and tells you what to do. In a terminal, run:
              </p>
              <div className={docs.commands}>
                <Cmd code="./sg-local doctor" />
                <Cmd code="./sg-local doctor --report stillgreen-report.txt" label="Copy the report command" />
              </div>
              <p className={docs.small}>
                The report has no passwords, Slack tokens, cookies or access code. Read it before you share it.
              </p>
            </Step>

            <Step
              id="cloud"
              number="5"
              title="Run it in the cloud (advanced)"
              lead="Optional. Keep Stillgreen on a small server that never sleeps. Only do this if you are comfortable looking after a server."
            >
              <Banner tone="warning" title="Before you choose the cloud">
                <ul className={docs.bullets}>
                  <li>Google Cloud needs a card on file, even for the free e2-micro server.</li>
                  <li>The free tier has limits. Going past them, or keeping a static IP address, can cost money.</li>
                  <li>The server&apos;s address can change when it stops and starts.</li>
                  <li>You keep the server updated and secure.</li>
                  <li>
                    Your Slack session lives on that server. If someone breaks into it, they can act as you in Slack.
                    That is more risk than keeping it on your own computer.
                  </li>
                </ul>
              </Banner>
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
                    <Cmd code={`git clone ${REPO_GIT} && cd Still-Green`} label="Copy the server download command" />
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

            <section id="remove" className={docs.section} aria-labelledby="remove-title">
              <div className={docs.sectionHead}>
                <span className={docs.stepNumber} aria-hidden="true">
                  <Lock />
                </span>
                <h2 id="remove-title" className={docs.h2}>
                  Remove Stillgreen
                </h2>
              </div>
              <p className={docs.sectionLead}>Stop it, delete your saved Slack logins, and end the Slack sessions.</p>
              <div className={`${docs.prose} ${styles.stepBody}`}>
                <ol className={docs.list}>
                  <li>
                    <p>In the Stillgreen folder, run this. It stops Stillgreen and deletes its settings, logs and saved Slack logins. It asks first.</p>
                    <Cmd code="./sg-local uninstall" />
                  </li>
                  <li>
                    <p>
                      In Slack, open your profile, then <strong>Settings</strong> (or your account page) and click{" "}
                      <strong>Sign out of all other sessions</strong>. This ends the session Stillgreen used.
                    </p>
                  </li>
                  <li>
                    <p>
                      In Chrome, open <code>chrome://extensions</code> and click <strong>Remove</strong> on Stillgreen.
                      Then delete the <code>Still-Green</code> folder.
                    </p>
                  </li>
                </ol>
                <p className={docs.small}>
                  On a cloud server, run <code>sudo docker compose down -v</code> in the folder, then delete the server.
                  More in the <Link href="/privacy">privacy policy</Link>.
                </p>
              </div>
            </section>

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
                <p>
                  Click <strong>Check my setup</strong> on the dashboard, or check the setup in a terminal and read the
                  log:
                </p>
                <div className={docs.commands}>
                  <Cmd code="./sg-local doctor --check-tokens" />
                  <Cmd code="./sg-local logs -f" />
                </div>
                <p>
                  Still stuck? <Ext href={ISSUES_URL}>Report a problem on GitHub</Ext> and attach the report from{" "}
                  <strong>Download report</strong> (or{" "}
                  <code className={docs.wrap}>./sg-local doctor --report stillgreen-report.txt</code>).
                  It leaves out your tokens and access code, but read it first. Never paste tokens.
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
