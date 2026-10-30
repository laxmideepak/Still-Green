import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// The dashboard talks from the browser straight to the user's daemon, normally
// http://127.0.0.1:8765, so connect-src allows loopback on any port and https
// daemons. Next's inline bootstrap scripts need 'unsafe-inline' without nonces;
// the dev server also needs 'unsafe-eval' for fast refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
