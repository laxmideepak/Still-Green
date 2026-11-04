import styles from "./velocity-marquee.module.css";

/**
 * A strip of big text that drifts sideways forever. It is a plain CSS
 * animation of transform, which the browser runs off the main thread, so it
 * stays smooth even while the page is busy.
 */
export function VelocityMarquee({
  items,
  baseVelocity = -2,
  outline = false,
}: {
  items: string[];
  /** Negative drifts left, positive drifts right. Bigger is faster. */
  baseVelocity?: number;
  outline?: boolean;
}) {
  const row = items.map((item, i) => (
    <span key={i} className={styles.item}>
      {item}
      <i className={styles.star} aria-hidden="true">
        ✳
      </i>
    </span>
  ));

  return (
    <div className={`${styles.strip} ${outline ? styles.outline : ""}`} aria-hidden="true">
      <div
        className={styles.track}
        data-direction={baseVelocity > 0 ? "right" : "left"}
        style={{ "--marquee-duration": `${Math.round(90 / Math.max(0.5, Math.abs(baseVelocity)))}s` } as React.CSSProperties}
      >
        {row}
        {row}
        {row}
        {row}
      </div>
    </div>
  );
}
