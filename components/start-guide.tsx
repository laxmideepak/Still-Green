"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import {
  ArrowRight,
  Check,
  Copy,
  Github,
  Lock,
  Shield,
  Terminal,
} from "./icons";
import {
  connectBridge,
  loadBridge,
  saveBridge,
  type BridgeConfig,
} from "@/lib/bridge";
import styles from "./start-guide.module.css";

const commands = {
  install: {
    label: "Terminal",
    command: `git clone https://github.com/laxmideepak/slack.git
cd slack
./sg-local add
./sg-local web --daemon --open`,
    note: "`add` prompts for both Slack values with hidden input. `web --daemon` starts the presence daemon and its control page at 127.0.0.1:8765.",
  },
  autostart: {
    label: "Optional · macOS",
    command: `./sg-local install-launchd
./sg-local status`,
    note: "Starts the daemon at login so the dot survives a reboot. Without it, the daemon stops when the terminal closes.",
  },
} as const;

type CommandKey = keyof typeof commands;

function CommandBlock({ command, label }: { command: string; label: string }) {
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
    <div className={styles.command}>
      <div className={styles.commandTop}>
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${label} commands`}>
          {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
  );
}

function ConnectForm() {
  const router = useRouter();
  const [url, setUrl] = useState("http://127.0.0.1:8765");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<BridgeConfig | null>(null);

  useEffect(() => {
    const existing = loadBridge();
    if (existing) {
      setSaved(existing);
      setUrl(existing.url);
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await connectBridge(url, code);
      const config = { url: url.replace(/\/+$/, ""), code: code.trim() };
      saveBridge(config);
      setSaved(config);
      router.push(`/dashboard?workspaces=${next.workspaces.length}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to the daemon.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className={styles.savedBox}>
        <div className={styles.savedIcon} aria-hidden="true">
          <Check width={17} height={17} />
        </div>
        <div>
          <h3>A daemon is already saved here.</h3>
          <p>
            <code>{saved.url}</code> is connected to this browser. Open the dashboard to
            see its live state, or enter a different URL below.
          </p>
        </div>
        <Link href="/dashboard" className="button buttonPrimary buttonSmall">
          Open dashboard
          <ArrowRight width={14} height={14} />
        </Link>
      </div>
    );
  }

  return (
    <form className={styles.connectForm} onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor="daemon-url">Daemon URL</label>
        <input
          id="daemon-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="http://127.0.0.1:8765"
          autoComplete="url"
          spellCheck={false}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="daemon-code">Access code</label>
        <input
          id="daemon-code"
          type="password"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="SG-XXXX-XXXX-XXXX"
          autoComplete="current-password"
          spellCheck={false}
          required
        />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button buttonPrimary" disabled={busy}>
        {busy ? "Checking…" : "Connect dashboard"}
        {!busy && <ArrowRight width={15} height={15} />}
      </button>
      <p className={styles.finePrint}>
        The URL and code are stored in this browser. They are never sent to Vercel or
        any third party. Loopback addresses are allowed even though this page is HTTPS.
      </p>
    </form>
  );
}

export function StartGuide() {
  const [tab, setTab] = useState<CommandKey>("install");
  const active = commands[tab];

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Local setup · about 3 minutes
              </p>
              <h1>
                Your dot,
                <br />
                from this laptop<span className={styles.dot}>.</span>
              </h1>
              <p className={styles.lede}>
                Vercel hosts this dashboard and nothing else — it cannot hold a Slack
                connection, and it never sees a token. The presence daemon runs on your
                own machine, next to your Slack session.
              </p>
              <div className={styles.heroActions}>
                <a href="#deploy" className="button buttonPrimary">
                  Set it up
                  <ArrowRight width={16} height={16} />
                </a>
                <a href="#connect" className="button buttonSecondary">
                  I already run it
                </a>
              </div>
            </div>
            <div className={styles.heroStack} aria-hidden="true">
              <div className={styles.stackCard}>
                <span className={styles.stackLabel}>Vercel</span>
                <strong>This dashboard</strong>
                <em>static UI · no tokens</em>
              </div>
              <div className={styles.stackLine}>
                <i />
                <span>HTTPS · access code</span>
              </div>
              <div className={`${styles.stackCard} ${styles.stackDaemon}`}>
                <span className={styles.stackLabel}>Your machine</span>
                <strong>Presence daemon</strong>
                <em>WebSocket · schedule · tokens</em>
              </div>
              <div className={styles.stackLine}>
                <i />
                <span>wss-primary.slack.com</span>
              </div>
              <div className={styles.stackCard}>
                <span className={styles.stackLabel}>Slack</span>
                <strong>Green dot</strong>
                <em>one session per workspace</em>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.stepsSection} id="deploy">
          <div className={`container ${styles.stepsInner}`}>
            <div className={styles.sectionHead}>
              <h2>Three steps, then close the tab.</h2>
              <p>
                One Python process, one browser extension, one access code. No account
                system, no database, no relay.
              </p>
            </div>

            <ol className={styles.steps}>
              <li className={styles.step} id="daemon">
                <div className={styles.stepNumber} aria-hidden="true">
                  01
                </div>
                <div className={styles.stepBody}>
                  <h3>Run the daemon on your machine</h3>
                  <p>
                    Python 3.11+ and one dependency. The daemon holds the Slack session,
                    watches the clock, and serves a control page on loopback.
                  </p>
                  <div className={styles.providerTabs} role="tablist" aria-label="Command">
                    {(
                      [
                        ["install", "First run", "clone, add tokens, start"],
                        ["autostart", "Keep it running", "macOS login item"],
                      ] as Array<[CommandKey, string, string]>
                    ).map(([id, label, note]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                      >
                        <strong>{label}</strong>
                        <span>{note}</span>
                      </button>
                    ))}
                  </div>
                  <CommandBlock command={active.command} label={active.label} />
                  <p className={styles.finePrint}>{active.note}</p>
                </div>
              </li>

              <li className={styles.step} id="extension">
                <div className={styles.stepNumber} aria-hidden="true">
                  02
                </div>
                <div className={styles.stepBody}>
                  <h3>Let the extension capture your Slack session</h3>
                  <p>
                    The <code>xoxc</code> token lives in the page; the <code>xoxd</code>{" "}
                    cookie is <code>HttpOnly</code>. Neither can be read by a bookmarklet,
                    so the repository ships a small unpacked extension that reads both from
                    your own browser and posts them to the daemon on loopback.
                  </p>
                  <div className={styles.tokenRow}>
                    <div>
                      <span>Install</span>
                      <p>
                        Load <code>extension/</code> as an unpacked extension from{" "}
                        <code>chrome://extensions</code>.
                      </p>
                    </div>
                    <div>
                      <span>Capture</span>
                      <p>
                        Paste the access code and press <strong>Capture from Slack</strong>.
                        Every signed-in workspace is added at once.
                      </p>
                    </div>
                  </div>
                  <p className={styles.finePrint}>
                    Prefer doing it by hand? DevTools works too.{" "}
                    <Link href="/setup#tokens">Manual walkthrough</Link>.
                  </p>
                </div>
              </li>

              <li className={styles.step} id="connect">
                <div className={styles.stepNumber} aria-hidden="true">
                  03
                </div>
                <div className={styles.stepBody}>
                  <h3>Connect this dashboard to the daemon</h3>
                  <p>
                    The daemon listens on <code>127.0.0.1:8765</code>. Paste that URL and
                    the access code. Your browser stores both locally and talks to the
                    daemon directly.
                  </p>
                  <ConnectForm />
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className={styles.honestySection}>
          <div className={`container ${styles.honestyGrid}`}>
            <div className={styles.honestyCard}>
              <span className={styles.honestyIcon} aria-hidden="true">
                <Shield width={18} height={18} />
              </span>
              <div>
                <h2>What runs where</h2>
                <dl>
                  <div>
                    <dt>Vercel</dt>
                    <dd>This static UI. It stores your daemon URL and access code in localStorage.</dd>
                  </div>
                  <div>
                    <dt>Your machine</dt>
                    <dd>The daemon, the Slack WebSocket, the schedule, and the tokens.</dd>
                  </div>
                  <div>
                    <dt>The extension</dt>
                    <dd>Reads your Slack session once, then hands it to the daemon.</dd>
                  </div>
                  <div>
                    <dt>Slack</dt>
                    <dd>The only service the daemon contacts for auth and presence.</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className={styles.honestyCard}>
              <span className={styles.honestyIcon} aria-hidden="true">
                <Lock width={18} height={18} />
              </span>
              <div>
                <h2>What it costs</h2>
                <p>
                  Nothing. The daemon is one Python process and a WebSocket per
                  workspace; the dashboard is a static site. There is no subscription and
                  no account.
                </p>
                <p className={styles.finePrint}>
                  The trade is the laptop: sleep it and the session ends. Keep the machine
                  awake, or run the daemon on a machine you leave on. Your Slack plan may
                  also restrict automated presence — check your workspace rules.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.closing}>
          <div className={`container ${styles.closingInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Already running?
              </p>
              <h2>Point the dashboard at it.</h2>
              <p>One URL, one code, live state. The same flow every time.</p>
            </div>
            <div className={styles.closingActions}>
              <a href="#connect" className="button buttonPrimary">
                Connect daemon
                <ArrowRight width={16} height={16} />
              </a>
              <Link href="/setup" className="button buttonSecondary">
                CLI reference
              </Link>
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
