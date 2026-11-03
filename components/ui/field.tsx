"use client";

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, Clock } from "../icons";
import { cx } from "./cx";
import styles from "./field.module.css";

type FieldContextValue = { id: string; describedBy?: string; invalid: boolean };

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  label: ReactNode;
  /** Help text under the control. Hidden while an error shows. */
  hint?: ReactNode;
  /** Error text. Marks the control aria-invalid and is announced. */
  error?: ReactNode;
  /** Adds a quiet "Optional" after the label. */
  optional?: boolean;
  /** id for the control. Generated when left out. */
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + hint or error, wired up for screen readers.
 *
 *   <Field label="Stillgreen address" hint="Shown in your terminal when Stillgreen starts." error={urlError}>
 *     <Input mono value={url} onChange={(e) => setUrl(e.target.value)} />
 *   </Field>
 */
export function Field({ label, hint, error, optional, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `field-${auto}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
        {optional && <span className={styles.optional}>Optional</span>}
      </label>
      <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext.Provider>
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function useFieldProps(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
}) {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.invalid ? true : undefined),
  };
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** sm 32px, md 36px (default). */
  size?: "sm" | "md";
  /** JetBrains Mono, for URLs, codes and hosts. */
  mono?: boolean;
  /** Icon inside the left edge. */
  icon?: ReactNode;
  ref?: Ref<HTMLInputElement>;
};

export function Input({ size = "md", mono, icon, className, ...rest }: InputProps) {
  const wired = useFieldProps(rest);
  const input = (
    <input
      {...rest}
      {...wired}
      className={cx(
        styles.input,
        size === "sm" && styles.sm,
        mono && styles.mono,
        icon ? styles.withIcon : undefined,
        className,
      )}
    />
  );
  if (!icon) return input;
  return (
    <div className={styles.wrap}>
      <span className={styles.leading} aria-hidden="true">
        {icon}
      </span>
      {input}
    </div>
  );
}

export type TimeInputProps = Omit<InputProps, "type" | "mono" | "icon">;

/**
 * A 24-hour "HH:MM" time field (the value format of <input type="time">).
 *
 *   <Field label="Until"><TimeInput value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
 */
export function TimeInput({ className, ...rest }: TimeInputProps) {
  return <Input type="time" icon={<Clock />} className={cx(styles.time, className)} {...rest} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
};

export function Textarea({ mono, className, ...rest }: TextareaProps) {
  const wired = useFieldProps(rest);
  return (
    <textarea
      {...rest}
      {...wired}
      className={cx(styles.input, styles.textarea, mono && styles.mono, className)}
    />
  );
}
