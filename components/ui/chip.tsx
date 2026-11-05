"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./chip.module.css";

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  /** On/off state, exposed as aria-pressed. */
  pressed?: boolean;
  icon?: ReactNode;
};

/** A small toggle button, e.g. a duration or a weekday. */
export function Chip({ pressed = false, icon, className, children, ...rest }: ChipProps) {
  return (
    <button type="button" aria-pressed={pressed} className={cx(styles.chip, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export type ChipOption<T extends string> = { value: T; label: ReactNode; ariaLabel?: string; disabled?: boolean };

type ChipGroupBase<T extends string> = {
  /** Accessible name for the group, e.g. "Keep me online for". */
  label: string;
  options: ReadonlyArray<ChipOption<T>>;
  className?: string;
};

export type ChipGroupProps<T extends string> = ChipGroupBase<T> &
  (
    | { multiple?: false; value: T | null; onChange: (value: T) => void }
    | { multiple: true; value: ReadonlyArray<T>; onChange: (value: T[]) => void }
  );

/**
 * A row of toggle chips. Single choice by default; `multiple` for sets like weekdays.
 *
 *   <ChipGroup label="Keep me online for" value={pick} onChange={setPick}
 *     options={[{ value: "30", label: "30 min" }, { value: "60", label: "1 h" }]} />
 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { label, options, className } = props;
  const isOn = (value: T) =>
    props.multiple ? props.value.includes(value) : props.value === value;
  const toggle = (value: T) => {
    if (props.multiple) {
      const next = props.value.includes(value)
        ? props.value.filter((v) => v !== value)
        : [...props.value, value];
      props.onChange(options.map((o) => o.value).filter((v) => next.includes(v)));
    } else {
      props.onChange(value);
    }
  };
  return (
    <div role="group" aria-label={label} className={cx(styles.group, className)}>
      {options.map((option) => (
        <Chip
          key={option.value}
          pressed={isOn(option.value)}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
          onClick={() => toggle(option.value)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );
}
