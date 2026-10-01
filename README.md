# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Authentication

This app authenticates purely by session cookie (`db/auth.ts`'s
`getSessionUser`/`createSession`, backed by `user_sessions` in Postgres) —
there is no reverse proxy or workspace host in front of the deployed app
(it runs directly on Render or cPanel, see `docs/deploy-render.md`) able to
set or verify an identity header on its behalf. An earlier version of this
starter also trusted an `oai-authenticated-user-email` request header as a
fallback identity source for exactly that kind of proxied deployment; that
fallback was removed from `resolveCurrentUser` in `app/api/system/route.ts`
because, without a trusted proxy actually stripping and re-setting that
header, any caller could set it themselves and be authenticated as anyone.
Do not reintroduce header-based identity here unless this app is genuinely
deployed behind a proxy that owns and verifies that header itself.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
