import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./empty-state.module.css";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually one button that fixes the emptiness. */
  actions?: ReactNode;
  titleAs?: "h2" | "h3" | "h4";
  compact?: boolean;
  className?: string;
};

/**
 *   <EmptyState icon={<Grid />} title="No workspaces yet"
 *     description="Add one with the Chrome extension." actions={<Button>Add workspace</Button>} />
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  titleAs: Heading = "h3",
  compact,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, compact && styles.compact, className)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <Heading className={styles.title}>{title}</Heading>
      {description && <p className={styles.description}>{description}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
