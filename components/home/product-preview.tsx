import { Badge, Button } from "@/components/ui";
import { CheckCircle, Lock, Pause } from "@/components/icons";
import styles from "./product-preview.module.css";

type Workspace = {
  initial: string;
  name: string;
  host: string;
  tone: "info" | "warning" | "violet";
  status: { label: string; tone: "success" | "warning" | "violet" };
};

// Example workspaces for the picture only. Not real people or data.
const workspaces: Workspace[] = [
  { initial: "A", name: "Acme Corp", host: "acme-corp.slack.com", tone: "info", status: { label: "Active", tone: "success" } },
  { initial: "N", name: "Northwind", host: "northwind.slack.com", tone: "warning", status: { label: "Paused", tone: "warning" } },
  { initial: "D", name: "Design Club", host: "designclub.slack.com", tone: "violet", status: { label: "Away (set by you)", tone: "violet" } },
];

const ticks = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"];

/**
 * A small, still picture of the dashboard, built from the real UI parts.
 * It is inert: not focusable and hidden from screen readers, which get the
 * figure's label instead.
 */
export function ProductPreview() {
  return (
    <figure className={styles.figure} aria-label="Preview of the Stillgreen dashboard">
      <div className={styles.frame} inert>
        <div className={styles.chrome}>
          <span className={styles.dots}>
            <i />
            <i />
            <i />
          </span>
          <span className={styles.url}>
            <Lock />
            stillgreen.vercel.app/dashboard
          </span>
          <span className={styles.chromeSpacer} />
        </div>

        <div className={styles.body}>
          <div className={`${styles.panel} ${styles.status}`}>
            <span className={styles.pulse}>
              <i />
            </span>
            <span className={styles.statusText}>
              <strong>Active</strong>
              <span>Online until 5:00 PM</span>
            </span>
            <Button size="sm" icon={<Pause />}>
              Pause
            </Button>
          </div>

          <div className={`${styles.panel} ${styles.timeline}`}>
            <div className={styles.timelineHead}>
              <span className={styles.timelineDay}>Today · Thursday</span>
              <span className={styles.mono}>9:00 AM – 5:00 PM</span>
            </div>
            <div className={styles.bar}>
              <span className={styles.on} />
              <span className={styles.now} />
            </div>
            <div className={styles.ticks}>
              {ticks.map((tick, index) => (
                <span key={index}>{tick}</span>
              ))}
            </div>
          </div>

          <ul className={`${styles.panel} ${styles.list}`}>
            {workspaces.map((ws) => (
              <li key={ws.name} className={styles.row}>
                <span className={`${styles.avatar} ${styles[ws.tone]}`}>{ws.initial}</span>
                <span className={styles.wsText}>
                  <span className={styles.wsName}>{ws.name}</span>
                  <span className={styles.wsHost}>{ws.host}</span>
                </span>
                <Badge tone={ws.status.tone} dot>
                  {ws.status.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={styles.toast} inert>
        <span className={styles.toastIcon}>
          <CheckCircle />
        </span>
        <span className={styles.toastText}>
          <strong>Schedule started</strong>
          <span>Active in Acme Corp at 9:00 AM</span>
        </span>
      </div>
    </figure>
  );
}
