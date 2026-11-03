"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./segmented-control.module.css";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  /** Accessible name for the group, e.g. "Schedule mode". */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Stretch to the full width with equal segments. */
  block?: boolean;
  className?: string;
};

/**
 * Pick one of two to four modes. Each segment is a toggle button (aria-pressed).
 *
 *   <SegmentedControl label="Schedule mode" value={mode} onChange={setMode}
 *     options={[{ value: "always", label: "Always on" }, { value: "scheduled", label: "Scheduled" }]} />
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  block,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx(styles.group, block && styles.block, className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
