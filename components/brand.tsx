import { useId } from "react";
import Link from "next/link";
import styles from "./brand.module.css";

/** "on": Stillgreen is keeping you green (laughing). "off": it isn't (sad). */
export type BrandMood = "on" | "off";

type BrandProps = {
  /** Where the logo links. Default "/". Pass null for a plain, unlinked logo. */
  href?: string | null;
  /** Mark only, without the "Stillgreen" word. */
  compact?: boolean;
  size?: "sm" | "md";
  /** Marketing pages are always "on". The dashboard passes the live state. */
  mood?: BrandMood;
  className?: string;
};

/**
 * The Stillgreen mark: a pill switch whose knob has a face. One inline SVG
 * holds both moods; data-mood picks one, and CSS slides the knob, cross-fades
 * the track and swaps the face. Decorative: the word or status text beside it
 * carries the meaning.
 */
export function BrandMark({ mood = "on", className = "" }: { mood?: BrandMood; className?: string }) {
  // Gradient ids must be unique per instance, or two marks on a page clash.
  const gradient = `sg-track-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={`${styles.mark} ${className}`}
      data-mood={mood}
      viewBox="0 0 64 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#a3e635" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect className={styles.trackOn} width="64" height="32" rx="16" fill={`url(#${gradient})`} />
      <rect className={styles.trackOff} width="64" height="32" rx="16" />
      <g className={styles.knob}>
        <circle cx="18" cy="16" r="12.5" fill="#fff" />
        <g className={styles.faceOn}>
          <path d="M11.38 14.31A2.13 2.13 0 0 1 15.63 14.31" fill="none" strokeWidth="1.88" strokeLinecap="round" />
          <path d="M20.38 14.31A2.13 2.13 0 0 1 24.63 14.31" fill="none" strokeWidth="1.88" strokeLinecap="round" />
          <path className={styles.grin} d="M11.75 17H24.25A6.25 6.25 0 0 1 11.75 17Z" />
        </g>
        <g className={styles.faceOff}>
          <circle cx="13.75" cy="14.13" r="1.38" />
          <circle cx="22.25" cy="14.13" r="1.38" />
          <path d="M13.5 22.25A5.17 5.17 0 0 1 22.5 22.25" fill="none" strokeWidth="1.88" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

export function Brand({ href = "/", compact = false, size = "md", mood = "on", className = "" }: BrandProps) {
  const classes = `${styles.brand} ${size === "sm" ? styles.sm : ""} ${className}`;
  const content = (
    <>
      <BrandMark mood={mood} />
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
