"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, X } from "../icons";
import { cx } from "./cx";
import styles from "./toast.module.css";

export type ToastTone = "neutral" | "success" | "danger" | "warning" | "info";

export type ToastOptions = {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** One quick follow-up such as "Undo". The toast closes after it runs. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it closes on its own. 0 keeps it until dismissed. Default 5000. */
  duration?: number;
};

type ToastItem = ToastOptions & { id: number };

type ToastApi = {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Put once near the root (app/layout.tsx does this). Then:
 *
 *   const { toast } = useToast();
 *   toast({ tone: "success", title: "Staying online", description: "Until 3:46 PM today" });
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = next.current++;
    // Keep the newest three; older ones have been read or are stale.
    setItems((list) => [...list.slice(-2), { ...options, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className={styles.region} aria-label="Notifications" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() needs a <ToastProvider> above it.");
  return api;
}

const toneIcon: Record<ToastTone, ReactNode> = {
  neutral: null,
  success: <Check strokeWidth={3} />,
  danger: <X strokeWidth={3} />,
  warning: <AlertTriangle strokeWidth={2.5} />,
  info: <Info strokeWidth={2.5} />,
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { title, description, tone = "neutral", action, duration = 5000 } = item;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!duration || paused) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, paused, onDismiss]);

  return (
    <div
      className={cx(styles.toast, tone !== "neutral" && styles[tone])}
      role={tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toneIcon[tone] && (
        <span className={styles.icon} aria-hidden="true">
          {toneIcon[tone]}
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss notification">
        <X />
      </button>
    </div>
  );
}
