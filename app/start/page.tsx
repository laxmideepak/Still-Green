import type { Metadata } from "next";
import { StartGuide } from "@/components/start-guide";

export const metadata: Metadata = {
  title: "Cloud setup",
  description:
    "Run the Stillgreen presence daemon on an always-on cloud host, then connect the Vercel dashboard with your daemon URL and access code.",
};

export default function StartPage() {
  return <StartGuide />;
}
