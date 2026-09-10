# Deploying to Render (free plan)

Everything in the repo is ready. What is left needs your Render account and
your secrets, so those steps are yours — they are listed below in order.

---

## What was set up here

| File | What it does |
|---|---|
| `render.yaml` | The whole service definition — plan, region, build/start commands, health check, which env vars to prompt for |
| `.node-version` | Pins Node to 22.13.0, matching `engines` in `package.json` |
| `package.json` | `build:standalone` / `start:standalone` are the real scripts; `build:cpanel` / `start:cpanel` now just call them, so the existing cPanel process is unchanged |

### Why the standalone server and not `next start`

`next.config.ts` sets `output: "standalone"`. Next refuses to support
`next start` with it:

```
⚠ "next start" does not work with "output: standalone" configuration.
  Use "node .next/standalone/server.js" instead.
```

The build therefore copies the two directories the traced bundle does not
include (`.next/static`, `public`) and the start command runs the server
directly. Verified locally: login page 200, `/api/system` 401 without a
session, a static chunk served 200 at 28 KB.

---

## Before you start

- The app must be in a **GitHub / GitLab / Bitbucket repo** Render can read.
- **Supabase stays where it is.** Render's own free Postgres is wiped after
  30 days — do not add one. The app reaches Supabase over the network.
- Have the three secrets to hand: `DATABASE_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. They are in your local `.env.local` /
  `.dev.vars`, both of which are correctly git-ignored and must stay that way.

---

## Steps

> **`render.yaml` only applies to a service created as a Blueprint.** A
> service created through New → Web Service ignores the file entirely and
> falls back to Render's own defaults, which for this repo means
> `npm run build` — and that is `vinext build`, the Cloudflare Workers build,
> not the Node one. If the service already exists, use "Fixing an existing
> service" at the bottom instead of these steps.

**1. Push the branch.** `render.yaml` has to be in the repo Render reads.

**2. Render → New → Blueprint**, pick the repo. Render reads `render.yaml`
and proposes one web service named `hostel-operations`.

**3. It will prompt for three values** (they are marked `sync: false`, which
means "ask, never store in the repo"):

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → **Connection pooling** string, not the direct one. It must be the Supavisor pooler; the app sets `prepare: false` specifically for it |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. This is a **service-role** key — full read/write, no row-level security. It belongs only in the server environment |

**4. Apply.** First build takes a few minutes (`npm ci` plus `next build`).

`render.yaml` also sets `HOSTNAME=0.0.0.0`. That one is not optional: Next's
standalone server binds to `process.env.HOSTNAME || "0.0.0.0"`, and Render
sets `HOSTNAME` to the container's own name. Left alone, the server listens
on that single interface, Render's proxy cannot reach it, and every request
returns 502 while the logs cheerfully report the service is live.

**5. Check it came up.** Open `https://<your-service>.onrender.com/login`.
You should get the sign-in page. Then sign in and load Finance — that is the
heaviest page (~30 queries in one request) and the best single smoke test.

---

## What the free plan actually gives you

| | |
|---|---|
| Instance hours | 750 per workspace per calendar month — a single service running all month fits, two do not |
| Sleep | Spins down after **15 minutes** with no inbound traffic; the next request waits about **a minute** while it wakes |
| Disk | None that survives a restart. Fine here: uploads go to Supabase Storage, not local disk |
| Shell access | Not available on free — no `ssh` into the instance to run a migration |

### The sleep is survivable for this app, and here is why

The daily housekeeping — late-payment charges and building the month's
billing cycle — runs on the first request of the day and is fired without
being awaited, so nobody waits for it. On a real Node process that work
finishes even though the response has already gone. Serverless is where that
breaks, which is why this is a web service and not a function.

Practically: the first person in each morning waits about a minute, the app
then stays awake while anyone is using it.

---

## Known risks, in order

**1. Migrations have to be run from your machine.** Free has no shell. The
three applied-but-uncommitted migrations (0019, 0020, 0021) were run with
one-off scripts against `DATABASE_URL`, and that stays the process. Never
point a migration at production without a backup first.

**2. There is now exactly one lockfile, and it has to stay that way.**
`pnpm-lock.yaml` was removed because it broke the first deploy: Render sees a
pnpm lockfile and switches the whole build to pnpm, and that lockfile was
seven weeks stale — missing `postgres` and seven other dependencies — so
`pnpm install --frozen-lockfile` refused to run, `node_modules` was never
installed, and the build died on `vinext: not found`. Adding a second
lockfile back would reproduce this exactly.

**3. Database connections are worth watching.** `getDb()` opens a fresh pool
of up to 20 per call and **nothing in the codebase ever closes one** — there
is no `.end()` anywhere. A full dashboard load calls it two or three times.
Measured against Supabase, the database-side connection count went 7 → 11
under fifteen requests and then stayed flat, so the Supavisor pooler is
absorbing it. What was not measured is the socket count inside the Node
process, which is the number that matters on a small instance. Watch memory
and connection errors after the first busy day.

**4. Free plans are discontinued without much warning.** Fly.io and Railway
both ended theirs this year. This system holds 527 tenancies, identity
numbers, owner bank details and roughly RM 390,000 of monthly billing. Keep a
restorable Supabase backup independent of whoever is hosting the app.

---

## Do not set `CPANEL_BASE_PATH`

It exists only because cPanel serves the app under `/system` without
stripping the prefix. On Render the app is at the domain root; setting it
would break every asset and API path. It is deliberately absent from
`render.yaml`.


---

## Fixing an existing service that was created by hand

A service created through New → Web Service never reads `render.yaml`. Either
delete it and recreate it as a Blueprint, or set the two commands yourself in
**Settings → Build & Deploy**:

| Setting | Value |
|---|---|
| Build Command | `npm ci && npm run build:standalone` |
| Start Command | `npm run start:standalone` |

Then add one environment variable, which a hand-made service will not have:

| Key | Value |
|---|---|
| `HOSTNAME` | `0.0.0.0` |

Without it every request is a 502 — see step 4 above for why. The three
secrets are already on the service and need no change.

Setting them by hand works, but it does mean `render.yaml` is then only
documentation: the dashboard is what actually runs. Recreating as a Blueprint
keeps one source of truth.
