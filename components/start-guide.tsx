import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight, Cloud, Github, Grid, Laptop, Lock, Puzzle } from "./icons";
import { Button, Card, CardBody, CardHeader, CodeBlock } from "./ui";
import { DocsNav, type DocsNavItem } from "./setup/docs-nav";
import { CommandTable, type CommandRow } from "./start/command-table";
import { GITHUB_URL } from "@/lib/site";
import docs from "./setup/docs.module.css";
import styles from "./start-guide.module.css";

const LOCAL_URL = "http://127.0.0.1:8765";

const navItems: DocsNavItem[] = [
  { id: "quick-start", label: "Quick start" },
  { id: "commands", label: "Commands" },
  { id: "cmd-daemon", label: "Start and stop", sub: true },
  { id: "cmd-workspaces", label: "Workspaces", sub: true },
  { id: "cmd-schedule", label: "Schedule", sub: true },
  { id: "cmd-pause", label: "Pause and stay online", sub: true },
  { id: "cmd-check", label: "Check and fix", sub: true },
  { id: "formats", label: "Times and days" },
  { id: "files", label: "Your files" },
];

const groups: Array<{
  id: string;
  title: string;
  intro?: ReactNode;
  rows: CommandRow[];
}> = [
  {
    id: "cmd-daemon",
    title: "Start and stop",
    rows: [
      {
        command: "./sg-local start",
        description: "Start Stillgreen in the background. It also serves the control page.",
      },
      { command: "./sg-local stop", description: "Stop Stillgreen." },
      { command: "./sg-local restart", description: "Restart Stillgreen." },
      {
        command: "./sg-local status",
        description: "Show whether Stillgreen is running, the schedule, any pause, and each workspace.",
      },
      {
        command: "./sg-local web --daemon --open",
        description: "Start Stillgreen and open the control page.",
      },
      {
        command: "./sg-local web --show-code",
        description: "Print the access code.",
      },
      {
        command: "./sg-local install-launchd",
        description: "Start automatically when you log in (macOS).",
      },
      {
        command: "./sg-local uninstall-launchd",
        description: "Turn automatic start off again.",
      },
      {
        command: "./sg-local cloud",
        description: "Run Stillgreen and its control page on a server. The Docker setup uses this; put HTTPS in front.",
      },
    ],
  },
  {
    id: "cmd-workspaces",
    title: "Workspaces",
    rows: [
      {
        command: "./sg-local add",
        description: "Add or update a workspace. Paste the two Slack values when asked; they stay hidden.",
      },
      {
        command: "./sg-local add --name NAME",
        description: "The same, with a name you choose.",
      },
      {
        command: "./sg-local list",
        description: "List your workspaces and their status.",
      },
      {
        command: "./sg-local remove NAME",
        description: "Remove a workspace and delete its saved login. Use its name or team ID.",
      },
    ],
  },
  {
    id: "cmd-schedule",
    title: "Schedule",
    rows: [
      {
        command: "./sg-local schedule show",
        description: "Show your schedule.",
      },
      {
        command: "./sg-local schedule set --days mon-fri --start 09:00 --end 17:00",
        description: "Stay green only on these days, between these times.",
      },
      {
        command: "./sg-local schedule set --timezone America/New_York",
        description: "Use a time zone other than your computer's.",
      },
      {
        command: "./sg-local schedule always",
        description: "Stay green all the time.",
      },
    ],
  },
  {
    id: "cmd-pause",
    title: "Pause and stay online",
    intro: "Staying online wins over a pause and over your schedule. It never overrides an away you set in Slack.",
    rows: [
      {
        command: "./sg-local pause",
        description: "Pause every workspace until you resume.",
      },
      {
        command: "./sg-local pause --for 1h",
        description: "Pause every workspace for a while.",
      },
      {
        command: "./sg-local pause --workspace NAME",
        description: "Pause one workspace until you resume it.",
      },
      { command: "./sg-local resume", description: "Resume everything." },
      {
        command: "./sg-local resume --workspace NAME",
        description: "Resume one workspace.",
      },
      {
        command: "./sg-local stay 2h",
        description: "Stay online for a while, even when paused or outside your schedule.",
      },
      {
        command: "./sg-local stay --until 17:00",
        description: "Stay online until a time today.",
      },
      {
        command: "./sg-local stay --cancel",
        description: "Stop staying online.",
      },
    ],
  },
  {
    id: "cmd-check",
    title: "Check and fix",
    rows: [
      { command: "./sg-local doctor", description: "Check your setup." },
      {
        command: "./sg-local doctor --check-tokens",
        description: "Also check each workspace's login with Slack.",
      },
      {
        command: "./sg-local logs",
        description: "Show the last 80 lines of the log.",
      },
      { command: "./sg-local logs -n 200", description: "Show more lines." },
      {
        command: "./sg-local logs -f",
        description: "Keep showing new lines as they come.",
      },
      { command: "./sg-local --version", description: "Show the version." },
    ],
  },
];

function QuickStep({
  number,
  title,
  id,
  children,
}: {
  number: string;
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <li className={styles.quickStep} id={id}>
      <span className={styles.quickNumber} aria-hidden="true">
        {number}
      </span>
      <div className={styles.quickBody}>
        <h3 className={styles.quickTitle}>{title}</h3>
        <div className={docs.prose}>{children}</div>
      </div>
    </li>
  );
}

export function StartGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={docs.main}>
        <header className={docs.hero}>
          <div className={`container ${docs.heroInner}`}>
            <p className={docs.eyebrow}>Quick start</p>
            <h1 className={docs.title}>Quick start</h1>
            <p className={docs.lead}>
              The short version of the setup, then every <code className={styles.titleCode}>sg-local</code> command in
              one place.
            </p>
            <div className={docs.heroActions}>
              <Button href="/setup" iconRight={<ArrowRight />}>
                Setup guide
              </Button>
              <Button href={GITHUB_URL} variant="ghost" icon={<Github />}>
                GitHub
              </Button>
            </div>
          </div>
        </header>

        <div className={`container ${docs.layout}`}>
          <aside className={docs.aside}>
            <DocsNav items={navItems} />
          </aside>

          <div className={docs.content}>
            <section id="quick-start" className={docs.section} aria-labelledby="quick-start-title">
              <h2 id="quick-start-title" className={docs.h2}>
                Quick start
              </h2>
              <p className={docs.sectionLead}>
                Four steps on a Mac or Linux computer with Python 3.11 or newer and Chrome.
              </p>

              <ol className={styles.quick}>
                <QuickStep number="1" title="Download">
                  <CodeBlock
                    code={`git clone ${GITHUB_URL}.git\ncd Still-Green\npython3 -m pip install --user websockets`}
                    copyLabel="Copy the download commands"
                  />
                </QuickStep>
                <QuickStep number="2" title="Start">
                  <CodeBlock prompt="$" code="./sg-local web --daemon --open" copyLabel="Copy the start command" />
                  <p>
                    The control page opens at <code>{LOCAL_URL}</code> and shows your access code.
                  </p>
                </QuickStep>
                <QuickStep number="3" title="Add your Slack">
                  <p>
                    Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong>, click{" "}
                    <strong>Load unpacked</strong> and choose the <code>extension</code> folder. Paste your access code
                    in the extension, open app.slack.com, and click <strong>Capture from Slack</strong>.
                  </p>
                  <p className={docs.small}>
                    No extension? Run <code>./sg-local add</code>.{" "}
                    <Link href="/setup#tokens">Where to find the two values</Link>
                  </p>
                </QuickStep>
                <QuickStep number="4" title="Connect the dashboard" id="connect">
                  <p>
                    Optional. Open the dashboard, click <strong>Connect Stillgreen</strong>, and enter{" "}
                    <code>{LOCAL_URL}</code> and your access code.
                  </p>
                  <div>
                    <Button href="/dashboard" size="sm" iconRight={<ArrowRight />}>
                      Open dashboard
                    </Button>
                  </div>
                </QuickStep>
              </ol>

              <Card as="div" className={styles.where}>
                <CardHeader title="Where each part runs" titleAs="h3" />
                <CardBody flush>
                  <ul className={styles.whereList}>
                    <li>
                      <span className={styles.whereIcon} aria-hidden="true">
                        <Laptop />
                      </span>
                      <span>
                        <strong>Stillgreen</strong>
                        <span>Your computer, or your own cloud server. It holds the Slack connection.</span>
                      </span>
                    </li>
                    <li>
                      <span className={styles.whereIcon} aria-hidden="true">
                        <Puzzle />
                      </span>
                      <span>
                        <strong>Extension</strong>
                        <span>Chrome on your computer. It copies your Slack login to your Stillgreen.</span>
                      </span>
                    </li>
                    <li>
                      <span className={styles.whereIcon} aria-hidden="true">
                        <Grid />
                      </span>
                      <span>
                        <strong>Dashboard</strong>
                        <span>This website, or Stillgreen&apos;s own control page. It only shows the page.</span>
                      </span>
                    </li>
                  </ul>
                  <p className={styles.whereNote}>
                    <Lock aria-hidden="true" />
                    Your Slack login stays with your Stillgreen. It never goes to this website.
                  </p>
                </CardBody>
              </Card>

              <p className={`${docs.small} ${styles.cloudNote}`}>
                <Cloud aria-hidden="true" />
                <span>
                  Want to stay green when your laptop sleeps? <Link href="/setup#cloud">Run it in the cloud</Link> on a
                  free Google Cloud server.
                </span>
              </p>
            </section>

            <section id="commands" className={docs.section} aria-labelledby="commands-title">
              <h2 id="commands-title" className={docs.h2}>
                Commands
              </h2>
              <div className={`${docs.prose} ${styles.sectionBody}`}>
                <p>
                  Run these inside the <code>Still-Green</code> folder. If you ran <code>./install.sh</code>, you can
                  type <code>sg-local</code> instead of <code>./sg-local</code> from any folder. Words in capitals, like{" "}
                  <code>NAME</code>, are yours to fill in.
                </p>
                <p>
                  Add <code>--help</code> to any command for the details:
                </p>
                <CodeBlock prompt="$" code="./sg-local --help" copyLabel="Copy the help command" />
              </div>

              {groups.map((group) => (
                <div key={group.id} className={styles.group}>
                  <h3 id={group.id} className={docs.h3}>
                    {group.title}
                  </h3>
                  {group.intro && <p className={`${docs.small} ${styles.groupIntro}`}>{group.intro}</p>}
                  <CommandTable rows={group.rows} caption={`${group.title} commands`} />
                </div>
              ))}
            </section>

            <section id="formats" className={docs.section} aria-labelledby="formats-title">
              <h2 id="formats-title" className={docs.h2}>
                Times and days
              </h2>
              <p className={docs.sectionLead}>How to write lengths of time, times, days and time zones.</p>
              <dl className={styles.formats}>
                <div>
                  <dt>Lengths of time</dt>
                  <dd>
                    <code>30m</code> <code>2h</code> <code>1d</code> <code>1w</code>
                    <span>Minutes, hours, days or weeks.</span>
                  </dd>
                </div>
                <div>
                  <dt>Times</dt>
                  <dd>
                    <code>09:00</code> <code>17:30</code>
                    <span>24-hour clock. A window like 22:00 to 06:00 runs overnight.</span>
                  </dd>
                </div>
                <div>
                  <dt>Days</dt>
                  <dd>
                    <code>mon-fri</code> <code>weekdays</code> <code>weekends</code> <code>mon,wed,fri</code>
                    <span>A range, a group, or a list with commas.</span>
                  </dd>
                </div>
                <div>
                  <dt>Time zone</dt>
                  <dd>
                    <code>local</code> <code>America/New_York</code>
                    <span>Your computer&apos;s time zone unless you choose one.</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section id="files" className={docs.section} aria-labelledby="files-title">
              <h2 id="files-title" className={docs.h2}>
                Your files
              </h2>
              <p className={docs.sectionLead}>Everything Stillgreen saves is on your own computer.</p>
              <dl className={styles.formats}>
                <div>
                  <dt>Workspaces and Slack logins</dt>
                  <dd>
                    <code>~/.config/slack-green-local/config.json</code>
                    <span>Only your user account can read it.</span>
                  </dd>
                </div>
                <div>
                  <dt>State and log</dt>
                  <dd>
                    <code>~/.local/state/slack-green-local/</code>
                    <span>
                      The log is <code>daemon.log</code> in this folder.
                    </span>
                  </dd>
                </div>
              </dl>
              <div className={`${docs.prose} ${styles.sectionBody}`}>
                <p>To remove everything, stop Stillgreen, then delete both folders:</p>
                <div className={docs.commands}>
                  <CodeBlock prompt="$" code="./sg-local stop" copyLabel="Copy the stop command" />
                  <CodeBlock
                    prompt="$"
                    code="rm -rf ~/.config/slack-green-local ~/.local/state/slack-green-local"
                    copyLabel="Copy the delete command"
                  />
                </div>
                <p>
                  Then remove the extension at <code>chrome://extensions</code>.
                </p>
              </div>
            </section>

            <nav className={docs.next} aria-label="Next">
              <Link href="/setup" className={docs.nextLink}>
                <span className={docs.nextKicker}>Need more detail?</span>
                <span className={docs.nextTitle}>
                  Setup guide
                  <ArrowRight aria-hidden="true" />
                </span>
                <span className={docs.nextText}>Every step, the cloud setup and troubleshooting.</span>
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
