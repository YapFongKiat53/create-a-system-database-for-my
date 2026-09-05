import type { NextConfig } from "next";

// cPanel's Setup Node.js App proxies this app under a URL prefix
// (hostelpro.com.my/system) rather than at the domain root, and doesn't
// strip that prefix before forwarding requests — so the app must know its
// own basePath to route pages/assets/APIs correctly. Only set for the
// cPanel build (see build:cpanel in package.json); local dev via
// `vinext dev` stays unprefixed.
const basePath = process.env.CPANEL_BASE_PATH;

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone/ build (its own minimal
  // node_modules, traced from what's actually imported) — this is what
  // gets uploaded to cPanel's Node.js app, run directly as `node
  // server.js` rather than needing the full project + node_modules.
  output: "standalone",
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
