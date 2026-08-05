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

function getClient(max: number) {
  const bindings = env as unknown as { DATABASE_URL?: string };
  if (!bindings.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.dev.vars` (local dev) or as a secret (deployed)."
    );
  }
  // Cloudflare Workers forbids reusing I/O objects (sockets) across request
  // boundaries, so the client can't be cached at module scope — create a
  // fresh one per call. Each client is now ephemeral (built fresh per
  // getDb() call, torn down with the request).
  //
  // `prepare: false` is required because the DATABASE_URL points at
  // Supavisor's transaction-mode pooler (port 6543): that pooler does not
  // keep a query's backend connection pinned across statements, so
  // postgres-js's default prepared-statement caching deadlocks as soon as
  // more than a couple of queries run concurrently on the same client.
  //
  // `max` is call-site tunable for the same reason: most handlers only run a
  // handful of sequential queries per request, so the small default below is
  // plenty. A handler such as the dashboard's GET /api/system, which fires
  // ~30 reads via `Promise.all([...])` against a single `getDb()` client,
  // needs a much larger pool — with too few connections, postgres-js has to
  // multiplex all of those over too few physical connections through the
  // transaction-mode pooler, and the excess queries stall until Postgres's
  // statement_timeout kills them — even though every individual query runs
  // in milliseconds in isolation. Both the prepared-statement deadlock and
  // the undersized-pool stall were confirmed via direct reproduction
  // (including replaying the exact query set from GET /api/system) during
  // Task 15 verification.
  return postgres(bindings.DATABASE_URL, { max, prepare: false });
}

export function getDb(options?: { max?: number }) {
  return drizzle(getClient(options?.max ?? 5), { schema });
}
