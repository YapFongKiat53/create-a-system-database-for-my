# Staff notifications — a bell, a dropdown, and a page, wired to the events that already matter

**Date**: 2026-09-18
**Scope**: A new in-app notification system for staff (Director/Manager/Finance/
Sales/Maintenance/Technician — not tenants). v1 covers the confirmed
action-triggered events for Finance, Sales, and Maintenance, plus one
scheduled daily check (a student's lease ending within 2 months, notifying
Sales). Everything else scheduled/computed (meter overdue, a reservation
hold expiring, an incomplete profile) is explicitly deferred.

---

## Why

There is currently no staff-facing notification mechanism anywhere in the
app. The closest thing, `notice` in `SystemContext`, is an ephemeral toast
shown only to the person who *just* saved something — it tells you "Saved",
not "someone else did something you need to know about". Nobody finds out
about another role's action unless they happen to open that module and
notice it themselves.

Concrete pain today: Finance doesn't know a payment proof arrived until they
browse Invoices looking for one. Maintenance doesn't know a ticket was
raised until they open the module. Sales doesn't know a lease is about to
lapse until someone remembers to check every student's dates by hand. A
technician who gets assigned a ticket has no way to know except being told
in person.

## Decisions taken

| Question | Decision |
|---|---|
| Storage shape | One row per **recipient** (fan-out on write) — a broadcast to 6 Maintenance users inserts 6 rows, not one shared row with a read-tracking join table. Matches how every other list in this app is read: "my unread notifications" is one indexed query, no join. |
| Trigger mechanism | A `notify()` helper called inline from the ~10 relevant action handlers in `route.ts` — no event bus, no queue. Same shape as everything else in this file: a save does the extra work in the same transaction. |
| Recipient resolution — role broadcasts | `notifyRole(db, roleKey, {...})` — active `app_users` joined to `app_roles` on `role_key`. |
| Recipient resolution — permission-gated | `notifyRoleWithApproval(db, roleKey, moduleKey, {...})` — same, plus a join to `role_permissions` requiring `can_approve` on that module. Used only for the electricity-adjustment-pending event. |
| Recipient resolution — a specific person | `notifyUser(db, userId, {...})` — used only for "ticket assigned to a technician", where the assignee is now a real account (see below). |
| Recipient resolution — "the reservation's salesperson" / "notify Sales" | **Broadcasts to all active Sales-role users, not a specific matched account.** `salesPerson`/`salesperson` (on reservations and students) is a free-text-backed picker sourced from a loose `sales_person` names table — it has no column linking it to `app_users`, and includes names that may not correspond to any login at all (the payload even hardcodes a fallback `"Irena"` to keep the picker usable on an empty database). Resolving a name to an account would be guessing; broadcasting to the whole Sales team is honest about what the data actually supports. |
| "Assigned to" on a ticket | Changes from a free-text `<input>` to a `<select>` of active Maintenance/Technician users (Option B, confirmed) — both so the field is actually correct, and so "ticket assigned" has a real account to notify. |
| Delivery UI | Bell icon + unread-count badge in the shared top bar (`(system)/layout.tsx`); click opens a dropdown of the most recent notifications (read on click, navigates to the record); a "View all" row at the bottom opens a dedicated Notifications page. |
| Live-ness | Polled, not pushed — this app has no websocket/live layer anywhere, and adding one for this alone is out of proportion. The badge count polls a lightweight endpoint every 60s. |
| Where "View all" lives | **Added as a real (small) entry in `navGroups`**, not a hidden route. The layout's own redirect guard ("bounce off a page the current role can no longer see", `(system)/layout.tsx`) sends anyone at a URL outside their `navigation` list back to their first allowed page — a route reachable *only* from the bell would get redirected away the moment someone reloads the page or shares the link. Keeping it a normal nav entry avoids fighting that guard. It's visible to every signed-in staff role (empty permission string, same as Dashboard) since anyone can have notifications. |
| Click-through to the exact record | **Not a universal deep-link framework.** Every module's tabs (`financeTab`, `drawerRecordsTab`, `ticketStatusFilter`, ...) are plain React state, not URL state, so a link alone can only land on the right top-level page (e.g. `/finance`), not the right tab. Scoped fix: the handful of pages this feature actually touches (Finance, Maintenance, the student drawer) read one optional query param on mount (`?tab=deposits`, `?ticket=123`) to preselect the right tab/record if present — a few lines each, not a new routing layer. |
| Scheduled check — mechanism | Reuses the existing pattern in `route.ts` (`lateChargesAppliedOn`, `applyLatePaymentCharges`): a module-level in-memory date guard, run once per KL calendar day, fired-and-forgotten alongside the response so it never blocks a request. |
| Scheduled check — what counts as "ending within 2 months" | An **active** `accommodation_assignments` row (`status = 'active'`) whose `agreement_end_date` (exposed to the frontend as `leaseEndDate`) falls between today and today + 60 days. |
| Scheduled check — avoiding duplicate notifications every day | Before inserting, check whether an *unsuperseded* notification of type `lease-expiring` already exists for that assignment (`WHERE type = 'lease-expiring' AND link = '/students?tenancy=<id>'`). If the lease end date is later moved further out and drifts back outside the 60-day window, that stale row is left as-is (it's about a lease end date that's since changed — harmless, and gone once read); the scan simply won't create a new one for the same assignment until it's read and a new gap opens. |

## Out of scope for this spec

- **The other scheduled/computed events** discussed and explicitly deferred: meter reading overdue (this already has its own, separate, already-shipped surface — see `2026-09-14-meter-overdue-reminder-design.md` — this spec does not duplicate it as a notification), a reservation's payment hold expiring soon, and an incomplete student profile after move-in.
- **A payment-slip "reject and ask Sales to redo it" flow.** No such action exists today (Finance can only edit the amount or delete the payment); adding one is a real feature in its own right, not a notification wiring task.
- **Email or SMS delivery.** In-app only.
- **Any change to the existing `notice` toast.** That stays exactly as it is — a separate, ephemeral, self-only signal.
- **A generic deep-link/routing framework.** See the click-through decision above — scoped to the handful of pages this feature needs.
- **Notifications for tenants.** This is a staff-only feature; the tenant-facing app is untouched.

---

## Data model

New table, `notifications`:

```ts
export const notifications = pgTable(
  "notifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    recipientUserId: bigint("recipient_user_id", { mode: "number" })
      .notNull()
      .references(() => appUsers.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // Where clicking this notification should navigate — a relative path,
    // optionally with the query params the target page's tab/record picker
    // reads (see "Click-through to the exact record" above).
    link: text("link").notNull().default(""),
    readAt: text("read_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [
    index("notifications_recipient_unread").on(
      table.recipientUserId,
      table.readAt,
    ),
  ],
);
```

`type` is a short key (`"ticket-created"`, `"ticket-assigned"`,
`"payment-pending"`, `"adjustment-pending"`, `"billing-cycle-ready"`,
`"reservation-changed"`, `"lease-expiring"`) — not enforced by a DB enum,
same convention `chargeType`/`action` already use throughout this schema.

## Server helpers (`app/api/system/route.ts`)

```ts
async function notify(
  db: ReturnType<typeof getDb>,
  input: {
    recipientUserIds: number[];
    type: string;
    title: string;
    body?: string;
    link?: string;
  },
) {
  if (!input.recipientUserIds.length) return;
  await db.insert(notifications).values(
    input.recipientUserIds.map((recipientUserId) => ({
      recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body || "",
      link: input.link || "",
    })),
  );
}

async function notifyRole(
  db: ReturnType<typeof getDb>,
  roleKey: string,
  input: Omit<Parameters<typeof notify>[1], "recipientUserIds">,
) {
  const recipients = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
    .where(and(eq(appRoles.roleKey, roleKey), eq(appUsers.status, "active")));
  await notify(db, { ...input, recipientUserIds: recipients.map((r) => r.id) });
}

async function notifyRoleWithApproval(
  db: ReturnType<typeof getDb>,
  roleKey: string,
  moduleKey: string,
  input: Omit<Parameters<typeof notify>[1], "recipientUserIds">,
) {
  const recipients = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, appRoles.id))
    .where(
      and(
        eq(appRoles.roleKey, roleKey),
        eq(appUsers.status, "active"),
        eq(rolePermissions.moduleKey, moduleKey),
        eq(rolePermissions.canApprove, true),
      ),
    );
  await notify(db, { ...input, recipientUserIds: recipients.map((r) => r.id) });
}

async function notifyUser(
  db: ReturnType<typeof getDb>,
  userId: number,
  input: Omit<Parameters<typeof notify>[1], "recipientUserIds">,
) {
  await notify(db, { ...input, recipientUserIds: [userId] });
}
```

## Trigger points

Added inline, one `notify*()` call each, at the end of the existing
handler (after its own writes succeed, same place `save()`'s callers
already read `createdId` back from):

| Event | Handler (`action === ...`) | Call |
|---|---|---|
| New reservation payment proof pending verification | `reservation-payment` | `notifyRole(db, "finance", {type: "payment-pending", title: \`New reservation payment from ${reservation.studentName}\`, link: \`/finance?tab=deposits\`})` |
| New invoice payment proof pending verification | `billing-payment` | `notifyRole(db, "finance", {type: "payment-pending", title: \`New payment on invoice ${invoice.invoiceNo}\`, link: \`/finance?tab=invoices&invoice=${invoiceId}\`})` |
| Electricity billing adjustment needs approval | `billing-item-adjust`, only when `item.itemType === "electricity"` (the branch that already sets `approvalStatus: "pending"`) | `notifyRoleWithApproval(db, "finance", "finance", {type: "adjustment-pending", title: \`Electricity adjustment needs approval — ${item.description}\`, link: "/finance?tab=adjustments"})` |
| Billing cycle generated, ready for review & post | `billing-cycle` | `notifyRole(db, "finance", {type: "billing-cycle-ready", title: \`${periodLabel} billing is ready to review\`, link: "/finance?tab=invoices"})` |
| Reservation cancelled | `reservation-cancel` | `notifyRole(db, "sales", {type: "reservation-changed", title: \`Reservation ${reservation.referenceNo} was cancelled\`, link: "/hostels?tab=reservations"})` |
| Reservation's unit/room confirmed by someone else | `reservation-confirm-unit` | same shape, title `"...room confirmed"` |
| Reservation room changed | `reservation-room-change` | same shape, title `"...room changed"` |
| New ticket submitted | `ticket-create` | `notifyRole(db, "maintenance", {type: "ticket-created", title: \`New ${priority === "high" ? "URGENT " : ""}ticket — ${category}\`, link: \`/maintenance?ticket=${ticketId}\`})` |
| New tenant message on a ticket | `ticket-message`, only when `body.authorRole === "tenant"` (the create-time value, not a staff reply) | `notifyRole(db, "maintenance", {type: "ticket-message", title: \`New message on ${ticket.ticketNo}\`, link: \`/maintenance?ticket=${ticket.id}\`})` |
| Ticket assigned to a technician | `ticket-message`, only when `body.assignedTo` (now a user id, see below) changed from the ticket's previous value | `notifyUser(db, assignedUserId, {type: "ticket-assigned", title: \`You were assigned ${ticket.ticketNo}\`, link: \`/maintenance?ticket=${ticket.id}\`})` |
| Room turnover/cleaning scheduled | `turnover-schedule` | `notifyRole(db, "maintenance", {type: "turnover-scheduled", title: \`Turnover scheduled — room ${roomCode}\`, link: "/maintenance?tab=turnover"})` |

## "Assigned to" becomes a real picker

`maintenanceTickets.assignedTo` (currently `text`, holding whatever staff
typed) changes meaning to **hold a user id as text** — no column type
change needed (it's already `text`, and existing rows are just cleared/left
as free text that no longer matches anyone, which is fine — they're
historical and not re-notified). The reply form's
```tsx
<input name="assignedTo" required placeholder="Staff name" />
```
(Maintenance.tsx, both occurrences) becomes
```tsx
<select name="assignedTo" defaultValue={ticket.assignedTo} required>
  <option value="">Unassigned</option>
  {data.users
    .filter((user) => ["maintenance", "technician"].includes(user.roleKey) && user.status === "active")
    .map((user) => (
      <option key={user.id} value={user.id}>{user.displayName}</option>
    ))}
</select>
```
and every place the table/detail view currently prints `ticket.assignedTo`
as raw text instead prints the matching user's `displayName` (looked up
once from `data.users`, same pattern `loginFor()` already uses in
StudentInformation.tsx).

## Scheduled check — lease ending within 2 months

```ts
let leaseExpiryCheckedOn: string | null = null;

async function checkExpiringLeases(db: ReturnType<typeof getDb>) {
  const today = todayInKL();
  const in60Days = /* today + 60 days, same date-math already used for
                       cutoff/due-date rollovers elsewhere in this file */;
  const expiring = await db
    .select({
      id: accommodationAssignments.id,
      studentName: studentProfiles.fullName,
      leaseEndDate: accommodationAssignments.agreementEndDate,
    })
    .from(accommodationAssignments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, accommodationAssignments.studentId))
    .where(
      and(
        eq(accommodationAssignments.status, "active"),
        gte(accommodationAssignments.agreementEndDate, today),
        lte(accommodationAssignments.agreementEndDate, in60Days),
      ),
    );

  for (const row of expiring) {
    const link = `/students?tenancy=${row.id}`;
    const already = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, "lease-expiring"), eq(notifications.link, link)))
      .limit(1);
    if (already.length) continue;
    // dateLabel() is a frontend-only formatter (app/modules/shared.tsx, a
    // client module) — the backend has no equivalent, so the title carries
    // the raw ISO date rather than reaching across that boundary for a
    // "15 Nov 2026"-style string. The dropdown/page can format it
    // client-side later if that's worth doing; not needed for v1.
    await notifyRole(db, "sales", {
      type: "lease-expiring",
      title: `${row.studentName}'s lease ends ${row.leaseEndDate}`,
      link,
    });
  }
}
```

Wired the same way `applyLatePaymentCharges` already is, right next to it:

```ts
const leaseCheckDate = todayInKL();
if (leaseExpiryCheckedOn !== leaseCheckDate) {
  leaseExpiryCheckedOn = leaseCheckDate;
  void checkExpiringLeases(seedDb).catch((failure) => {
    leaseExpiryCheckedOn = "";
    console.error("Lease expiry check failed", failure);
  });
}
```

## Reading notifications (client)

Two additions to the scoped-module read path (`loadScopedModules`, the same
mechanism `?modules=a,b` already uses after a `save()`), plus one new save
action:

- `GET /api/system?modules=notifications` → `{ notifications: { unreadCount: number, recent: Row[] } }` — `recent` is the current user's latest 15 notifications (any read state), ordered newest first. Cheap: one indexed query on `recipient_user_id`.
- The Notifications *page* fetches its own full, paginated list directly (not through the shared payload) — same `PAGE_SIZE`/offset pattern every other module table already uses, filtered to `recipientUserId = currentUser.id`.
- `action: "notification-mark-read"` (`{ notificationId }`) and `action: "notification-mark-all-read"` — set `readAt = nowIso()`, scoped to the current user's own rows only (never someone else's).

The bell polls `?modules=notifications` every 60 seconds via `setInterval`
in a small hook local to `(system)/layout.tsx` (not `SystemContext` — this
data doesn't need to be threaded through every module, only the bell and
the notifications page read it).

## Frontend components

- **Bell** — a new icon button in `.topbar` (`(system)/layout.tsx`,
  currently just `<h1>`/`<p className="topbar-note">`), badge shows
  `unreadCount` capped at "9+".
- **Dropdown** — opens on click, closes on outside click/Escape (same
  pattern `Modal`'s backdrop `onMouseDown` already uses). Lists `recent`;
  each row is a `<Link>` to `notification.link`, calls
  `notification-mark-read` on click, bold while unread. A "Mark all as
  read" action and a "View all →" row at the bottom.
- **Notifications page** (`app/modules/Notifications.tsx`, new nav entry —
  see decision above) — full paginated table, same shell as any other
  `.table-v2` list in this app (search not needed for v1; a simple
  All/Unread toggle is enough).

## Testing

Same approach as every other feature verified this session: synthetic
`ZZTEST`-prefixed fixtures against the real dev database (a test
ticket/reservation/tenancy, a scratch session cookie), never touching real
records, cleaned up immediately after. Specific checks:

1. Each of the 10 action-triggered events creates the right number of rows
   for the right recipients (broadcast events: one row per active user of
   that role; targeted events: exactly one row, to the right account).
2. A staff reply on a ticket (`authorRole !== "tenant"`) does **not**
   trigger the "new tenant message" notification.
3. Changing `assignedTo` to the *same* user id again does not re-notify
   (only an actual change fires it).
4. The electricity-adjustment notification only reaches Finance users with
   `canApprove` — a Finance user without it gets nothing.
5. `checkExpiringLeases` picks up a tenancy at exactly the 60-day boundary
   and at 1 day out, skips one at 61 days and one already ended.
6. Running the scheduled check twice on the same synthetic tenancy does not
   create a second notification.
7. `notification-mark-read`/`-mark-all-read` never touch another user's
   rows (attempt with a second synthetic account, confirm no cross-write).
8. The bell's unread badge and the dropdown list update after
   `notification-mark-read`, without a full page reload.
