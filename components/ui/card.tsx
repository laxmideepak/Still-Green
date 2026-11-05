import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./card.module.css";

type HeadingLevel = "h2" | "h3" | "h4";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** Element to render. Use "section" with a CardHeader title for landmarks. */
  as?: "section" | "div" | "article";
};

/**
 *   <Card>
 *     <CardHeader title="Keep me online" description="Stay green past your schedule, just for now." />
 *     <CardBody>…</CardBody>
 *     <CardFooter>…</CardFooter>
 *   </Card>
 */
export function Card({ as: Tag = "section", className, ...rest }: CardProps) {
  return <Tag className={cx(styles.card, className)} {...rest} />;
}

export type CardHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons, a badge or a segmented control on the right. */
  actions?: ReactNode;
  /** Heading level for the title. Default h2. */
  titleAs?: HeadingLevel;
  /** id for the heading, e.g. to label the card with aria-labelledby. */
  titleId?: string;
};

export function CardHeader({
  title,
  description,
  actions,
  titleAs: Heading = "h2",
  titleId,
  className,
  children,
  ...rest
}: CardHeaderProps) {
  return (
    <header className={cx(styles.header, className)} {...rest}>
      {(title || description) && (
        <div className={styles.headerText}>
          {title && (
            <Heading className={styles.title} id={titleId}>
              {title}
            </Heading>
          )}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export type CardBodyProps = HTMLAttributes<HTMLDivElement> & {
  /** No padding, for lists whose rows bring their own. */
  flush?: boolean;
};

export function CardBody({ flush, className, ...rest }: CardBodyProps) {
  return <div className={cx(styles.body, flush && styles.flush, className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <footer className={cx(styles.footer, className)} {...rest} />;
}
