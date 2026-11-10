import Link from "next/link";
import styles from "./brand.module.css";

type BrandProps = {
  /** Where the logo links. Default "/". Pass null for a plain, unlinked logo. */
  href?: string | null;
  /** Mark only, without the "Stillgreen" word. */
  compact?: boolean;
  size?: "sm" | "md";
  className?: string;
};

/** The Stillgreen mark and wordmark. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`${styles.mark} ${className}`} aria-hidden="true">
      <span className={styles.dot} />
    </span>
  );
}

export function Brand({ href = "/", compact = false, size = "md", className = "" }: BrandProps) {
  const classes = `${styles.brand} ${size === "sm" ? styles.sm : ""} ${className}`;
  const content = (
    <>
      <BrandMark />
      {compact ? <span className="visually-hidden">Stillgreen</span> : <span className={styles.word}>Stillgreen</span>}
    </>
  );
  if (href === null) return <span className={classes}>{content}</span>;
  return (
    <Link href={href} className={classes} aria-label={href === "/" ? "Stillgreen home" : undefined}>
      {content}
    </Link>
  );
}
