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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.env` (local dev) or the hosting environment's variables (deployed).",
    );
  }
  // A fresh client per call, never cached at module scope — confirmed by
  // direct reproduction that a shared, long-lived pool against Supabase's
  // Supavisor transaction-mode pooler eventually hangs (later requests time
  // out waiting for a connection that never frees up), even on a plain
  // Node.js server where nothing forces this the way Cloudflare Workers
  // does (Workers forbids reusing I/O objects like sockets across request
  // boundaries in the first place). `prepare: false` is required because
  // Supavisor's transaction-mode pooler does not keep a query's backend
  // connection pinned across statements, so postgres-js's default
  // prepared-statement caching deadlocks as soon as more than a couple of
  // queries run concurrently on the same client. `max: 20` covers the
  // heaviest handler (the dashboard's GET /api/system, which fires ~30
  // reads via `Promise.all([...])` against a single client) — see Task 15
  // verification for why an undersized pool stalls those queries.
  // idle_timeout / max_lifetime are what stop the "fresh client per call"
  // rule above from becoming a connection leak. Nothing in the codebase ever
  // calls .end() — a handler takes a client, uses it, and drops it — so
  // without a timeout every request leaves up to 20 sockets open against
  // Supavisor forever. On a long-running server that climbs until the pooler
  // refuses new clients with EMAXCONN (limit: 200), at which point the
  // process already holding connections keeps working while everything else
  // is locked out, which is exactly how it presented. These two make an
  // abandoned pool close itself shortly after the request that opened it.
  return postgres(databaseUrl, {
    max: 20,
    prepare: false,
    // Seconds a connection may sit unused before it is closed. Longer than a
    // request takes, short enough that an abandoned pool does not outlive it
    // by much.
    idle_timeout: 20,
    // A hard ceiling regardless of activity, so nothing accumulates even
    // under steady traffic.
    max_lifetime: 60 * 10,
  });
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
