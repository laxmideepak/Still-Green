"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  connectBridge,
  loadBridge,
  saveBridge,
  type BridgeConfig,
} from "@/lib/bridge";
import styles from "./start-guide.module.css";

type Provider = "fly" | "render" | "railway" | "local";

const providers: Array<{ id: Provider; label: string; note: string }> = [
  { id: "fly", label: "Fly.io", note: "Docker + volume · always on" },
  { id: "render", label: "Render", note: "Blueprint · persistent disk" },
  { id: "railway", label: "Railway", note: "Docker + volume" },
  { id: "local", label: "This laptop", note: "No cloud, no 24/7" },
];

const commands: Record<Provider, { label: string; command: string; note: string }> = {
  fly: {
    label: "Terminal",
    command: `fly launch --copy-config --name stillgreen-yourname --no-deploy
fly volumes create stillgreen_data --size 1 --region ams
fly secrets set \\
  SG_LOCAL_BRIDGE_CODE="SG-$(openssl rand -hex 8)" \\
  SG_LOCAL_WEB_ORIGIN="https://your-app.vercel.app"
fly deploy`,
    note: "Edit app and primary_region in fly.toml first. The volume keeps tokens across deploys. Fly asks for a card.",
  },
  render: {
    label: "Render Blueprint",
    command: `# New → Blueprint → connect this GitHub repository
# render.yaml creates the service and 1 GB disk
# Set SG_LOCAL_WEB_ORIGIN to your Vercel URL
# Copy the generated SG_LOCAL_BRIDGE_CODE from the dashboard`,
    note: "The starter plan is required for a persistent disk. The free plan sleeps and loses the volume.",
  },
  railway: {
    label: "Railway",
    command: `# New Project → Deploy from GitHub → laxmideepak/slack
# Add a volume mounted at /data
# Variables:
#   SG_LOCAL_BRIDGE_CODE=SG-...
#   SG_LOCAL_WEB_ORIGIN=https://your-app.vercel.app
#   SG_LOCAL_CONFIG_DIR=/data/config
#   SG_LOCAL_STATE_DIR=/data/state`,
    note: "railway.json selects the Dockerfile and the /api/health check.",
  },
  local: {
    label: "Local terminal",
    command: `git clone https://github.com/laxmideepak/slack.git
cd slack
./sg-local web --daemon --open`,
    note: "This keeps the daemon on your machine. It stops when the laptop sleeps or closes. Use a cloud provider if you want 24/7.",
  },
};

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
  const [url, setUrl] = useState("https://");
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
      const config = { url, code: code.trim() };
      saveBridge(config);
      setSaved(config);
      const target = `/dashboard?workspaces=${next.workspaces.length}`;
      router.push(target);
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
        <label htmlFor="cloud-url">Daemon URL</label>
        <input
          id="cloud-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://stillgreen-yourname.fly.dev"
          autoComplete="url"
          spellCheck={false}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="cloud-code">Access code</label>
        <input
          id="cloud-code"
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
        any third party.
      </p>
    </form>
  );
}

export function StartGuide() {
  const [provider, setProvider] = useState<Provider>("fly");
  const active = commands[provider];

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <section className={styles.masthead}>
          <div className={`container ${styles.mastheadInner}`}>
            <div>
              <p className={styles.eyebrow}>
                <span aria-hidden="true" />
                Cloud setup · about 5 minutes
              </p>
              <h1>
                Your dot,
                <br />
                without your laptop<span className={styles.dot}>.</span>
              </h1>
              <p className={styles.lede}>
                Vercel can host this page, but it cannot hold a long-lived Slack
                connection. The daemon runs on one small always-on host that you own.
                Close the laptop; the session keeps going.
              </p>
              <div className={styles.heroActions}>
                <a href="#connect" className="button buttonPrimary">
                  Connect an existing daemon
                  <ArrowRight width={16} height={16} />
                </a>
                <a href="#deploy" className="button buttonSecondary">
                  Deploy one
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
                <span className={styles.stackLabel}>Your cloud</span>
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
              <h2>Three steps, then close the lid.</h2>
              <p>
                One daemon process, one volume, one access code. No account system, no
                database, no relay.
              </p>
            </div>

            <ol className={styles.steps}>
              <li className={styles.step} id="daemon">
                <div className={styles.stepNumber} aria-hidden="true">
                  01
                </div>
                <div className={styles.stepBody}>
                  <h3>Put the daemon on an always-on host</h3>
                  <p>
                    Pick a host that keeps a container running. Fly.io, Render, Railway,
                    or any VPS with Docker works. The repository ships the{" "}
                    <code>Dockerfile</code>, <code>fly.toml</code>,{" "}
                    <code>render.yaml</code>, and <code>railway.json</code>.
                  </p>
                  <div className={styles.providerTabs} role="tablist" aria-label="Deployment provider">
                    {providers.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={provider === item.id}
                        onClick={() => setProvider(item.id)}
                      >
                        <strong>{item.label}</strong>
                        <span>{item.note}</span>
                      </button>
                    ))}
                  </div>
                  <CommandBlock command={active.command} label={active.label} />
                  <p className={styles.finePrint}>
                    {active.note} The daemon listens on its platform port and is checked at{" "}
                    <code>/api/health</code>.
                  </p>
                </div>
              </li>

              <li className={styles.step} id="tokens">
                <div className={styles.stepNumber} aria-hidden="true">
                  02
                </div>
                <div className={styles.stepBody}>
                  <h3>Add Slack tokens on the daemon, not here</h3>
                  <p>
                    Open your daemon URL in a browser and enter the access code. That
                    page is served by the daemon itself. Paste the <code>xoxc</code>{" "}
                    token and the <code>xoxd</code> cookie there; they never reach
                    Vercel.
                  </p>
                  <div className={styles.tokenRow}>
                    <div>
                      <span>xoxc</span>
                      <p>
                        DevTools → Network → filter <code>api</code> → open{" "}
                        <code>client.boot</code> → Payload → <code>token</code>.
                      </p>
                    </div>
                    <div>
                      <span>xoxd</span>
                      <p>
                        DevTools → Application → Cookies →{" "}
                        <code>https://app.slack.com</code> → the <code>d</code> cookie.
                      </p>
                    </div>
                  </div>
                  <p className={styles.finePrint}>
                    Both values must come from the same signed-in browser session.{" "}
                    <Link href="/setup#tokens">Full token walkthrough</Link>.
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
                    Paste the daemon&apos;s HTTPS URL and the same access code. The browser
                    stores them locally and talks to the daemon directly.
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
                    <dt>Your cloud host</dt>
                    <dd>The daemon, the Slack WebSocket, the schedule, and the tokens.</dd>
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
                  The daemon is small: one Python process and a WebSocket per workspace.
                  A 256 MB shared instance is enough. Fly and Railway charge a few
                  dollars a month; Render&apos;s starter plan is about $7. There is no
                  Stillgreen subscription.
                </p>
                <p className={styles.finePrint}>
                  Your Slack plan may restrict automated presence. Check your workspace
                  rules before using it.
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
              <p>
                Local or cloud, the flow is the same: URL, access code, live state.
              </p>
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
