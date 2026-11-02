import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { MotionShell } from "@/components/motion/motion-shell";
import { RevealObserver } from "@/components/motion/reveal-observer";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["wdth", "opsz"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const description =
  "A self-hosted Slack presence daemon. Keep your green dot active during the hours you choose, with no relay and no telemetry.";

export const metadata: Metadata = {
  title: {
    default: "Stillgreen — Slack presence on your schedule",
    template: "%s — Stillgreen",
  },
  description,
  applicationName: "Stillgreen",
  keywords: [
    "Slack presence",
    "self-hosted",
    "presence daemon",
    "slack green",
    "local-first",
  ],
  openGraph: {
    title: "Stillgreen — Slack presence on your schedule",
    description,
    type: "website",
    siteName: "Stillgreen",
  },
  twitter: {
    card: "summary",
    title: "Stillgreen — Slack presence on your schedule",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#050806",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Lets CSS hide not-yet-revealed content only when JavaScript runs. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <a className="skipLink" href="#main">
          Skip to content
        </a>
        <MotionShell>{children}</MotionShell>
        <RevealObserver />
      </body>
    </html>
  );
}
