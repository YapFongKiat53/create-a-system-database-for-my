import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // The app talks to Postgres (Supabase) via DATABASE_URL, not D1 — this
  // binding is unused dead weight from the original scaffold and its
  // database_id is a placeholder that doesn't exist in any real account, so
  // it's left empty rather than pointed at a database nothing reads from.
  d1_databases: [],
  // R2 isn't enabled on the Cloudflare account yet, so the bucket binding is
  // left empty for now — file uploads (payment slips, etc.) return "File
  // storage is not available yet" until it's turned on and this is restored
  // to `r2 ? [{ binding: r2, bucket_name: "hostel-project-files" }] : []`.
  r2_buckets: [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // 方案二：加入 allowedHosts 允许所有 ngrok 域名
      allowedHosts: [".ngrok-free.app"],
      // 保留原本 Codex 沙盒的 watch 逻辑
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});