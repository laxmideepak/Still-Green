import type { Metadata } from "next";
import { DashboardRoute } from "@/components/dashboard-route";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Control your own Stillgreen daemon from the browser: pause, keep me online, schedule and workspaces. Shows sample data until you connect.",
};

export default function DashboardPage() {
  return <DashboardRoute />;
}
