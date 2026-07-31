import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function getClient() {
  const bindings = env as unknown as { DATABASE_URL?: string };
  if (!bindings.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.dev.vars` (local dev) or as a secret (deployed)."
    );
  }
  // Cloudflare Workers forbids reusing I/O objects (sockets) across request
  // boundaries, so the client can't be cached at module scope — create a
  // fresh one per call. Supabase's pooled (Supavisor) connection is designed
  // for exactly this pattern of many short-lived connections.
  return postgres(bindings.DATABASE_URL, { max: 5 });
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
