# Student Login + Password-Setup Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A resident-facing login page (`/student/login`), and a one-time "set your password" link emailed via Resend the moment a tenant login is created.

**Design spec (authoritative — read it, all code blocks live there):** `docs/superpowers/specs/2026-09-25-student-login-and-setup-email-design.md`

**Architecture:** Same `app_users`/`user_sessions`/password hashing as today; adds one table (`password_setup_tokens`), two helpers in `db/auth.ts`, a small `sendEmail` module (plain `fetch` to Resend), one new public action on `/api/auth`, a hook in `user-save` plus a `user-resend-setup-email` action, and three small pages/buttons.

## Global Constraints

- No test framework — verify with `npx tsc --noEmit`, `npx eslint <files>`, and live checks against the real dev DB using synthetic `ZZTEST` fixtures cleaned up after.
- **No git commits.** **No `rm -rf`** on directories (`.claude-scratch/` is git-tracked); targeted `rm` of your own files only.
- Email must be **awaited**, never fire-and-forget (this runtime kills un-awaited background work).
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `APP_URL` are supplied by the user; they will NOT be set during implementation. Verify the "not configured" path for real; the real-send path is verified by code review only (do not fabricate a key).
- Never store a raw setup token; only its SHA-256 hash. Never put a password in an email.
- Real production data: all destructive/creating checks use synthetic fixtures only.

---

### Task 1: `password_setup_tokens` table

**Files:** Modify `db/schema.ts`; generated `drizzle/pg/00XX_*.sql`; temp apply script in `.claude-scratch/` (delete after).

- [ ] Add the `passwordSetupTokens` table exactly as in the spec's "Data model" section (after `userSessions`).
- [ ] `npm run db:generate` (tracked, drift-only), then hand-write an idempotent `CREATE TABLE IF NOT EXISTS password_setup_tokens (...)` + unique index script matching the generated SQL, run it with `node` against `DATABASE_URL` (same workflow used for earlier migrations this project; there is no `db:migrate` script). Confirm the table exists via a query. Delete the script.
- [ ] `npx tsc --noEmit`.

### Task 2: Token helpers, `sendEmail`, and `set-password-with-token`

**Files:** Modify `db/auth.ts`, `app/api/auth/route.ts`; create `app/api/email.ts`.

- [ ] Add `createPasswordSetupToken` / `consumePasswordSetupToken` to `db/auth.ts` per the spec's "Server helpers" (import `passwordSetupTokens`; reuse the file's private `toBase64`/`sha256`).
- [ ] Create `app/api/email.ts` per the spec's "Email sending".
- [ ] Add the `set-password-with-token` branch to `handleAuth` per the spec, before the `action !== "login"` rejection. Reuse `hashPassword`, `createSession`, `sessionCookieHeader`, `landingFor`. Also import what's missing (`hashPassword`, `consumePasswordSetupToken`).
- [ ] tsc + eslint on the three files.
- [ ] Live verify against dev DB (synthetic tenant user, dev server on :3000): valid token → password set, `used_at` set, session cookie + `landing:"/student"` returned, subsequent `/api/auth` login with the new password works; reuse of same token → 400 "invalid or expired"; backdated-expired token → 400; password < 8 chars → 400 and token NOT consumed (check ordering: validate length before consuming — if the spec's snippet consumes first, fix so a too-short password doesn't burn the link). Clean up all fixtures.

### Task 3: Trigger on tenant creation + resend action + env config

**Files:** Modify `app/api/system/route.ts`, `render.yaml`, `docs/deploy-render.md`.

- [ ] Add `import { BASE_PATH } from "../../basePath";`, `sendEmail`, `createPasswordSetupToken` imports.
- [ ] Update `user-save` per the spec's "Trigger points" (independent `isNewTenant` role check; `.returning({id})` on insert; awaited send; failure → `noticeForClient`, account still created).
- [ ] Add `user-resend-setup-email` action per the spec (failure surfaces as a thrown error). Confirm the POST permission gate treats it like `user-save`/`user-set-password` (check `moduleForAction` so it's covered by the same users-module permission; a tenant must not be able to call it — the tenant-action allow-list work from the earlier security plan is NOT yet in place, so explicitly reject `currentUser.roleKey === "tenant"` inside this handler).
- [ ] Add `APP_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` to `render.yaml` `envVars` (`sync: false`) and to the env-var table in `docs/deploy-render.md`.
- [ ] tsc + eslint (only the 2 known baseline warnings allowed).
- [ ] Live verify (Resend env vars UNSET): `user-save` creating a new tenant login (no userId) returns success, creates a `password_setup_tokens` row, and the response notice reports the email failure (not a crash); `user-save` with a userId (update) does NOT create a token; creating a non-tenant (staff) account does NOT create a token; `user-resend-setup-email` invalidates the earlier token (old hash gone, new present) and surfaces the "not configured" error. Clean up fixtures.

### Task 4: Pages — `/student/login`, `/set-password`, `/login` copy

**Files:** Create `app/student/login/page.tsx`, `app/set-password/page.tsx`; modify `app/login/page.tsx`.

- [ ] **Important:** `app/student/layout.tsx` currently redirects any signed-out visitor to `/login` — it would also wrap `/student/login`. Read it and make sure `/student/login` renders WITHOUT the auth guard/tab bar/`SystemProvider` (e.g. move the guarded shell into a route group `app/student/(portal)/...`, or have the layout skip the guard for the login path). Choose the least invasive option that keeps all existing `/student/*` routes working; report what you chose.
- [ ] `/student/login`: structure copied from `app/login/page.tsx` with resident-facing copy per the spec. `/set-password`: per the spec (token from `?token=`, password+confirm, 8-char min, on success `window.location.replace(landing)`; clear expired/invalid message, no fake "request new link" affordance). Both must work signed out.
- [ ] `/login`: add the pointer line to `/student/login`; do not gate tenant login.
- [ ] tsc + eslint; browser-verify (dev server, Browser pane): all three pages render signed-out; `/student/login` logs a synthetic tenant in and lands on `/student`; `/set-password?token=<synthetic>` end-to-end sets a password and lands on `/student`; expired token shows the message; existing `/student` still redirects signed-out users (to `/login` or `/student/login` — pick `/student/login` for the portal guard if trivial, report either way). Clean up fixtures.

### Task 5: "Resend setup email" buttons

**Files:** Modify `app/modules/UserManagement.tsx`, `app/modules/StudentInformation.tsx`.

- [ ] Per the spec's "one new button" section: for tenant users with `lastLoginAt` null, add a "Resend setup email" button next to existing password controls, calling `user-resend-setup-email`; keep the manual "Set password" path. Match each file's existing button/`save()`/notice conventions. Update StudentInformation's "No password is stored in this system" helper copy if it now misleads (setup email is sent automatically).
- [ ] tsc + eslint; browser-verify the button appears only for never-signed-in tenants and that clicking it surfaces the expected "email not configured" error (Resend unset). Clean up.

### Task 6: End-to-end pass

- [ ] Re-run the spec's Testing checklist items 1–7 in one pass (item 1's real inbox delivery and the real-send half of 2 need a real Resend key — mark those "not verifiable without user's key" rather than faking). Broad synthetic-data sweep (`app_users`, `password_setup_tokens`, `user_sessions`, `student_profiles`) = zero rows; confirm no leftover scratch files; final tsc/eslint across all touched files.
