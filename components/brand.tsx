import Link from "next/link";
import styles from "./brand.module.css";

type BrandProps = {
  inverted?: boolean;
  compact?: boolean;
  className?: string;
};

export function Brand({ inverted = false, compact = false, className = "" }: BrandProps) {
  return (
    <Link
      href="/"
      className={`${styles.brand} ${inverted ? styles.inverted : ""} ${className}`}
      aria-label="Stillgreen home"
    >
      <span className={styles.mark} aria-hidden="true">
        <span className={styles.orbit} />
        <span className={styles.dot} />
      </span>
      {!compact && <span className={styles.word}>stillgreen</span>}
    </Link>
  );
}
