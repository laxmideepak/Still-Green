import type { Metadata } from "next";
import { StartGuide } from "@/components/start-guide";

export const metadata: Metadata = {
  title: "Quick start",
  description:
    "Get Stillgreen running in four steps, then look up every sg-local command: start and stop, workspaces, schedule, pause and Keep me online.",
};

export default function StartPage() {
  return <StartGuide />;
}
