import type { Metadata } from "next";
import { DashboardRoute } from "@/components/dashboard-route";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Control your Stillgreen daemon: presence, schedules, workspaces, and an honest sample preview when no daemon is connected.",
};

export default function DashboardPage() {
  return <DashboardRoute />;
}
