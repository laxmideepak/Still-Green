"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "../icons";
import { IconButton } from "./button";
import { cx } from "./cx";
import styles from "./code-block.module.css";

export type CodeBlockProps = {
  /** The text to show and copy. Lines are kept as written. */
  code: string;
  /** A prompt shown before single-line commands, e.g. "$". Not copied. */
  prompt?: string;
  /** Accessible name of the copy button. */
  copyLabel?: string;
  /** Hide the copy button. */
  noCopy?: boolean;
  className?: string;
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/**
 * A command or snippet in JetBrains Mono with a copy button.
 *
 *   <CodeBlock prompt="$" code="sg-local start" copyLabel="Copy start command" />
 */
export function CodeBlock({ code, prompt, copyLabel = "Copy", noCopy, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const multiline = code.includes("\n");

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <div className={cx(styles.block, multiline && styles.multiline, className)}>
      {prompt && !multiline && (
        <span className={styles.prompt} aria-hidden="true">
          {prompt}
        </span>
      )}
      <pre className={styles.code}>
        <code>{code}</code>
      </pre>
      {!noCopy && (
        <IconButton
          label={copied ? "Copied" : copyLabel}
          size="sm"
          className={cx(styles.copy, copied && styles.copied)}
          onClick={onCopy}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      )}
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
