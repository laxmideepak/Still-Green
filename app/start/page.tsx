import type { Metadata } from "next";
import { StartGuide } from "@/components/start-guide";

export const metadata: Metadata = {
  title: "Local setup",
  description:
    "Run the Stillgreen presence daemon on your own machine, capture your Slack session with the bundled extension, then connect the Vercel dashboard with a URL and access code.",
};

export default function StartPage() {
  return <StartGuide />;
}
