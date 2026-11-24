import type { Metadata } from "next";
import { StartGuide } from "@/components/start-guide";

export const metadata: Metadata = {
  title: "Commands",
  description:
    "Every sg-local command in one place: start and stop, workspaces, schedule, pause and Keep me online.",
};

export default function StartPage() {
  return <StartGuide />;
}
