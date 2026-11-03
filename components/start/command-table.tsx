"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "../icons";
import { IconButton, copyText, cx } from "../ui";
import styles from "../start-guide.module.css";

export type CommandRow = {
  /** The full command. Upper-case words like NAME are placeholders. */
  command: string;
  description: ReactNode;
};

const PLACEHOLDER = /\b([A-Z][A-Z_]{2,})\b/g;

/** Show placeholders such as NAME in a quieter style. */
function renderCommand(command: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of command.matchAll(PLACEHOLDER)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(command.slice(last, index));
    parts.push(
      <span key={index} className={styles.placeholder}>
        {match[0]}
      </span>,
    );
    last = index + match[0].length;
  }
  if (last < command.length) parts.push(command.slice(last));
  return parts;
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = async () => {
    if (await copyText(command)) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <>
      <IconButton
        label={copied ? "Copied" : `Copy: ${command}`}
        size="sm"
        className={cx(styles.copy, copied && styles.copied)}
        onClick={onCopy}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}

/** A card-style table of commands, each with a copy button. */
export function CommandTable({ rows, caption }: { rows: CommandRow[]; caption: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">What it does</th>
            <th scope="col">
              <span className="visually-hidden">Copy</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.command}>
              <td className={styles.command}>
                <code>{renderCommand(row.command)}</code>
              </td>
              <td className={styles.description}>{row.description}</td>
              <td className={styles.copyCell}>
                <CopyCommand command={row.command} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
