import type { CSSProperties } from "react";
import { cx } from "./cx";
import styles from "./skeleton.module.css";

export type SkeletonProps = {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
  className?: string;
};

/**
 * A grey placeholder while data loads. Hidden from screen readers, so put
 * aria-busy="true" on the region that is loading.
 *
 *   <div aria-busy="true"><Skeleton width="60%" height={16} /><Skeleton width="90%" /></div>
 */
export function Skeleton({ width = "100%", height = 12, radius, className }: SkeletonProps) {
  return (
    <span
      className={cx(styles.skeleton, className)}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
