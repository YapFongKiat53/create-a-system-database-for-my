# Student portal — turning the `/student` stub into a real self-service app

**Date**: 2026-09-23
**Scope**: The tenant-facing app at `/student` — room & tenancy details, billing
(view + submit payment proof), maintenance (submit + reply to tickets),
announcements, and a simple unread badge on the two tabs that can produce
notifications. Not in scope: room-change/move-out requests, parking, or any
change to the staff-facing app beyond three new notification triggers.

---

## Why

`app/student/page.tsx` exists but is a placeholder — it authenticates the
user and prints a "coming soon" list (room/tenancy, bills, maintenance,
announcements), nothing else. Every tenant who signs in lands there and can
do nothing.

The backend, on the other hand, is already most of the way there.
`GET /api/system` in `app/api/system/route.ts` has a `currentUser.roleKey ===
"tenant"` branch (~line 3010) that already scopes the *entire* payload down
to that student's own records: their hostel/unit/bed, their profile, their
invoices (posted ones only — draft-cycle invoices are held back), their
tickets and ticket messages, their deposit adjustments, their past
tenancies, their attachments, and hostel-scoped announcements.
`permissionFor()` (~line 1295) already grants tenants `view` on
finance/maintenance/announcements and `create` on finance/maintenance. The
actions a tenant needs — `billing-payment`, `ticket-create`,
`ticket-message` — already exist and already have tenant-specific branches
in their handlers. The `/student` landing redirect is already wired
(`landingFor()` in `app/api/auth/route.ts`).

So this is mostly a frontend project: build the screens that consume data
the API already hands over, using the same `SystemContext`/`useSystem()`
pattern, `shared.tsx` components (`Modal`, `StatusPill`, `FileField`,
`AttachmentGrid`, `Lightbox`, `DateField`, `money()`, `dateLabel()`), and
visual language every staff module already uses — just laid out for one
hand on a phone instead of a desk. It does need a handful of small, precise
backend additions on top of what's already scoped, found while checking
each screen's data needs against the actual tenant-scoping code rather than
assuming it's all already there: wiring the *existing* notification system
(built 2026-09-18, staff-only so far) to reach tenants for three events,
one narrow new field for roommate names (the current scoping deliberately
withholds every other occupant's row, for good reason — see "Roommates
card" below), and one optional prop on `AttachmentGrid` so a tenant can't
delete a staff member's photo. None of these touch the database schema.

## Decisions taken

| Question | Decision |
|---|---|
| Routing | Four real Next.js routes (`/student`, `/student/billing`, `/student/maintenance`, `/student/announcements`) under a shared `app/student/layout.tsx`, matching how every staff module is already one route each — not client-side tab state inside one page. Gets back/forward and shareable links for free. |
| Data source | Reuse `SystemContext`/`useSystem()` exactly as every `(system)` module does. The existing tenant branch in `GET /api/system` already covers billing/maintenance/announcements/tenancy in full; the one gap found is roommate names (see below), which needs one small, deliberately narrow addition. |
| Auth guard | `app/student/layout.tsx` does the same `fetch('/api/auth')` check the current stub does, redirects to `/login` if signed out, and additionally redirects a non-tenant role to `/` (a staff account landing here by a stale bookmark shouldn't see another role's shell). |
| Visual design | Same design system as the staff app (colors, type, `StatusPill`, `Modal`, card styling from `globals.css`) — not a separate visual identity. Only the layout changes: single column, bottom tab bar instead of sidebar. |
| Navigation shape | Fixed bottom tab bar, four icons (room / billing / maintenance / announcements) — the standard mobile pattern, since tenants use this on their phones, not at a desk like staff do. |
| New `PortalTabBar` component | Lives in `app/modules/shared.tsx` next to the other cross-module UI (`Modal`, `AttachmentGrid`, etc.), takes the active route and renders the four links + optional unread dot per tab. |
| Room/tenancy screen scope | **Read-only.** Shows current room, dates, rent, deposit, roommates (names only, no contact info). No move-out/room-change request flow — that stays a staff-initiated action for now. |
| Billing payment submission | Tenant can upload a payment slip themselves, reusing the existing `billing-payment` action (already permission-gated to tenant `create` on the finance module, already creates a `pending-verification` payment record and notifies the Finance role). No backend change needed here. |
| Maintenance ticket creation/reply | Reuses the existing `ticket-create` and `ticket-message` actions as-is — required photo on create, and `authorRole` already derived server-side from `currentUser.roleKey` (stored as `"student"`, never sent by the client). No change to either action itself; the one addition is the new staff→tenant notify call described under "Notifications" below, which touches `ticket-message`'s handler but not its reuse contract. |
| Attachment viewing | `AttachmentLink`/`Lightbox`/`AttachmentGrid` components (built 2026-09-22) carry over — tapping a payment slip or a ticket photo pops it out in place instead of opening a new tab, same as the staff app. `AttachmentGrid` gets one new optional `canDelete` predicate prop (default: unchanged existing behavior) so the portal can restrict deletion to the tenant's own uploads — see "Maintenance" below. |
| Notifications | Reuse the existing `notifications` table and `notifyUser()`/`getNotificationSummary()` helpers (already generic by `userId`, not role-restricted) — no schema change. What's missing is that nothing currently *calls* them for tenant-relevant events. Three new trigger points are added (see below), plus one new helper, `notifyStudent()`, to resolve a `studentId` to its `app_users.id`. |
| Notification UI scope | A small unread dot on the Billing and Maintenance tab icons only (driven by `data.notifications.unreadCount`, bucketed by the notification's `link` prefix). No dropdown, no dedicated notifications page, no push — v1 is "does this tab have something new," not a full inbox. |

## Out of scope for this spec

- **Room-change or move-out requests.** Room/tenancy stays a read-only screen. Those requests keep going through staff (Sales/Manager) by whatever channel they use today.
- **Parking.** Not one of the four sections the tenant asked for; can be added later as its own screen once wanted.
- **A notification dropdown or dedicated notifications page for tenants.** Just the two tab-icon dots described above.
- **Push/email/SMS delivery.** In-app only, same as the staff notification system.
- **Any change to how staff use the app**, beyond the three new `notifyStudent()` call sites listed below.
- **Multi-language UI.** English only, matching the staff app today.

---

## Architecture

```
app/student/
  layout.tsx               new — SystemProvider + auth/role guard + PortalTabBar shell
  page.tsx                 rewritten — "My room" (was the placeholder)
  billing/page.tsx         new
  maintenance/page.tsx     new
  announcements/page.tsx   new

app/modules/
  StudentHome.tsx           new — room/tenancy screen content
  StudentBilling.tsx        new — billing screen content
  StudentMaintenance.tsx    new — maintenance screen content
  StudentAnnouncements.tsx  new — announcements screen content
  shared.tsx                + PortalTabBar component
```

Each `app/student/*/page.tsx` is a thin wrapper — same shape as
`app/(system)/finance/page.tsx` etc. — that calls `useSystem()` and renders
its matching module component:

```tsx
"use client";
import { useSystem } from "../../SystemContext";
import { StudentBillingModule } from "../../modules/StudentBilling";

export default function StudentBillingPage() {
  const { data, save, busy, load } = useSystem();
  if (!data) return null;
  return <StudentBillingModule data={data} save={save} busy={busy} load={load} />;
}
```

`app/student/layout.tsx` wraps all four routes:

```tsx
"use client";
import { useEffect, useState } from "react";
import { SystemProvider } from "../SystemContext";
import { PortalTabBar } from "../modules/shared";
import { BASE_PATH } from "../basePath";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!result.user) { window.location.replace(`${BASE_PATH}/login`); return; }
        if (result.user.roleKey !== "tenant") { window.location.replace(BASE_PATH || "/"); return; }
        setChecked(true);
      })
      .catch(() => window.location.replace(`${BASE_PATH}/login`));
  }, []);

  if (!checked) return <div className="login-shell"><div className="login-card"><p className="login-checking">Loading your portal...</p></div></div>;

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

`SystemProvider` (`app/SystemContext.tsx:63`) is already a standalone
exported component, currently mounted only in `(system)/layout.tsx` — no
refactor needed to mount it a second time here.

## Screens

### 1. My room (`/student`, `StudentHome.tsx`)

- Greeting with the student's name.
- **Current stay card**: room code, hostel name, move-in date, monthly rent,
  deposit held, current billing cycle label. Sourced from `data.students`
  (own profile — already the only row returned), `data.units`/`data.bedSpaces`
  filtered to the student's own bed.
- **Roommates card** (only if others share the room): names only, no
  contact info. **This needs one new field in the tenant-scoped response —
  it is not already there.** Checked: the existing tenant branch's
  `bedSpaces` (`route.ts:3060`) is filtered to `bed.occupantId ===
  currentUser.studentId`, i.e. only the tenant's own bed, and `students`
  is filtered to `ownStudents` (their own profile only) — neither carries
  any other occupant's data today, and widening either wholesale would leak
  other students' full profiles (IC number, contact, etc.), not just their
  name. Add a narrow `roommates: { studentId: number; fullName: string }[]`
  field instead: server-side, find the tenant's own `roomId` (via their bed),
  then select just `id`/`fullName` from `studentProfiles` for every other
  active occupant of beds in that same room — never the full row.
- **At a glance**: outstanding balance (sum of `data.invoices` where
  `status !== "paid"`) and open ticket count (`data.tickets` where `status`
  not in `["completed", "closed"]`), each a tap-through to that tab.

### 2. Billing (`/student/billing`, `StudentBilling.tsx`)

- Three-way filter: Outstanding / Paid / All, over `data.invoices` (already
  scoped to this student, posted cycles only).
- Each row: period/invoice number, due date, total, paid, `StatusPill`.
- Tapping a row opens a `Modal` with the line items (`invoice.items`) and
  payment history (`invoice.payments`, each with its own status —
  pending-verification vs verified).
- **Submit payment** button (shown when the invoice isn't fully paid) opens
  a small form: amount, optional remark, `FileField` for the slip. Submit
  handler copies `Finance.tsx`'s own "Submit payment proof" form verbatim
  (`Finance.tsx:2916-2945`, the `save({ action: "billing-payment", invoiceId,
  ...formValues(e), confirmSuspicious })` → `uploadAttachment(file,
  "payment-proof", result.id, ...)` → `load()` sequence) — same action, same
  suspicious-amount confirmation flow (`SuspiciousConfirm`), same
  attachment-linking step. `billing-payment` already notifies the Finance
  role on its own; untouched.
- Existing slips render through `AttachmentLink` (pops a `Lightbox` for a
  photo/PDF-image instead of a new tab).

### 3. Maintenance (`/student/maintenance`, `StudentMaintenance.tsx`)

- List of `data.tickets` (already scoped to this student), newest first,
  each with `StatusPill`, category, submitted date.
- **New ticket** button opens a form: category/subcategory (`data.ticketCategories`),
  priority, description, `FileField` (`ATTACHMENT_ACCEPT`, required — the
  existing tenant-required-photo rule in the `ticket-create` handler is
  unchanged). Submits `action: "ticket-create"`.
- Tapping a ticket opens its full thread: every `data.ticketMessages` row
  for that ticket, staff messages visually distinct from the tenant's own
  (same `student-message`/`staff-message` classes `Maintenance.tsx` already
  defines). A reply box posts `action: "ticket-message"` with just
  `{ ticketId, message }` — the handler already derives `authorRole` from
  `currentUser.roleKey` server-side (`route.ts:6740`, `"student"` for a
  tenant), the client never sends it.
- Attachments (fault photos, staff reply photos) render through the shared
  `AttachmentGrid`. Today that component's delete button is unconditional
  for every attachment it's given (no ownership check at all — confirmed by
  reading `shared.tsx:891`), which would let a tenant delete a staff
  member's uploaded photo if reused as-is. `AttachmentGrid` gets one new
  optional prop, `canDelete?: (attachment: Row) => boolean` (defaulting to
  `() => true`, so every existing call site is unaffected); the student
  portal passes `canDelete={(a) => a.uploadedBy === data.currentUser?.displayName}`.

### 4. Announcements (`/student/announcements`, `StudentAnnouncements.tsx`)

- List of `data.announcements` (already hostel-scoped), newest first, title
  + date + preview.
- Tapping opens the full text in a `Modal`. No write actions.

## Notifications

Reuses everything from the 2026-09-18 staff notifications spec unchanged:
the `notifications` table, `notify()`, `notifyUser()`, and
`getNotificationSummary(db, userId)` (already keyed by `userId`, not
role — a tenant's `app_users.id` works exactly like a staff one).

One new helper in `app/api/system/notifications.ts`, since these three
triggers know a `studentId`, not a `userId` directly:

```ts
export async function notifyStudent(db: Db, studentId: number, input: NotifyInput) {
  const [user] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.studentId, studentId), eq(appUsers.status, "active")));
  if (user) await notifyUser(db, user.id, input);
}
```

Three new trigger points in `app/api/system/route.ts`:

| Event | Handler | What's added |
|---|---|---|
| Staff replies on a ticket | `ticket-message`, only when `currentUser.roleKey !== "tenant"` (the mirror image of the existing tenant→Maintenance trigger) | One line, after the existing update. `priorTicket` (`route.ts:6671`) currently selects only `assignedTo`/`ticketNo` — add `studentId: maintenanceTickets.studentId` to that select first, then: `await notifyStudent(db, priorTicket.studentId, { type: "ticket-reply", title: \`New reply on ${priorTicket.ticketNo}\`, link: "/student/maintenance" })` |
| A billing cycle is posted | `billing-post` — checked `route.ts:7217-7222`: today this handler only flips `billingCycles.status`, it doesn't load the cycle's `periodLabel` or any of its invoices | More than one line: after the status update, fetch `SELECT id, invoice_no, student_id FROM billing_invoices WHERE cycle_id = ${cycleId}` (plus the cycle's own `periodLabel`, already fetchable by the same `cycleId`), then loop: `for (const invoice of invoices) await notifyStudent(db, invoice.studentId, { type: "invoice-posted", title: \`${periodLabel} bill is ready\`, link: "/student/billing" })` |
| A payment is verified | `billing-verify` | One line, after the existing update — `invoice` is already loaded in this handler (to recompute `amountPaid`), no new query needed: `await notifyStudent(db, invoice.studentId, { type: "payment-verified", title: \`Payment on ${invoice.invoiceNo} confirmed\`, link: "/student/billing" })` |

`link` here points into the student app's own routes (`/student/billing`,
`/student/maintenance`) rather than the staff routes the existing triggers
use — the tab-dot logic below reads this prefix.

### Tab unread dots

`PortalTabBar` reads `data.notifications` (added to the scoped payload the
same way the staff bell does — `GET /api/system?modules=notifications`,
polled every 60s, same mechanism, not duplicated). For each of `recent`
where `readAt` is null, bucket by `link` prefix: `/student/billing` → dot on
Billing tab, `/student/maintenance` → dot on Maintenance tab. No dot logic
for Home or Announcements in v1.

Marking read: `markAllNotificationsRead()` (the `notification-mark-all-read`
action) clears *every* unread notification for the user, not just one tab's
— checked `notifications.ts:104`, it takes no `link`/type filter. Using it
on tab mount would wrongly clear the *other* tab's dot too. Instead, each
tab filters its own already-loaded `data.notifications.recent` to unread
items whose `link` matches its own prefix, and calls the existing
per-notification `action: "notification-mark-read"` (`{ notificationId }`)
once for each — no new backend action needed, just a client-side loop over
data already in hand.

## Error handling

- Signed out or session expired: redirect to `/login`, same as the current
  stub and every other `(system)` page's guard.
- `save()` failures (validation errors, the suspicious-amount guard, etc.):
  surfaced the same way every staff form already shows them — inline error
  banner from `SystemContext`'s existing error state, no new mechanism.
- `currentUser.studentId` missing (account not linked to a student profile):
  `ticket-create`'s existing guard (`if (!currentUser.studentId) throw ...`)
  already covers the backend; the frontend shows a plain message — "Your
  account isn't linked to a room yet — contact the hostel office" — instead
  of a blank or broken screen, on any screen where `data.students` comes
  back empty.

## Testing

Same approach as every other feature this session: synthetic
`ZZTEST`-prefixed fixtures against the real dev database, a scratch session
cookie for a tenant test account, cleaned up immediately after each pass.

1. A tenant session's `GET /api/system` returns only that student's rows
   across every scoped field listed in "Why" above — spot-check one row
   each for units/invoices/tickets/announcements against a second tenant's
   session to confirm no cross-student leakage.
2. Submit a payment slip as the tenant → confirm the `billing_payment_records`
   row and the uploaded attachment exist, and Finance's existing
   payment-pending notification still fires.
3. Submit a maintenance ticket with a required photo as the tenant → confirm
   the ticket, its first message, and the attachment all exist with the
   right `contextType`/`recordId`.
4. Reply to that ticket as staff → confirm the new `ticket-reply`
   notification lands on the tenant's `app_users.id`, and that a *tenant*
   reply does **not** also trigger it (only the staff-authored branch does).
5. Post a billing cycle → confirm every invoice in it produces exactly one
   `invoice-posted` notification to its student.
6. Verify a payment → confirm the `payment-verified` notification fires
   once, to the right student.
7. Confirm the tab dot appears after step 4/5/6 and clears after visiting
   the corresponding tab, via the per-notification mark-read loop — and
   confirm visiting one tab does **not** clear the other tab's still-unread
   dot (the exact bug the naive mark-all approach would have caused).
8. `tsc --noEmit` and `eslint` clean on every new/changed file.
9. Manual pass in the browser at mobile viewport width: all four tabs,
   photo/PDF lightbox pop-out, form validation errors, empty states (no
   invoices yet, no tickets yet, no announcements yet).
