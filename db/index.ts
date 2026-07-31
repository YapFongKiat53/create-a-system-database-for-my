import { env } from "cloudflare:workers";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsTransaction } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type PgTx = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

function getClient() {
  const bindings = env as unknown as { DATABASE_URL?: string };
  if (!bindings.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.dev.vars` (local dev) or as a secret (deployed)."
    );
  }
  // Cloudflare Workers forbids reusing I/O objects (sockets) across request
  // boundaries, so the client can't be cached at module scope — create a
  // fresh one per call. Each client is now ephemeral (built fresh per
  // getDb() call, torn down with the request), so it only ever needs one
  // connection; Supabase's pooled (Supavisor) connection is designed for
  // exactly this pattern of many short-lived connections.
  return postgres(bindings.DATABASE_URL, { max: 1 });
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
