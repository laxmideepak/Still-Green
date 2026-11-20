import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Lock, Shield } from "@/components/icons";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Banner } from "@/components/ui";
import docs from "@/components/setup/docs.module.css";
import { GITHUB_URL, ISSUES_URL } from "@/lib/site";
import styles from "./privacy.module.css";

// Keep in step with docs/privacy.md (same text, for people reading on GitHub).

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Stillgreen collects, where it is stored, how long it is kept and how to delete it. No analytics and no tracking.",
};

const THREAT_MODEL_URL = `${GITHUB_URL}/blob/main/docs/threat-model.md`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={docs.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={docs.h2}>
        {title}
      </h2>
      <div className={`${docs.prose} ${styles.body}`}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className={docs.main}>
        <header className={docs.hero}>
          <div className={`container ${docs.heroInner}`}>
            <p className={docs.eyebrow}>
              <span>Last updated 20 November 2026</span>
            </p>
            <h1 className={docs.title}>Privacy policy</h1>
            <p className={docs.lead}>
              Stillgreen is a free, open source project. There is no Stillgreen company, account or server that holds
              your data. You run Stillgreen yourself, on your own computer or (advanced) your own cloud server.
            </p>
          </div>
        </header>

        <div className={`container ${styles.layout}`}>
          <div className={docs.content}>
            <Section id="short" title="The short version">
              <ul className={docs.bullets}>
                <li>
                  Stillgreen needs your Slack web session (a token and a cookie) to work. It keeps them on your computer
                  or your server, in a file only your user can read, and sends them only to Slack.
                </li>
                <li>This website never sees your Slack session. It only sends the dashboard page to your browser.</li>
                <li>No analytics, no tracking, no ads, and no selling of data.</li>
                <li>
                  You can delete everything at any time. See <a href="#delete">Delete your data</a>.
                </li>
              </ul>
            </Section>

            <Section id="collected" title="What is collected, and by which part">
              <h3 className={docs.h3}>This website</h3>
              <ul className={docs.bullets}>
                <li>We collect nothing about you. The site sets no cookies and has no analytics or tracking scripts.</li>
                <li>
                  The site is hosted by Vercel. Like any web host, Vercel may keep normal server logs (for example the
                  IP address and time of a request) under its own privacy policy. We don&apos;t use those logs.
                </li>
                <li>
                  If you connect the dashboard, your <strong>Stillgreen address</strong> and <strong>access code</strong>{" "}
                  are saved in your own browser, so you don&apos;t have to type them again. They are not sent to this
                  website. Click <strong>Disconnect</strong> to remove them.
                </li>
              </ul>

              <h3 className={docs.h3}>The Chrome extension</h3>
              <ul className={docs.bullets}>
                <li>
                  Only when you click <strong>Capture from Slack</strong>, it reads, for each Slack workspace open in
                  Chrome: your Slack <strong>session token</strong> (it starts with <code>xoxc-</code>) and the Slack{" "}
                  <strong>&ldquo;d&rdquo; cookie</strong> (it starts with <code>xoxd-</code>).
                </li>
                <li>
                  Together these let anyone who has them <strong>act as you in Slack</strong>, like being signed in.
                </li>
                <li>
                  It sends them <strong>only to the Stillgreen address you set</strong>, never to this website or
                  anyone else. Plain <code>http://</code> is allowed only to your own computer; any other address must
                  use <code>https://</code>.
                </li>
                <li>
                  It saves your Stillgreen address, access code and the date you agreed to its notice in Chrome&apos;s
                  extension storage on your computer. It does not keep the Slack token or cookie.
                </li>
                <li>Before the first capture it shows what it reads and asks you to agree. If that changes, or you change the Stillgreen address, it asks again.</li>
              </ul>

              <h3 className={docs.h3}>Stillgreen itself</h3>
              <p>The program on your computer or server saves:</p>
              <dl className={styles.table}>
                <div>
                  <dt>Each workspace&apos;s name, team ID, user ID, session token and &ldquo;d&rdquo; cookie</dt>
                  <dd>
                    <code>~/.config/slack-green-local/config.json</code>, readable only by your user (file mode{" "}
                    <code>0600</code>).
                  </dd>
                </div>
                <div>
                  <dt>The access code</dt>
                  <dd>
                    <code>~/.config/slack-green-local/bridge.json</code>, readable only by your user.
                  </dd>
                </div>
                <div>
                  <dt>Schedule, pause and &ldquo;keep me online&rdquo; settings</dt>
                  <dd>The same folder.</dd>
                </div>
                <div>
                  <dt>Status and a log of what it did</dt>
                  <dd>
                    <code>~/.local/state/slack-green-local/</code>, a folder only your user can open.
                  </dd>
                </div>
              </dl>
              <p>
                On a cloud server with Docker, the same files are in the <code>stillgreen-data</code> volume. Tokens,
                cookies and access codes are removed from the log, from error messages and from the diagnostics report
                before they are written.
              </p>
            </Section>

            <Section id="shared" title="Who it is shared with">
              <ul className={docs.bullets}>
                <li>
                  <strong>Slack.</strong> Stillgreen sends your token and cookie to Slack (<code>slack.com</code>) to
                  check them and to keep a connection open, like the Slack web app does.
                </li>
                <li>
                  <strong>Nobody else.</strong> There is no Stillgreen server in the middle. Nothing is sent to this
                  website, to us, or to any other company.
                </li>
                <li>
                  If you run Stillgreen on a cloud server, your session is stored on that server, and the cloud
                  company&apos;s own terms apply to the machine.
                </li>
              </ul>
            </Section>

            <Section id="retention" title="How long it is kept">
              <ul className={docs.bullets}>
                <li>
                  Your saved Slack session stays until you remove the workspace or uninstall Stillgreen. Slack may end it
                  earlier, for example when you sign out.
                </li>
                <li>The log is kept to about 4 MB. The oldest lines are deleted automatically.</li>
                <li>
                  A diagnostics report is only made when you ask for one. It is saved where you choose, and you decide
                  whether to share it.
                </li>
              </ul>
            </Section>

            <Section id="delete" title="Delete your data">
              <ol className={docs.list}>
                <li>
                  <p>
                    <strong>Remove one workspace:</strong> click <strong>Remove</strong> next to it on the dashboard or
                    the control page, or run <code>./sg-local remove NAME</code>.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Remove everything:</strong> in the Stillgreen folder, run <code>./sg-local uninstall</code>.
                    It stops Stillgreen and deletes the settings, logs, saved sessions and access code. It asks first. On
                    a server, run <code>sudo docker compose down -v</code>.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>End the session in Slack too:</strong> in Slack, go to Settings and click{" "}
                    <strong>Sign out of all other sessions</strong>. This makes sure no copy of the session can be used.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Remove the extension:</strong> open <code>chrome://extensions</code> and click{" "}
                    <strong>Remove</strong>.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Forget the dashboard:</strong> click <strong>Disconnect</strong> on the{" "}
                    <Link href="/dashboard">dashboard</Link>.
                  </p>
                </li>
              </ol>
            </Section>

            <Section id="slack" title="Slack and your workplace">
              <Banner tone="warning" title="Slack does not officially support this">
                Stillgreen is not made by or connected to Slack. Slack&apos;s official API can&apos;t force a person to be
                active, so Stillgreen uses your web session. It may stop working if Slack changes, and your employer or
                workspace may not allow it. Check before you use it.
              </Banner>
            </Section>

            <Section id="security" title="Security">
              <p className={styles.iconLine}>
                <Shield aria-hidden="true" />
                <span>
                  How Stillgreen protects your session, and the risks that remain, are in the{" "}
                  <a href={THREAT_MODEL_URL} target="_blank" rel="noreferrer">
                    threat model
                  </a>
                  . In short: anyone with your Slack token and cookie can act as you, so protect the computer or server
                  Stillgreen runs on.
                </span>
              </p>
            </Section>

            <Section id="changes" title="Changes and contact">
              <p>
                Changes to this policy are made in the open, in the project&apos;s Git history. If the extension starts
                reading anything new, it asks for your agreement again.
              </p>
              <p className={styles.iconLine}>
                <Lock aria-hidden="true" />
                <span>
                  Questions? <a href={ISSUES_URL} target="_blank" rel="noreferrer">Open an issue on GitHub</a>. Never
                  paste tokens, cookies or your access code in an issue.
                </span>
              </p>
            </Section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
