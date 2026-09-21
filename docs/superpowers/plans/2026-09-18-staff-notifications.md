# Staff Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff (Director/Manager/Finance/Sales/Maintenance/Technician) an in-app bell + dropdown + dedicated page that surfaces ~10 action-triggered events and one scheduled daily check, per the approved spec.

**Architecture:** One new Postgres table (`notifications`, fan-out on write — one row per recipient). A small new server module (`app/api/system/notifications.ts`) holds all the write/read/mark-read logic as plain functions; `app/api/system/route.ts` calls them inline from the relevant action handlers (no event bus). The frontend polls a lightweight scoped endpoint (`GET /api/system?modules=notifications`) every 60s for the bell's badge/dropdown, and a dedicated `Notifications` module renders the full paginated list.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Supabase Postgres (via the `postgres` package), React 19, no test framework (this repo has none — see Testing Approach below).

## Global Constraints

- No unit test framework exists in this repo (`package.json`'s `"test"` script is just `vinext build`). Every task's verification step uses this repo's own established practice instead: `npx tsc --noEmit`, `npx eslint <files>`, and a scripted check against the real dev database using `ZZTEST`/synthetic-session fixtures (a `.mjs` script under `.claude-scratch/`, run with `node`, cleaned up immediately after). This mirrors exactly how every feature in this codebase's recent history (see `.claude-scratch/apply_0023.mjs`, and every verification done in this session) has actually been checked.
- Schema changes follow this repo's own two-step pattern: edit `db/schema.ts`, run `npm run db:generate` (produces a tracked `drizzle/pg/00XX_*.sql` file), **and separately** hand-write a small idempotent `CREATE TABLE IF NOT EXISTS ...` script applied directly against `DATABASE_URL` with `node` — there is no `db:migrate` script in this repo; the generated SQL file is for drift-tracking, the hand-written script is what actually changes the live database.
- Never commit unless explicitly asked (matches this session's standing rule) — this plan's steps say "commit" per the skill's own convention, but treat that as "stage and describe the commit you'd make"; only actually run `git commit` if the user has asked for commits during execution. Never touch real production data — every verification step must clean up its own fixtures.
- Dates are plain `text` columns in `YYYY-MM-DD`/ISO-string form throughout this schema (see `todayInKL()`, `nowIso()` in `route.ts`) — never `Date` objects in the DB layer.

---

### Task 1: `notifications` table

**Files:**
- Modify: `db/schema.ts` (add near the end, after `reminderTemplates` at line 854 and before the `systemSettings` table)
- Create: `.claude-scratch/apply_notifications_table.mjs` (idempotent apply script, following `.claude-scratch/apply_0023.mjs`'s exact pattern)
- Create: `.claude-scratch/verify_task1.mjs` (verification script)

**Interfaces:**
- Produces: `notifications` Drizzle table export — columns `id`, `recipientUserId`, `type`, `title`, `body`, `link`, `readAt`, `createdAt`. Every later task imports this from `../../../db/schema` (server) exactly like every other table in this file already does.

- [ ] **Step 1: Add the table to `db/schema.ts`**

Insert immediately after the closing `});` of `reminderTemplates` (currently ending at line 854, right before the `systemSettings` comment block):

```ts
export const notifications = pgTable(
  "notifications",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    recipientUserId: bigint("recipient_user_id", { mode: "number" })
      .notNull()
      .references(() => appUsers.id),
    // A short event key ("ticket-created", "ticket-assigned",
    // "payment-pending", "adjustment-pending", "billing-cycle-ready",
    // "reservation-changed", "lease-expiring") — not a DB enum, same
    // convention chargeType/action already use throughout this schema.
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // Where clicking this notification navigates — a relative path,
    // optionally carrying the query params the target page's tab/record
    // picker reads (see app/api/system/notifications.ts).
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

`index` needs importing — check the top of `db/schema.ts` for its existing import line (it already imports `pgTable`, `bigint`, `text`, `boolean`, `doublePrecision`, `uniqueIndex`, `sql` from `drizzle-orm/pg-core`, since `uniqueIndex` is used by `rolePermissions` a few tables up). Add `index` to that same import list if it isn't already there:

```ts
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  pgTable,
  sql,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

(Keep whatever the existing import already has; just make sure `index` is in it — don't duplicate `pgTable`/`sql`/etc. if they're already imported under different ordering.)

- [ ] **Step 2: Generate the tracked migration**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && npm run db:generate`
Expected: a new file appears under `drizzle/pg/`, e.g. `drizzle/pg/0024_<name>.sql`, containing a `CREATE TABLE "notifications" (...)` statement and a `CREATE INDEX` statement. `drizzle/pg/meta/_journal.json` gets a new entry. This file is for drift-tracking only — do not run it directly.

- [ ] **Step 3: Write and run the idempotent apply script**

```js
// .claude-scratch/apply_notifications_table.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 2,
  idle_timeout: 10,
});
await sql`SET search_path TO public`;

await sql`
  CREATE TABLE IF NOT EXISTS notifications (
    id bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
    recipient_user_id bigint NOT NULL REFERENCES app_users(id),
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    link text NOT NULL DEFAULT '',
    read_at text,
    created_at text DEFAULT (CURRENT_TIMESTAMP)::text NOT NULL
  )`;
console.log("notifications table ready");

await sql`
  CREATE INDEX IF NOT EXISTS notifications_recipient_unread
  ON notifications (recipient_user_id, read_at)`;
console.log("index ready");

await sql.end();
```

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/apply_notifications_table.mjs`
Expected output: `notifications table ready` then `index ready`.

- [ ] **Step 4: Verify the table matches the schema**

```js
// .claude-scratch/verify_task1.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const cols = await sql`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'notifications'
  ORDER BY ordinal_position
`;
console.log(cols);
const [{ id: userId }] = await sql`SELECT id FROM app_users LIMIT 1`;
const [row] = await sql`
  INSERT INTO notifications (recipient_user_id, type, title)
  VALUES (${userId}, 'ZZTEST', 'Scratch check')
  RETURNING id, read_at, created_at
`;
console.log("inserted:", row);
if (row.read_at !== null) throw new Error("read_at should default to null");
await sql`DELETE FROM notifications WHERE type = 'ZZTEST'`;
console.log("cleaned up");
await sql.end();
```

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task1.mjs`
Expected: prints 8 columns (id, recipient_user_id, type, title, body, link, read_at, created_at), then `inserted: { id: ..., read_at: null, created_at: ... }`, then `cleaned up`, no thrown error.

- [ ] **Step 5: Type-check**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task1.mjs
git add db/schema.ts drizzle/pg/
git commit -m "Add notifications table"
```

---

### Task 2: Notification helper module

**Files:**
- Create: `app/api/system/notifications.ts`
- Create: `.claude-scratch/verify_task2.mjs`

**Interfaces:**
- Consumes: `notifications`, `appUsers`, `appRoles`, `rolePermissions` from `../../../db/schema` (Task 1); `getDb`'s return type from `../../../db`.
- Produces (all imported by `route.ts` from later tasks, exact signatures — this is the contract every later backend task relies on):
  - `notify(db, {recipientUserIds: number[], type: string, title: string, body?: string, link?: string}): Promise<void>`
  - `notifyRole(db, roleKey: string, {type, title, body?, link?}): Promise<void>`
  - `notifyRoleWithApproval(db, roleKey: string, moduleKey: string, {type, title, body?, link?}): Promise<void>`
  - `notifyUser(db, userId: number, {type, title, body?, link?}): Promise<void>`
  - `getNotificationSummary(db, userId: number): Promise<{unreadCount: number, recent: {id: number, type: string, title: string, body: string, link: string, readAt: string | null, createdAt: string}[]}>`
  - `markNotificationRead(db, userId: number, notificationId: number): Promise<void>` — scoped to that user's own rows only.
  - `markAllNotificationsRead(db, userId: number): Promise<void>` — scoped to that user's own rows only.

- [ ] **Step 1: Write the module**

```ts
// app/api/system/notifications.ts
import { and, desc, eq, isNull } from "drizzle-orm";
import type { getDb } from "../../../db";
import { appRoles, appUsers, notifications, rolePermissions } from "../../../db/schema";

type Db = ReturnType<typeof getDb>;

type NotifyInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
};

export async function notify(
  db: Db,
  input: NotifyInput & { recipientUserIds: number[] },
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

export async function notifyRole(db: Db, roleKey: string, input: NotifyInput) {
  const recipients = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
    .where(and(eq(appRoles.roleKey, roleKey), eq(appUsers.status, "active")));
  await notify(db, { ...input, recipientUserIds: recipients.map((r) => r.id) });
}

export async function notifyRoleWithApproval(
  db: Db,
  roleKey: string,
  moduleKey: string,
  input: NotifyInput,
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

export async function notifyUser(db: Db, userId: number, input: NotifyInput) {
  await notify(db, { ...input, recipientUserIds: [userId] });
}

export async function getNotificationSummary(db: Db, userId: number) {
  const [unread, recent] = await Promise.all([
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt))),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(15),
  ]);
  return { unreadCount: unread.length, recent };
}

export async function markNotificationRead(
  db: Db,
  userId: number,
  notificationId: number,
) {
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, userId),
      ),
    );
}

export async function markAllNotificationsRead(db: Db, userId: number) {
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)),
    );
}
```

- [ ] **Step 2: Verify against the real dev database**

```js
// .claude-scratch/verify_task2.mjs
// Exercises the module directly via tsx (no route.ts involved yet).
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

// notifications.ts imports getDb from "../../../db" (a Workers-style
// binding wrapper) — for this standalone check, hit the same rows the
// module's queries would, using plain SQL, to confirm the *data* shape the
// functions rely on (role/user join, canApprove) is correct before wiring
// route.ts in Task 3+.
const salesUsers = await sql`
  SELECT u.id FROM app_users u
  JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key = 'sales' AND u.status = 'active'
`;
console.log("active sales users:", salesUsers.length);
if (salesUsers.length < 1) throw new Error("expected at least 1 active sales user (flo/florence per earlier session check)");

const financeApprovers = await sql`
  SELECT u.id FROM app_users u
  JOIN app_roles r ON r.id = u.role_id
  JOIN role_permissions p ON p.role_id = r.id
  WHERE r.role_key = 'finance' AND u.status = 'active'
    AND p.module_key = 'finance' AND p.can_approve = true
`;
console.log("finance approvers:", financeApprovers.length);

await sql.end();
```

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task2.mjs`
Expected: `active sales users: 2` (flo, florence, per the roles check done during the design phase), and a `finance approvers` count (0 is fine if no finance user exists yet in this deployment — it just means `notifyRoleWithApproval` currently has nobody to notify, which is correct behaviour, not a bug).

- [ ] **Step 3: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint app/api/system/notifications.ts`
Expected: no output from either.

- [ ] **Step 4: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task2.mjs
git add app/api/system/notifications.ts
git commit -m "Add notification write/read helper module"
```

---

### Task 3: Read API — scoped poll, full-load summary, mark-read actions

**Files:**
- Modify: `app/api/system/route.ts` (four separate insertion points, detailed below)

**Interfaces:**
- Consumes: `notify*`/`getNotificationSummary`/`markNotificationRead`/`markAllNotificationsRead` from `./notifications` (Task 2).
- Produces: `GET /api/system?modules=notifications` → `{ notifications: { unreadCount, recent } }`; every full (unscoped) staff load carries `notifications: { unreadCount, recent }` too; `POST { action: "notification-mark-read", notificationId }` and `POST { action: "notification-mark-all-read" }`.

- [ ] **Step 1: Import the module**

In `app/api/system/route.ts`, add this import right after the existing `db/auth` import block (after line 29, `} from "../../../db/auth";`). Only what this task actually calls — `notifyRole`/`notifyRoleWithApproval`/`notifyUser`/`checkExpiringLeases` get added to this same import statement by Tasks 4, 7, and 8 as each one introduces its first real call site (an unused import is a lint failure, so don't import ahead of use):

```ts
import {
  getNotificationSummary,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications";
```

- [ ] **Step 2: Add the scoped module (poll endpoint)**

In the `SCOPED_MODULE_KEYS` array (line 790), add `"notifications"`:

```ts
const SCOPED_MODULE_KEYS = [
  "parking",
  "maintenance-tickets",
  "announcements",
  "users",
  "schools-courses",
  "attachments",
  "rooms",
  "tenants",
  "meter-history",
  "meter-readings",
  "notifications",
] as const;
```

Inside `loadScopedModules` (starts line 810), `currentUser` isn't currently a parameter — check its signature. If it only takes `(db, scopes)`, add a third parameter so this block can scope to "my own" notifications:

```ts
async function loadScopedModules(
  db: ReturnType<typeof getDb>,
  scopes: Set<ScopedModuleKey>,
  currentUserId: number,
) {
```

(Update its one call site — inside the main `GET` handler, near where `requestedModules` is checked, currently `await loadScopedModules(scopedDb!, scopes)` — to `await loadScopedModules(scopedDb!, scopes, currentUser.id)`.)

Then add a new block, alongside the existing `if (scopes.has("rooms")) { ... }` etc. blocks (any position among them is fine — order doesn't matter, they all push independent promises):

```ts
  if (scopes.has("notifications")) {
    tasks.push(
      (async () => {
        result.notifications = await getNotificationSummary(db, currentUserId);
      })(),
    );
  }
```

- [ ] **Step 3: Add the field to the full (unscoped) staff load**

In the big `Promise.all([...])` array (the one ending at `computeUnreadMeterRooms` — line 2774), add one more entry right after it:

```ts
      selectOpenTurnover(db),
      // computeUnreadMeterRooms needs upcomingMeterCutoff's resolved value
      // first, so this entry is an async IIFE — it starts running concurrently
      // with every other query above instead of waiting for the whole
      // Promise.all to settle first.
      (async () => computeUnreadMeterRooms(db, await upcomingMeterCutoff(db)))(),
      getNotificationSummary(db, currentUser.id),
    ]);
```

And add the matching destructured name at the end of the array's destructuring list (currently ending `overdueMeterRooms,` at line 2340):

```ts
      overdueMeterRooms,
      notificationSummary,
    ] = await Promise.all([
```

Then, in the `responseData` object literal (right before `currentUser,`, around line 2953), add:

```ts
      reminderTemplates: reminderRows,
      notifications: notificationSummary,
      currentUser,
```

- [ ] **Step 4: Exclude from the tenant-scoped response**

In the tenant-specific `Response.json({...})` override block (the one that sets `roles: [], users: [], rolePermissions: [], reminderTemplates: [], overdueMeterRooms: [],` around line 3063-3067), add:

```ts
        reminderTemplates: [],
        overdueMeterRooms: [],
        notifications: { unreadCount: 0, recent: [] },
      });
```

- [ ] **Step 5: Add the two mark-read actions**

In the big `if (action === "...") {} else if (action === "...") {}` chain, add these two branches anywhere in the chain (e.g. right after the existing `} else if (action === "user-set-password") {` block, before its closing brace joins the next `else if`):

```ts
    } else if (action === "notification-mark-read") {
      const notificationId = asNumber(body.notificationId);
      if (!notificationId) throw new Error("Notification is required");
      await markNotificationRead(db, currentUser.id, notificationId);
    } else if (action === "notification-mark-all-read") {
      await markAllNotificationsRead(db, currentUser.id);
```

- [ ] **Step 6: Verify with a live dev server**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task3.mjs << 'EOF'
import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [user] = await sql`
  SELECT u.id FROM app_users u JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key != 'tenant' AND u.status = 'active' ORDER BY u.id LIMIT 1
`;
await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${user.id}, ${expiresAt})`;

const [{ id: notifId }] = await sql`
  INSERT INTO notifications (recipient_user_id, type, title, link)
  VALUES (${user.id}, 'ZZTEST', 'Scratch verify', '/dashboard')
  RETURNING id
`;

const cookie = `hostel_session=${encodeURIComponent(token)}`;
const base = "http://localhost:3000";

const scoped = await fetch(`${base}/api/system?modules=notifications`, { headers: { cookie } }).then((r) => r.json());
console.log("scoped unreadCount:", scoped.notifications.unreadCount);
if (scoped.notifications.unreadCount < 1) throw new Error("expected at least 1 unread");
if (!scoped.notifications.recent.some((n) => n.id === notifId)) throw new Error("scratch notification missing from recent list");

const markRead = await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ action: "notification-mark-read", notificationId: notifId }),
}).then((r) => r.json());
console.log("mark-read ok:", markRead.ok);

const after = await fetch(`${base}/api/system?modules=notifications`, { headers: { cookie } }).then((r) => r.json());
const stillThere = after.notifications.recent.find((n) => n.id === notifId);
console.log("readAt after mark-read:", stillThere?.readAt);
if (!stillThere?.readAt) throw new Error("expected readAt to be set after notification-mark-read");

await sql`DELETE FROM notifications WHERE type = 'ZZTEST'`;
await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`;
console.log("cleaned up");
await sql.end();
EOF
```

This needs the dev server running first — start it (via the project's normal `npm run dev`, or however this session already has it running via the Browser tool's `preview_start`), then:

Run: `set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task3.mjs`
Expected: `scoped unreadCount: 1` (or more, if other real notifications already exist for this user — the `>= 1` check is what matters), no thrown error about the missing scratch row, `mark-read ok: true`, `readAt after mark-read:` prints a real ISO timestamp (not `undefined`), `cleaned up`.

- [ ] **Step 7: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint app/api/system/route.ts`
Expected: no output from either (any pre-existing warnings in this large file are unrelated — compare against a `git stash`/`git stash pop` baseline if unsure which warnings are new).

- [ ] **Step 8: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task3.mjs
git add app/api/system/route.ts
git commit -m "Wire notification read API: scoped poll, full-load summary, mark-read actions"
```

---

### Task 4: Finance trigger points

**Files:**
- Modify: `app/api/system/route.ts` — four handlers: `reservation-payment` (line 5151), `billing-item-adjust` (line 7026), `billing-cycle` (line 6874), `billing-payment` (line 6941).

**Interfaces:**
- Consumes: `notifyRole`, `notifyRoleWithApproval` from `./notifications` (add both to Task 3's import statement — this is their first real use in `route.ts`).

- [ ] **Step 0: Extend the `./notifications` import**

Task 3 imported only the read-side functions. Add the two this task uses:

```ts
import {
  getNotificationSummary,
  markAllNotificationsRead,
  markNotificationRead,
  notifyRole,
  notifyRoleWithApproval,
} from "./notifications";
```

- [ ] **Step 1: `reservation-payment` → notify Finance**

At the end of the `reservation-payment` handler (after the existing last line, `linkedPaymentId = (...)[0]?.id ?? undefined;`, and before the next `} else if (action === "reservation-finance-review") {`), add:

```ts
      const paidReservation = (
        await db
          .select({ studentName: reservations.studentName, referenceNo: reservations.referenceNo })
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      if (paidReservation)
        await notifyRole(db, "finance", {
          type: "payment-pending",
          title: `New reservation payment from ${paidReservation.studentName}`,
          body: `${paidReservation.referenceNo} — RM ${amount.toLocaleString()}`,
          link: "/finance?tab=deposits",
        });
```

- [ ] **Step 2: `billing-payment` → notify Finance**

At the end of the `billing-payment` handler (after `createdId = inserted[0]?.id;`, before `} else if (action === "billing-verify") {`), add:

```ts
      await notifyRole(db, "finance", {
        type: "payment-pending",
        title: `New payment on invoice ${target.invoice_no}`,
        body: `RM ${amount.toLocaleString()}`,
        link: `/finance?tab=invoices&invoice=${invoiceId}`,
      });
```

- [ ] **Step 3: `billing-item-adjust` → notify Finance approvers (electricity only)**

Inside the `if (item.itemType !== "electricity") { ... }` block's **else** — currently there's no else branch, only the `if`. Add one, right after that block closes (still inside the `billing-item-adjust` handler, before the next `} else if (action === "billing-adjust-approve") {`):

```ts
      if (item.itemType !== "electricity") {
        // A changed amount is no longer the one somebody confirmed, so the
        // invoice drops back to "not verified" until it is checked again.
        await db
          .update(billingItems)
          .set({
            amount: newAmount,
            rate: newAmount,
            verifiedAt: null,
            verifiedBy: "",
          })
          .where(eq(billingItems.id, itemId));
        await db.execute(
          sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${item.invoiceId}) WHERE id=${item.invoiceId}`,
        );
      } else {
        await notifyRoleWithApproval(db, "finance", "finance", {
          type: "adjustment-pending",
          title: `Electricity adjustment needs approval — ${item.description}`,
          body: `RM ${item.amount.toLocaleString()} → RM ${newAmount.toLocaleString()}`,
          link: "/finance?tab=adjustments",
        });
      }
```

(The comment above the `if` branch is the original code's own — keep it; only the `else` branch is new.)

(This replaces the existing `if (item.itemType !== "electricity") { ... }` block with an `if/else` — same body inside the `if`, new `else` added.)

- [ ] **Step 4: `billing-cycle` → notify Finance**

At the end of the `billing-cycle` handler (after `createdId = await generateBillingCycle(db, {...});`, before `} else if (action === "billing-cycle-review") {`), add:

```ts
      await notifyRole(db, "finance", {
        type: "billing-cycle-ready",
        title: `${asText(body.periodLabel)} billing is ready to review`,
        link: "/finance?tab=invoices",
      });
```

- [ ] **Step 5: Verify against the real dev database**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task4.mjs << 'EOF'
import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [user] = await sql`
  SELECT u.id FROM app_users u JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key != 'tenant' AND u.status = 'active' ORDER BY u.id LIMIT 1
`;
await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${user.id}, ${expiresAt})`;
const cookie = `hostel_session=${encodeURIComponent(token)}`;
const base = "http://localhost:3000";

const before = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'payment-pending'`;

// Build a minimal synthetic reservation + charge + payment, then record a
// payment against it through the real POST /api/system endpoint.
const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [res] = await sql`
  INSERT INTO reservations (reference_no, student_name, reservation_type, status, preferred_hostel_id, room_category, sales_person)
  VALUES ('ZZTEST-RSV', 'ZZTEST Student', 'individual', 'reserved', ${hostel.id}, 'any', 'ZZTEST Sales')
  RETURNING id
`;
const [charge] = await sql`
  INSERT INTO reservation_charges (reservation_id, charge_type, amount)
  VALUES (${res.id}, 'deposit', 100)
  RETURNING id
`;

const result = await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({
    action: "reservation-payment",
    reservationId: res.id,
    chargeIds: [charge.id],
    amount: 100,
    method: "cash",
  }),
}).then((r) => r.json());
console.log("save ok:", result.ok, result.error);

const after = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'payment-pending'`;
console.log("payment-pending notifications before/after:", before[0].c, after[0].c);
if (after[0].c <= before[0].c) throw new Error("expected a new payment-pending notification");

// Clean up — cascade order matters: payments before charges/reservation.
await sql`DELETE FROM notifications WHERE type = 'payment-pending' AND title LIKE '%ZZTEST%'`;
await sql`DELETE FROM reservation_payments WHERE reservation_id = ${res.id}`;
await sql`DELETE FROM reservation_charges WHERE reservation_id = ${res.id}`;
await sql`DELETE FROM reservations WHERE id = ${res.id}`;
await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`;
console.log("cleaned up");
await sql.end();
EOF
set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task4.mjs
```

Expected: `save ok: true undefined`, then `payment-pending notifications before/after: N N+1`, `cleaned up`. If the dev server isn't already running, start it first (this session's `preview_start` / `npm run dev`).

- [ ] **Step 6: Type-check**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task4.mjs
git add app/api/system/route.ts
git commit -m "Notify Finance on new payments, electricity adjustments, and cycle generation"
```

---

### Task 5: Sales trigger points

**Files:**
- Modify: `app/api/system/route.ts` — three handlers: `reservation-cancel` (line 5388), `reservation-confirm-unit` (line 5437), `reservation-room-change` (line 5464).

**Interfaces:**
- Consumes: `notifyRole` — already imported by Task 4, no import change needed here.

- [ ] **Step 1: `reservation-cancel` → notify Sales**

This handler currently doesn't fetch the reservation row (it goes straight to raw-SQL updates). Add a fetch right after the existing guard, and the notify call at the end:

```ts
    } else if (action === "reservation-cancel") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      const cancelledReservation = (
        await db
          .select({ referenceNo: reservations.referenceNo, studentName: reservations.studentName })
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      // Cancelling a booking that had already converted has to give the room
```

(everything from `// Cancelling a booking...` through the end of the existing `await db.transaction(async (tx) => { ... });` block stays exactly as-is), then immediately after that transaction block closes, before `} else if (action === "reservation-confirm-unit") {`:

```ts
      });
      if (cancelledReservation)
        await notifyRole(db, "sales", {
          type: "reservation-changed",
          title: `Reservation ${cancelledReservation.referenceNo} was cancelled`,
          body: cancelledReservation.studentName,
          link: "/hostels?tab=reservations",
        });
```

- [ ] **Step 2: `reservation-confirm-unit` → notify Sales**

This handler already fetches the full `reservation` row. At the end (after the existing `.where(eq(reservations.id, reservationId));` that closes this handler, before `} else if (action === "reservation-room-change") {`), add:

```ts
      await notifyRole(db, "sales", {
        type: "reservation-changed",
        title: `Reservation ${reservation.referenceNo} — room confirmed`,
        body: reservation.studentName,
        link: "/hostels?tab=reservations",
      });
```

- [ ] **Step 3: `reservation-room-change` → notify Sales**

This handler also already fetches `reservation`. At the very end of the handler (after `await syncMoveInInvoice(db, reservationId, currentUser.displayName);`, before `} else if (action === "student-update") {`), add:

```ts
      await notifyRole(db, "sales", {
        type: "reservation-changed",
        title: `Reservation ${reservation.referenceNo} — room changed`,
        body: reservation.studentName,
        link: "/hostels?tab=reservations",
      });
```

- [ ] **Step 4: Verify against the real dev database**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task5.mjs << 'EOF'
import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [user] = await sql`
  SELECT u.id FROM app_users u JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key != 'tenant' AND u.status = 'active' ORDER BY u.id LIMIT 1
`;
await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${user.id}, ${expiresAt})`;
const cookie = `hostel_session=${encodeURIComponent(token)}`;
const base = "http://localhost:3000";

const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [res] = await sql`
  INSERT INTO reservations (reference_no, student_name, reservation_type, status, preferred_hostel_id, room_category, sales_person)
  VALUES ('ZZTEST-RSV2', 'ZZTEST Student 2', 'individual', 'reserved', ${hostel.id}, 'any', 'ZZTEST Sales')
  RETURNING id
`;

const before = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'reservation-changed'`;
const result = await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ action: "reservation-cancel", reservationId: res.id }),
}).then((r) => r.json());
console.log("cancel save ok:", result.ok, result.error);
const after = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'reservation-changed'`;
console.log("reservation-changed before/after:", before[0].c, after[0].c);
if (after[0].c <= before[0].c) throw new Error("expected a new reservation-changed notification");

await sql`DELETE FROM notifications WHERE type = 'reservation-changed' AND title LIKE '%ZZTEST%'`;
await sql`DELETE FROM reservations WHERE id = ${res.id}`;
await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`;
console.log("cleaned up");
await sql.end();
EOF
set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task5.mjs
```

Expected: `cancel save ok: true undefined`, `reservation-changed before/after: N N+1`, `cleaned up`.

- [ ] **Step 5: Type-check**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task5.mjs
git add app/api/system/route.ts
git commit -m "Notify Sales when a reservation is cancelled, confirmed, or room-changed"
```

---

### Task 6: Maintenance trigger points (new ticket, tenant message, turnover)

**Files:**
- Modify: `app/api/system/route.ts` — `ticket-create` (line 6294), `ticket-message` (line 6417), `turnover-schedule` (line 6274).

**Interfaces:**
- Consumes: `notifyRole` — already imported by Task 4, no import change needed here.

- [ ] **Step 1: `ticket-create` → notify Maintenance**

The insert currently does `priority: asText(body.priority, "average"),` inline. Capture it to a variable first so the notify call can reuse it. Change:

```ts
      const inserted = await db
        .insert(maintenanceTickets)
        .values({
          ticketNo: `MT-${Date.now().toString().slice(-8)}`,
          studentId:
            currentUser.roleKey === "tenant"
              ? currentUser.studentId
              : asNullableNumber(body.studentId),
          hostelId: asNumber(body.hostelId),
          unitId: asNumber(body.unitId),
          roomId: asNullableNumber(body.roomId),
          category: asText(body.category),
          subcategory: asText(body.subcategory),
          subject: asText(body.subcategory),
          description: asText(body.description),
          priority: asText(body.priority, "average"),
```

to:

```ts
      const ticketPriority = asText(body.priority, "average");
      const inserted = await db
        .insert(maintenanceTickets)
        .values({
          ticketNo: `MT-${Date.now().toString().slice(-8)}`,
          studentId:
            currentUser.roleKey === "tenant"
              ? currentUser.studentId
              : asNullableNumber(body.studentId),
          hostelId: asNumber(body.hostelId),
          unitId: asNumber(body.unitId),
          roomId: asNullableNumber(body.roomId),
          category: asText(body.category),
          subcategory: asText(body.subcategory),
          subject: asText(body.subcategory),
          description: asText(body.description),
          priority: ticketPriority,
```

Then, at the end of the handler (after the existing `await db.insert(ticketMessages).values({...});` that follows the ticket insert, before `} else if (action === "ticket-clean-create") {`), add:

```ts
      await notifyRole(db, "maintenance", {
        type: "ticket-created",
        title: `New ${ticketPriority === "high" ? "URGENT " : ""}ticket — ${asText(body.category)}`,
        body: asText(body.subcategory),
        link: `/maintenance?ticket=${createdId}`,
      });
```

- [ ] **Step 2: `ticket-message` → notify Maintenance on a tenant message**

`authorRole` written for a tenant is `"student"`, not `"tenant"` — the gate is `currentUser.roleKey === "tenant"`. At the end of the `ticket-message` handler (after `.where(eq(maintenanceTickets.id, ticketId));`, before `} else if (action === "ticket-delete") {`), add:

```ts
      if (currentUser.roleKey === "tenant") {
        const messagedTicket = (
          await db
            .select({ ticketNo: maintenanceTickets.ticketNo })
            .from(maintenanceTickets)
            .where(eq(maintenanceTickets.id, ticketId))
        )[0];
        if (messagedTicket)
          await notifyRole(db, "maintenance", {
            type: "ticket-message",
            title: `New message on ${messagedTicket.ticketNo}`,
            body: message,
            link: `/maintenance?ticket=${ticketId}`,
          });
      }
```

(`message` here is the same local variable the handler already built a few lines earlier: `const message = asText(body.message) || (status ? ... : "Ticket details updated");` — reused, not recomputed.)

- [ ] **Step 3: `turnover-schedule` → notify Maintenance**

The handler currently does `const [bed] = await db.execute<{ status: string }>(sql\`SELECT status FROM bed_spaces WHERE id = ${bedSpaceId}\`);`. Extend the select to also carry the room code, and add the notify call after `raiseTurnoverTickets` runs:

```ts
      const [bed] = await db.execute<{ status: string; legacy_code: string }>(
        sql`SELECT status, legacy_code FROM bed_spaces WHERE id = ${bedSpaceId}`,
      );
      if (!bed) throw new Error("Room not found");
      if (bed.status !== "vacant")
        throw new Error(
          "This room is not empty — turnover is for a room a student has left.",
        );
      const raised = await raiseTurnoverTickets(db, bedSpaceId, {});
      if (raised.length)
        await notifyRole(db, "maintenance", {
          type: "turnover-scheduled",
          title: `Turnover scheduled — room ${bed.legacy_code}`,
          link: "/maintenance?tab=turnover",
        });
      noticeForClient = raised.length
```

(Only the `const [bed] = ...` line's type/select and the two new lines before `noticeForClient = ...` are new; the rest of the existing handler body is unchanged.)

- [ ] **Step 4: Verify against the real dev database**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task6.mjs << 'EOF'
import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [user] = await sql`
  SELECT u.id FROM app_users u JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key != 'tenant' AND u.status = 'active' ORDER BY u.id LIMIT 1
`;
await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${user.id}, ${expiresAt})`;
const cookie = `hostel_session=${encodeURIComponent(token)}`;
const base = "http://localhost:3000";

const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [unit] = await sql`SELECT id FROM hostel_units WHERE hostel_id = ${hostel.id} LIMIT 1`;

const before = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'ticket-created'`;
const result = await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({
    action: "ticket-create",
    hostelId: hostel.id,
    unitId: unit.id,
    category: "ZZTEST",
    subcategory: "Scratch check",
    description: "Verification only",
    priority: "high",
  }),
}).then((r) => r.json());
console.log("ticket-create ok:", result.ok, result.error, "id:", result.id);
const after = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'ticket-created'`;
console.log("ticket-created before/after:", before[0].c, after[0].c);
if (after[0].c <= before[0].c) throw new Error("expected a new ticket-created notification");
const [notif] = await sql`SELECT title FROM notifications WHERE type = 'ticket-created' ORDER BY id DESC LIMIT 1`;
console.log("title:", notif.title);
if (!notif.title.startsWith("New URGENT ticket")) throw new Error("expected URGENT prefix for priority=high");

await sql`DELETE FROM notifications WHERE type = 'ticket-created' AND title LIKE '%ZZTEST%'`;
await sql`DELETE FROM ticket_messages WHERE ticket_id = ${result.id}`;
await sql`DELETE FROM maintenance_tickets WHERE id = ${result.id}`;
await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`;
console.log("cleaned up");
await sql.end();
EOF
set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task6.mjs
```

Expected: `ticket-create ok: true undefined id: <number>`, `ticket-created before/after: N N+1`, `title: New URGENT ticket — ZZTEST`, `cleaned up`.

- [ ] **Step 5: Type-check**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task6.mjs
git add app/api/system/route.ts
git commit -m "Notify Maintenance on new tickets, tenant messages, and turnover scheduling"
```

---

### Task 7: Ticket assignment — real user picker + notify

**Files:**
- Modify: `app/modules/Maintenance.tsx` (three `<input name="assignedTo">` locations: ~2366, ~3365, ~3409; plus the three places `ticket.assignedTo` is printed as raw text: ~1677, ~1711, ~1866, ~2180)
- Modify: `app/api/system/route.ts` — `ticket-message` (line 6417) and `ticket-clean-create` (line 6359).

**Interfaces:**
- Consumes: `notifyUser` from `./notifications` (add to `route.ts`'s import statement — first use); `data.users` (already present in every module's `Data` payload — `{id, displayName, roleKey, status}[]`, confirmed in the full-load response at the `users: userRows` field).

- [ ] **Step 0: Extend the `./notifications` import in `route.ts`**

```ts
import {
  getNotificationSummary,
  markAllNotificationsRead,
  markNotificationRead,
  notifyRole,
  notifyRoleWithApproval,
  notifyUser,
} from "./notifications";
```

- [ ] **Step 1: Replace the three free-text inputs with a picker**

At line ~2366 (the main ticket reply/update form):

```tsx
              <label>
                Assigned to
                <select name="assignedTo" defaultValue={ticket.assignedTo}>
                  <option value="">Unassigned</option>
                  {data.users
                    .filter(
                      (user: Row) =>
                        ["maintenance", "technician"].includes(user.roleKey) &&
                        user.status === "active",
                    )
                    .map((user: Row) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                </select>
              </label>
```

(Replaces the existing `<label>Assigned to<input name="assignedTo" defaultValue={ticket.assignedTo} /></label>`.)

At line ~3365 (the cleaning-assign modal, `ticket-clean-create`):

```tsx
            <label className="wide">
              Assign to
              <select name="assignedTo" required defaultValue="">
                <option value="" disabled>
                  Select who&rsquo;s doing this
                </option>
                {data.users
                  .filter(
                    (user: Row) =>
                      ["maintenance", "technician"].includes(user.roleKey) &&
                      user.status === "active",
                  )
                  .map((user: Row) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
              </select>
            </label>
```

At line ~3409 (the turnover-cleaning-assign modal, `ticket-message`) — same replacement as the 3365 block above, but `defaultValue` should read from the ticket if one is already partially assigned: `defaultValue={assigningTurnoverTicket.assignedTo || ""}`.

- [ ] **Step 2: Print the assignee's real name, not the raw stored value**

Add a lookup helper near the top of the component (wherever other small derived lookups already live, e.g. near `loginFor`-style helpers if this file has one, otherwise just before the JSX return):

```tsx
  const assigneeNameFor = (assignedTo: string) => {
    if (!assignedTo) return "";
    const match = data.users.find((user: Row) => String(user.id) === assignedTo);
    return match?.displayName || assignedTo;
  };
```

Then at each of the four raw-print locations, wrap the value:
- Line ~1677: `<strong>{ticket.assignedTo}</strong>` → `<strong>{assigneeNameFor(ticket.assignedTo)}</strong>`
- Line ~1711: `{ticket.assignedTo || (...)}` → `{assigneeNameFor(ticket.assignedTo) || (...)}`
- Line ~1866: `<strong>{pending.assignedTo || "Not named"}</strong>` → `<strong>{assigneeNameFor(pending.assignedTo) || "Not named"}</strong>`
- Line ~2180: `<b>{ticket.assignedTo || "Not assigned"}</b>` → `<b>{assigneeNameFor(ticket.assignedTo) || "Not assigned"}</b>`

(`assigneeNameFor` falls back to the raw stored string for any pre-existing ticket whose `assignedTo` still holds old free-text staff names from before this change — those just keep displaying as-is, matching the spec's "existing rows are just left as free text that no longer matches anyone" decision.)

- [ ] **Step 3: `ticket-message` → notify the technician on a real assignment change**

The handler currently does `if (currentUser.roleKey !== "tenant") { changes.assignedTo = asText(body.assignedTo); ... }` without reading the ticket's prior value first. Add a fetch right at the top of the handler (after the existing `if (!ticketId) throw new Error(...)`, before the tenant-ownership check):

```ts
      const priorTicket = (
        await db
          .select({ assignedTo: maintenanceTickets.assignedTo, ticketNo: maintenanceTickets.ticketNo })
          .from(maintenanceTickets)
          .where(eq(maintenanceTickets.id, ticketId))
      )[0];
```

Then, after the existing `await db.update(maintenanceTickets).set(changes).where(eq(maintenanceTickets.id, ticketId));` at the very end of the handler (before `} else if (action === "ticket-delete") {`), add:

```ts
      const newAssignedTo = changes.assignedTo as string | undefined;
      if (
        newAssignedTo &&
        newAssignedTo !== priorTicket?.assignedTo &&
        priorTicket
      ) {
        const assignedUserId = Number(newAssignedTo);
        if (Number.isFinite(assignedUserId) && assignedUserId > 0)
          await notifyUser(db, assignedUserId, {
            type: "ticket-assigned",
            title: `You were assigned ${priorTicket.ticketNo}`,
            link: `/maintenance?ticket=${ticketId}`,
          });
      }
```

(This sits alongside the "new tenant message" notify block added in Task 6, Step 2 — both are separate `if` blocks inside the same handler, not nested in each other, since one fires for tenant callers and this one fires for staff callers changing `assignedTo`.)

- [ ] **Step 4: `ticket-clean-create` → notify on immediate assignment**

At the end of the `ticket-clean-create` handler (after the existing `await db.insert(ticketMessages).values({...});`, before `} else if (action === "ticket-message") {`), add:

```ts
      if (assign) {
        const assignedUserId = Number(asText(body.assignedTo));
        if (Number.isFinite(assignedUserId) && assignedUserId > 0)
          await notifyUser(db, assignedUserId, {
            type: "ticket-assigned",
            title: "You were assigned a cleaning ticket",
            link: `/maintenance?ticket=${createdId}`,
          });
      }
```

- [ ] **Step 5: Verify against the real dev database**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task7.mjs << 'EOF'
import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const token = crypto.randomBytes(32).toString("base64");
const tokenHash = crypto.createHash("sha256").update(token).digest("base64");
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const [staff] = await sql`
  SELECT u.id FROM app_users u JOIN app_roles r ON r.id = u.role_id
  WHERE r.role_key != 'tenant' AND u.status = 'active' ORDER BY u.id LIMIT 1
`;
await sql`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${staff.id}, ${expiresAt})`;
const cookie = `hostel_session=${encodeURIComponent(token)}`;
const base = "http://localhost:3000";

const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [unit] = await sql`SELECT id FROM hostel_units WHERE hostel_id = ${hostel.id} LIMIT 1`;
const [ticket] = await sql`
  INSERT INTO maintenance_tickets (ticket_no, hostel_id, unit_id, category, subcategory, subject, priority, status, submitted_by_type, assigned_to)
  VALUES ('MT-ZZTEST01', ${hostel.id}, ${unit.id}, 'ZZTEST', 'Scratch', 'Scratch check', 'average', 'submitted', 'staff', '')
  RETURNING id
`;

const before = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'ticket-assigned'`;
const result = await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({
    action: "ticket-message",
    ticketId: ticket.id,
    assignedTo: String(staff.id),
    costResponsibility: "management",
  }),
}).then((r) => r.json());
console.log("assign save ok:", result.ok, result.error);
const after = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'ticket-assigned'`;
console.log("ticket-assigned before/after:", before[0].c, after[0].c);
if (after[0].c <= before[0].c) throw new Error("expected a new ticket-assigned notification");

// Re-saving the SAME assignedTo must not notify again.
const before2 = after[0].c;
await fetch(`${base}/api/system`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({
    action: "ticket-message",
    ticketId: ticket.id,
    assignedTo: String(staff.id),
    costResponsibility: "management",
  }),
});
const after2 = await sql`SELECT COUNT(*)::int c FROM notifications WHERE type = 'ticket-assigned'`;
console.log("unchanged re-save before/after:", before2, after2[0].c);
if (after2[0].c !== before2) throw new Error("re-saving the same assignedTo should not re-notify");

await sql`DELETE FROM notifications WHERE type = 'ticket-assigned' AND link = ${`/maintenance?ticket=${ticket.id}`}`;
await sql`DELETE FROM ticket_messages WHERE ticket_id = ${ticket.id}`;
await sql`DELETE FROM maintenance_tickets WHERE id = ${ticket.id}`;
await sql`DELETE FROM user_sessions WHERE token_hash = ${tokenHash}`;
console.log("cleaned up");
await sql.end();
EOF
set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task7.mjs
```

Expected: `assign save ok: true undefined`, `ticket-assigned before/after: N N+1`, `unchanged re-save before/after: <same number twice>`, `cleaned up`.

- [ ] **Step 6: Manual browser check of the picker**

Using this session's established synthetic-session technique (create a scratch session cookie, `mcp__Claude_Browser__navigate` to `/maintenance`, open a ticket, confirm the "Assigned to" field now renders as a `<select>` populated with active Maintenance/Technician staff names, not a text box). Clean up the scratch session afterward.

- [ ] **Step 7: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint app/modules/Maintenance.tsx app/api/system/route.ts`
Expected: no output from either.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task7.mjs
git add app/modules/Maintenance.tsx app/api/system/route.ts
git commit -m "Turn ticket assignment into a real user picker and notify the assignee"
```

---

### Task 8: Scheduled check — lease ending within 2 months

**Files:**
- Modify: `app/api/system/notifications.ts` (add `checkExpiringLeases`)
- Modify: `app/api/system/route.ts` (wire the once-per-day guard, mirroring `applyLatePaymentCharges`)

**Interfaces:**
- Consumes: `notifyRole` (already in `notifications.ts` from Task 2); `accommodationAssignments`, `studentProfiles`, `notifications` from `../../../db/schema`.
- Produces: `checkExpiringLeases(db): Promise<void>` — called once per KL calendar day from `route.ts`, same pattern as `applyLatePaymentCharges`.

- [ ] **Step 1: Add `checkExpiringLeases` to `app/api/system/notifications.ts`**

Add these imports to the top of the file (alongside the existing ones):

```ts
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { accommodationAssignments, appRoles, appUsers, notifications, rolePermissions, studentProfiles } from "../../../db/schema";
```

(Replaces the existing `import { and, desc, eq, isNull } from "drizzle-orm";` and `import { appRoles, appUsers, notifications, rolePermissions } from "../../../db/schema";` lines with these two, which add `gte`/`lte` and the two new table imports.)

Then append this function at the end of the file:

```ts
function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function checkExpiringLeases(db: Db, today: string) {
  const in60Days = addDays(today, 60);
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
    // the raw ISO date rather than reaching across that boundary.
    await notifyRole(db, "sales", {
      type: "lease-expiring",
      title: `${row.studentName}'s lease ends ${row.leaseEndDate}`,
      link,
    });
  }
}
```

- [ ] **Step 2: Wire the once-per-day guard in `route.ts`**

Add the module-level cache variable next to the existing `lateChargesAppliedOn` (line 251):

```ts
let lateChargesAppliedOn: string | null = null;
let leaseExpiryCheckedOn: string | null = null;
```

Add `checkExpiringLeases` to the `./notifications` import statement (built up across Tasks 3, 4, and 7 — this is its final form):

```ts
import {
  checkExpiringLeases,
  getNotificationSummary,
  markAllNotificationsRead,
  markNotificationRead,
  notifyRole,
  notifyRoleWithApproval,
  notifyUser,
} from "./notifications";
```

Right after the existing late-charges guard block (the one at line ~2265, ending `console.error("Late payment charges failed", failure); });`), add:

```ts
    const leaseCheckDate = todayInKL();
    if (leaseExpiryCheckedOn !== leaseCheckDate) {
      leaseExpiryCheckedOn = leaseCheckDate;
      void checkExpiringLeases(seedDb, leaseCheckDate).catch((failure) => {
        leaseExpiryCheckedOn = "";
        console.error("Lease expiry check failed", failure);
      });
    }
```

(`seedDb` is the same database handle the late-charges block already uses — matching it exactly, not introducing a second connection.)

- [ ] **Step 3: Verify against the real dev database**

```bash
cd /Users/yapfongkiat/create-a-system-database-for-my && cat > .claude-scratch/verify_task8.mjs << 'EOF'
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [unit] = await sql`SELECT id FROM hostel_units WHERE hostel_id = ${hostel.id} LIMIT 1`;
const [room] = await sql`SELECT id FROM hostel_rooms WHERE unit_id = ${unit.id} LIMIT 1`;
const [student] = await sql`
  INSERT INTO student_profiles (student_code, full_name, identity_no, contact_number, gender, nationality, status, source_key)
  VALUES ('ZZTEST-SC', 'ZZTEST Lease Student', 'ZZTEST-IC', '0000000000', 'male', 'Malaysian', 'active', 'zztest:lease')
  RETURNING id
`;
const today = new Date().toISOString().slice(0, 10);
const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const [assignment] = await sql`
  INSERT INTO accommodation_assignments (assignment_key, student_id, room_id, status, agreement_end_date)
  VALUES (${`zztest:${student.id}:${Date.now()}`}, ${student.id}, ${room.id}, 'active', ${in30Days})
  RETURNING id
`;

// Hit the real running dev server's request path so the once-per-day guard
// runs for real (this only fires the check the FIRST request of the KL
// calendar day — if the dev server already served a request today, force it
// by directly importing and calling the function instead).
console.log("Calling checkExpiringLeases directly (bypassing the once-per-day cache, since the dev server may already have run it today)");
const { checkExpiringLeases } = await import("../app/api/system/notifications.ts");
EOF
echo "NOTE: TypeScript can't be imported directly by plain node — see Step 3b below instead."
```

Since `notifications.ts` is TypeScript, this scratch script can't `import` it directly with plain `node`. Verify via the real HTTP path instead — hit the dev server once (which runs the guarded check as a side effect of any request), then check the database directly:

```bash
cat > .claude-scratch/verify_task8.mjs << 'EOF'
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const [hostel] = await sql`SELECT id FROM hostel_properties LIMIT 1`;
const [unit] = await sql`SELECT id FROM hostel_units WHERE hostel_id = ${hostel.id} LIMIT 1`;
const [room] = await sql`SELECT id FROM hostel_rooms WHERE unit_id = ${unit.id} LIMIT 1`;
const [student] = await sql`
  INSERT INTO student_profiles (student_code, full_name, identity_no, contact_number, gender, nationality, status, source_key)
  VALUES ('ZZTEST-SC', 'ZZTEST Lease Student', 'ZZTEST-IC', '0000000000', 'male', 'Malaysian', 'active', 'zztest:lease')
  RETURNING id
`;
const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const [assignment] = await sql`
  INSERT INTO accommodation_assignments (assignment_key, student_id, room_id, status, agreement_end_date)
  VALUES (${`zztest:${student.id}:${Date.now()}`}, ${student.id}, ${room.id}, 'active', ${in30Days})
  RETURNING id
`;
console.log("fixture assignment id:", assignment.id, "leaseEndDate:", in30Days);

// A fresh request to the dev server runs the once-per-day guard block. If
// the server process was already hit today, restart it first (this resets
// leaseExpiryCheckedOn to null) — note this in the plan's step text.
await fetch("http://localhost:3000/api/system").catch(() => {});
await new Promise((r) => setTimeout(r, 1500)); // the check runs fire-and-forget, give it a beat

const found = await sql`
  SELECT id, title FROM notifications
  WHERE type = 'lease-expiring' AND link = ${`/students?tenancy=${assignment.id}`}
`;
console.log("notification created:", found.length > 0, found[0]?.title);
if (!found.length) throw new Error("expected a lease-expiring notification for the fixture assignment");

// Re-run the check (hit the server again) and confirm no duplicate.
await fetch("http://localhost:3000/api/system").catch(() => {});
await new Promise((r) => setTimeout(r, 500));
const foundAgain = await sql`
  SELECT COUNT(*)::int c FROM notifications
  WHERE type = 'lease-expiring' AND link = ${`/students?tenancy=${assignment.id}`}
`;
console.log("still exactly one:", foundAgain[0].c === 1);
if (foundAgain[0].c !== 1) throw new Error("expected exactly one notification, not a duplicate");

await sql`DELETE FROM notifications WHERE type = 'lease-expiring' AND link = ${`/students?tenancy=${assignment.id}`}`;
await sql`DELETE FROM accommodation_assignments WHERE id = ${assignment.id}`;
await sql`DELETE FROM student_profiles WHERE id = ${student.id}`;
console.log("cleaned up");
await sql.end();
EOF
```

Run (**restart the dev server first**, so `leaseExpiryCheckedOn` starts `null` for this test run): `set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a && node .claude-scratch/verify_task8.mjs`
Expected: `fixture assignment id: ... leaseEndDate: ...`, `notification created: true <student name>'s lease ends ...`, `still exactly one: true`, `cleaned up`.

- [ ] **Step 4: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint app/api/system/notifications.ts app/api/system/route.ts`
Expected: no output from either.

- [ ] **Step 5: Clean up and commit**

```bash
rm -f .claude-scratch/verify_task8.mjs
git add app/api/system/notifications.ts app/api/system/route.ts
git commit -m "Add scheduled check: notify Sales when a lease ends within 2 months"
```

---

### Task 9: Bell + dropdown UI

**Files:**
- Modify: `app/(system)/layout.tsx` (poll hook, bell button, dropdown)
- Modify: `app/(system)/NavIcons.tsx` (add `BellIcon`)
- Modify: `app/globals.css` (bell/dropdown styling)

**Interfaces:**
- Consumes: `GET /api/system?modules=notifications` (Task 3); `POST { action: "notification-mark-read" | "notification-mark-all-read" }` (Task 3).

- [ ] **Step 1: Add `BellIcon` to `NavIcons.tsx`**

Add after the existing `SignOutIcon` (before the `CollapseIcon` at the end of the file):

```tsx
export function BellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}
```

- [ ] **Step 2: Add the poll hook and bell UI to `layout.tsx`**

Add this import alongside the existing `CollapseIcon` import (line 24):

```tsx
import {
  DashboardIcon,
  RoomsIcon,
  TenantsIcon,
  BillingIcon,
  MaintenanceIcon,
  ParkingIcon,
  PropertiesIcon,
  ReportsIcon,
  AnnouncementsIcon,
  AccessIcon,
  BrandIcon,
  SignOutIcon,
  CollapseIcon,
  BellIcon,
} from "./NavIcons";
```

Inside the `Chrome` component, add this state and effect right after the existing `drawerSectionsOpenByDefault`-style hooks (near the other `useState`/`useEffect` calls, e.g. right after the `menuOpen`/`collapsed` state block):

```tsx
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
  const [notifOpen, setNotifOpen] = useState(false);

  const loadNotifications = async () => {
    try {
      const response = await fetch(
        `${BASE_PATH}/api/system?modules=notifications`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        notifications?: typeof notifState;
      };
      if (result.notifications) setNotifState(result.notifications);
    } catch {
      // A missed poll just means a stale badge for 60s — not worth surfacing
      // as an error banner.
    }
  };

  useEffect(() => {
    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markNotificationRead = async (notificationId: number) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "notification-mark-read",
        notificationId,
      }),
    });
    loadNotifications();
  };

  const markAllNotificationsRead = async () => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notification-mark-all-read" }),
    });
    loadNotifications();
  };
```

Then, inside the `.topbar` `<header>` (currently just `<div><h1>{current?.label}</h1><p className="topbar-note">{current?.note}</p></div>`), add the bell as a sibling:

```tsx
        <header className="topbar">
          <div>
            <h1>{current?.label}</h1>
            <p className="topbar-note">{current?.note}</p>
          </div>
          <div className="notif-bell-wrap">
            <button
              type="button"
              className="notif-bell"
              aria-label="Notifications"
              onClick={() => setNotifOpen((open) => !open)}
            >
              <BellIcon />
              {notifState.unreadCount > 0 && (
                <span className="notif-badge">
                  {notifState.unreadCount > 9 ? "9+" : notifState.unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                className="notif-dropdown-backdrop"
                onMouseDown={(e) =>
                  e.target === e.currentTarget && setNotifOpen(false)
                }
              >
                <div className="notif-dropdown">
                  <div className="notif-dropdown-head">
                    <strong>Notifications</strong>
                    {notifState.unreadCount > 0 && (
                      <button type="button" onClick={markAllNotificationsRead}>
                        Mark all as read
                      </button>
                    )}
                  </div>
                  {notifState.recent.length === 0 && (
                    <p className="notif-empty">Nothing yet.</p>
                  )}
                  {notifState.recent.map((item) => (
                    <Link
                      key={item.id}
                      href={item.link || "#"}
                      className={`notif-item${item.readAt ? "" : " is-unread"}`}
                      onClick={() => {
                        setNotifOpen(false);
                        if (!item.readAt) markNotificationRead(item.id);
                      }}
                    >
                      <strong>{item.title}</strong>
                      {item.body && <small>{item.body}</small>}
                    </Link>
                  ))}
                  <Link
                    href={`${BASE_PATH}/notifications`}
                    className="notif-view-all"
                    onClick={() => setNotifOpen(false)}
                  >
                    View all →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </header>
```

- [ ] **Step 3: Add CSS**

Add to `app/globals.css`, near the other `.topbar` rules:

```css
.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
}

.notif-bell-wrap {
  position: relative;
  flex: none;
}

.notif-bell {
  position: relative;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--subtle);
  color: var(--muted);
  cursor: pointer;
}

.notif-bell:hover {
  color: var(--brand);
  border-color: var(--brand-light);
  background: var(--brand-soft);
}

.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--coral);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
}

.notif-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.notif-dropdown {
  position: absolute;
  top: 46px;
  right: 0;
  width: min(360px, 90vw);
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  z-index: 91;
}

.notif-dropdown-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--line);
}

.notif-dropdown-head button {
  color: var(--brand);
  font-size: var(--text-xs);
  font-weight: 700;
  background: none;
  border: none;
  cursor: pointer;
}

.notif-empty {
  padding: var(--sp-5) var(--sp-4);
  color: var(--muted);
  font-size: var(--text-sm);
  text-align: center;
}

.notif-item {
  display: block;
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--line);
  text-decoration: none;
}

.notif-item:hover {
  background: var(--tint);
}

.notif-item strong {
  display: block;
  color: var(--ink);
  font-size: var(--text-sm);
}

.notif-item.is-unread strong {
  font-weight: 800;
}

.notif-item.is-unread strong::before {
  content: "";
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--brand);
}

.notif-item small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--text-xs);
}

.notif-view-all {
  display: block;
  padding: var(--sp-3) var(--sp-4);
  color: var(--brand);
  font-size: var(--text-sm);
  font-weight: 700;
  text-align: center;
  text-decoration: none;
}

.notif-view-all:hover {
  background: var(--tint);
}
```

- [ ] **Step 4: Verify in the browser**

Using this session's established technique: start the dev server, create a scratch session, insert a synthetic notification row directly via SQL, navigate to any staff page, confirm the bell shows a badge, click it, confirm the dropdown lists the synthetic notification, click it, confirm it navigates and the badge count drops. Clean up the synthetic row and session afterward.

- [ ] **Step 5: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint "app/(system)/layout.tsx" "app/(system)/NavIcons.tsx"`
Expected: no output from either.

- [ ] **Step 6: Clean up and commit**

```bash
git add "app/(system)/layout.tsx" "app/(system)/NavIcons.tsx" app/globals.css
git commit -m "Add notification bell and dropdown to the top bar"
```

---

### Task 10: Dedicated Notifications page + nav entry

**Files:**
- Create: `app/modules/Notifications.tsx`
- Create: `app/(system)/notifications/page.tsx`
- Modify: `app/(system)/layout.tsx` (`navGroups`)
- Modify: `app/globals.css` (page-level list styling, reusing `.table-v2` where possible)

**Interfaces:**
- Consumes: same `GET /api/system?modules=notifications` (Task 3) pattern, but this page fetches its own paginated view directly rather than sharing `layout.tsx`'s 60s-polled state.
- Produces: a route at `/notifications`, reachable from the sidebar (not just the bell).

- [ ] **Step 1: Add the module component**

```tsx
// app/modules/Notifications.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "../basePath";

type NotificationRow = {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationsModule() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const response = await fetch(
      `${BASE_PATH}/api/system?modules=notifications`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as {
      notifications?: { recent: NotificationRow[] };
    };
    setRows(result.notifications?.recent || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = async (id: number) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notification-mark-read", notificationId: id }),
    });
    load();
  };

  const visible = rows.filter((row) => filter === "all" || !row.readAt);

  return (
    <div className="table-v2">
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">STAFF NOTIFICATIONS</span>
          <h2>Everything the system has flagged for you.</h2>
        </div>
      </section>
      <div className="v2-toolbar">
        <select
          className="v2-pill-select"
          value={filter}
          onChange={(event) => setFilter(event.target.value as "all" | "unread")}
        >
          <option value="all">All</option>
          <option value="unread">Unread only</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Notification</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className={row.readAt ? "" : "notif-row-unread"}>
                <td>
                  <strong>{row.title}</strong>
                  {row.body && <small>{row.body}</small>}
                </td>
                <td>{row.createdAt.slice(0, 10)}</td>
                <td>
                  <Link
                    href={row.link || "#"}
                    className="secondary compact"
                    onClick={() => {
                      if (!row.readAt) markRead(row.id);
                    }}
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {!loading && !visible.length && (
              <tr>
                <td colSpan={3}>
                  <em>Nothing here.</em>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

(This page fetches only the 15 most recent per `getNotificationSummary`'s current `limit(15)` — matching the spec's "recent" scope. A true full-history paginated list would need `getNotificationSummary` extended with an offset/limit param; out of scope for v1 per the spec's Notifications page being described as "not needing search for v1" — this simpler version is the correct size for what was approved. Flag to the user if they want deeper history later.)

- [ ] **Step 2: Add the route**

Every existing route file (e.g. `app/(system)/finance/page.tsx`) follows this exact shape — `"use client"`, pull `data`/`save`/`busy`/etc. from `useSystem()`, bail to `null` until `data` loads, pass them down as props:

```tsx
"use client";

import { useSystem } from "../../SystemContext";
import { FinanceModule } from "../../modules/Finance";

export default function FinancePage() {
  const { data, save, busy, load, suspicious } = useSystem();
  if (!data) return null;
  return <FinanceModule
      data={data}
      save={save}
      busy={busy}
      load={load}
      suspicious={suspicious}
    />;
}
```

`NotificationsModule` needs none of that — it fetches its own data independently — but `Chrome` (the shared layout in `layout.tsx`) already gates all page content behind `{!data ? <loading/> : <div className="content">{children}</div>}`, so by the time this route's children render at all, `data` is guaranteed loaded anyway. The page file stays minimal:

```tsx
// app/(system)/notifications/page.tsx
"use client";

import { NotificationsModule } from "../../modules/Notifications";

export default function NotificationsPage() {
  return <NotificationsModule />;
}
```

- [ ] **Step 3: Add the nav entry**

In `app/(system)/layout.tsx`, add to the first `navGroups` entry (the `label: null` group that currently holds only Dashboard):

```tsx
const navGroups: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        note: "Today at a glance",
        permission: "",
        Icon: DashboardIcon,
      },
      {
        href: "/notifications",
        label: "Notifications",
        note: "Everything flagged for you",
        permission: "",
        Icon: BellIcon,
      },
    ],
  },
```

(Empty `permission: ""` — same as Dashboard — means every signed-in staff role sees it, matching the spec's decision.)

- [ ] **Step 4: Verify in the browser**

Start the dev server, create a scratch session + synthetic notification row (same as Task 9's verification), navigate to `/notifications` via the sidebar link (confirm it now appears there), confirm the row renders, click "Open", confirm it marks read and navigates. Clean up.

- [ ] **Step 5: Type-check and lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npx eslint app/modules/Notifications.tsx "app/(system)/notifications/page.tsx" "app/(system)/layout.tsx"`
Expected: no output from any.

- [ ] **Step 6: Clean up and commit**

```bash
git add app/modules/Notifications.tsx "app/(system)/notifications/page.tsx" "app/(system)/layout.tsx" app/globals.css
git commit -m "Add dedicated Notifications page and sidebar entry"
```

---

### Task 11: Click-through — land on the right tab/record, not just the right page

**Files:**
- Modify: `app/modules/Finance.tsx` (read `?tab=` and `?invoice=` on mount)
- Modify: `app/modules/Maintenance.tsx` (read `?ticket=` on mount)
- Modify: `app/modules/StudentInformation.tsx` (read `?tenancy=` on mount)

**Interfaces:**
- Consumes: `useSearchParams` from `next/navigation` (new to all three files — see the Suspense note in Step 4).

Note: `HostelInformation.tsx` needs **no change**. Its tab state (`tab`/`setTab`) is lifted to `app/(system)/hostels/page.tsx` (`const [tab, setTab] = useState<HostelTab>("reservations")`), and the Sales notifications all link to `/hostels?tab=reservations` — which is already that page's default tab on a fresh load. Nothing to wire.

- [ ] **Step 1: Finance.tsx**

Finance.tsx currently imports `import { Fragment, useState } from "react";` (no `useEffect` yet) and has no `next/navigation` import. Change the react import to:

```tsx
import { Fragment, useEffect, useState } from "react";
```

Add a new import line right after it:

```tsx
import { useSearchParams } from "next/navigation";
```

Find where `financeTab` and `openInvoiceId` are declared (`const [financeTab, setFinanceTab] = useState<...>("invoices");` and `const [openInvoiceId, setOpenInvoiceId] = useState<string | number | null>(null);`). Add right after both:

```tsx
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "invoices" || tab === "deposits" || tab === "adjustments" || tab === "maintenance" || tab === "parking")
      setFinanceTab(tab);
    const invoiceParam = searchParams.get("invoice");
    if (invoiceParam) setOpenInvoiceId(Number(invoiceParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 2: Maintenance.tsx**

Maintenance.tsx currently imports `import { useMemo, useState } from "react";` — change to:

```tsx
import { useEffect, useMemo, useState } from "react";
```

Add:

```tsx
import { useSearchParams } from "next/navigation";
```

Find `const [ticket, setTicket] = useState<Row | null>(null);` (line 176). Add nearby:

```tsx
  const searchParams = useSearchParams();
  useEffect(() => {
    const ticketParam = searchParams.get("ticket");
    if (ticketParam) {
      const match = data.tickets.find((row) => String(row.id) === ticketParam);
      if (match) setTicket(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tickets]);
```

(Depends on `data.tickets` rather than `[]` since tickets aren't loaded synchronously — this re-checks once the real data arrives, matching how the rest of this module already reacts to `data` becoming available.)

- [ ] **Step 3: StudentInformation.tsx**

Find `const [selectedStudentRef, setSelectedStudentRef] = useState<SelectedStudentRef | null>(null);` (line 1400). `SelectedStudentRef` is `{ studentId: string | number; assignmentId?: string | number | null }` (declared at line 42) — a student is looked up by matching `data.students[].assignmentId` against the URL's `tenancy` param, then the ref is set the same way a row click already does elsewhere in this file. Add `useEffect`/`useSearchParams` imports the same way as Steps 1-2 (check this file's existing `"react"` import line and add `useEffect` if missing; add the `next/navigation` import), then add near the `selectedStudentRef` declaration:

```tsx
  const searchParams = useSearchParams();
  useEffect(() => {
    const tenancyParam = searchParams.get("tenancy");
    if (tenancyParam) {
      const match = data.students.find(
        (row) => String(row.assignmentId) === tenancyParam,
      );
      if (match) setSelectedStudentRef({ studentId: match.id, assignmentId: match.assignmentId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.students]);
```

- [ ] **Step 4: Handle the Suspense requirement for `useSearchParams`**

`useSearchParams()` requires a `<Suspense>` boundary somewhere above it when the route could be statically rendered. This app's routes are all fully dynamic already (every page waits behind `SystemLayout`'s own client-side auth check before rendering anything — see `app/(system)/layout.tsx`'s `if (!allowed) return <div className="login-shell">...`), so in practice this usually isn't an issue, but Next.js's build step checks statically regardless of runtime behavior. Handle this empirically:

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx tsc --noEmit && npm run build 2>&1 | tail -60`

If it fails citing `useSearchParams() should be wrapped in a suspense boundary` for `/finance`, `/maintenance`, or `/students`, wrap that route's module render in that route's own `page.tsx` (not inside the module component) — e.g. for Finance:

```tsx
"use client";

import { Suspense } from "react";
import { useSystem } from "../../SystemContext";
import { FinanceModule } from "../../modules/Finance";

export default function FinancePage() {
  const { data, save, busy, load, suspicious } = useSystem();
  if (!data) return null;
  return (
    <Suspense fallback={null}>
      <FinanceModule
        data={data}
        save={save}
        busy={busy}
        load={load}
        suspicious={suspicious}
      />
    </Suspense>
  );
}
```

(Same wrapping pattern for `app/(system)/maintenance/page.tsx` and `app/(system)/students/page.tsx` if the build flags them too — only wrap the ones the build actually complains about.)

Run the build again after any wrapping: `npm run build 2>&1 | tail -60`
Expected: succeeds with no Suspense-boundary error.

- [ ] **Step 5: Manual browser verification, end to end**

Using this session's established technique: create a scratch session, insert a real synthetic ticket + a `ticket-assigned` notification row pointing at `/maintenance?ticket=<id>`, log in via the Browser tool, click the bell, click that notification, confirm the Maintenance page opens with that exact ticket's detail modal already open (not just the Maintenance page in general). Repeat once for a `lease-expiring`-style link (`/students?tenancy=<id>`) against a synthetic tenancy, confirming the right student's drawer opens. Clean up both fixtures.

- [ ] **Step 6: Lint**

Run: `cd /Users/yapfongkiat/create-a-system-database-for-my && npx eslint app/modules/Finance.tsx app/modules/Maintenance.tsx app/modules/StudentInformation.tsx`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/modules/Finance.tsx app/modules/Maintenance.tsx app/modules/StudentInformation.tsx "app/(system)"
git commit -m "Wire notification click-through to the right tab/record on each page"
```
