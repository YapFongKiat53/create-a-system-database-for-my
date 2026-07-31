import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

function getClient() {
  const bindings = env as unknown as { DATABASE_URL?: string };
  if (!bindings.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.dev.vars` (local dev) or as a secret (deployed)."
    );
  }
  if (!client) client = postgres(bindings.DATABASE_URL, { max: 5 });
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
