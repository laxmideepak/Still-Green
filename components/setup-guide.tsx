import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight, Check, ChevronDown, Clock, Cloud, Info, Laptop, Shield, Trash } from "./icons";
import { Banner, Button, CodeBlock, Kbd } from "./ui";
import { DocsNav, type DocsNavItem } from "./setup/docs-nav";
import { AI_SETUP_PROMPT } from "@/lib/ai-setup";
import { CopyPromptButton } from "./copy-prompt";
import { BREW_INSTALL, BREW_TAP, BREW_TRUST, CLOUD_GUIDE_URL, GITHUB_URL, ISSUES_URL } from "@/lib/site";
import docs from "./setup/docs.module.css";
import styles from "./setup-guide.module.css";

const REPO_GIT = `${GITHUB_URL}.git`;
const LOCAL_URL = "http://127.0.0.1:8765";

const navItems: DocsNavItem[] = [
  { id: "install", label: "Install", number: "1" },
  { id: "start", label: "Start", number: "2" },
  { id: "add-slack", label: "Add your Slack", number: "3" },
  { id: "dashboard", label: "Dashboard", number: "4" },
  { id: "troubleshooting", label: "Troubleshooting", icon: <Info /> },
  { id: "cloud", label: "Always on (cloud)", icon: <Cloud /> },
  { id: "remove", label: "Remove", icon: <Trash /> },
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

/** A closed section the reader opens when they need it. */
function More({ id, title, children }: { id?: string; title: ReactNode; children: ReactNode }) {
  return (
    <details id={id} className={styles.more}>
      <summary>
        <span>{title}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={`${docs.prose} ${styles.moreBody}`}>{children}</div>
    </details>
  );
}

/** An extra section after the steps, marked with an icon instead of a number. */
function Extra({
  id,
  icon,
  title,
  lead,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={docs.section} aria-labelledby={`${id}-title`}>
      <div className={docs.sectionHead}>
        <span className={docs.stepNumber} aria-hidden="true">
          {icon}
        </span>
        <h2 id={`${id}-title`} className={docs.h2}>
          {title}
        </h2>
      </div>
      {lead && <p className={docs.sectionLead}>{lead}</p>}
      <div className={`${docs.prose} ${styles.stepBody}`}>{children}</div>
    </section>
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
            <p className={docs.eyebrow}>Setup guide</p>
            <h1 className={docs.title}>Set up Stillgreen</h1>
            <p className={docs.lead}>
              Four short steps, from install to showing as active. Stillgreen runs on your own computer, so your Slack
              login stays with you.
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
                <Shield />
                Free, no account
              </li>
            </ul>
          </div>
        </header>

        <div className={`container ${docs.layout}`}>
          <aside className={docs.aside}>
            <DocsNav items={navItems} label="Steps" />
          </aside>

          <div className={docs.content}>
            <Step id="install" number="1" title="Install" lead="On a Mac with Homebrew, run these three commands.">
              <div className={docs.commands}>
                <Cmd code={BREW_TAP} label="Copy the Homebrew tap command" />
                <Cmd code={BREW_TRUST} label="Copy the Homebrew trust command" />
                <Cmd code={BREW_INSTALL} />
              </div>
              <p className={docs.small}>
                The second command tells Homebrew you trust this source. If yours says <code>trust</code> is an unknown
                command, skip it. With Homebrew, type <code>sg-local</code> where this guide says{" "}
                <code>./sg-local</code>.
              </p>

              <div className={styles.moreGroup}>
                <More id="ai" title="Let an AI assistant do it">
                  <p>
                    Copy the prompt and paste it into Claude, ChatGPT, Cursor or Copilot. It walks you through these same
                    steps. Claude Code, Cursor and Codex can run them for you; in a browser chat, you run each step in
                    Terminal and paste back what it prints.
                  </p>
                  <div className={styles.promptActions}>
                    <CopyPromptButton />
                  </div>
                  <details className={styles.promptDetails}>
                    <summary>Show the prompt</summary>
                    <CodeBlock code={AI_SETUP_PROMPT} copyLabel="Copy the AI setup prompt" className={styles.aiPrompt} />
                  </details>
                  <p className={docs.small}>
                    Never paste your Slack token (<code>xoxc-...</code>), the <code>d</code> cookie (
                    <code>xoxd-...</code>) or your access code into any chat. The prompt tells the assistant not to ask
                    for them. You still add Slack yourself, in step 3.
                  </p>
                </More>

                <More title="Without Homebrew (Mac or Linux)">
                  <ul className={docs.checklist} aria-label="What you need">
                    <li>
                      <Check />
                      <span>Python 3.9 or newer. Macs already have it.</span>
                    </li>
                    <li>
                      <Check />
                      <span>Chrome, Edge or Brave</span>
                    </li>
                  </ul>
                  <div className={docs.commands}>
                    <Cmd code={`git clone ${REPO_GIT}`} label="Copy the download command" />
                    <Cmd code="cd Still-Green" />
                    <Cmd code="./sg-local --version" />
                  </div>
                  <p>
                    The first run sets up a private <code>.venv</code> folder inside <code>Still-Green</code> with the
                    exact package versions Stillgreen was tested with. It takes about a minute and needs the internet
                    once. Nothing is installed system-wide, and you don&apos;t need <code>pip</code> or{" "}
                    <code>sudo</code>.
                  </p>
                  <p className={docs.small}>
                    On a new Mac, <code>git</code> or <code>python3</code> may first ask to install the developer tools.
                    Click <strong>Install</strong>, then run the command again. Optional: run <code>./install.sh</code>{" "}
                    so you can type <code>sg-local</code> from any folder.
                  </p>
                </More>
              </div>
            </Step>

            <Step id="start" number="2" title="Start" lead="Start Stillgreen and open its control page.">
              <Cmd code="./sg-local web --daemon --open" />
              <p>
                The control page opens at <code>{LOCAL_URL}</code> and shows your <strong>access code</strong> (it looks
                like <code>SG-ABCD-EFGH-JKLM</code>). You need it in the next step. You can close the terminal;
                Stillgreen keeps running.
              </p>
              <div className={styles.moreGroup}>
                <More title="Start it at every login">
                  <p>
                    With Homebrew: <code>brew services start stillgreen</code>. Otherwise, on a Mac:
                  </p>
                  <Cmd code="./sg-local install-launchd" />
                  <p className={docs.small}>
                    Lost the access code? Run <code>./sg-local web --show-code</code>. To stop Stillgreen, run{" "}
                    <code>./sg-local stop</code>.
                  </p>
                </More>
              </div>
            </Step>

            <Step
              id="add-slack"
              number="3"
              title="Add your Slack"
              lead="The Chrome extension sends your Slack login to your own Stillgreen in one click."
            >
              <ol className={docs.list}>
                <li>
                  <p>
                    Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).
                  </p>
                </li>
                <li>
                  <p>
                    Click <strong>Load unpacked</strong> and choose the <code>extension</code> folder. It&apos;s inside{" "}
                    <code>Still-Green</code>, or wherever Homebrew printed it.
                  </p>
                </li>
                <li>
                  <p>
                    Click the Stillgreen icon in the toolbar. Leave the address as <code>{LOCAL_URL}</code> and paste
                    your access code.
                  </p>
                </li>
                <li>
                  <p>
                    Sign in at <Ext href="https://app.slack.com">app.slack.com</Ext> in the same window, then click{" "}
                    <strong>Capture from Slack</strong>.
                  </p>
                </li>
              </ol>
              <p>
                The workspace shows up on the control page within seconds. About a minute later,{" "}
                <strong>Presence confirmed</strong> turns green.
              </p>
              <p className={docs.small}>
                The extension reads your Slack session token and the &ldquo;d&rdquo; cookie, which let Stillgreen act as
                you in Slack. They go only to your own Stillgreen, never to this website. See the{" "}
                <Link href="/privacy">privacy policy</Link>.
              </p>

              <div className={styles.moreGroup}>
                <More id="tokens" title="Add Slack without the extension">
                  <p>Run this, then paste two values when it asks. What you paste stays hidden.</p>
                  <Cmd code="./sg-local add" />
                  <ol className={docs.list}>
                    <li>
                      <p>
                        Open your workspace at <Ext href="https://app.slack.com">app.slack.com</Ext> in Chrome and sign
                        in.
                      </p>
                    </li>
                    <li>
                      <p>
                        Open DevTools (<Kbd>Cmd</Kbd> <Kbd>Option</Kbd> <Kbd>I</Kbd> on a Mac, <Kbd>Ctrl</Kbd>{" "}
                        <Kbd>Shift</Kbd> <Kbd>I</Kbd> elsewhere), go to the <strong>Network</strong> tab and reload.
                      </p>
                    </li>
                    <li>
                      <p>
                        <strong>Token:</strong> type <code>api</code> in the filter box, click a request such as{" "}
                        <code>client.boot</code>, open <strong>Payload</strong> and copy the <code>token</code> value
                        (it starts with <code>xoxc-</code>).
                      </p>
                    </li>
                    <li>
                      <p>
                        <strong>Cookie:</strong> in <strong>Application → Cookies → https://app.slack.com</strong>,
                        copy the cookie named <code>d</code> (it starts with <code>xoxd-</code>).
                      </p>
                    </li>
                  </ol>
                  <Banner tone="warning" title="Treat these like a password">
                    Both values give full access to your Slack account. Never paste them into a website, chat, issue or
                    screenshot. To end them, remove the workspace in Stillgreen, then in Slack use{" "}
                    <strong>Sign out of all other sessions</strong>.
                  </Banner>
                </More>
              </div>
            </Step>

            <Step
              id="dashboard"
              number="4"
              title="Open the dashboard"
              lead="Optional. The control page already has every control; the dashboard is the same, on this website."
            >
              <p>
                Open the <Link href="/dashboard">dashboard</Link>, click <strong>Connect Stillgreen</strong>, and enter{" "}
                <code>{LOCAL_URL}</code> and your access code. Your browser remembers both. It talks to your Stillgreen
                directly; your Slack login never comes to this website.
              </p>
              <div>
                <Button href="/dashboard" iconRight={<ArrowRight />}>
                  Open dashboard
                </Button>
              </div>
              <p className={docs.small}>
                On a laptop, Stillgreen stops when the computer sleeps. Slack decides your final status; this uses your
                web session, so it may stop working if Slack changes, and your workplace may not allow it.
              </p>
            </Step>

            <Extra
              id="troubleshooting"
              icon={<Info />}
              title="Troubleshooting"
              lead={
                <>
                  First, click <strong>Check my setup</strong> on the dashboard or control page, or run{" "}
                  <code>./sg-local doctor</code>. It tells you what to do.
                </>
              }
            >
              <div className={styles.moreGroup}>
                {troubles.map((row, i) => (
                  <More key={i} title={row.problem}>
                    <p>{row.fix}</p>
                  </More>
                ))}
              </div>
              <p>
                Still stuck? <Ext href={ISSUES_URL}>Report a problem on GitHub</Ext> and attach the report from{" "}
                <code className={docs.wrap}>./sg-local doctor --report stillgreen-report.txt</code>. It leaves out your
                tokens and access code, but read it first.
              </p>
            </Extra>

            <Extra
              id="cloud"
              icon={<Cloud />}
              title="Keep it on all the time (cloud)"
              lead="Advanced and optional. Run Stillgreen on a small server that never sleeps, so it works with your laptop closed."
            >
              <div className={styles.moreGroup}>
                <More title="Show the Google Cloud steps (about 15 minutes)">
                  <Banner tone="warning" title="Before you choose the cloud">
                    <ul className={docs.bullets}>
                      <li>Google Cloud needs a card on file, even for the free e2-micro server.</li>
                      <li>Going past the free limits, or keeping a static IP address, can cost money.</li>
                      <li>You keep the server updated and secure.</li>
                      <li>
                        Your Slack session lives on that server. If someone breaks into it, they can act as you in
                        Slack.
                      </li>
                    </ul>
                  </Banner>
                  <ol className={docs.list}>
                    <li>
                      <p>
                        Open{" "}
                        <Ext href="https://console.cloud.google.com/compute/instances">Google Cloud → VM instances</Ext>{" "}
                        and click <strong>Create instance</strong>.
                      </p>
                    </li>
                    <li>
                      <p>
                        Pick <strong>Region</strong> <code>us-central1</code> (or <code>us-west1</code> or{" "}
                        <code>us-east1</code>) and <strong>Machine type</strong> <code>e2-micro</code>. Only these
                        regions are free.
                      </p>
                    </li>
                    <li>
                      <p>
                        Under <strong>Boot disk</strong>, click <strong>Change</strong> and choose{" "}
                        <strong>Standard persistent disk</strong>. Keep Debian and 10 GB. The default
                        &ldquo;Balanced&rdquo; disk is not free.
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
                        Click <strong>SSH</strong> next to the new instance and run:
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
                      <p>It prints an address and an access code, like:</p>
                      <CodeBlock noCopy code={"Address:      https://34-1-2-3.sslip.io\nAccess code:  SG-ABCD-EFGH-JKLM"} />
                    </li>
                    <li>
                      <p>
                        Use them in the dashboard and the extension instead of <code>{LOCAL_URL}</code>, then click{" "}
                        <strong>Capture from Slack</strong> as usual.
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
                      <p>To update later, run this in the <code>Still-Green</code> folder on the server:</p>
                      <Cmd code="git pull && sudo docker compose up -d --build" label="Copy the update command" />
                    </li>
                    <li>
                      <p>
                        The address changes if you stop and start the server (<code>sudo reboot</code> keeps it). Run{" "}
                        <code>sudo sh deploy/setup-vm.sh</code> again and update the address in the dashboard and the
                        extension.
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
                </More>
              </div>
            </Extra>

            <Extra
              id="remove"
              icon={<Trash />}
              title="Remove Stillgreen"
              lead="Stop it, delete your saved Slack logins, and end the Slack session."
            >
              <ol className={docs.list}>
                <li>
                  <p>Run this. It stops Stillgreen and deletes its settings, logs and saved logins. It asks first.</p>
                  <Cmd code="./sg-local uninstall" />
                </li>
                <li>
                  <p>
                    In Slack, use <strong>Sign out of all other sessions</strong> to end the session Stillgreen used.
                  </p>
                </li>
                <li>
                  <p>
                    Remove the extension in <code>chrome://extensions</code>. Then delete the <code>Still-Green</code>{" "}
                    folder, or run <code>brew uninstall stillgreen</code>.
                  </p>
                </li>
              </ol>
              <p className={docs.small}>
                On a cloud server, run <code>sudo docker compose down -v</code> in the folder, then delete the server.
              </p>
            </Extra>

            <nav className={docs.next} aria-label="Next">
              <Link href="/start" className={docs.nextLink}>
                <span className={docs.nextKicker}>Reference</span>
                <span className={docs.nextTitle}>
                  Commands
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
