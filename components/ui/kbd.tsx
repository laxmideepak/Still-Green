import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./kbd.module.css";

/** A key on the keyboard: <Kbd>Esc</Kbd> */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cx(styles.kbd, className)} {...rest} />;
}
