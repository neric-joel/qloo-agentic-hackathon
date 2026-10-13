import type { NextConfig } from "next";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

/**
 * Origin of the API service that `/api/*` is proxied to.
 * An empty value falls back to the local default; a missing scheme is assumed to be https.
 */
function resolveBackendUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_BACKEND_URL;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No dev-mode badge in the corner: it shows up in every screenshot and is not part of the page.
  devIndicators: false,
  // Do not write tooling instruction files into the repository on `next dev`.
  agentRules: false,
  // With gzip on, the Node server holds an event stream back until it ends (browsers always send
  // Accept-Encoding: gzip), so the rewrite below would deliver every event at once. Hosted
  // deployments compress at the edge regardless of this setting.
  compress: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${resolveBackendUrl(process.env.BACKEND_URL)}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
