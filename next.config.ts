import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone/ build (its own minimal
  // node_modules, traced from what's actually imported) — this is what
  // gets uploaded to cPanel's Node.js app, run directly as `node
  // server.js` rather than needing the full project + node_modules.
  output: "standalone",
};

export default nextConfig;
