# Student Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/student` from a "coming soon" placeholder into a real self-service app for tenants — room/tenancy details, billing with payment submission, maintenance ticket submission/reply, announcements, and a simple unread badge on two tabs.

**Architecture:** Four real Next.js routes (`/student`, `/student/billing`, `/student/maintenance`, `/student/announcements`) under one `app/student/layout.tsx` that mounts the existing `SystemProvider` and a new bottom `PortalTabBar`. Each route is a thin page that calls `useSystem()` and renders a matching `app/modules/Student*.tsx` module — same shape every `(system)/*` page already uses. Almost everything reuses code that already exists (tenant-scoped data from `GET /api/system`, `billing-payment`/`ticket-create`/`ticket-message` actions, `shared.tsx` components); the plan adds a handful of small, precise backend/shared-component pieces first, then builds each screen on top of them.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Supabase Postgres, the existing `SystemContext`/`useSystem()` data layer, `shared.tsx` component library.

## Global Constraints

- No test framework exists in this repo (`npm test` just runs a production build) — verification is `npx tsc --noEmit` + `npx eslint <files>` + live checks against the real dev database (synthetic `ZZTEST`-prefixed fixtures, a scratch session cookie, cleaned up immediately after each check) + manual browser pass. Every task's verification steps follow this pattern instead of a unit-test loop.
- Never commit unless the user explicitly asks in this session; these tasks end at "verified working," not "committed" — follow whatever the executing session's standing instructions say about committing.
- Never leave synthetic/test data in the real database after a task's verification is done.
- Reuse existing `shared.tsx` components (`Modal`, `StatusPill`, `FileField`, `AttachmentGrid`, `AttachmentLink`, `Lightbox`, `DateField`, `SuspiciousConfirm`, `money()`, `dateLabel()`, `titleCase()`, `formValues()`, `effectiveRateOn()`, `uploadAttachment()`) rather than re-implementing equivalents.
- Design spec: `docs/superpowers/specs/2026-09-23-student-portal-design.md` — read it before starting if you weren't the one who wrote it.

---

### Task 1: Roommate names in the tenant-scoped payload

**Files:**
- Modify: `app/api/system/route.ts` (~line 3010, the `if (currentUser?.roleKey === "tenant")` block)
- Modify: `app/modules/shared.tsx` (`Data` type, ~line 10)

**Interfaces:**
- Produces: `data.roommates: { studentId: number; fullName: string }[]` — every other active occupant of the tenant's own room (never the full student row, never contact info). Empty array when the tenant is the only occupant.

- [ ] **Step 1: Read the current tenant-scoping block precisely**

Read `app/api/system/route.ts` around line 3010-3110 (the `if (currentUser?.roleKey === "tenant")` block inside the main `GET` handler) to confirm the exact current shape before editing — variable names (`ownStudents`, `beds`, `ownUnitIds`, etc.) may have shifted since this plan was written if other work landed in between.

- [ ] **Step 2: Add the roommates lookup**

Inside that same `if (currentUser?.roleKey === "tenant")` block, right after `ownStudents` is computed, add:

```ts
      // Other students sharing the tenant's own room — name only, never the
      // full profile (IC number, contact, etc.) another occupant has no
      // business seeing about a roommate. `beds` here is the full,
      // unfiltered bed list already loaded earlier in this handler for the
      // staff-facing payload.
      const ownRoomIds = new Set(
        beds
          .filter((bed) => bed.occupantId === currentUser.studentId)
          .map((bed) => bed.roomId),
      );
      const roommateStudentIds = new Set(
        beds
          .filter(
            (bed) =>
              ownRoomIds.has(bed.roomId) &&
              bed.occupantId &&
              bed.occupantId !== currentUser.studentId,
          )
          .map((bed) => bed.occupantId),
      );
      const roommates = studentRows
        .filter((student) => roommateStudentIds.has(student.id))
        .map((student) => ({ studentId: student.id, fullName: student.fullName }));
```

(`beds` and `studentRows` are the same already-in-scope variables `ownStudents`/`ownUnitIds` are computed from a few lines above — confirm the exact names match what Step 1 found; adjust if they differ.)

- [ ] **Step 3: Include it in the returned payload**

In the same block's `return Response.json({ ...responseData, ... })`, add `roommates,` as a new top-level field (anywhere in that object literal — order doesn't matter).

- [ ] **Step 4: Add the field to the shared `Data` type**

In `app/modules/shared.tsx`, in the `Data` type (~line 10), add after `students: Row[];`:

```ts
  roommates: { studentId: number; fullName: string }[];
```

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors. (A non-tenant session's payload won't have `roommates` at all — since it's typed as always-present on `Data`, either give it a safe default in the non-tenant branch too — search for where `responseData` is first assembled and add `roommates: [],` there as the baseline the tenant branch overrides — or confirm the frontend only reads `data.roommates` on the `/student` routes, where the session is always a tenant. Prefer the safe default: cheaper than a `?.` scattered through the frontend and matches how `parkingLots: []` etc. are already defaulted for the staff payload.)

- [ ] **Step 6: Verify against the real dev database**

Write a scratch script (`.claude-scratch/verify_roommates.mjs`) that:
1. Finds two students sharing a room (or creates a synthetic pair via direct SQL on a `ZZTEST` room/beds — check whether an existing shared room is easier to find first via `SELECT room_id, COUNT(*) FROM bed_spaces WHERE occupant_id IS NOT NULL GROUP BY room_id HAVING COUNT(*) > 1 LIMIT 1`).
2. Creates a synthetic session for one of them (same technique used throughout this project: `crypto.randomBytes(32)` token, SHA-256 hash into `user_sessions`).
3. Calls `GET /api/system` with that session's cookie, confirms `roommates` contains the other occupant's `fullName` and `studentId`, and does **not** contain any other field (no `icNumber`, `contactNumber`, etc. — confirm by checking the roommate object's own keys are exactly `{studentId, fullName}`).
4. Confirms a student with no roommates gets `roommates: []`.
5. Cleans up the session row (and any synthetic fixtures created).

Run it:
```bash
node .claude-scratch/verify_roommates.mjs
```
Then delete the scratch script.

---

### Task 2: Notify a tenant on staff ticket reply, invoice posted, and payment verified

**Files:**
- Modify: `app/api/system/notifications.ts` (add `notifyStudent` helper)
- Modify: `app/api/system/route.ts` (three trigger points: `ticket-message`, `billing-post`, `billing-verify`)

**Interfaces:**
- Produces: `notifyStudent(db: Db, studentId: number, input: NotifyInput): Promise<void>` — exported from `notifications.ts`, alongside the existing `notify`/`notifyRole`/`notifyRoleWithApproval`/`notifyUser`.
- Consumes: existing `notifyUser` (same file), existing `appUsers` schema table (already imported in `notifications.ts`).

- [ ] **Step 1: Add the `notifyStudent` helper**

In `app/api/system/notifications.ts`, after the existing `notifyUser` function, add:

```ts
// Three of the student-portal notification triggers know a studentId, not
// a userId — this resolves the tenant's own login account and reuses
// notifyUser. A student with no linked/active login account (shouldn't
// happen once the portal is in use, but possible for older data) is
// silently skipped rather than thrown — a missing notification isn't worth
// failing the staff action that triggered it.
export async function notifyStudent(db: Db, studentId: number, input: NotifyInput) {
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.studentId, studentId), eq(appUsers.status, "active")));
  if (user) await notifyUser(db, user.id, input);
}
```

- [ ] **Step 2: Import `notifyStudent` in `route.ts`**

Find the existing import of `notify`/`notifyRole`/etc. from `./notifications` in `app/api/system/route.ts` and add `notifyStudent` to it.

- [ ] **Step 3: Staff-reply trigger on `ticket-message`**

Read `app/api/system/route.ts` around the `ticket-message` handler (search for `action === "ticket-message"`) to re-confirm current line numbers, since Task 1/prior work may have shifted them.

Change the `priorTicket` select (currently `{ assignedTo: maintenanceTickets.assignedTo, ticketNo: maintenanceTickets.ticketNo }`) to also select `studentId: maintenanceTickets.studentId`.

Immediately after the existing:
```ts
      if (currentUser.roleKey === "tenant" && priorTicket)
        await notifyRole(db, "maintenance", {
          type: "ticket-message",
          title: `New message on ${priorTicket.ticketNo}`,
          body: message,
          link: `/maintenance?ticket=${ticketId}`,
        });
```
add the mirror-image branch:
```ts
      if (currentUser.roleKey !== "tenant" && priorTicket)
        await notifyStudent(db, priorTicket.studentId, {
          type: "ticket-reply",
          title: `New reply on ${priorTicket.ticketNo}`,
          body: message,
          link: "/student/maintenance",
        });
```

- [ ] **Step 4: Invoice-posted trigger on `billing-post`**

Find `action === "billing-post"`. It currently only updates `billingCycles.status`. Replace it with:

```ts
    } else if (action === "billing-post") {
      if (!body.cycleId) throw new Error("Billing cycle is required");
      const cycleId = asNumber(body.cycleId);
      const cycle = (
        await db.select().from(billingCycles).where(eq(billingCycles.id, cycleId))
      )[0];
      if (!cycle) throw new Error("Billing cycle not found");
      await db
        .update(billingCycles)
        .set({ status: "posted", postedAt: nowIso() })
        .where(eq(billingCycles.id, cycleId));
      const cycleInvoices = await db
        .select({ studentId: billingInvoices.studentId })
        .from(billingInvoices)
        .where(eq(billingInvoices.cycleId, cycleId));
      for (const invoice of cycleInvoices) {
        if (!invoice.studentId) continue;
        await notifyStudent(db, invoice.studentId, {
          type: "invoice-posted",
          title: `${cycle.periodLabel} bill is ready`,
          link: "/student/billing",
        });
      }
```

(`billingInvoices.studentId` and `billingCycles.periodLabel` are confirmed exact column names — `db/schema.ts`, `periodLabel` is declared `.unique()` on `billingCycles`.)

- [ ] **Step 5: Payment-verified trigger on `billing-verify`**

Find `action === "billing-verify"`. It already loads `const invoice = (await db.select().from(billingInvoices).where(eq(billingInvoices.id, payment.invoiceId)))[0];` to recompute `amountPaid`. Immediately after the existing `await db.update(billingInvoices).set({...}).where(...)` call in that handler, add:

```ts
      if (invoice?.studentId)
        await notifyStudent(db, invoice.studentId, {
          type: "payment-verified",
          title: `Payment on ${invoice.invoiceNo} confirmed`,
          link: "/student/billing",
        });
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts app/api/system/notifications.ts
```
Expected: no new errors (only the two pre-existing baseline warnings — `TURNOVER_OPEN_STATUSES` and `invoiceFrequency` unused — may still appear; nothing else new).

- [ ] **Step 7: Verify each trigger against the real dev database**

Write `.claude-scratch/verify_student_notifications.mjs`:
1. Set up a synthetic tenant (`app_users` row with `role_id` for the `tenant` role, `student_id` pointing at a real or synthetic `student_profiles` row) with a scratch session, and a synthetic staff (Director) session.
2. **Ticket reply:** as the tenant, create a ticket (`ticket-create`). As staff, post a reply (`ticket-message`). Query `notifications` for the tenant's `app_users.id` — confirm exactly one `type: "ticket-reply"` row with `link: "/student/maintenance"`. Then, as the *tenant*, post another reply on the same ticket — confirm this does **not** create a second `ticket-reply` notification (only the staff-authored branch should).
3. **Invoice posted:** create a synthetic `draft` billing cycle with 2-3 synthetic invoices across 2+ different students (or reuse one student twice if only one test student is set up — the loop behavior is what's being checked). Call `billing-post`. Confirm one `invoice-posted` notification lands on each invoice's student, and none on students without an invoice in that cycle.
4. **Payment verified:** create a synthetic pending-verification payment on an invoice, call `billing-verify` as staff. Confirm exactly one `payment-verified` notification on that invoice's student.
5. Clean up every synthetic row created (notifications, invoices, cycle, tickets, messages, sessions, and any synthetic student/user rows — in FK-safe order).

Run it, confirm all checks pass, then delete the scratch script.

---

### Task 3: `AttachmentGrid` gets an optional `canDelete` predicate

**Files:**
- Modify: `app/modules/shared.tsx` (`AttachmentGrid` component, ~line 891)

**Interfaces:**
- Produces: `AttachmentGrid`'s props gain `canDelete?: (attachment: Row) => boolean` (default: every attachment deletable, i.e. current behavior unchanged for every existing call site — Maintenance.tsx's three usages, UnitInformation.tsx's two).
- Consumes: nothing new.

- [ ] **Step 1: Read the current component**

Read `app/modules/shared.tsx`'s `AttachmentGrid` in full (from `export function AttachmentGrid(` to its closing `}`) to confirm current structure before editing.

- [ ] **Step 2: Add the prop**

Change the props destructure/type from:
```ts
export function AttachmentGrid({
  attachments,
  onDeleted,
  compact = false,
}: {
  attachments: Row[];
  onDeleted: () => void;
  compact?: boolean;
}) {
```
to:
```ts
export function AttachmentGrid({
  attachments,
  onDeleted,
  compact = false,
  canDelete = () => true,
}: {
  attachments: Row[];
  onDeleted: () => void;
  compact?: boolean;
  canDelete?: (attachment: Row) => boolean;
}) {
```

- [ ] **Step 3: Gate both delete buttons**

The component renders two delete buttons — one inside `group()` (pictures/videos) and one inside the `documentGroup` block. In both, wrap the existing
```tsx
            <button
              type="button"
              className="secondary compact attachment-delete"
              disabled={deletingId === attachment.id}
              onClick={() => handleDelete(attachment.id)}
            >
              Delete
            </button>
```
with a conditional render:
```tsx
            {canDelete(attachment) && (
              <button
                type="button"
                className="secondary compact attachment-delete"
                disabled={deletingId === attachment.id}
                onClick={() => handleDelete(attachment.id)}
              >
                Delete
              </button>
            )}
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/shared.tsx
```
Expected: clean (existing pre-existing warnings in this file only — the three `_ignoredType` and two `<img>` LCP warnings noted in earlier work this session).

- [ ] **Step 5: Confirm existing call sites are unaffected**

`AttachmentGrid` is used without a `canDelete` prop in `Maintenance.tsx` (ticket attachments, ×3) and `UnitInformation.tsx` (room photos, owner agreements, ×2) — since the prop defaults to "always true," their behavior is unchanged by construction, so no code change is needed at those call sites. Confirm this by grepping:
```bash
grep -n "<AttachmentGrid" app/modules/Maintenance.tsx app/modules/UnitInformation.tsx
```
and spot-checking none of them need a `canDelete` prop added for correctness (they show delete unconditionally today, same as before this task).

---

### Task 4: `PortalTabBar` component and bottom-tab CSS

**Files:**
- Modify: `app/modules/shared.tsx` (new `PortalTabBar` component)
- Modify: `app/globals.css` (new tab-bar styles, appended after the existing `.portal-note` rules, ~line 3850)

**Interfaces:**
- Produces: `PortalTabBar` — a client component reading the current pathname via `usePathname()` (from `next/navigation`) to highlight the active tab. Takes an optional `unread?: { billing: boolean; maintenance: boolean }` prop for the dot indicators (wired up in Task 9 — this task builds it accepting the prop but Task 9 is what actually supplies real data; pass `unread={{ billing: false, maintenance: false }}` or omit entirely with a default of `{}` until then).
- Consumes: `next/navigation`'s `usePathname`, `next/link`'s `Link`.

- [ ] **Step 1: Add the component to `shared.tsx`**

`app/(system)/layout.tsx` already imports `Link` from `"next/link"` and `usePathname`/`useRouter` from `"next/navigation"`, and highlights its own active nav item the same way this component will (`className={pathname === item.href ? "active" : ""}`, `app/(system)/layout.tsx:350-353`) — `shared.tsx` itself has no prior import of either, so add both fresh there, matching that existing convention rather than inventing a new one.

Add near the other cross-module UI components (e.g. right after `AttachmentGrid` or near `Modal`):

```tsx
const PORTAL_TABS = [
  { href: "/student", label: "My room", icon: "home" },
  { href: "/student/billing", label: "Billing", icon: "receipt" },
  { href: "/student/maintenance", label: "Maintenance", icon: "wrench" },
  { href: "/student/announcements", label: "Announcements", icon: "megaphone" },
] as const;

const PORTAL_TAB_ICON_PATHS: Record<string, string> = {
  home: "M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM8 8h8M8 12h8M8 16h5",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2-2z",
  megaphone: "M3 11v2a2 2 0 0 0 2 2h1l3 5V4l-3 5H5a2 2 0 0 0-2 2zM14 8a5 5 0 0 1 0 8M17 5a9 9 0 0 1 0 14",
};

function PortalTabIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PORTAL_TAB_ICON_PATHS[name]} />
    </svg>
  );
}

export function PortalTabBar({
  unread = {},
}: {
  unread?: { billing?: boolean; maintenance?: boolean };
}) {
  const pathname = usePathname();
  return (
    <nav className="portal-tabbar">
      {PORTAL_TABS.map((tab) => {
        const active =
          tab.href === "/student"
            ? pathname === "/student"
            : pathname?.startsWith(tab.href);
        const dot =
          (tab.href === "/student/billing" && unread.billing) ||
          (tab.href === "/student/maintenance" && unread.maintenance);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`portal-tab${active ? " is-active" : ""}`}
          >
            <span className="portal-tab-icon">
              <PortalTabIcon name={tab.icon} />
              {dot && <span className="portal-tab-dot" aria-hidden="true" />}
            </span>
            <small>{tab.label}</small>
          </Link>
        );
      })}
    </nav>
  );
}
```

Add the needed imports at the top of `shared.tsx`:
```ts
import Link from "next/link";
import { usePathname } from "next/navigation";
```

No `BASE_PATH` prefix needed on these hrefs — confirmed `(system)/layout.tsx`'s own `<Link href={item.href}>` uses plain unprefixed paths (`/finance`, `/maintenance`, etc.) throughout; Next.js's router applies `basePath` automatically for `<Link>`, unlike the raw `fetch()` calls elsewhere in this codebase which do need the manual `${BASE_PATH}` prefix.

- [ ] **Step 2: Add the CSS**

Append to `app/globals.css`, right after the existing `.portal-note ul` rule (~line 3850, before the "12. MISC COMPONENTS" section header):

```css
  .portal-tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    border-top: 1px solid var(--line);
    background: var(--surface);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }

  .portal-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--sp-2) 0;
    color: var(--muted);
    text-decoration: none;
  }

  .portal-tab.is-active {
    color: var(--brand);
  }

  .portal-tab svg {
    width: 22px;
    height: 22px;
  }

  .portal-tab small {
    font-size: 11px;
  }

  .portal-tab-icon {
    position: relative;
  }

  .portal-tab-dot {
    position: absolute;
    top: -2px;
    right: -4px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #dc2626;
    border: 1.5px solid var(--surface);
  }

  /* Leaves room so page content never sits under the fixed tab bar. */
  .portal-shell .portal-body {
    padding-bottom: calc(64px + var(--sp-6));
  }
```

(`--brand: #4f46e5` is the confirmed existing primary-color variable, `:root` in `app/globals.css`.)

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/shared.tsx
```

- [ ] **Step 4: Smoke-test the component compiles and renders**

This can't be verified standalone yet (nothing mounts it until Task 5) — defer visual verification to Task 5's browser check. Just confirm the file compiles cleanly here.

---

### Task 5: Portal shell (`layout.tsx`) + "My room" screen — first full vertical slice

**Files:**
- Create: `app/modules/StudentHome.tsx`
- Create: `app/student/layout.tsx`
- Modify: `app/student/page.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `SystemProvider`/`useSystem()` (`app/SystemContext.tsx`), `PortalTabBar` (Task 4), `data.roommates` (Task 1), `effectiveRateOn` (`shared.tsx`).
- Produces: the pattern every subsequent screen (Tasks 6-8) copies — `app/student/<x>/page.tsx` → `StudentXModule`.

- [ ] **Step 1: Write `app/modules/StudentHome.tsx`**

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { effectiveRateOn, money, dateLabel } from "./shared";
import type { Data } from "./shared";

export function StudentHomeModule({ data }: { data: Data }) {
  const student = data.students[0];
  if (!student) {
    return (
      <section className="portal-card">
        <span className="section-kicker">MY ROOM</span>
        <h1>Not linked to a room yet</h1>
        <p>
          Your account isn&rsquo;t linked to a room yet — contact the hostel
          office.
        </p>
      </section>
    );
  }
  const rate = effectiveRateOn(data.studentRateChanges, student.assignmentId, student);
  const outstanding = data.invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce(
      (sum, invoice) =>
        sum + Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0),
      0,
    );
  const openTickets = data.tickets.filter(
    (ticket) => !["completed", "closed"].includes(ticket.status),
  ).length;

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">MY ROOM</span>
        <h1>Hello, {student.fullName}</h1>
        <p>
          {student.roomCode ? `Room ${student.roomCode}` : "No room assigned"}
          {student.hostelName ? ` · ${student.hostelName}` : ""}
        </p>
      </section>

      <section className="portal-card">
        <span className="section-kicker">CURRENT STAY</span>
        <div className="portal-fact-grid">
          <div>
            <small>Room</small>
            <strong>{student.roomCode || "-"}</strong>
          </div>
          <div>
            <small>Since</small>
            <strong>{dateLabel(student.checkInDate)}</strong>
          </div>
          <div>
            <small>Monthly rent</small>
            <strong>{money(rate.monthlyRental, true)}</strong>
          </div>
          <div>
            <small>Deposit held</small>
            <strong>{money(rate.securityDeposit, true)}</strong>
          </div>
        </div>
      </section>

      {data.roommates.length > 0 && (
        <section className="portal-card">
          <span className="section-kicker">ROOMMATES</span>
          <ul className="portal-roommate-list">
            {data.roommates.map((roommate) => (
              <li key={roommate.studentId}>{roommate.fullName}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="portal-card portal-glance">
        <a href="/student/billing" className="portal-glance-tile">
          <strong>{money(outstanding, true)}</strong>
          <small>Outstanding balance</small>
        </a>
        <a href="/student/maintenance" className="portal-glance-tile">
          <strong>{openTickets}</strong>
          <small>Open ticket{openTickets === 1 ? "" : "s"}</small>
        </a>
      </section>
    </div>
  );
}
```

`student.assignmentId` is confirmed to exist and is used the same way at `StudentInformation.tsx:70,82,139`.

- [ ] **Step 2: Write `app/student/layout.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { SystemProvider } from "../SystemContext";
import { PortalTabBar } from "../modules/shared";
import { BASE_PATH } from "../basePath";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ user?: { roleKey: string } | null }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) {
          window.location.replace(`${BASE_PATH}/login`);
          return;
        }
        if (result.user.roleKey !== "tenant") {
          window.location.replace(BASE_PATH || "/");
          return;
        }
        setChecked(true);
      })
      .catch(() => !cancelled && window.location.replace(`${BASE_PATH}/login`));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!checked)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Loading your portal...</p>
        </div>
      </div>
    );

  return (
    <SystemProvider>
      <div className="portal-shell">
        <main className="portal-body">{children}</main>
        <PortalTabBar />
      </div>
    </SystemProvider>
  );
}
```

- [ ] **Step 3: Rewrite `app/student/page.tsx`**

```tsx
"use client";

import { useSystem } from "../SystemContext";
import { StudentHomeModule } from "../modules/StudentHome";

export default function StudentHomePage() {
  const { data } = useSystem();
  if (!data) return null;
  return <StudentHomeModule data={data} />;
}
```

- [ ] **Step 4: Add the small CSS this screen needs**

Append to `app/globals.css` near the portal rules from Task 4:

```css
  .portal-stack {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .portal-fact-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-4);
    margin-top: var(--sp-3);
  }

  .portal-fact-grid small {
    display: block;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .portal-fact-grid strong {
    font-size: 16px;
  }

  .portal-roommate-list {
    margin: var(--sp-3) 0 0;
    padding: 0;
    list-style: none;
  }

  .portal-roommate-list li {
    padding: var(--sp-2) 0;
    border-bottom: 1px solid var(--line);
  }

  .portal-roommate-list li:last-child {
    border-bottom: none;
  }

  .portal-glance {
    display: flex;
    gap: var(--sp-4);
  }

  .portal-glance-tile {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-decoration: none;
    color: inherit;
  }

  .portal-glance-tile strong {
    font-size: 20px;
  }

  .portal-glance-tile small {
    color: var(--muted);
    font-size: 12px;
  }
```

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/student/layout.tsx app/student/page.tsx app/modules/StudentHome.tsx app/modules/shared.tsx
```

- [ ] **Step 6: Browser verification**

1. Start the dev server preview (`preview_start`), open a real tenant test session via the established synthetic-session technique (`user_sessions` row + `document.cookie`), navigate to `/student`.
2. Confirm: the "Loading your portal..." flash, then the shell renders with the bottom tab bar (4 icons) and the "My room" content — greeting, current-stay facts, roommates (if the test student has any), outstanding/open-ticket tiles.
3. Confirm a **non-tenant** session visiting `/student` gets redirected away (test with a staff synthetic session).
4. Confirm a **signed-out** visit redirects to `/login`.
5. `resize_window` to mobile width and confirm the tab bar sits fixed at the bottom without covering content (the `portal-body` bottom padding from Task 4/5 should prevent this) and the layout doesn't horizontally overflow.
6. Clean up the synthetic session(s) used.

---

### Task 6: Billing screen

**Files:**
- Create: `app/modules/StudentBilling.tsx`
- Create: `app/student/billing/page.tsx`

**Interfaces:**
- Consumes: `data.invoices`, `data.currentUser`, `save`, `load`, `Modal`, `StatusPill`, `FileField`, `AttachmentLink`, `Lightbox`, `useLightbox`, `SuspiciousConfirm`, `uploadAttachment`, `money`, `dateLabel`, `formValues` (all from `shared.tsx`).

- [ ] **Step 1: Write `app/modules/StudentBilling.tsx`**

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentLink,
  FileField,
  Lightbox,
  Modal,
  StatusPill,
  SuspiciousConfirm,
  dateLabel,
  formValues,
  money,
  titleCase,
  uploadAttachment,
  useLightbox,
} from "./shared";
import type { Data, Row } from "./shared";

export function StudentBillingModule({
  data,
  save,
  busy,
  load,
  suspicious,
}: {
  data: Data;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
  /** Set when the last save was refused only because a figure looked wrong — see Finance.tsx's identical use of this prop. */
  suspicious: string;
}) {
  const [tab, setTab] = useState<"outstanding" | "paid" | "all">("outstanding");
  const [invoice, setInvoice] = useState<Row | null>(null);
  const [confirmOverpay, setConfirmOverpay] = useState(false);
  const lightbox = useLightbox();

  const invoices = data.invoices.filter((i) =>
    tab === "all" ? true : tab === "paid" ? i.status === "paid" : i.status !== "paid",
  );

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">BILLING</span>
        <h1>Your invoices</h1>
        <div className="workspace-tabs">
          <button className={tab === "outstanding" ? "active" : ""} onClick={() => setTab("outstanding")}>
            Outstanding
          </button>
          <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>
            Paid
          </button>
          <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
            All
          </button>
        </div>
      </section>

      <section className="portal-stack">
        {invoices.map((i) => (
          <button key={i.id} className="portal-list-row" onClick={() => setInvoice(i)}>
            <div>
              <strong>{i.invoiceNo}</strong>
              <small>Due {dateLabel(i.dueDate)}</small>
            </div>
            <div className="portal-list-row-end">
              <strong>{money(i.totalAmount, true)}</strong>
              <StatusPill status={i.status} />
            </div>
          </button>
        ))}
        {!invoices.length && <p className="empty-copy">No invoices here.</p>}
      </section>

      {invoice &&
        (() => {
          const current = data.invoices.find((i) => i.id === invoice.id) || invoice;
          const slips = data.attachments.filter(
            (a) => a.contextType === "payment-proof" && current.payments?.some((p: Row) => p.id === a.recordId),
          );
          const outstanding = Number(current.totalAmount || 0) - Number(current.amountPaid || 0);
          return (
            <Modal
              title={current.invoiceNo}
              kicker="INVOICE"
              description={`Due ${dateLabel(current.dueDate)}`}
              onClose={() => setInvoice(null)}
            >
              <div className="portal-invoice-items">
                {current.items.map((item: Row) => (
                  <div key={item.id} className="portal-invoice-item">
                    <span>{item.description || titleCase(item.itemType)}</span>
                    <strong>{money(item.amount, true)}</strong>
                  </div>
                ))}
              </div>
              <div className="portal-invoice-totals">
                <span>Total {money(current.totalAmount, true)}</span>
                <span>Paid {money(current.amountPaid, true)}</span>
                <strong>Owed {money(outstanding, true)}</strong>
              </div>

              {current.payments?.length > 0 && (
                <div className="portal-payment-history">
                  <small>PAYMENT HISTORY</small>
                  {current.payments.map((p: Row) => (
                    <div key={p.id} className="portal-payment-row">
                      <span>{money(p.verifiedAmount ?? p.amount, true)}</span>
                      <StatusPill status={p.status} />
                    </div>
                  ))}
                </div>
              )}

              {slips.length > 0 && (
                <div className="portal-payment-history">
                  <small>SLIPS</small>
                  {slips.map((a) => (
                    <AttachmentLink key={a.id} attachment={a} onOpen={lightbox.open} className="secondary compact">
                      {a.fileName || "View slip"}
                    </AttachmentLink>
                  ))}
                </div>
              )}

              {outstanding > 0 && (
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const result = await save(
                      {
                        action: "billing-payment",
                        invoiceId: current.id,
                        ...formValues(e),
                        confirmSuspicious: confirmOverpay,
                      },
                      "Payment submitted for verification",
                    );
                    if (result) {
                      const file = (form.elements.namedItem("proof") as HTMLInputElement)
                        .files?.[0];
                      if (file && result.id) {
                        await uploadAttachment(file, "payment-proof", result.id, data.currentUser?.displayName);
                        await load(["attachments"]);
                      }
                      setInvoice(null);
                      setConfirmOverpay(false);
                    }
                  }}
                >
                  <label>
                    Amount
                    <input name="amount" type="number" min="0" step="0.01" required />
                  </label>
                  <label>
                    Remark (optional)
                    <input name="remark" placeholder="Payment note" />
                  </label>
                  <label className="wide">
                    Payment slip
                    <FileField
                      name="proof"
                      accept={ATTACHMENT_ACCEPT}
                      required
                      hint="Photo, PDF, Word, Excel or CSV."
                    />
                  </label>
                  <SuspiciousConfirm
                    message={suspicious}
                    checked={confirmOverpay}
                    onChange={setConfirmOverpay}
                  />
                  <div className="form-actions wide">
                    <button className="primary" disabled={busy}>
                      Submit payment
                    </button>
                  </div>
                </form>
              )}
            </Modal>
          );
        })()}
      <Lightbox attachment={lightbox.attachment} onClose={lightbox.close} />
    </div>
  );
}
```

This mirrors `Finance.tsx:2860-2980`'s own "Submit payment proof" form exactly: `FileField` (not a native input) with `accept={ATTACHMENT_ACCEPT}`, and `SuspiciousConfirm message={suspicious}` where `suspicious` is threaded down from `useSystem()` the same way `FinanceModule` already receives it as a prop (see Step 2's page wrapper, which passes it through).

- [ ] **Step 2: Write `app/student/billing/page.tsx`**

```tsx
"use client";

import { useSystem } from "../../SystemContext";
import { StudentBillingModule } from "../../modules/StudentBilling";

export default function StudentBillingPage() {
  const { data, save, busy, load, suspicious } = useSystem();
  if (!data) return null;
  return (
    <StudentBillingModule
      data={data}
      save={save}
      busy={busy}
      load={load}
      suspicious={suspicious}
    />
  );
}
```

- [ ] **Step 3: Add CSS for the invoice list rows / modal layout**

Append to `app/globals.css`:

```css
  .portal-list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }

  .portal-list-row-end {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .portal-invoice-items,
  .portal-payment-history {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    margin-top: var(--sp-3);
  }

  .portal-invoice-item,
  .portal-payment-row {
    display: flex;
    justify-content: space-between;
  }

  .portal-invoice-totals {
    display: flex;
    justify-content: space-between;
    margin-top: var(--sp-4);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--line);
  }
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/student/billing/page.tsx app/modules/StudentBilling.tsx
```

- [ ] **Step 5: Browser verification**

Using a synthetic tenant session with at least one unpaid and one paid synthetic invoice (create via direct SQL if the test student doesn't already have both):
1. Confirm the three tabs filter correctly.
2. Open an unpaid invoice, confirm items/totals/owed render correctly.
3. Submit a payment with a real small test image as the slip (same synthetic-file-upload technique used earlier this session — `DataTransfer`/`dispatchEvent` on the file input via `javascript_tool`, or drive `FileField` if that's what Step 1 ended up using).
4. Confirm the payment appears in the invoice's payment history as `pending-verification`, and the slip opens via the Lightbox (not a new tab) when tapped.
5. Confirm the `billing-payment` action's existing Finance-role notification still fires (query `notifications` directly).
6. Clean up the synthetic invoice/payment/attachment/session.

---

### Task 7: Maintenance screen

**Files:**
- Create: `app/modules/StudentMaintenance.tsx`
- Create: `app/student/maintenance/page.tsx`

**Interfaces:**
- Consumes: `data.tickets`, `data.ticketMessages`, `data.ticketCategories`, `data.students`, `data.attachments`, `AttachmentGrid` (with the `canDelete` prop from Task 3), `FileField`, `ATTACHMENT_ACCEPT`, `Modal`, `StatusPill`, `uploadAttachment`, `dateLabel`, `titleCase`, `formValues`.

- [ ] **Step 1: Write `app/modules/StudentMaintenance.tsx`**

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentGrid,
  FileField,
  Modal,
  StatusPill,
  dateLabel,
  formValues,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

export function StudentMaintenanceModule({
  data,
  save,
  busy,
  load,
}: {
  data: Data;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
}) {
  const [modal, setModal] = useState(false);
  const [ticket, setTicket] = useState<Row | null>(null);
  const [category, setCategory] = useState("");
  const student = data.students[0];

  const tickets = [...data.tickets].sort((a, b) => Number(b.id) - Number(a.id));
  const openTicket = ticket && data.tickets.find((t) => t.id === ticket.id);

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">MAINTENANCE</span>
        <h1>Your tickets</h1>
        <button className="v2-btn-primary" onClick={() => setModal(true)}>
          + New ticket
        </button>
      </section>

      <section className="portal-stack">
        {tickets.map((t) => (
          <button key={t.id} className="portal-list-row" onClick={() => setTicket(t)}>
            <div>
              <strong>{t.category}</strong>
              <small>
                {t.ticketNo} · {dateLabel(t.createdAt)}
              </small>
            </div>
            <StatusPill status={t.status} />
          </button>
        ))}
        {!tickets.length && <p className="empty-copy">No tickets yet.</p>}
      </section>

      {openTicket && (
        <Modal
          title={openTicket.subject || openTicket.category}
          kicker={openTicket.ticketNo}
          onClose={() => setTicket(null)}
        >
          <p>{openTicket.description}</p>
          <AttachmentGrid
            attachments={data.attachments.filter(
              (a) => a.contextType === "ticket" && a.recordId === openTicket.id,
            )}
            onDeleted={() => load(["attachments"])}
            canDelete={(a) => a.uploadedBy === data.currentUser?.displayName}
            compact
          />
          <div className="conversation">
            {data.ticketMessages
              .filter((m) => m.ticketId === openTicket.id)
              .map((m) => (
                <article
                  key={m.id}
                  className={m.authorRole === "student" ? "student-message" : "staff-message"}
                >
                  <div>
                    <b>{m.authorName}</b>
                    <small>
                      {titleCase(m.authorRole)} · {dateLabel(m.createdAt)}
                    </small>
                  </div>
                  <p>{m.message}</p>
                  <AttachmentGrid
                    attachments={data.attachments.filter(
                      (a) => a.contextType === "ticket-update" && a.recordId === m.id,
                    )}
                    onDeleted={() => load(["attachments"])}
                    canDelete={(a) => a.uploadedBy === data.currentUser?.displayName}
                    compact
                  />
                </article>
              ))}
          </div>
          <form
            className="drawer-section"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const result = await save(
                { action: "ticket-message", ticketId: openTicket.id, ...formValues(e) },
                "Message posted",
              );
              if (result) {
                const file = (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files?.[0];
                if (file && result.id) {
                  await uploadAttachment(file, "ticket-update", result.id, data.currentUser?.displayName);
                  await load(["attachments"]);
                }
                form.reset();
              }
            }}
          >
            <label className="wide">
              Reply
              <textarea name="message" required placeholder="Add an update" />
            </label>
            <label className="wide">
              Attach a photo (optional)
              <FileField name="attachment" accept={ATTACHMENT_ACCEPT} />
            </label>
            <button className="primary" disabled={busy}>
              Send
            </button>
          </form>
        </Modal>
      )}

      {modal && (
        <Modal title="New maintenance ticket" kicker="REPORT AN ISSUE" onClose={() => setModal(false)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const result = await save(
                {
                  action: "ticket-create",
                  hostelId: student?.hostelId,
                  unitId: student?.unitId,
                  roomId: student?.roomId,
                  ...formValues(e),
                },
                "Ticket submitted",
              );
              if (result) {
                const file = (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files?.[0];
                if (file && result.id) {
                  await uploadAttachment(file, "ticket", result.id, data.currentUser?.displayName);
                  await load(["attachments"]);
                }
                setModal(false);
                setCategory("");
              }
            }}
          >
            <label>
              Category
              <select
                name="category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Select category</option>
                {[...new Set(data.ticketCategories.filter((c) => c.status === "active").map((c) => c.category))].map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Subcategory
              <select name="subcategory" required>
                <option value="">Select subcategory</option>
                {data.ticketCategories
                  .filter((c) => c.status === "active" && c.category === category)
                  .map((c) => (
                    <option key={c.id} value={c.subcategory}>
                      {c.subcategory}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="average">Average</option>
                <option value="high">Urgent</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="wide">
              Description
              <textarea name="description" required placeholder="Describe the issue" />
            </label>
            <label className="wide">
              Photo or video (required)
              <FileField name="attachment" accept={ATTACHMENT_ACCEPT} required />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit ticket
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

`student.hostelId`/`student.unitId`/`student.roomId` are confirmed real fields on a student row — already used the same way in `Maintenance.tsx:553-554,2755,2767` and `StudentInformation.tsx:1105` — safe to rely on as written above.

- [ ] **Step 2: Write `app/student/maintenance/page.tsx`**

```tsx
"use client";

import { useSystem } from "../../SystemContext";
import { StudentMaintenanceModule } from "../../modules/StudentMaintenance";

export default function StudentMaintenancePage() {
  const { data, save, busy, load } = useSystem();
  if (!data) return null;
  return <StudentMaintenanceModule data={data} save={save} busy={busy} load={load} />;
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/student/maintenance/page.tsx app/modules/StudentMaintenance.tsx
```

- [ ] **Step 4: Browser verification**

1. As a synthetic tenant, submit a new ticket with a required photo — confirm it appears in the list, confirm the photo shows via `AttachmentGrid`/`Lightbox`.
2. Open the ticket, post a reply with an attachment — confirm the thread updates, the reply's own photo shows.
3. As a synthetic staff (maintenance role) session, post a reply on that same ticket — confirm, per Task 2's verification, a `ticket-reply` notification landed on the tenant.
4. As the tenant, confirm `canDelete` lets them delete their **own** uploaded photo (Delete button present) but not the staff member's reply photo (Delete button absent on that attachment).
5. Clean up all synthetic tickets/messages/attachments/sessions.

---

### Task 8: Announcements screen

**Files:**
- Create: `app/modules/StudentAnnouncements.tsx`
- Create: `app/student/announcements/page.tsx`

**Interfaces:**
- Consumes: `data.announcements`, `Modal`, `dateLabel`, `titleCase`.

- [ ] **Step 1: Write `app/modules/StudentAnnouncements.tsx`**

```tsx
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { Modal, dateLabel, titleCase } from "./shared";
import type { Data, Row } from "./shared";

export function StudentAnnouncementsModule({ data }: { data: Data }) {
  const [open, setOpen] = useState<Row | null>(null);
  const announcements = [...data.announcements].sort((a, b) =>
    String(b.publishAt).localeCompare(String(a.publishAt)),
  );
  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">ANNOUNCEMENTS</span>
        <h1>Hostel notices</h1>
      </section>
      <section className="portal-stack">
        {announcements.map((a) => (
          <button key={a.id} className="portal-list-row" onClick={() => setOpen(a)}>
            <div>
              <strong>{a.title}</strong>
              <small>
                {a.pinned ? "PINNED · " : ""}
                {titleCase(a.priority)} · {dateLabel(a.publishAt)}
              </small>
            </div>
          </button>
        ))}
        {!announcements.length && <p className="empty-copy">No announcements yet.</p>}
      </section>
      {open && (
        <Modal title={open.title} kicker={dateLabel(open.publishAt)} onClose={() => setOpen(null)}>
          <p>{open.body}</p>
        </Modal>
      )}
    </div>
  );
}
```

The "PINNED · " prefix and priority label copy the exact rendering `Announcements.tsx:72-75` already uses for staff — no new badge component needed.

- [ ] **Step 2: Write `app/student/announcements/page.tsx`**

```tsx
"use client";

import { useSystem } from "../../SystemContext";
import { StudentAnnouncementsModule } from "../../modules/StudentAnnouncements";

export default function StudentAnnouncementsPage() {
  const { data } = useSystem();
  if (!data) return null;
  return <StudentAnnouncementsModule data={data} />;
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/student/announcements/page.tsx app/modules/StudentAnnouncements.tsx
```

- [ ] **Step 4: Browser verification**

1. Confirm the tenant sees announcements scoped to their own hostel (create a synthetic announcement targeted at their hostel, confirm it shows; create one targeted at a different hostel, confirm it does **not** show).
2. Open one, confirm the full body renders in the modal.
3. Clean up the synthetic announcement(s).

---

### Task 9: Wire the unread tab dots

**Files:**
- Modify: `app/student/layout.tsx` (own the notification poll, same pattern as `(system)/layout.tsx`)
- Modify: `app/modules/shared.tsx` (`PortalTabBar` already accepts `unread` from Task 4 — no signature change needed, just confirm)

**Interfaces:**
- Consumes: `GET /api/system?modules=notifications`, `notification-mark-read` action (both already exist, used by the staff bell in `(system)/layout.tsx` — mirror that file's `loadNotifications`/polling `useEffect` exactly).

- [ ] **Step 1: Read the staff bell's polling code precisely**

Read `app/(system)/layout.tsx`'s `notifState`/`loadNotifications`/polling `useEffect`/`markNotificationRead` block in full (search `notifState` in that file) immediately before writing this task's code, to copy its exact shape rather than re-deriving it from memory — field names, the 60-second interval, the `eslint-disable-next-line react-hooks/set-state-in-effect` comment convention, and the try/catch-swallow-on-poll-failure behavior all need to match.

- [ ] **Step 2: Add the same polling to `app/student/layout.tsx`**

Add, inside `StudentLayout`, after the existing auth-check `useEffect` (only once `checked` is true — polling shouldn't start before the auth check resolves):

```ts
  type NotificationRow = {
    id: number;
    type: string;
    title: string;
    body: string;
    link: string;
    readAt: string | null;
    createdAt: string;
  };
  const [notifState, setNotifState] = useState<{
    unreadCount: number;
    recent: NotificationRow[];
  }>({ unreadCount: 0, recent: [] });

  const loadNotifications = async () => {
    try {
      const response = await fetch(`${BASE_PATH}/api/system?modules=notifications`, {
        cache: "no-store",
      });
      const result = (await response.json()) as { notifications?: typeof notifState };
      if (result.notifications) setNotifState(result.notifications);
    } catch {
      // A missed poll just means a stale dot for 60s.
    }
  };

  useEffect(() => {
    if (!checked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const markRead = async (notificationId: number) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notification-mark-read", notificationId }),
    });
  };

  const unreadByTab = {
    billing: notifState.recent.some((n) => !n.readAt && n.link.startsWith("/student/billing")),
    maintenance: notifState.recent.some(
      (n) => !n.readAt && n.link.startsWith("/student/maintenance"),
    ),
  };
```

Pass `unread={unreadByTab}` into `<PortalTabBar unread={unreadByTab} />`.

- [ ] **Step 3: Mark read on tab visit**

`app/student/layout.tsx` wraps every route, so it can see the current path (`usePathname()`, already imported in `shared.tsx` for `PortalTabBar` — import it here too). Add:

```ts
  const pathname = usePathname();
  useEffect(() => {
    if (!checked) return;
    const prefix = pathname?.startsWith("/student/billing")
      ? "/student/billing"
      : pathname?.startsWith("/student/maintenance")
        ? "/student/maintenance"
        : null;
    if (!prefix) return;
    const toMark = notifState.recent.filter((n) => !n.readAt && n.link.startsWith(prefix));
    if (!toMark.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all(toMark.map((n) => markRead(n.id))).then(loadNotifications);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, checked, notifState.recent]);
```

(This re-runs whenever `notifState.recent` changes — including right after `loadNotifications()` marks things read, which triggers another `loadNotifications()`. Confirm this doesn't loop: once everything matching `prefix` has `readAt` set, `toMark` is empty and the effect body does nothing further, so it settles after one extra round-trip. Watch for this specifically in Step 5's browser check — if it *does* loop, guard with a ref tracking already-marked ids instead.)

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/student/layout.tsx app/modules/shared.tsx
```

- [ ] **Step 5: Browser verification**

1. Trigger a `ticket-reply` notification (staff replies on the tenant's ticket, per Task 2/7's setup) while the tenant is on `/student` (not the maintenance tab) — confirm the Maintenance tab icon shows the red dot, Billing does not.
2. Navigate to `/student/maintenance` — confirm the dot clears within the poll cycle (or immediately, given the mark-read-on-visit effect) and **stays cleared** (watch for a minute to rule out the re-loop risk flagged in Step 3).
3. Trigger both a `ticket-reply` and an `invoice-posted` notification at once — confirm both dots show, and visiting one tab only clears that tab's dot, not the other's.
4. Clean up all synthetic notifications/tickets/invoices/sessions used.

---

### Task 10: Full end-to-end pass and cleanup

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint across every changed file**

```bash
npx tsc --noEmit
npx eslint app/student app/modules/StudentHome.tsx app/modules/StudentBilling.tsx app/modules/StudentMaintenance.tsx app/modules/StudentAnnouncements.tsx app/modules/shared.tsx app/api/system/route.ts app/api/system/notifications.ts
```
Expected: 0 errors; only the two known pre-existing baseline warnings in `route.ts` (`TURNOVER_OPEN_STATUSES`, `invoiceFrequency`) may appear — nothing else new.

- [ ] **Step 2: Run the full "Testing" checklist from the design spec, in order**

Re-read `docs/superpowers/specs/2026-09-23-student-portal-design.md`'s "Testing" section and re-verify all 9 points end-to-end in one continuous pass with a single synthetic tenant + one synthetic staff account, rather than the piecemeal checks each earlier task already did — this catches any interaction between tasks (e.g. a roommate whose own ticket accidentally shows up in the wrong student's list, a notification dot that doesn't clear because Task 9's effect and Task 7's `load()` calls interact unexpectedly).

- [ ] **Step 3: Cross-student leakage spot-check**

Set up two synthetic tenants with distinct rooms/invoices/tickets. Confirm tenant A's `GET /api/system` never contains any row belonging to tenant B (units, invoices, tickets, attachments, announcements-if-different-hostel, deposit adjustments, past tenancies) — this is the single highest-consequence thing to get right in this whole feature, worth a dedicated final check even though Task 1's own verification already touched it for `roommates` specifically.

- [ ] **Step 4: Confirm no synthetic data remains**

```bash
node -e '
const postgres = require("postgres");
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  for (const [table, col] of [["app_users","display_name"],["student_profiles","full_name"],["maintenance_tickets","ticket_no"],["billing_invoices","invoice_no"],["notifications","title"],["announcements","title"],["user_sessions","id"]]) {
    const rows = await sql.unsafe(`SELECT id FROM ${table} WHERE ${col === "id" ? "id > 0" : col + " ILIKE $1"}`, col === "id" ? [] : ["%ZZTEST%"]);
    if (rows.length) console.log(table, rows.length, "possible leftovers");
  }
  await sql.end();
})();
'
```
(Adjust the leftover-scan approach as needed — the point is a final broad sweep for anything with a `ZZTEST`-style marker left in the real database, plus any scratch `user_sessions` rows, across every table touched by this feature's verification work.)

- [ ] **Step 5: Delete any remaining `.claude-scratch/verify_*.mjs` files from this plan's tasks**

```bash
ls .claude-scratch/ | grep -i student
```
Remove anything left over.

- [ ] **Step 6: Manual mobile-viewport pass**

One more pass through all four tabs at mobile width, in a real browser tab, checking: tab bar never overlaps content, forms are usable at that width, lightbox pop-out works for both photos and PDFs, empty states read sensibly (a tenant with no invoices/tickets/announcements yet), and the "not linked to a room" fallback from `StudentHomeModule` renders sensibly if tested with an unlinked account.

---

## Execution Notes

- **Task order matters for 1-3** (backend/shared-component prerequisites) but **6-8 (the three remaining screens) are independent of each other** and can be built in any order, or in parallel by different workers/agents, once Tasks 1-5 are done.
- Every code block above is a starting point verified against the real, current shape of the files it touches **as read during spec-writing** — but re-read the actual current file content immediately before editing in every task, since line numbers and exact variable names may have shifted from other work landing in between. Several steps explicitly flag "confirm X before relying on it" for exactly this reason — treat those as required, not optional.
- Follow this session's established verification discipline throughout: real dev database, `ZZTEST`/`ZZ`-prefixed synthetic fixtures, scratch session cookies, immediate cleanup after each check, `tsc`/`eslint` clean before calling any task done.
