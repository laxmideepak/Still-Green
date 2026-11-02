"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Trash } from "../icons";
import { Button } from "./button";
import { cx } from "./cx";
import styles from "./dialog.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogProps = {
  open: boolean;
  /** Called on Escape, a backdrop click, or your own Cancel button. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Round icon next to the title. A trash icon is used for tone="danger" if none is given. */
  icon?: ReactNode;
  tone?: "default" | "danger";
  /** Footer buttons, right-aligned. Put the safe choice first; mark the control to focus first with data-autofocus. */
  actions?: ReactNode;
  /** Extra content under the description, e.g. form fields. */
  children?: ReactNode;
  size?: "md" | "lg";
  /** Set false to ignore backdrop clicks (e.g. while a form is dirty). */
  closeOnBackdrop?: boolean;
  /**
   * Where focus goes on close if the control that opened the dialog is gone,
   * e.g. the Remove button of a row that was just removed.
   */
  returnFocus?: () => HTMLElement | null | undefined;
  className?: string;
};

/**
 * A modal built on the native <dialog>: the page behind it is inert, Tab stays
 * inside, Escape closes, and focus goes back to where it was.
 *
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Add a workspace"
 *     actions={<><Button onClick={close}>Cancel</Button><Button variant="primary">Add</Button></>}>
 *     …fields…
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "default",
  actions,
  children,
  size = "md",
  closeOnBackdrop = true,
  returnFocus,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      // showModal focuses the first control; data-autofocus picks another one.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const opener = returnTo.current;
      if (opener && opener.isConnected) opener.focus?.();
      else returnFocus?.()?.focus?.();
    }
    // returnFocus is read only when the dialog closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close the native dialog if the component unmounts while open.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const shownIcon = icon ?? (tone === "danger" ? <Trash /> : null);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, size === "lg" && styles.lg, tone === "danger" && styles.danger, className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          const inside =
            event.clientX >= box.left &&
            event.clientX <= box.right &&
            event.clientY >= box.top &&
            event.clientY <= box.bottom;
          if (!inside) onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {open && (
        <>
          <div className={styles.body}>
            {shownIcon && (
              <span className={styles.icon} aria-hidden="true">
                {shownIcon}
              </span>
            )}
            <div className={styles.text}>
              <h2 className={styles.title} id={titleId}>
                {title}
              </h2>
              {description && (
                <p className={styles.description} id={descriptionId}>
                  {description}
                </p>
              )}
            </div>
          </div>
          {children && <div className={styles.content}>{children}</div>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </>
      )}
    </dialog>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Label of the confirming button, e.g. "Remove workspace". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button and a trash icon. Use for anything that deletes or cannot be undone. */
  destructive?: boolean;
  /** Shows a spinner on the confirm button while the action runs. */
  loading?: boolean;
  /** Round icon next to the title. Defaults to a trash icon when destructive. */
  icon?: ReactNode;
  returnFocus?: DialogProps["returnFocus"];
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Ask before doing something you can't take back. Never use window.confirm().
 *
 *   <ConfirmDialog open={removing} destructive title="Remove Acme Corp?"
 *     description="Stillgreen stops keeping you active there and deletes its saved tokens."
 *     confirmLabel="Remove workspace" onConfirm={remove} onCancel={() => setRemoving(false)} />
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  loading,
  icon,
  returnFocus,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      icon={icon}
      returnFocus={returnFocus}
      tone={destructive ? "danger" : "default"}
      actions={
        <>
          <Button onClick={onCancel} data-autofocus disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
