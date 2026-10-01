# Student Portal Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 Critical findings from the student-portal feature's final whole-branch review (`.superpowers/sdd/progress.md`) before any real tenant account is safely usable. Each finding is already fully diagnosed (file:line, root cause, recommended fix) by that review — this plan turns those diagnoses into verified code changes. No new design work; this is a bug-fix pass.

**Architecture:** Four independent-ish fix areas, grouped to minimize repeated re-reads of the same large file region:
- **Task A** — `/api/files` authentication (standalone file).
- **Task B** — the tenant-scoped `GET /api/system` response block in `route.ts`: null-`studentId` guard, `studentRateChanges` scoping, announcements filtering, plus the sibling `ticket-message` null-comparison bug (same root cause, different handler). Bundled because they all touch the same response-shaping code or the same underlying "null matches null" defect class.
- **Task C** — `billing-payment` invoice-ownership check (standalone action handler).
- **Task D** — tenant write-access lockdown on non-tenant-safe actions (`meter-rates`, `meter-reading*`, `ticket-category-save`, `general-cost`, etc.) — a single early guard, not per-handler patches.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Supabase Postgres (real production data — `DATABASE_URL` points at it directly).

## Global Constraints

- No test framework exists in this repo — verification is `npx tsc --noEmit` + `npx eslint <files>` + live checks against the real dev database using synthetic `ZZTEST`/`zztest`-prefixed fixtures, cleaned up immediately after each check.
- **Do NOT create any git commits** — this session's standing rule this whole project: never commit unless explicitly asked, and it has not been asked for this plan either.
- **Do NOT run `rm -rf` on any directory** — `.claude-scratch/` is git-tracked; a previous task's implementer accidentally deleted it (recovered). Use targeted `rm` on files you personally create only.
- Never leave synthetic/test data in the real database after verification.
- These are real security fixes to code handling real student PII and real payment data — err toward the more conservative/restrictive behavior whenever a judgment call arises, and ask rather than guess.

---

### Task A: `/api/files` requires authentication

**Files:**
- Modify: `app/api/files/route.ts` (all four handlers: `GET`, `POST`, `PATCH`, `DELETE`)

**Interfaces:**
- Consumes: `getSessionUser` (or equivalent — check `db/auth.ts` and how `app/api/system/route.ts` resolves `currentUser` from a request, and reuse that exact mechanism rather than inventing a new one).
- Produces: every handler in this file now requires a valid session; a tenant is further restricted to attachments within their own scoped context.

- [ ] **Step 1: Find and reuse the existing session-resolution helper**

Read how `app/api/system/route.ts` resolves `currentUser` at the top of its `GET`/`POST` handlers (search for where `currentUser` is first assigned) and how `db/auth.ts` exposes a function to read a session from a `Request`. Use the exact same mechanism here — do not write a second, parallel implementation of session lookup.

- [ ] **Step 2: Require a valid session on every handler**

For `GET`, `POST`, `PATCH`, and `DELETE` in `app/api/files/route.ts`: resolve the current user first; if there is none, return `Response.json({ error: "Not signed in" }, { status: 401 })` (or the equivalent shape `route.ts`'s own handlers already use for an auth failure — match that exact response shape) before doing anything else.

- [ ] **Step 3: Scope a tenant's access to their own attachments**

For a `currentUser.roleKey === "tenant"` request:
- `GET` (read/download a file): only allow it if the requested attachment's `id` is one the tenant is actually scoped to see. The tenant-scoped attachment set is already computed server-side in `app/api/system/route.ts`'s tenant branch (search for `attachments:` inside `if (currentUser?.roleKey === "tenant")`) — read that filtering logic and reuse the same rule here (own tickets' attachments, own ticket-update messages' attachments, own payments' proof attachments). Do not just check `uploadedBy`/`displayName` — that's a client-supplied-at-upload-time string, not a real ownership check (this is exactly the same weakness the review flagged in the portal's own `canDelete` prop — fix it at the source here, in the API, not just in the UI layer).
- `DELETE`: only allow it if the attachment belongs to that tenant AND (per the review) was uploaded by them specifically — check `storedAttachments.uploadedBy` against `currentUser.displayName` is what the UI already assumes, but since a real server-side identity is now available, prefer checking against a real user/student identifier if the schema allows it without a migration; if not, keep the `uploadedBy` string comparison but note in your report that it's inherited, not newly introduced.
- `POST` (upload): only allow it if the `contextType`/`recordId` the tenant is uploading against is one they're actually allowed to write to (their own ticket, their own ticket-update reply, their own payment). Reuse the same ownership logic direction as `GET`.
- `PATCH` (rename): same ownership check as `DELETE`.
- Non-tenant roles (staff): keep existing behavior — this task is only tightening the tenant path and closing the fully-unauthenticated gap for everyone, not changing staff's existing access.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/files/route.ts
```

- [ ] **Step 5: Verify against the real dev database**

Using synthetic fixtures (two tenants, each with their own ticket+attachment; one staff session):
1. Confirm an unauthenticated request (no cookie) to `GET /api/files?id=<real attachment id>` now returns 401, not the file.
2. Confirm tenant A cannot `GET`/`DELETE`/`PATCH` an attachment that belongs to tenant B's ticket (403 or 404 — pick one and be consistent, matching whatever convention `route.ts`'s own action handlers use for "not yours").
3. Confirm tenant A *can* still `GET` their own attachment, and `POST` a new one onto their own ticket.
4. Confirm a staff session's existing behavior (uploading/viewing/deleting attachments across the app) is unaffected — spot-check one existing staff flow (e.g. a Finance payment-proof view) still works.
5. Clean up all fixtures.

---

### Task B: Tenant-scoping GET response — null-`studentId` guard, rate-change scoping, announcement filtering

**Files:**
- Modify: `app/api/system/route.ts` (the tenant branch inside the main `GET` handler, and the `ticket-message` action handler's tenant-ownership check)

**Interfaces:**
- Produces: an unlinked tenant (`currentUser.studentId == null`) gets an entirely empty scoped payload instead of leaking unrelated rows; `studentRateChanges` is scoped to the tenant's own `assignmentId`s; announcements are filtered by publish status/date/audience, not just hostel.

- [ ] **Step 1: Read the current tenant branch in full**

Re-read `app/api/system/route.ts`'s `if (currentUser?.roleKey === "tenant")` block (search for it) top to bottom before editing — this plan's earlier student-portal work already modified this block twice (adding `roommates`, then fixing the hardcoded-empty `notifications` override), so re-confirm current line numbers and variable names rather than trusting any line numbers cited below.

- [ ] **Step 2: Early-return guard for an unlinked tenant**

At the very top of the tenant branch, before any of the existing `ownStudents`/`ownRoomIds`/etc. computations, add:

```ts
if (currentUser.studentId == null) {
  return Response.json({
    ...responseData,
    hostels: [], units: [], bedSpaces: [], accessCards: [], owners: [],
    reservations: [], students: [], roommates: [], services: [],
    parkingLots: [], parkingRentals: [], tickets: [], ticketMessages: [],
    meterReadings: [], depositAdjustments: [], pastTenancies: [],
    invoices: [], attachments: [], studentRateChanges: [],
    // Global reference data (categories, roles, settings) can stay —
    // it's not tied to any student and carries nothing sensitive.
  });
}
```

Adjust the exact key list to match whatever the tenant branch's own full return object currently sets (some of these may already be empty-by-default from `responseData`'s base shape — don't invent new fields, just ensure every field the *populated* branch below would otherwise fill from student-linked data is empty here too). `announcements` and `notifications` are legitimately still meaningful for an unlinked tenant (hostel-wide notices, and their own — possibly zero — notifications) — do not zero those two out.

- [ ] **Step 3: Replace the unfiltered `...responseData` spread with an explicit allow-list, scoping `studentRateChanges`**

The tenant branch currently does `return Response.json({ ...responseData, hostels: ..., units: ..., ... })` — meaning any key not explicitly overridden (e.g. `studentRateChanges`, `billingCycles`, `salesPeople`, `settings`, `importProgress`) passes through **unfiltered** from the staff-scoped `responseData`. Add an explicit override:

```ts
studentRateChanges: responseData.studentRateChanges.filter(
  (change) => ownStudents.some((student) => student.assignmentId === change.assignmentId),
),
```

(Confirm the exact field names — `assignmentId` on both `studentRateChanges` rows and `ownStudents` rows — by reading `db/schema.ts`'s `studentRateChanges` table and how `effectiveRateOn` in `shared.tsx` already keys into this data.)

For `billingCycles`, `salesPeople`, `settings`, `importProgress`: the final review characterized these as "low-sensitivity" but flagged them as part of the same unaudited-spread pattern. Decide and document explicitly for each: `billingCycles` (cycle period labels/dates, no student-specific data) and `settings` (site-wide config) are fine to pass through as-is — leave them. `salesPeople` (a list of staff names) and `importProgress` (an internal admin metric) are staff-facing concerns a tenant has no reason to receive at all — override both to `[]`/an empty-shaped default rather than leaving them unfiltered. State your reasoning for each in your report so a reviewer can check it, rather than silently deciding.

- [ ] **Step 4: Announcement filtering**

The tenant branch's `announcements` filter currently only checks `hostelId`. Extend it to also require: `status === "published"`, `publishAt` is not in the future (`publishAt <= <today's ISO date, matching whatever date-comparison convention the rest of this file already uses>`), not expired (`!announcement.expiresAt || announcement.expiresAt >= today`), and the audience actually includes this tenant — `audienceType === "all"` always matches; `audienceType === "hostel"` matches on `hostelId` (already checked); `audienceType === "block"` needs the tenant's own unit's block code to match `blockCode` (read how block codes are derived elsewhere in this codebase — `Announcements.tsx`'s `blocksByHostel`/`blockOf` helpers or similar — and reuse that, don't invent new block-parsing logic); `audienceType === "unit"` needs `unitId` to match one of the tenant's own `ownUnitIds`.

- [ ] **Step 5: Fix the sibling null-comparison bug in `ticket-message`**

Read the `ticket-message` action handler's tenant-ownership check (search for `ownTicket.studentId !== currentUser.studentId` or similar — the review cited this exact comparison). Guard it the same way: a tenant with `currentUser.studentId == null` must never be treated as "this is their own ticket" just because both sides are null. Add an explicit `currentUser.studentId == null` rejection before or as part of that comparison (reject with the same "you can only update your own ticket" error the handler already throws for the normal mismatch case).

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 7: Verify against the real dev database**

1. Create a synthetic tenant `app_users` row with `student_id = NULL` (the real, minimal-effort way to trigger this bug, per the earlier investigation of how accounts are provisioned — this is not a hypothetical). Confirm `GET /api/system` for that session returns every one of the zeroed fields as empty, and does NOT throw.
2. Confirm `announcements` for that same unlinked session still returns hostel-wide notices if any exist (or an empty list if none do) — i.e. Step 2's guard didn't accidentally also zero this out.
3. Create a synthetic linked tenant with at least one `studentRateChanges` row for their own `assignmentId` and one for a *different* student's `assignmentId` — confirm only their own comes back.
4. Create (or find) an announcement with `status='draft'`, one with a future `publishAt`, one expired, and one `audienceType='unit'` targeting a *different* unit in the tenant's own hostel — confirm none of these four appear for the tenant, while a normal published/current/hostel-or-matching-unit one does.
5. As the unlinked tenant, attempt `ticket-message` against one of the real studentless tickets (e.g. a turnover/cleaning ticket) — confirm it's rejected with the ownership error, not silently accepted.
6. Clean up every fixture created.

---

### Task C: `billing-payment` invoice ownership check

**Files:**
- Modify: `app/api/system/route.ts` (the `billing-payment` action handler)

**Interfaces:**
- Produces: a tenant calling `billing-payment` with an `invoiceId` that isn't theirs (or that belongs to a draft, not-yet-posted cycle) gets rejected before any suspicious-amount check runs or any row is inserted.

- [ ] **Step 1: Read the current handler**

Re-read the `billing-payment` action handler in full (search `action === "billing-payment"`) before editing.

- [ ] **Step 2: Add the ownership check**

Immediately after the existing `if (!target) throw new Error("Invoice not found")` check (or wherever the invoice row is first loaded), add, only for tenants:

```ts
if (currentUser.roleKey === "tenant") {
  const owned = (
    await db
      .select({ studentId: billingInvoices.studentId, cycleId: billingInvoices.cycleId })
      .from(billingInvoices)
      .where(eq(billingInvoices.id, invoiceId))
  )[0];
  if (!owned || owned.studentId !== currentUser.studentId)
    throw new Error("Invoice not found");
  if (owned.cycleId) {
    const cycle = (
      await db.select({ status: billingCycles.status }).from(billingCycles).where(eq(billingCycles.id, owned.cycleId))
    )[0];
    if (cycle?.status === "draft") throw new Error("Invoice not found");
  }
}
```

Use `"Invoice not found"` (not a more specific "this isn't your invoice" message) deliberately — the same reasoning the GET branch's draft-cycle exclusion already uses: don't confirm to an unauthorized caller that a given invoice ID exists at all. Adjust field/table names to match what Task B's investigation of `db/schema.ts` already confirmed (`billingInvoices`, `billingCycles` should already be imported in this file — confirm before adding a duplicate import).

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify against the real dev database**

1. As a synthetic tenant, call `billing-payment` against their own real (posted-cycle or move-in) invoice — confirm it still succeeds exactly as before.
2. As the same tenant, call it against a *different* student's invoice — confirm `"Invoice not found"`, and confirm no `billing_payment_records` row was inserted.
3. As the same tenant, call it against their own invoice that belongs to a `draft` cycle (if one exists or can be created synthetically) — confirm rejection.
4. Confirm a staff session calling `billing-payment` on any invoice is completely unaffected (the new check is tenant-only).
5. Clean up every fixture.

---

### Task D: Lock down tenant write access to non-tenant-safe actions

**Files:**
- Modify: `app/api/system/route.ts` (the POST action dispatch)

**Interfaces:**
- Produces: a tenant-role POST request for any action other than an explicit allow-list is rejected before reaching that action's handler.

- [ ] **Step 1: Find the POST action dispatch**

Read how `app/api/system/route.ts`'s `POST` handler currently gates access before running an action's `else if (action === "...")` branch (the review cited this around line 4514-4529 — re-confirm the actual current code, since this plan's Tasks A-C may have already touched nearby code, and re-check exactly how `currentUser`/`action`/the permission matrix interact today).

- [ ] **Step 2: Add an explicit tenant allow-list**

Before the long `if/else if` chain of action handlers runs, add a check: if `currentUser.roleKey === "tenant"`, the `action` must be one of an explicit allow-list — `ticket-create`, `ticket-message`, `billing-payment`, `notification-mark-read`, `notification-mark-all-read` (cross-check this list against every action this plan's student-portal screens actually call — re-read `StudentBilling.tsx`, `StudentMaintenance.tsx`, and `layout.tsx` for their exact `action:` values, and don't allow anything not actually used by the portal). Anything else from a tenant is rejected with a clear error (`throw new Error("Not permitted for this account")` or match whatever convention nearby code uses for a permission refusal) **before** the dispatch chain reaches the matching `else if` branch — do this as an early gate, not by patching each individual handler.

This intentionally does not touch or "fix" the underlying `role_permissions` table data (the review noted tenant has `can_edit`/`can_create` on the maintenance module there) — that table likely still needs correcting separately since it drives *frontend* permission checks (`permissionFor`-style UI gating) as well as this backend gate, and changing it is a broader, more visible change than this plan's scope. Note this explicitly in your report as a follow-up the user should decide on, rather than silently also changing the permissions table.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify against the real dev database**

1. As a synthetic tenant, confirm each of the actions the portal actually uses (`ticket-create`, `ticket-message`, `billing-payment`, `notification-mark-read`, `notification-mark-all-read`) still works exactly as before.
2. As the same tenant, attempt `meter-rates`, `meter-reading-update`, `general-cost`, and `ticket-category-save` (the specific actions the review named as reachable) — confirm every one is now rejected, and confirm no data was changed by any of the rejected attempts (spot-check one, e.g. a hostel's electricity rate, is unchanged after the rejected `meter-rates` attempt).
3. Confirm a staff session's use of these same actions is completely unaffected.
4. Clean up every fixture.

---

## Execution Notes

- Tasks A, C, and D are independent of each other and of Task B's specific edits (different files or different, non-overlapping parts of the same file) — but per the subagent-driven-development skill's own rule, implementer subagents must still be dispatched one at a time, never in parallel, regardless of this independence.
- Task B is the largest and most consequential — its null-`studentId` guard interacts with every other field in the tenant branch, so do it as one coherent pass, not split further.
- Every code block above is a starting point based on the final review's diagnosis and this plan-writing pass's own reading of the code — re-read the actual current file content immediately before editing in every task, since exact line numbers and variable names may have shifted.
- Follow this session's established verification discipline: real dev database, synthetic fixtures cleaned up immediately after each check, `tsc`/`eslint` clean before calling any task done, no git commits.
- After all four tasks: re-run a final, focused review (not a full second whole-branch review — just a targeted check that these four fixes, together, actually close the six Critical findings and don't reopen anything Tasks 1-10 already got right).
