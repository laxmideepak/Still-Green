import type { Metadata } from "next";
import { SetupGuide } from "@/components/setup-guide";

export const metadata: Metadata = {
  title: "Setup",
  description:
    "Run the Stillgreen Slack presence daemon on your machine: clone, add tokens locally, set a schedule, and start the daemon.",
};

export default function SetupPage() {
  return <SetupGuide />;
}
