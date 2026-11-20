"use client";

// Health views for the web dashboard: the three status signals, the
// "Check my setup" panel and the setup checklist. Same words as the control
// page (sg_local/static/app.js). Everything is worked out from live state.

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, Check, Clock, Info, Refresh, Shield } from "./icons";
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, cx } from "./ui";
import type { CheckStatus, Diagnostics, ErrorInfo } from "@/lib/bridge";
import { clock, type SetupStep, type StatusSignal } from "@/lib/dashboard";
import styles from "./dashboard-health.module.css";

// ------------------------------------------------------------------ signals

const SIGNAL_WORDS: Record<StatusSignal["tone"], string> = {
  pass: "OK",
  warn: "Check",
  fail: "Problem",
  off: "Not needed now",
};

function SignalIcon({ tone }: { tone: StatusSignal["tone"] | CheckStatus }) {
  if (tone === "pass") return <Check />;
  if (tone === "warn") return <AlertTriangle />;
  if (tone === "fail") return <AlertCircle />;
  return <i />;
}

/** "Stillgreen running", "Slack login valid", "Presence confirmed". */
export function StatusSignals({ signals }: { signals: StatusSignal[] }) {
  return (
    <ul className={styles.signals} aria-label="Status checks">
      {signals.map((signal) => (
        <li key={signal.id} className={styles.signal} data-tone={signal.tone} data-signal={signal.id}>
          <span className={styles.signalIcon} data-tone={signal.tone} aria-hidden="true">
            <SignalIcon tone={signal.tone} />
          </span>
          <div className={styles.signalText}>
            <span className={styles.signalLabel}>{signal.label}</span>
            <span className={styles.signalValue}>
              <span className="visually-hidden">{SIGNAL_WORDS[signal.tone]}: </span>
              {signal.value}
            </span>
            <span className={styles.signalDetail}>{signal.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ problem text

/** Title, message and next step for one problem. */
export function ProblemText({ info, className }: { info: ErrorInfo; className?: string }) {
  return (
    <div className={cx(styles.problem, className)}>
      <AlertTriangle aria-hidden="true" />
      <div>
        <p className={styles.problemTitle}>{info.title}</p>
        {info.message && <p className={styles.problemMessage}>{info.message}</p>}
        {info.action && (
          <p className={styles.problemAction}>
            <span className={styles.problemNext}>What to do:</span> {info.action}
          </p>
        )}
      </div>
    </div>
  );
}

/** Error info as banner content: the message, then the next step. */
export function ProblemBody({ info, extra }: { info: ErrorInfo; extra?: ReactNode }) {
  return (
    <>
      {info.message}
      {info.action && (
        <>
          {" "}
          <strong>What to do:</strong> {info.action}
        </>
      )}
      {extra}
    </>
  );
}

// ------------------------------------------------------------------ diagnostics

const CHECK_BADGE: Record<CheckStatus, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  pass: { tone: "success", label: "OK" },
  warn: { tone: "warning", label: "Check" },
  fail: { tone: "danger", label: "Problem" },
  skip: { tone: "neutral", label: "Skipped" },
};

export type DiagnosticsView = {
  result: Diagnostics | null;
  error: ErrorInfo | null;
  running: boolean;
  downloading: boolean;
  run: () => void;
  download: () => void;
};

export function DiagnosticsCard({ view, preview }: { view: DiagnosticsView; preview?: boolean }) {
  const { result, error, running, downloading } = view;
  const failing = result ? result.checks.filter((check) => check.status === "fail").length : 0;
  const warning = result ? result.checks.filter((check) => check.status === "warn").length : 0;
  const badge = !result ? undefined : failing ? (
    <Badge tone="danger" dot>
      {failing} {failing === 1 ? "problem" : "problems"}
    </Badge>
  ) : warning ? (
    <Badge tone="warning" dot>
      {warning} to check
    </Badge>
  ) : (
    <Badge tone="success" dot>
      All good
    </Badge>
  );

  return (
    <Card aria-labelledby="diagnostics-title" id="check-setup">
      <CardHeader
        titleId="diagnostics-title"
        title="Check my setup"
        description={
          preview
            ? "Sample results. Connect your Stillgreen to test your own setup."
            : "Tests your Stillgreen, its settings and its connection to Slack."
        }
        actions={badge}
      />
      <CardBody flush={Boolean(result)}>
        {error && (
          <div className={styles.diagError}>
            <ProblemText info={error} />
          </div>
        )}
        {result ? (
          <ul className={styles.checks} aria-live="polite">
            {result.checks.map((check) => {
              const tone = CHECK_BADGE[check.status];
              return (
                <li key={check.id || check.label} className={styles.check} data-status={check.status} data-check={check.id}>
                  <span className={styles.signalIcon} data-tone={check.status === "skip" ? "off" : check.status} aria-hidden="true">
                    <SignalIcon tone={check.status} />
                  </span>
                  <div className={styles.checkText}>
                    <span className={styles.checkLabel}>
                      {check.label}
                      <Badge tone={tone.tone} className={styles.checkBadge}>
                        {tone.label}
                      </Badge>
                    </span>
                    {check.detail && <span className={styles.checkDetail}>{check.detail}</span>}
                    {check.action && check.status !== "pass" && (
                      <span className={styles.checkAction}>
                        <span className={styles.problemNext}>What to do:</span> {check.action}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          !error && (
            <p className={styles.muted}>
              Run the check when something isn&apos;t working. It looks at Python, your settings, file permissions,
              the network, the certificate check, your clock and each workspace.
            </p>
          )
        )}
      </CardBody>
      <CardFooter className={styles.diagFoot}>
        <span className={styles.privacyNote}>
          <Shield aria-hidden="true" />
          <span>
            The report has no passwords, Slack tokens, cookies or access code. Read it before you share it.
            {result && <> Checked at {clock(result.generated_at)}.</>}
          </span>
        </span>
        <div className={styles.diagActions}>
          <Button size="sm" variant="ghost" onClick={view.download} loading={downloading} disabled={running}>
            {downloading ? "Preparing" : "Download report"}
          </Button>
          <Button size="sm" icon={result ? <Refresh /> : undefined} onClick={view.run} loading={running} disabled={downloading}>
            {running ? "Checking" : result ? "Check again" : "Check my setup"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// ------------------------------------------------------------------ checklist

const STEP_WORDS: Record<SetupStep["status"], string> = {
  done: "Done",
  todo: "To do",
  problem: "Needs attention",
  waiting: "Waiting",
};

function StepIcon({ status, index }: { status: SetupStep["status"]; index: number }) {
  if (status === "done") return <Check />;
  if (status === "problem") return <AlertCircle />;
  if (status === "waiting") return <Clock />;
  return <span>{index + 1}</span>;
}

export function SetupChecklist({
  steps,
  onAction,
  preview,
}: {
  steps: SetupStep[];
  /** Buttons for steps that have one: "check" runs Check my setup, "add" opens Add workspace. */
  onAction: (action: "check" | "add" | "schedule") => void;
  preview?: boolean;
}) {
  const done = steps.filter((step) => step.status === "done").length;
  return (
    <Card aria-labelledby="setup-title" className={styles.checklist}>
      <CardHeader
        titleId="setup-title"
        title="Finish setting up"
        description={`${done} of ${steps.length} steps done. This list follows what Stillgreen reports, so you can come back to it any time.`}
        actions={
          <Badge tone={done === steps.length ? "success" : "info"} className="tnum">
            {done}/{steps.length}
          </Badge>
        }
      />
      <CardBody flush>
        <ol className={styles.steps}>
          {steps.map((step, index) => {
            const action =
              step.id === "tls" && step.status !== "done"
                ? { key: "check" as const, label: "Check my setup" }
                : step.id === "slack" && step.status !== "done"
                  ? { key: "add" as const, label: step.status === "problem" ? "How to capture again" : "Add workspace" }
                  : step.id === "hours"
                    ? { key: "schedule" as const, label: step.status === "done" ? "Change hours" : "Choose hours" }
                    : null;
            return (
              <li key={step.id} className={styles.step} data-status={step.status} data-step={step.id}>
                <span className={styles.stepIcon} data-status={step.status} aria-hidden="true">
                  <StepIcon status={step.status} index={index} />
                </span>
                <div className={styles.stepText}>
                  <span className={styles.stepTitle}>
                    {index + 1}. {step.title}
                    <span className="visually-hidden">: {STEP_WORDS[step.status]}.</span>
                  </span>
                  <span className={styles.stepDetail}>{step.detail}</span>
                </div>
                {action && !preview && (
                  <Button size="sm" variant={step.status === "done" ? "ghost" : "secondary"} onClick={() => onAction(action.key)}>
                    {action.label}
                  </Button>
                )}
                {!action && (
                  <span className={styles.stepState} data-status={step.status}>
                    {STEP_WORDS[step.status]}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </CardBody>
      <CardFooter>
        <span>Stuck? The setup guide walks through each step.</span>
        <Button size="sm" variant="ghost" href="/setup" iconRight={<ArrowUpRight />}>
          Setup guide
        </Button>
      </CardFooter>
    </Card>
  );
}

// ------------------------------------------------------------------ honesty note

/** The short, honest note about what Stillgreen can and can't do. */
export function HonestyNote({ className }: { className?: string }) {
  return (
    <p className={cx(styles.honesty, className)}>
      <Info aria-hidden="true" />
      <span>
        Slack decides your final status. Stillgreen keeps a connection open like the Slack web app. Slack&apos;s official
        API can&apos;t force a person to be active, so this uses your web session. It may stop working if Slack changes,
        and your workspace may not allow it.
      </span>
    </p>
  );
}

