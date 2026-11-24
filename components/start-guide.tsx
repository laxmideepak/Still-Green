import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { ArrowRight } from "./icons";
import { CodeBlock } from "./ui";
import { DocsNav, type DocsNavItem } from "./setup/docs-nav";
import { CommandTable, type CommandRow } from "./start/command-table";
import docs from "./setup/docs.module.css";
import styles from "./start-guide.module.css";

const navItems: DocsNavItem[] = [
  { id: "commands", label: "Before you start" },
  { id: "cmd-daemon", label: "Start and stop" },
  { id: "cmd-workspaces", label: "Workspaces" },
  { id: "cmd-schedule", label: "Schedule" },
  { id: "cmd-pause", label: "Pause and keep helping" },
  { id: "cmd-check", label: "Check and fix" },
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
        description: "Only run on these days, between these times.",
      },
      {
        command: "./sg-local schedule set --timezone America/New_York",
        description: "Use a time zone other than your computer's.",
      },
      {
        command: "./sg-local schedule always",
        description: "Help all the time, until you pause it.",
      },
    ],
  },
  {
    id: "cmd-pause",
    title: "Pause and keep helping",
    intro: "Keep me online wins over a pause and over your schedule. It never overrides an away you set in Slack.",
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
        description: "Keep helping you look active for a while, even when paused or outside your schedule.",
      },
      {
        command: "./sg-local stay --until 17:00",
        description: "Keep helping until a time today.",
      },
      {
        command: "./sg-local stay --cancel",
        description: "Stop Keep me online.",
      },
    ],
  },
  {
    id: "cmd-check",
    title: "Check and fix",
    rows: [
      { command: "./sg-local doctor", description: "Check your setup and say what to do about each problem." },
      {
        command: "./sg-local doctor --check-tokens",
        description: "Also check each workspace's login with Slack.",
      },
      {
        command: "./sg-local doctor --report stillgreen-report.txt",
        description: "Save a report to share when you ask for help. It has no tokens, cookies or access code.",
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

export function StartGuide() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={docs.main}>
        <header className={docs.hero}>
          <div className={`container ${docs.heroInner}`}>
            <p className={docs.eyebrow}>Reference</p>
            <h1 className={docs.title}>Commands</h1>
            <p className={docs.lead}>
              Every <code className={styles.titleCode}>sg-local</code> command in one place. New here? Start with the{" "}
              <Link href="/setup">setup guide</Link>.
            </p>
          </div>
        </header>

        <div className={`container ${docs.layout}`}>
          <aside className={docs.aside}>
            <DocsNav items={navItems} />
          </aside>

          <div className={docs.content}>
            <section id="commands" className={docs.section} aria-labelledby="commands-title">
              <h2 id="commands-title" className={docs.h2}>
                Before you start
              </h2>
              <div className={`${docs.prose} ${styles.sectionBody}`}>
                <p>
                  Run these inside the <code>Still-Green</code> folder. If you installed with Homebrew or ran{" "}
                  <code>./install.sh</code>, type <code>sg-local</code> instead of <code>./sg-local</code>, from any
                  folder. Words in capitals, like <code>NAME</code>, are yours to fill in. Add <code>--help</code> to
                  any command for the details:
                </p>
                <CodeBlock prompt="$" code="./sg-local --help" copyLabel="Copy the help command" />
              </div>
            </section>

            {groups.map((group) => (
              <section key={group.id} id={group.id} className={docs.section} aria-labelledby={`${group.id}-title`}>
                <h2 id={`${group.id}-title`} className={docs.h2}>
                  {group.title}
                </h2>
                {group.intro && <p className={docs.sectionLead}>{group.intro}</p>}
                <div className={styles.sectionBody}>
                  <CommandTable rows={group.rows} caption={`${group.title} commands`} />
                </div>
              </section>
            ))}

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
                <p>
                  To remove everything, run this. It stops Stillgreen and deletes both folders (and the login item on
                  a Mac). It asks first.
                </p>
                <div className={docs.commands}>
                  <CodeBlock prompt="$" code="./sg-local uninstall" copyLabel="Copy the uninstall command" />
                </div>
                <p>
                  Then, in Slack, use <strong>Sign out of all other sessions</strong> to end the session Stillgreen
                  used, and remove the extension at <code>chrome://extensions</code>. See the{" "}
                  <Link href="/privacy">privacy policy</Link>.
                </p>
              </div>
            </section>

            <nav className={docs.next} aria-label="Next">
              <Link href="/setup" className={docs.nextLink}>
                <span className={docs.nextKicker}>New here?</span>
                <span className={docs.nextTitle}>
                  Setup guide
                  <ArrowRight aria-hidden="true" />
                </span>
                <span className={docs.nextText}>Install, add your Slack, and troubleshooting.</span>
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
