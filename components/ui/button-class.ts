import { cx } from "./cx";
import styles from "./button.module.css";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "destructive-ghost"
  | "link";
export type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  destructive: styles.destructive,
  "destructive-ghost": styles.destructiveGhost,
  link: styles.link,
};

/**
 * Button classes for elements that can't be a <Button>, e.g. a <label> that
 * opens a file picker. Safe to call from server components.
 */
export function buttonClassName({
  variant = "secondary",
  size = "md",
  block,
  iconOnly,
  loading,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  iconOnly?: boolean;
  loading?: boolean;
  className?: string;
}): string {
  return cx(
    styles.button,
    variantClass[variant],
    size === "sm" && styles.sm,
    size === "lg" && styles.lg,
    block && styles.block,
    iconOnly && styles.icon,
    loading && styles.loading,
    className,
  );
}

