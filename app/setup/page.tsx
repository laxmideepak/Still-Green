import type { Metadata } from "next";
import { SetupGuide } from "@/components/setup-guide";

export const metadata: Metadata = {
  title: "Setup guide",
  description:
    "Set up Stillgreen step by step: install it, start it, add your Slack with the extension, connect the dashboard, check your setup, or (advanced) run it on a cloud server.",
};

export default function SetupPage() {
  return <SetupGuide />;
}
