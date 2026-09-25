# Student login separation + automated password-setup email

**Date**: 2026-09-25
**Scope**: A dedicated login entry point for tenants (`/student/login`), and
an automated "set your password" email (via Resend) sent the moment a
tenant login account is created, replacing the current manual
"staff-types-a-password-then-tells-the-student-out-of-band" flow. Not in
scope: a separate authentication backend, changing how staff accounts are
created or have their passwords set, or any change to session/cookie
mechanics beyond reusing what already exists.

---

## Why

Two gaps found while building the student portal:

1. **There's only one login page**, styled entirely for staff ("Hostel
   Operations | Internal Management System"), and tenants land on it too.
2. **Account provisioning has no path to the student at all.** Staff create
   a tenant's login (`user-save`) with no password, then separately type a
   password into a "Set password" field themselves (`user-set-password`),
   then have to tell the student that password some other way — there is
   no email-sending capability anywhere in this codebase today. This was
   discovered while investigating the null-`studentId` data-leak bug fixed
   in the prior security-fixes work: an account can exist in this
   "created, no password yet" state for an arbitrary length of time,
   which is exactly the state that bug was reachable from.

Both are fixed by: a tenant-branded login page reusing the existing
session/password backend, and a same-moment email with a one-time
"set your password" link — never a plaintext password — the instant a
tenant login is created.

## Decisions taken

| Question | Decision |
|---|---|
| How separate is "separate login system"? | **Only the entry page/URL and branding.** Same `app_users` table, same `hashPassword`/`verifyPassword` (`db/auth.ts`), same `user_sessions` table and cookie. No parallel auth backend — confirmed with the user this is the intended, smaller scope. |
| Where do students log in? | New `app/student/login/page.tsx`, resident-facing copy, submitting to the same `POST /api/auth` `{action: "login"}` the staff page already uses. `landingFor()` already sends a tenant to `/student` and everyone else to `/` — unchanged. |
| Does the old `/login` still work for tenants? | Yes, unchanged and not blocked — this is a UX/branding split, not an access-control split. `/login`'s own copy is updated to point tenants at `/student/login` instead of describing both audiences on one page. |
| Password delivery | **A one-time, expiring "set your password" link, never a plaintext password in the email** — the user's explicit choice over the simpler "email the generated password" alternative, given the account-security work already done this session. |
| New data needed | One new table, `password_setup_tokens` — a raw token is emailed, only its hash is ever stored, mirroring `user_sessions`' existing token-hash convention exactly. |
| When does the email fire | The moment a **new** tenant-role `app_users` row is inserted via the existing `user-save` action (covers both entry points that create one today: `UserManagement.tsx`'s "+ Add user" and `StudentInformation.tsx`'s "Enable tenant login"/"Add new student" flows, since both already funnel through this one action). Not fired on every `user-save` call — only the `!body.userId` (insert) branch, and only when the resolved role is `tenant`. |
| Re-sending | A new `user-resend-setup-email` action, usable from the same admin screens, for a tenant who never got the email or whose link expired — invalidates any prior unused token for that user and sends a fresh one. |
| Does setting the password log the student in? | Yes — after a successful `set-password-with-token`, the response also sets a real session cookie and returns `landing`, so the student never has to separately log in right after. Mirrors the existing login response shape exactly. |
| Email provider | **Resend**, the user's choice. Called via a plain `fetch` to Resend's REST API (`POST https://api.resend.com/emails`), no SDK dependency — matching this codebase's own established convention of talking to external services directly over REST (see `app/api/files/route.ts`'s comment on why it calls Supabase Storage's REST API directly rather than pulling in `@supabase/supabase-js`). |
| Credentials | `RESEND_API_KEY` and a "from" address (`RESEND_FROM_EMAIL`) as environment variables — **the user provides these** (a Resend account and a verified sending domain, or their sandbox domain for initial testing); not something this implementation can supply. |
| Email delivery must be awaited, not fire-and-forget | This app's dev/production runtime has already been found (this session, `checkExpiringLeases`) to kill `void someFn().catch()`-style background work the instant the HTTP response flushes. The Resend `fetch` call is awaited synchronously inside the `user-save`/`user-resend-setup-email` handlers, not fired-and-forgotten. |
| What happens if the email fails to send | Account creation still succeeds (a staff mistake in Resend configuration shouldn't block onboarding a tenant) — but the response carries a `noticeForClient`-style message telling staff the email failed and to use "Resend setup email," instead of silently claiming success. |

## Out of scope for this spec

- **A parallel/separate authentication backend for students.** Explicitly ruled out — same `app_users`/`user_sessions`, just a different front door.
- **Changing how staff accounts get passwords.** `user-set-password`'s manual staff-facing flow is untouched; this spec only changes the *tenant* provisioning path.
- **Forced password rotation, expiry, or complexity rules** beyond the existing 8-character minimum `user-set-password` already enforces (the new `set-password-with-token` flow reuses that same minimum).
- **Actually creating the Resend account or verifying a sending domain** — that's the user's own action outside this codebase.
- **Any change to the `/api/files` or `/api/system` auth fixes already shipped** — this spec builds on top of them, doesn't touch them.

---

## Data model

New table, `password_setup_tokens`, in `db/schema.ts` — mirrors `userSessions`' existing shape:

```ts
export const passwordSetupTokens = pgTable("password_setup_tokens", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => appUsers.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
```

A raw token is generated the same way `createSession` already does
(`toBase64(crypto.getRandomValues(new Uint8Array(32)))`), only its SHA-256
hash is ever persisted, and it expires — 24 hours is a reasonable window
for an onboarding email (long enough to not be a nuisance, short enough
that a stale, unused link isn't a standing risk). `usedAt` is set (not the
row deleted) once consumed, so there's an audit trail of when a student
actually set their password.

## Server helpers (`db/auth.ts`)

Two new functions, next to `createSession`/`destroySession`, reusing the
file's existing private `toBase64`/`sha256` helpers rather than
duplicating them:

```ts
const SETUP_TOKEN_HOURS = 24;

/** Creates a one-time password-setup token and returns the raw value (stored only as a hash). */
export async function createPasswordSetupToken(userId: number) {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(
    Date.now() + SETUP_TOKEN_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const db = getDb();
  // A fresh "resend" invalidates anything still outstanding for this user,
  // so only the most recently sent link ever works.
  await db
    .delete(passwordSetupTokens)
    .where(eq(passwordSetupTokens.userId, userId));
  await db
    .insert(passwordSetupTokens)
    .values({ tokenHash: await sha256(token), userId, expiresAt });
  return token;
}

/** Looks up an unused, unexpired setup token. Returns null if it's missing, used, or expired. */
export async function consumePasswordSetupToken(token: string) {
  if (!token) return null;
  const db = getDb();
  const row = (
    await db
      .select()
      .from(passwordSetupTokens)
      .where(eq(passwordSetupTokens.tokenHash, await sha256(token)))
  )[0];
  if (!row || row.usedAt || row.expiresAt < new Date().toISOString())
    return null;
  await db
    .update(passwordSetupTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(passwordSetupTokens.id, row.id));
  return row.userId;
}
```

(`sha256` and `toBase64` are already private, unexported functions in this
file — confirmed at `db/auth.ts:15,70` — these new functions live in the
same file so they can call them directly, no export needed.)

## Email sending (`app/api/email.ts`, new file)

```ts
export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from)
    throw new Error("Email is not configured (RESEND_API_KEY/RESEND_FROM_EMAIL missing)");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!response.ok)
    throw new Error(`Resend rejected the email: ${await response.text()}`);
}
```

A tiny, single-purpose module — deliberately not a general "email
templates" system, since this spec only needs the one email.

## Trigger points (`app/api/system/route.ts`)

**`user-save`** — read the actual current handler first: the existing
`tenantRole` lookup (`const tenantRole = (await db.select({id: appRoles.id})
...)[0]`) only runs inside `if (linkedStudentId) { ... }` — it is **not**
always computed, so it can't be reused as-is for a tenant account created
without a linked student (e.g. `UserManagement.tsx`'s "+ Add user" with
role set to Tenant directly, no student picked). Resolve independently,
after `roleId` is finalized:

```ts
const isNewTenant =
  !body.userId &&
  (
    await db.select({ id: appRoles.id }).from(appRoles).where(
      and(eq(appRoles.id, roleId), eq(appRoles.roleKey, "tenant")),
    )
  ).length > 0;
```

Then, after the existing `if (body.userId) ... else await
db.insert(appUsers).values(values)` branch, capture the inserted row's id
(`.returning({ id: appUsers.id })`) and, only when `isNewTenant`:

```ts
if (isNewTenant) {
  const token = await createPasswordSetupToken(insertedId);
  const setupUrl = `${asText(process.env.APP_URL, "")}${BASE_PATH}/set-password?token=${token}`;
  try {
    await sendEmail(
      values.email,
      "Set up your resident portal login",
      `<p>Hi ${values.displayName},</p><p>Your hostel resident account is ready. Set your password to sign in:</p><p><a href="${setupUrl}">${setupUrl}</a></p><p>This link expires in 24 hours.</p>`,
    );
  } catch (error) {
    noticeForClient = `Account created, but the setup email failed to send (${error instanceof Error ? error.message : "unknown error"}). Use "Resend setup email".`;
  }
}
```

`APP_URL` is a genuinely new environment variable — confirmed nothing like
it exists today (`docs/deploy-render.md` only documents `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `render.yaml`'s `envVars` list
has exactly those three plus `NODE_VERSION`/`HOSTNAME`). Add `APP_URL`,
`RESEND_API_KEY`, and `RESEND_FROM_EMAIL` to `render.yaml`'s `envVars` as
`sync: false` entries (matching the existing three secrets' pattern
exactly), and document all three in `docs/deploy-render.md` alongside the
existing secrets table, so a future deploy doesn't silently ship without
them the way the existing three are already guarded against.

`BASE_PATH` (used in the snippets above) is **not currently imported** in
`app/api/system/route.ts` — checked: no reference to it exists in that
file today (the frontend files import it from `app/basePath.ts`, a plain
constant reading `NEXT_PUBLIC_BASE_PATH ?? ""`, safe to import server-side
too). Add `import { BASE_PATH } from "../../basePath";` to `route.ts` for
this feature. It's needed here where it isn't for the existing
notification `link` fields (which are relative paths, auto-prefixed by
`<Link>` on the client) because an email link is a raw absolute URL that
never passes through Next's router at all — under a cPanel-style
subpath deployment (`CPANEL_BASE_PATH`/`NEXT_PUBLIC_BASE_PATH` non-empty)
the link would 404 without it.

**New action, `user-resend-setup-email`:**

```ts
} else if (action === "user-resend-setup-email") {
  const targetId = asNumber(body.userId);
  if (!targetId) throw new Error("User is required");
  const target = (
    await db.select().from(appUsers).where(eq(appUsers.id, targetId))
  )[0];
  if (!target) throw new Error("User not found");
  const token = await createPasswordSetupToken(targetId);
  const setupUrl = `${asText(process.env.APP_URL, "")}${BASE_PATH}/set-password?token=${token}`;
  await sendEmail(
    target.email,
    "Set up your resident portal login",
    `<p>Hi ${target.displayName},</p><p>Set your password to sign in:</p><p><a href="${setupUrl}">${setupUrl}</a></p><p>This link expires in 24 hours.</p>`,
  );
```

This one lets the email failure surface as a normal thrown error (staff
explicitly asked for a resend, so a clear failure is the right feedback,
unlike the "just finished creating the account" case above where the
account itself shouldn't look like it failed).

## New public route: `POST /api/auth` action `set-password-with-token`

Added to `handleAuth` in `app/api/auth/route.ts`, alongside the existing
`login`/`logout` branches — this endpoint is unauthenticated by design
(the token itself is the credential):

```ts
if (action === "set-password-with-token") {
  const token = String(body.token || "");
  const password = String(body.password || "");
  if (password.length < 8)
    return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const userId = await consumePasswordSetupToken(token);
  if (!userId)
    return Response.json({ error: "This link is invalid or has expired" }, { status: 400 });
  await getDb()
    .update(appUsers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(appUsers.id, userId));
  const row = (
    await getDb()
      .select({ roleKey: appRoles.roleKey })
      .from(appUsers)
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(eq(appUsers.id, userId))
  )[0];
  const { token: sessionToken } = await createSession(userId);
  await getDb()
    .update(appUsers)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(appUsers.id, userId));
  return new Response(
    JSON.stringify({ ok: true, landing: landingFor(row.roleKey) }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": sessionCookieHeader(sessionToken, request),
      },
    },
  );
}
```

## Frontend

### `app/student/login/page.tsx` (new)

A close copy of `app/login/page.tsx`'s structure (same "already signed
in? redirect" check, same form submit to `/api/auth`), with resident-facing
copy instead of the staff-facing brand block — e.g. "Resident Portal —
sign in to view your room, bills, and maintenance requests" in place of
"Hostel Operations | Internal Management System". No backend differences
from the staff login page at all; this is purely presentational.

### `app/login/page.tsx` (small copy change)

Add a line pointing tenants elsewhere — e.g. "Are you a resident? Sign in
at [the resident portal](/student/login) instead." — without removing or
gating tenant login here (see decisions table: not an access-control
split).

### `app/set-password/page.tsx` (new)

Public page, reads `?token=` from the URL. A simple form: new password +
confirm (client-side check they match, same 8-character minimum
message as the backend enforces). On submit, `POST /api/auth
{action: "set-password-with-token", token, password}`; on success,
`window.location.replace(result.landing)` exactly like the login page
already does. On failure (expired/invalid token), a clear message and a
mailto/contact-the-office fallback copy — there's no self-service "request
a new link" from this page itself (that's staff-initiated via "Resend
setup email"), so don't imply one.

### `UserManagement.tsx` / `StudentInformation.tsx` — one new button

Wherever a tenant account is shown that has **never signed in**
(`lastLoginAt` is null — checked: `data.users` exposes `lastLoginAt`
(`route.ts:2739`) but deliberately no password state, and it shouldn't
gain one; "never signed in" is the right, sufficient proxy for "hasn't
completed setup", and also correctly covers a tenant who was given a
password by hand but never used it), add a "Resend setup email" button
next to the existing "Set password" option, calling the new
`user-resend-setup-email` action. Leave the existing manual "Set
password" button in place too (a staff member can still directly set a
password by hand if they genuinely need to, e.g. no email address
available) — this spec adds a path, it doesn't remove the existing one.

## Error handling

- Resend not configured (missing env vars): `sendEmail` throws a clear
  message; `user-save`'s tenant-creation path catches it and still
  succeeds with a `noticeForClient` explanation (see decisions table);
  `user-resend-setup-email` surfaces it as a normal action failure.
- Expired or already-used token: `set-password-with-token` returns a
  clear "invalid or expired" message, not a generic error.
- Password too short: enforced both client-side (immediate feedback) and
  server-side (the actual guard), matching `user-set-password`'s existing
  8-character rule exactly — don't invent a different minimum.

## Testing

Same approach as every other feature this session: synthetic fixtures
against the real dev database, cleaned up after each check.

1. Create a tenant login via `user-save` (no `userId`) → confirm a
   `password_setup_tokens` row exists for the new user, and (with
   `RESEND_API_KEY` set to a real sandbox key) confirm an actual email
   arrives at a real test inbox with a working link.
2. Visit the link's `/set-password?token=...` URL, set a password →
   confirm `appUsers.passwordHash` is now set, the token's `usedAt` is
   set, and the response includes a valid session cookie + correct
   `landing`.
3. Attempt to reuse the same token a second time → confirm rejection
   ("invalid or expired"), not a second successful password change.
4. Attempt an expired token (backdate one via direct SQL) → confirm
   rejection.
5. `user-resend-setup-email` on an account that already has one
   outstanding token → confirm the old token no longer works and only
   the new one does.
6. Confirm `/login` still successfully logs a tenant in (the split is
   cosmetic, not an access gate) and `/student/login` still successfully
   logs a staff member in (redirecting them to `/`, not blocking them).
7. Confirm `RESEND_API_KEY` unset → `user-save`'s tenant-creation path
   still succeeds, with the documented `noticeForClient` failure message,
   and no crash.
8. `tsc --noEmit` / `eslint` clean on every new/changed file.
