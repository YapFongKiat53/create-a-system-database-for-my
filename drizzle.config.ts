import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/pg",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Read from `.dev.vars` at generate-time via the same env var name used
    // at runtime. drizzle-kit reads plain `process.env`, not the Workers
    // `env` binding, so this only works when DATABASE_URL is also exported
    // as a shell env var when running `npm run db:generate` (see Task 13).
    url: process.env.DATABASE_URL!,
  },
});
