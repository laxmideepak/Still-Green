"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./button-class";
import { cx } from "./cx";
import styles from "./button.module.css";

export type { ButtonSize, ButtonVariant };

type CommonProps = {
  /** primary: the one main action in a view. Default: secondary. */
  variant?: ButtonVariant;
  /** sm 32px, md 36px (default), lg 40px. */
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks. Keep a label like "Saving". */
  loading?: boolean;
  /** Icon before the label (replaced by the spinner while loading). */
  icon?: ReactNode;
  /** Icon after the label, e.g. an arrow. */
  iconRight?: ReactNode;
  /** Full width. */
  block?: boolean;
  className?: string;
  children?: ReactNode;
};

export type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

export type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    /** Renders a link. Paths starting with "/" or "#" use Next's <Link>. */
    href: string;
    disabled?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Spinner({ className }: { className?: string }) {
  return <span className={cx(styles.spinner, className)} aria-hidden="true" />;
}

function isInternal(href: string) {
  return href.startsWith("/") || href.startsWith("#");
}

/**
 * The one button for the site. Renders <button>, or a link when `href` is set.
 *
 *   <Button variant="primary" onClick={save} loading={saving}>{saving ? "Saving" : "Save"}</Button>
 *   <Button href="/dashboard" variant="primary" iconRight={<ArrowRight />}>Open dashboard</Button>
 */
export function Button(props: ButtonProps & { iconOnly?: boolean }) {
  const {
    variant,
    size,
    loading = false,
    icon,
    iconRight,
    block,
    className,
    children,
    iconOnly,
    ...rest
  } = props;
  const classes = buttonClassName({ variant, size, block, iconOnly, loading, className });
  const lead = loading ? <Spinner /> : icon;
  const content = (
    <>
      {lead}
      {children}
      {iconRight}
    </>
  );

  if (typeof rest.href === "string") {
    const { href, disabled, ref, onClick, target, rel, ...anchor } = rest as ButtonAsLink;
    const blocked = disabled || loading;
    const shared = {
      ...anchor,
      className: classes,
      "aria-disabled": blocked || undefined,
      "aria-busy": loading || undefined,
      tabIndex: blocked ? -1 : anchor.tabIndex,
      onClick: blocked ? (event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault() : onClick,
    };
    if (isInternal(href)) {
      return (
        <Link ref={ref} href={href} target={target} rel={rel} {...shared}>
          {content}
        </Link>
      );
    }
    const external = /^https?:/.test(href);
    return (
      <a
        ref={ref}
        href={href}
        target={target ?? (external ? "_blank" : undefined)}
        rel={rel ?? (external ? "noreferrer" : undefined)}
        {...shared}
      >
        {content}
      </a>
    );
  }

  const { type = "button", disabled, ref, ...button } = rest as ButtonAsButton;
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...button}
    >
      {content}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children" | "icon" | "iconRight"> & {
  /** Accessible name; also shown as a tooltip. Required. */
  label: string;
  /** The icon to show. */
  children: ReactNode;
};

/**
 * A square button with only an icon. Default variant: ghost.
 *
 *   <IconButton label="Copy access code" onClick={copy}><Copy /></IconButton>
 */
export function IconButton({ label, children, variant = "ghost", ...rest }: IconButtonProps) {
  return (
    <Button
      {...(rest as ButtonProps)}
      variant={variant}
      iconOnly
      aria-label={label}
      title={label}
      icon={children}
    />
  );
}
