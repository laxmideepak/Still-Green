import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Info } from "../icons";
import { cx } from "./cx";
import styles from "./banner.module.css";

export type BannerTone = "neutral" | "info" | "success" | "warning" | "danger";

export type BannerProps = {
  tone?: BannerTone;
  title?: ReactNode;
  /** The message. */
  children?: ReactNode;
  /** Buttons on the right, e.g. "Try again". */
  actions?: ReactNode;
  /** Replaces the tone's icon. Pass null for none. */
  icon?: ReactNode | null;
  className?: string;
};

const toneIcon: Record<BannerTone, ReactNode> = {
  neutral: <Info />,
  info: <Info />,
  success: <CheckCircle />,
  warning: <AlertTriangle />,
  danger: <AlertCircle />,
};

/**
 * An inline message about the page or a section. Danger banners are announced
 * right away (role="alert"); the rest politely (role="status").
 *
 *   <Banner tone="warning" title="Slack rejected the tokens for Acme Corp"
 *     actions={<Button size="sm">Capture again</Button>}>Open Slack in Chrome and use the extension.</Banner>
 */
export function Banner({ tone = "neutral", title, children, actions, icon, className }: BannerProps) {
  const shown = icon === undefined ? toneIcon[tone] : icon;
  return (
    <div
      className={cx(styles.banner, tone !== "neutral" && styles[tone], className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      {shown && (
        <span className={styles.icon} aria-hidden="true">
          {shown}
        </span>
      )}
      <div className={styles.text}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.description}>{children}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

/** Same as Banner. */
export const Alert = Banner;
