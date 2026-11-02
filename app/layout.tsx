import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// The token --font-sans reads --font-inter, and --font-mono reads --font-jetbrains-mono.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const title = "Stillgreen — keep your Slack status green on your schedule";
const description =
  "Stillgreen keeps your Slack status green during the hours you choose. It is free and runs on your own computer or your own cloud server. Your tokens never go to this website.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s — Stillgreen",
  },
  description,
  applicationName: "Stillgreen",
  keywords: ["Slack status", "Slack presence", "stay active on Slack", "self-hosted", "open source"],
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Stillgreen",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
