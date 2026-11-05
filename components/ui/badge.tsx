import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./badge.module.css";

export type BadgeTone = "success" | "neutral" | "warning" | "danger" | "info" | "violet";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** success = active/online, warning = paused, danger = needs attention,
   *  info = connected/working, violet = manual away, neutral = everything else. */
  tone?: BadgeTone;
  /** Shows a small status dot before the label. */
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
};

/**
 *   <Badge tone="success" dot>Active</Badge>
 */
export function Badge({ tone = "neutral", dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx(styles.badge, tone !== "neutral" && styles[tone], className)} {...rest}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}
