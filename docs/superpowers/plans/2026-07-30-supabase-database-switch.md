# Switch the App's Database Layer from D1 to Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app read and write Supabase Postgres instead of Cloudflare D1 (SQLite), with identical behavior from the user's perspective.

**Architecture:** Swap the Drizzle driver from `drizzle-orm/d1` to `drizzle-orm/postgres-js`, pointed at Supabase's pooled connection string (already in `.dev.vars` as `DATABASE_URL`, confirmed working — see the connectivity spike in `docs/superpowers/specs/2026-07-30-supabase-connection-design.md`). Rewrite `db/schema.ts` from SQLite types to Postgres types. Convert every raw D1 API call (`d1.prepare().bind().run()/.first()/.all()`, `d1.batch()`) to Postgres-compatible Drizzle calls, and every Drizzle `.get()` shortcut (SQLite-only) to the Postgres equivalent.

**Tech Stack:** `drizzle-orm` 0.45.2 (already installed, includes the `postgres-js` driver), `postgres` npm package 3.4.9 (already installed), Supabase Postgres 17.6.

## Global Constraints

- D1 must remain untouched and unused as a rollback safety net — do not delete `wrangler.json`'s `d1_databases` block, the `drizzle/` SQLite migrations, or the local D1 sqlite file.
- Never print, log, or commit the contents of `.dev.vars` or the `DATABASE_URL` value.
- After every task: run `npx tsc --noEmit` and it must report zero errors before moving to the next task. This is the primary safety net for catching missed conversions (the postgres-js Drizzle types genuinely lack `.get()`, `getD1()`, and D1-only result shapes, so anything unconverted is a compile error, not a silent runtime bug).
- After every task that touches `app/api/system/route.ts` or `db/auth.ts`: run `npm run lint` (must show 0 errors) and `npm run build` (must succeed).
- Follow the existing code style exactly (2-space indent, double quotes, trailing commas per Prettier defaults already in this repo — do not reformat unrelated lines).

---

## Conversion rules (apply mechanically throughout)

These 9 rules cover every D1/SQLite-specific pattern found in the codebase (verified by exhaustive reading of every `.prepare(`, `.batch(`, `.get()` call site — 3371-line `route.ts`, all of `db/auth.ts`, all of `app/api/auth/route.ts`).

**R1 — Drop `getD1()` / the `d1` variable.** Every function using `const d1 = getD1();` gets that line deleted. All `d1.xxx` calls in that function become `db.xxx` (using the function's existing `db = getDb()`, or add one if the function doesn't already have it).

**R2 — `.get()` → array + `[0]`.** Drizzle's SQLite driver has a `.get()` shortcut for "single row or undefined"; the Postgres driver doesn't have it — `await` the query directly (it resolves to an array) and index `[0]`.
```ts
// Before
const user = await db.select().from(appUsers).where(eq(appUsers.id, id)).get();
// After
const user = (await db.select().from(appUsers).where(eq(appUsers.id, id)))[0];
```

**R3 — Raw `?`-parameterized SQL → `db.execute(sql\`...\`)` with `${}` interpolation.** Drizzle's `sql` tagged template (already imported: `import { ..., sql } from "drizzle-orm"`) parameterizes interpolated values automatically (same safety as `.bind()`). `db.execute()` on the postgres-js driver resolves directly to an array of rows (verified against the installed driver's type: `PostgresJsQueryResultHKT` = `RowList<Row[]>`) — no `.results` wrapper.
```ts
// Before
const rows = await d1.prepare("SELECT id FROM student_profiles WHERE source_key = ?").bind(key).first<{ id: number }>();
// After
const rows = (await db.execute(sql`SELECT id FROM student_profiles WHERE source_key = ${key}`))[0] as { id: number } | undefined;
```

**R4 — `.all<T>()` + `.results` → direct array.**
```ts
// Before
const readings = await d1.prepare("SELECT reading_value FROM meter_readings WHERE room_id=? ...").bind(roomId, cutoffDate).all<{ reading_value: number }>();
if (readings.results.length < 2) ...
// After
const readings = await db.execute<{ reading_value: number }>(sql`SELECT reading_value FROM meter_readings WHERE room_id=${roomId} ...`);
if (readings.length < 2) ...
```

**R5 — `.run()` → nothing (just await).** D1's `.run()` executes and returns `{success, meta, results}`; for statements where the code never reads the return value, just await `db.execute(sql...)` directly.

**R6 — `INSERT OR IGNORE` → `... ON CONFLICT DO NOTHING`.** Postgres syntax; safe to append to any raw INSERT that doesn't already have an `ON CONFLICT` clause. Note one query (`billing-cycle`'s cycle upsert) already uses `ON CONFLICT(...) DO UPDATE ... RETURNING id` — that's standard SQL Postgres already supports unchanged; only the `?` placeholders need converting there (R3).

**R7 — D1's `.meta.last_row_id` → `RETURNING id` + `[0].id`.** Only one call site (`student-create`). D1's `.run()` exposes the inserted row's id via `result.meta.last_row_id`; Postgres has no equivalent metadata field — add `RETURNING id` to the INSERT SQL itself and read it from the resolved array.

**R8 — `d1.batch([...])` → `db.transaction(async (tx) => { ... })`.** Postgres transactions are the direct equivalent; use `tx.execute(sql...)` (or Drizzle builder calls on `tx`) for each statement inside. All 5 batch call sites in this codebase never read the batch's return value, so no result-correlation logic is needed — just sequential awaits inside the transaction callback.

**R9 — Postgres is stricter about aggregates than SQLite.** One query (`meter-reading-bulk`'s room/bed lookup) selects a bare column (`r.id`) alongside an aggregate (`MIN(b.id)`) with no `GROUP BY` — SQLite allows this (picks an arbitrary row), Postgres rejects it outright with a "column must appear in GROUP BY" error. Fix: add `GROUP BY r.id`. This is the **one genuine semantic fix** required, not just a syntax swap — called out explicitly in Task 11.

Functions/values that need **no change** because Postgres already supports the same syntax: `substr()`, `||` concatenation, `lower()`, `COALESCE()`, `CASE WHEN`, `LIMIT`, correlated subqueries.

---

### Task 1: Swap the database driver

**Files:**
- Modify: `db/index.ts`

**Interfaces:**
- Produces: `getDb()` — same signature as before (`() => DrizzleDatabase`), now backed by Postgres. `getD1()` is removed entirely (no other file outside `app/api/system/route.ts` calls it — confirmed by `grep -rn "getD1" --include=*.ts .`).

- [ ] **Step 1: Replace the file contents**

```ts
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;

function getClient() {
  const bindings = env as unknown as { DATABASE_URL?: string };
  if (!bindings.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is unavailable. Add it to `.dev.vars` (local dev) or as a secret (deployed)."
    );
  }
  if (!client) client = postgres(bindings.DATABASE_URL, { max: 5 });
  return client;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors will appear from every other file still calling `getD1()` — that's expected at this point in the plan; confirm the *only* errors are `Module '"../../../db"' has no exported member 'getD1'` (or similar) in `app/api/system/route.ts`. If any other kind of error appears, stop and investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add db/index.ts
git commit -m "db: swap driver from D1 to postgres-js"
```

---

### Task 2: Point drizzle-kit at Postgres

**Files:**
- Modify: `drizzle.config.ts`

- [ ] **Step 1: Replace the file contents**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add drizzle.config.ts
git commit -m "db: point drizzle-kit at postgresql dialect"
```

---

### Task 3: Rewrite the schema for Postgres

**Files:**
- Modify: `db/schema.ts`

**Interfaces:**
- Produces: every table export (`hostelProperties`, `hostelUnits`, ... all 40) with identical names, identical field names, identical relationships — only the underlying column-builder types change. Every consumer (`app/api/system/route.ts`, `db/auth.ts`, `app/api/auth/route.ts`) keeps working against the same import names.

**Conversion applied uniformly:**
- `sqliteTable` → `pgTable` (from `drizzle-orm/pg-core`)
- `integer(...).primaryKey({ autoIncrement: true })` → `bigint(name, { mode: "number" }).primaryKey().generatedByDefaultAsIdentity()` — matches the `bigint GENERATED BY DEFAULT AS IDENTITY` type already live on every table in Supabase (created by the earlier data-migration export).
- Every other `integer(...)` column (including all foreign keys) → `bigint(name, { mode: "number" })` — the Supabase export mapped every SQLite `integer` to Postgres `bigint` uniformly; `{ mode: "number" }` keeps the JS-side value a plain `number` (not a `BigInt`), preserving every existing `Number(x.id)`/`String(x.id)`/`JSON.stringify` call site in the frontend and API — using the `bigint`/BigInt JS mode would break JSON serialization everywhere.
- `integer(col, { mode: "boolean" })` → `boolean(col)` (9 columns total: `reservations.inventoryCommitted`, `announcements.pinned`, `appRoles.isSystem`, `rolePermissions.canView/canCreate/canEdit/canDelete/canApprove`, `reminderTemplates.enabled`).
- `real(...)` → `doublePrecision(...)`.
- `text(...)` → `text(...)` (unchanged).
- `.default(sql\`CURRENT_TIMESTAMP\`)` on a `text` column → `.default(sql\`(CURRENT_TIMESTAMP)::text\`)` — matches the exact cast already baked into the live Supabase tables (Postgres requires an explicit cast when defaulting a `text` column to a `timestamp`-typed expression; SQLite didn't need one). Using the uncast form here would cause `drizzle-kit` to think there's schema drift later, even though it doesn't affect runtime inserts.
- `uniqueIndex` → same name, imported from `drizzle-orm/pg-core` instead of `drizzle-orm/sqlite-core`; same `.on(table.col1, table.col2)` call shape.
- `.references(() => otherTable.id)`, `.notNull()`, `.unique()`, `.default(literal)` — unchanged, same API across both dialects.

- [ ] **Step 1: Replace the entire file contents**

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const hostelProperties = pgTable("hostel_properties", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  electricityRate: doublePrecision("electricity_rate").notNull().default(0),
  monthlyCleaningFee: doublePrecision("monthly_cleaning_fee").notNull().default(0),
  monthlyWaterDispenserFee: doublePrecision("monthly_water_dispenser_fee")
    .notNull()
    .default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const hostelUnits = pgTable(
  "hostel_units",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    hostelId: bigint("hostel_id", { mode: "number" })
      .notNull()
      .references(() => hostelProperties.id),
    unitCode: text("unit_code").notNull(),
    address: text("address").notNull().default(""),
    gender: text("gender").notNull().default("mixed"),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    ownerName: text("owner_name").notNull().default(""),
    leaseEndDate: text("lease_end_date"),
    surrenderDate: text("surrender_date"),
    surrenderNotes: text("surrender_notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("hostel_unit_unique").on(table.hostelId, table.unitCode),
  ],
);

export const hostelRooms = pgTable(
  "hostel_rooms",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => hostelUnits.id),
    roomLabel: text("room_label").notNull(),
    status: text("status").notNull().default("active"),
    bathroomType: text("bathroom_type").notNull().default("unknown"),
    roomType: text("room_type").notNull().default("auto"),
    salesRate: doublePrecision("sales_rate"),
    promotionRate: doublePrecision("promotion_rate"),
    promotionStartDate: text("promotion_start_date"),
    promotionEndDate: text("promotion_end_date"),
    meterSerial: text("meter_serial").notNull().default(""),
  },
  (table) => [
    uniqueIndex("hostel_room_unique").on(table.unitId, table.roomLabel),
  ],
);

export const bedSpaces = pgTable(
  "bed_spaces",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    roomId: bigint("room_id", { mode: "number" })
      .notNull()
      .references(() => hostelRooms.id),
    bedLabel: text("bed_label").notNull(),
    legacyCode: text("legacy_code").notNull().unique(),
    status: text("status").notNull().default("vacant"),
    specialUse: text("special_use"),
    bedType: text("bed_type").notNull().default("unknown"),
    meterSerial: text("meter_serial").notNull().default(""),
    monthlyRental: doublePrecision("monthly_rental"),
    legacyAccessCardDeposit: doublePrecision("legacy_access_card_deposit"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [uniqueIndex("room_bed_unique").on(table.roomId, table.bedLabel)],
);

export const accessCards = pgTable("access_cards", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  unitId: bigint("unit_id", { mode: "number" })
    .notNull()
    .references(() => hostelUnits.id),
  cardCode: text("card_code").notNull().unique(),
  depositAmount: doublePrecision("deposit_amount").notNull().default(0),
  status: text("status").notNull().default("available"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const studentProfiles = pgTable("student_profiles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  sourceKey: text("source_key").notNull().unique(),
  studentCode: text("student_code").notNull().default(""),
  fullName: text("full_name").notNull(),
  identityNo: text("identity_no").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  email: text("email").notNull().default(""),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender").notNull().default("unspecified"),
  race: text("race").notNull().default(""),
  religion: text("religion").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
  hometown: text("hometown").notNull().default(""),
  course: text("course").notNull().default(""),
  school: text("school").notNull().default(""),
  applicationFormNo: text("application_form_no").notNull().default(""),
  receiptNo: text("receipt_no").notNull().default(""),
  salesperson: text("salesperson").notNull().default(""),
  agency: text("agency").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const accommodationAssignments = pgTable("accommodation_assignments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  sourceKey: text("source_key").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => studentProfiles.id),
  bedSpaceId: bigint("bed_space_id", { mode: "number" })
    .notNull()
    .references(() => bedSpaces.id),
  monthlyRental: doublePrecision("monthly_rental"),
  securityDeposit: doublePrecision("security_deposit"),
  accessCardDeposit: doublePrecision("access_card_deposit"),
  parkingDeposit: doublePrecision("parking_deposit"),
  salesperson: text("salesperson").notNull().default(""),
  checkInDate: text("check_in_date"),
  agreementStartDate: text("agreement_start_date"),
  agreementEndDate: text("agreement_end_date"),
  agreementDuration: text("agreement_duration").notNull().default(""),
  checkOutDate: text("check_out_date"),
  checkInMeter: doublePrecision("check_in_meter"),
  checkOutMeter: doublePrecision("check_out_meter"),
  sourceReservationId: bigint("source_reservation_id", { mode: "number" }),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const reservations = pgTable("reservations", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  referenceNo: text("reference_no").notNull().unique(),
  studentName: text("student_name").notNull(),
  reservationType: text("reservation_type").notNull().default("individual"),
  representativeType: text("representative_type").notNull().default("person"),
  salesPerson: text("sales_person").notNull().default(""),
  groupSize: bigint("group_size", { mode: "number" }).notNull().default(1),
  preferredHostelId: bigint("preferred_hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  preferredUnitId: bigint("preferred_unit_id", { mode: "number" }).references(
    () => hostelUnits.id,
  ),
  preferredGender: text("preferred_gender").notNull().default("unspecified"),
  roomCategory: text("room_category").notNull().default("any"),
  roomType: text("room_type").notNull().default("any"),
  bathroomType: text("bathroom_type").notNull().default("any"),
  targetMoveInDate: text("target_move_in_date").notNull(),
  expectedEndDate: text("expected_end_date"),
  budgetMax: doublePrecision("budget_max"),
  provisionalBedSpaceId: bigint("provisional_bed_space_id", {
    mode: "number",
  }).references(() => bedSpaces.id),
  assignedBedSpaceId: bigint("assigned_bed_space_id", {
    mode: "number",
  }).references(() => bedSpaces.id),
  holdExpiresAt: text("hold_expires_at"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  totalPayable: doublePrecision("total_payable"),
  paymentReference: text("payment_reference").notNull().default(""),
  inventoryCommitted: boolean("inventory_committed").notNull().default(false),
  paymentUpdatedAt: text("payment_updated_at"),
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const unitServices = pgTable("unit_services", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  unitId: bigint("unit_id", { mode: "number" })
    .notNull()
    .references(() => hostelUnits.id),
  serviceType: text("service_type").notNull(),
  accountHolderName: text("account_holder_name").notNull().default(""),
  provider: text("provider").notNull().default(""),
  accountReference: text("account_reference").notNull().default(""),
  lineType: text("line_type").notNull().default("not-applicable"),
  contractEndDate: text("contract_end_date"),
  servicePackage: text("service_package").notNull().default(""),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  surrenderAction: text("surrender_action").notNull().default("review"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const unitOwnerDetails = pgTable(
  "unit_owner_details",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => hostelUnits.id),
    ownerName: text("owner_name").notNull().default(""),
    ownerIdentityNo: text("owner_identity_no").notNull().default(""),
    ownerEmail: text("owner_email").notNull().default(""),
    registeredAddress: text("registered_address").notNull().default(""),
    agreementType: text("agreement_type").notNull().default("rental"),
    primaryContactName: text("primary_contact_name").notNull().default(""),
    primaryContactPhone: text("primary_contact_phone").notNull().default(""),
    secondaryContactName: text("secondary_contact_name").notNull().default(""),
    secondaryContactPhone: text("secondary_contact_phone")
      .notNull()
      .default(""),
    bankAccountNumber: text("bank_account_number").notNull().default(""),
    bankAccountHolder: text("bank_account_holder").notNull().default(""),
    bankName: text("bank_name").notNull().default(""),
    leaseStartDate: text("lease_start_date"),
    leaseEndDate: text("lease_end_date"),
    monthlyLeaseRental: doublePrecision("monthly_lease_rental"),
    servicePercentage: doublePrecision("service_percentage"),
    securityDeposit: doublePrecision("security_deposit"),
    utilityDeposit: doublePrecision("utility_deposit"),
    commissionAmount: doublePrecision("commission_amount"),
    tnbAccount: text("tnb_account").notNull().default(""),
    airSelangorAccount: text("air_selangor_account").notNull().default(""),
    indahWaterAccount: text("indah_water_account").notNull().default(""),
    monthlyCleaningFee: doublePrecision("monthly_cleaning_fee"),
    monthlyWaterDispenserFee: doublePrecision("monthly_water_dispenser_fee"),
    notes: text("notes").notNull().default(""),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [uniqueIndex("unit_owner_unique").on(table.unitId)],
);

export const reservationPayments = pgTable("reservation_payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  amount: doublePrecision("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("bank-transfer"),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  notes: text("notes").notNull().default(""),
});

export const reservationCharges = pgTable("reservation_charges", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  chargeType: text("charge_type").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  notes: text("notes").notNull().default(""),
});

export const studentRateChanges = pgTable("student_rate_changes", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  assignmentId: bigint("assignment_id", { mode: "number" })
    .notNull()
    .references(() => accommodationAssignments.id),
  effectiveDate: text("effective_date").notNull(),
  monthlyRental: doublePrecision("monthly_rental"),
  securityDeposit: doublePrecision("security_deposit"),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const parkingLots = pgTable(
  "parking_lots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    hostelId: bigint("hostel_id", { mode: "number" })
      .notNull()
      .references(() => hostelProperties.id),
    unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
    lotNumber: text("lot_number").notNull(),
    status: text("status").notNull().default("available"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("parking_lot_unique").on(table.hostelId, table.lotNumber),
  ],
);

export const parkingRentals = pgTable("parking_rentals", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  parkingLotId: bigint("parking_lot_id", { mode: "number" })
    .notNull()
    .references(() => parkingLots.id),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  tenantType: text("tenant_type").notNull().default("in-house"),
  tenantName: text("tenant_name").notNull(),
  contactNumber: text("contact_number").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  carPlateNumber: text("car_plate_number").notNull().default(""),
  carModel: text("car_model").notNull().default(""),
  monthlyRental: doublePrecision("monthly_rental").notNull().default(0),
  depositAmount: doublePrecision("deposit_amount").notNull().default(0),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  paidUntil: text("paid_until"),
  billingFrequency: text("billing_frequency").notNull().default("monthly"),
  packageMonths: bigint("package_months", { mode: "number" }).notNull().default(1),
  nextDueDate: text("next_due_date"),
  paymentStatus: text("payment_status").notNull().default("not-due"),
  status: text("status").notNull().default("active"),
  notes: text("notes").notNull().default(""),
});

export const ownerParkingPayments = pgTable("owner_parking_payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  unitId: bigint("unit_id", { mode: "number" })
    .notNull()
    .references(() => hostelUnits.id),
  parkingLotId: bigint("parking_lot_id", { mode: "number" }).references(
    () => parkingLots.id,
  ),
  period: text("period").notNull().default(""),
  amount: doublePrecision("amount").notNull().default(0),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull().default("bank-transfer"),
  reference: text("reference").notNull().default(""),
  status: text("status").notNull().default("paid"),
  remarks: text("remarks").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const schools = pgTable("schools", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const maintenanceTickets = pgTable("maintenance_tickets", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  roomId: bigint("room_id", { mode: "number" }).references(() => hostelRooms.id),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull().default(""),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("average"),
  status: text("status").notNull().default("submitted"),
  submittedByType: text("submitted_by_type").notNull().default("staff"),
  assignedTo: text("assigned_to").notNull().default(""),
  attendedAt: text("attended_at"),
  completedAt: text("completed_at"),
  costResponsibility: text("cost_responsibility")
    .notNull()
    .default("management"),
  estimatedCost: doublePrecision("estimated_cost"),
  actualCost: doublePrecision("actual_cost"),
  studentCharge: doublePrecision("student_charge"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketId: bigint("ticket_id", { mode: "number" })
    .notNull()
    .references(() => maintenanceTickets.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull().default("staff"),
  message: text("message").notNull(),
  statusAfter: text("status_after"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const ticketCategories = pgTable(
  "ticket_categories",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    status: text("status").notNull().default("active"),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    uniqueIndex("ticket_category_unique").on(table.category, table.subcategory),
  ],
);

export const generalCosts = pgTable("general_costs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  costDate: text("cost_date").notNull(),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  ticketId: bigint("ticket_id", { mode: "number" }).references(
    () => maintenanceTickets.id,
  ),
  costType: text("cost_type").notNull().default("maintenance"),
  description: text("description").notNull(),
  responsibility: text("responsibility").notNull().default("management"),
  amount: doublePrecision("amount").notNull().default(0),
  studentCharge: doublePrecision("student_charge").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const storedAttachments = pgTable("stored_attachments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  contextType: text("context_type").notNull(),
  recordId: bigint("record_id", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type")
    .notNull()
    .default("application/octet-stream"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  uploadedBy: text("uploaded_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const meterReadings = pgTable("meter_readings", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  bedSpaceId: bigint("bed_space_id", { mode: "number" })
    .notNull()
    .references(() => bedSpaces.id),
  roomId: bigint("room_id", { mode: "number" }).references(() => hostelRooms.id),
  readingDate: text("reading_date").notNull(),
  readingValue: doublePrecision("reading_value").notNull(),
  readingType: text("reading_type").notNull().default("monthly"),
  submittedBy: text("submitted_by").notNull().default("Maintenance Team"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingCycles = pgTable("billing_cycles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  periodLabel: text("period_label").notNull().unique(),
  cutoffDate: text("cutoff_date").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("draft"),
  postedAt: text("posted_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingInvoices = pgTable("billing_invoices", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceNo: text("invoice_no").notNull().unique(),
  cycleId: bigint("cycle_id", { mode: "number" })
    .notNull()
    .references(() => billingCycles.id),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => studentProfiles.id),
  assignmentId: bigint("assignment_id", { mode: "number" }).references(
    () => accommodationAssignments.id,
  ),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  invoiceFrequency: text("invoice_frequency").notNull().default("on-request"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingItems = pgTable("billing_items", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceId: bigint("invoice_id", { mode: "number" })
    .notNull()
    .references(() => billingInvoices.id),
  itemType: text("item_type").notNull(),
  description: text("description").notNull(),
  quantity: doublePrecision("quantity").notNull().default(1),
  rate: doublePrecision("rate").notNull().default(0),
  amount: doublePrecision("amount").notNull().default(0),
});

export const billingPaymentRecords = pgTable("billing_payment_records", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceId: bigint("invoice_id", { mode: "number" })
    .notNull()
    .references(() => billingInvoices.id),
  amount: doublePrecision("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  remark: text("remark").notNull().default(""),
  status: text("status").notNull().default("pending-verification"),
  proofAttachmentId: bigint("proof_attachment_id", { mode: "number" }).references(
    () => storedAttachments.id,
  ),
  submittedAt: text("submitted_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  verifiedAt: text("verified_at"),
  verifiedBy: text("verified_by").notNull().default(""),
  verifiedAmount: doublePrecision("verified_amount"),
  actualReference: text("actual_reference").notNull().default(""),
  receiptNo: text("receipt_no").notNull().default(""),
});

export const billingItemAdjustments = pgTable("billing_item_adjustments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  billingItemId: bigint("billing_item_id", { mode: "number" })
    .notNull()
    .references(() => billingItems.id),
  previousAmount: doublePrecision("previous_amount").notNull().default(0),
  newAmount: doublePrecision("new_amount").notNull().default(0),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: text("approved_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  approvedAt: text("approved_at"),
});

export const announcements = pgTable("announcements", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audienceType: text("audience_type").notNull().default("all"),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  blockCode: text("block_code").notNull().default(""),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("published"),
  pinned: boolean("pinned").notNull().default(false),
  publishAt: text("publish_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  expiresAt: text("expires_at"),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const appRoles = pgTable("app_roles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  roleKey: text("role_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const appUsers = pgTable("app_users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  roleId: bigint("role_id", { mode: "number" })
    .notNull()
    .references(() => appRoles.id),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  status: text("status").notNull().default("active"),
  // PBKDF2 digest: pbkdf2$<iterations>$<saltB64>$<hashB64>. Empty = no password set.
  passwordHash: text("password_hash").notNull().default(""),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const userSessions = pgTable("user_sessions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  // SHA-256 of the cookie token; the raw token is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => appUsers.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => appRoles.id),
    moduleKey: text("module_key").notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    canApprove: boolean("can_approve").notNull().default(false),
  },
  (table) => [
    uniqueIndex("role_permission_unique").on(table.roleId, table.moduleKey),
  ],
);

export const reminderTemplates = pgTable("reminder_templates", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reminderKey: text("reminder_key").notNull().unique(),
  dayOfMonth: bigint("day_of_month", { mode: "number" }).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

// The original prototype tables remain declared so schema tooling doesn't
// flag them as unexpected drift against the live database (they exist there
// too, as empty unused duplicates). The application never reads or writes
// these tables — do not add real logic against them.
export const legacyHostels = pgTable("hostels", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  wardenName: text("warden_name").notNull().default(""),
});
export const legacyRooms = pgTable("rooms", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  hostelId: bigint("hostel_id", { mode: "number" })
    .notNull()
    .references(() => legacyHostels.id),
  roomNumber: text("room_number").notNull(),
  floor: bigint("floor", { mode: "number" }).notNull().default(1),
  capacity: bigint("capacity", { mode: "number" }).notNull().default(2),
  monthlyRate: doublePrecision("monthly_rate").notNull().default(0),
  status: text("status").notNull().default("available"),
});
export const legacyStudents = pgTable("students", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  studentNo: text("student_no").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  course: text("course").notNull().default(""),
  intake: text("intake").notNull().default(""),
  emergencyContact: text("emergency_contact").notNull().default(""),
  roomId: bigint("room_id", { mode: "number" }).references(() => legacyRooms.id),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyComplaints = pgTable("complaints", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => legacyStudents.id),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to").notNull().default("Facilities Team"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyInvoices = pgTable("invoices", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceNo: text("invoice_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => legacyStudents.id),
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyPayments = pgTable("payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceId: bigint("invoice_id", { mode: "number" })
    .notNull()
    .references(() => legacyInvoices.id),
  amount: doublePrecision("amount").notNull(),
  method: text("method").notNull().default("bank transfer"),
  reference: text("reference").notNull().default(""),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: far fewer errors than before — anywhere the schema types now conflict with D1-specific code (e.g. `.get()` calls) will surface as type errors. This is expected; they get fixed in later tasks. No errors should come from `db/schema.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add db/schema.ts
git commit -m "db: rewrite schema for Postgres (pgTable, bigint, boolean, doublePrecision)"
```

---

### Task 4: Fix `db/auth.ts`

**Files:**
- Modify: `db/auth.ts:139-161` (the `getSessionUser` function)

- [ ] **Step 1: Apply rule R2**

```ts
// Before (lines ~139-161)
  const row = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      displayName: appUsers.displayName,
      status: appUsers.status,
      studentId: appUsers.studentId,
      roleId: appRoles.id,
      roleKey: appRoles.roleKey,
      roleName: appRoles.name,
    })
    .from(userSessions)
    .innerJoin(appUsers, eq(userSessions.userId, appUsers.id))
    .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
    .where(
      and(
        eq(userSessions.tokenHash, await sha256(token)),
        gt(userSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .get();
  if (!row || row.status !== "active") return null;
  return row;
```

```ts
// After
  const row = (
    await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        displayName: appUsers.displayName,
        status: appUsers.status,
        studentId: appUsers.studentId,
        roleId: appRoles.id,
        roleKey: appRoles.roleKey,
        roleName: appRoles.name,
      })
      .from(userSessions)
      .innerJoin(appUsers, eq(userSessions.userId, appUsers.id))
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(
        and(
          eq(userSessions.tokenHash, await sha256(token)),
          gt(userSessions.expiresAt, new Date().toISOString()),
        ),
      )
  )[0];
  if (!row || row.status !== "active") return null;
  return row;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported for `db/auth.ts`.

- [ ] **Step 3: Commit**

```bash
git add db/auth.ts
git commit -m "db: fix getSessionUser for postgres-js driver (drop .get())"
```

---

### Task 5: Fix `app/api/auth/route.ts` and `app/api/files/route.ts`

> Added during execution: Task 3's implementer flagged that `app/api/files/route.ts:37`
> also has one `.get()` call the original reconnaissance missed (`getDb().select().from(storedAttachments)...get()`
> inside the `GET` handler). It needs the identical R2 fix. Folded into this task since it's
> the same one-line pattern already being fixed here.

**Files:**
- Modify: `app/api/auth/route.ts:67-77`
- Modify: `app/api/files/route.ts:37`

- [ ] **Step 1: Apply rule R2**

```ts
// Before
  const row = await getDb()
    .select({
      id: appUsers.id,
      status: appUsers.status,
      passwordHash: appUsers.passwordHash,
      roleKey: appRoles.roleKey,
    })
    .from(appUsers)
    .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
    .where(eq(appUsers.email, email))
    .get();
```

```ts
// After
  const row = (
    await getDb()
      .select({
        id: appUsers.id,
        status: appUsers.status,
        passwordHash: appUsers.passwordHash,
        roleKey: appRoles.roleKey,
      })
      .from(appUsers)
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(eq(appUsers.email, email))
  )[0];
```

- [ ] **Step 2: Apply the same fix to `app/api/files/route.ts`**

```ts
// Before (line 37)
    const row = await getDb().select().from(storedAttachments).where(eq(storedAttachments.id, id)).get();
```

```ts
// After
    const row = (
      await getDb().select().from(storedAttachments).where(eq(storedAttachments.id, id))
    )[0];
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three succeed with no errors.

- [ ] **Step 4: Live test the login endpoint**

This is the first end-to-end test against Supabase. Start the dev server (`vinext dev`), then in another terminal:

```bash
curl -s -X POST http://localhost:PORT/api/auth \
  -H 'content-type: application/json' \
  -d '{"action":"login","email":"nonexistent@example.com","password":"wrong"}' \
  -w '\nstatus: %{http_code}\n'
```

Expected: `{"error":"Incorrect email or password"}` with `status: 401` — proves the query runs against Supabase without throwing (a 500 here would mean the query itself is broken).

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/route.ts app/api/files/route.ts
git commit -m "auth: fix login and file-download lookups for postgres-js driver (drop .get())"
```

---

### Task 6: Convert the batching helpers and seed/late-fee functions

**Files:**
- Modify: `app/api/system/route.ts:110-120` (`chunks`, `runBatches`)
- Modify: `app/api/system/route.ts:317-488` (`seedAdministration`, `applyLatePaymentCharges`)

**Interfaces:**
- Produces: `runBatches(statements: (tx: PgTx) => Promise<unknown>[] | Promise<unknown>, ...)` — **signature changes** (see below), so every call site of `runBatches` elsewhere in the file (Tasks 7–12) must be updated to match. Consumed by: `seedAdministration`, `seedKnownRoomFeatures`, `seedStudentAssignments`, `replaceReservationCharges`, `room-add`, `bulk-room-price`, `student-move-out`, `student-update`.

D1's `runBatches` took an array of already-built `D1PreparedStatement` objects. Postgres has no equivalent "prepared statement object you build then hand to a batch call" — instead, wrap the whole batch in one transaction and run each statement inside it. To keep every call site's shape as close to the original as possible (minimizing changes elsewhere), `runBatches` now takes a **factory function** that receives the transaction and returns the array of promises to run inside it:

- [ ] **Step 1: Replace `chunks`/`runBatches`**

```ts
// Before (lines 110-120)
function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function runBatches(statements: D1PreparedStatement[], size = 50) {
  const d1 = getD1();
  for (const group of chunks(statements, size)) await d1.batch(group);
}
```

```ts
// After
async function runBatches<T>(
  items: T[],
  build: (item: T, tx: PgTransaction) => Promise<unknown>,
) {
  if (!items.length) return;
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const item of items) await build(item, tx);
  });
}
```

Add the `PgTransaction` type import at the top of the file (needed for the new `runBatches` signature):

```ts
// Add to the existing `import { and, asc, desc, eq, sql } from "drizzle-orm";` region
import type { PgTransaction } from "drizzle-orm/pg-core";
```

Note: this changes every call site from `runBatches(array.map((x) => d1.prepare(...).bind(...)))` (an array of pre-built statements) to `runBatches(array, (x, tx) => tx.execute(sql\`...\`))` (an array of source items plus a per-item builder function that receives the transaction). This is a deliberate shape change — see each call site's conversion in Tasks 7–12.

- [ ] **Step 2: Convert `seedAdministration`**

```ts
// Before (lines 317-412)
async function seedAdministration() {
  const d1 = getD1();
  await runBatches(
    roleBlueprints.map((role) =>
      d1
        .prepare(
          "INSERT OR IGNORE INTO app_roles (role_key, name, description, is_system) VALUES (?, ?, ?, 1)",
        )
        .bind(role.key, role.name, role.description),
    ),
  );
  const roles = await getDb().select().from(appRoles);
  const statements: D1PreparedStatement[] = [];
  for (const role of roles)
    for (const moduleKey of permissionModules) {
      const p = permissionFor(role.roleKey, moduleKey);
      statements.push(
        d1
          .prepare(
            `
      INSERT OR IGNORE INTO role_permissions
        (role_id, module_key, can_view, can_create, can_edit, can_delete, can_approve)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
          )
          .bind(
            role.id,
            moduleKey,
            Number(p.view),
            Number(p.create),
            Number(p.edit),
            Number(p.delete),
            Number(p.approve),
          ),
      );
    }
  await runBatches(statements);
  const categories = [
    ["Electrical", "Fan"],
    ["Electrical", "Light"],
    ["Electrical", "Power socket"],
    ["Plumbing", "Tap / leaking"],
    ["Plumbing", "Toilet"],
    ["Plumbing", "Water heater"],
    ["Air-conditioner", "Not cooling"],
    ["Furniture", "Bed / wardrobe"],
    ["Access card / key", "Door unlocking"],
    ["Internet", "Wi-Fi connection"],
    ["Cleaning", "Room cleaning"],
    ["Other", "General issue"],
  ];
  await runBatches(
    categories.map(([category, subcategory], index) =>
      d1
        .prepare(
          "INSERT OR IGNORE INTO ticket_categories (category, subcategory, sort_order) VALUES (?, ?, ?)",
        )
        .bind(category, subcategory, index),
    ),
  );
  const reminders = [
    [
      "due-date",
      5,
      "Payment due today",
      "Your monthly hostel payment is due today. Please upload your payment slip in the portal.",
    ],
    [
      "first-overdue",
      8,
      "Payment overdue reminder",
      "Your hostel account is overdue. Please make payment and upload your payment slip.",
    ],
    [
      "second-overdue",
      15,
      "Important payment reminder",
      "Your hostel account remains overdue. Late-payment charges may apply.",
    ],
    [
      "final-overdue",
      21,
      "Final payment reminder",
      "This is the final scheduled reminder for the month. Please contact Accounts if assistance is required.",
    ],
  ];
  await runBatches(
    reminders.map(([key, day, subject, message]) =>
      d1
        .prepare(
          "INSERT OR IGNORE INTO reminder_templates (reminder_key, day_of_month, subject, message) VALUES (?, ?, ?, ?)",
        )
        .bind(key, day, subject, message),
    ),
  );
}
```

```ts
// After
async function seedAdministration() {
  const db = getDb();
  await runBatches(roleBlueprints, (role, tx) =>
    tx.execute(
      sql`INSERT INTO app_roles (role_key, name, description, is_system) VALUES (${role.key}, ${role.name}, ${role.description}, true) ON CONFLICT DO NOTHING`,
    ),
  );
  const roles = await db.select().from(appRoles);
  const permissionRows = roles.flatMap((role) =>
    permissionModules.map((moduleKey) => ({ role, moduleKey })),
  );
  await runBatches(permissionRows, ({ role, moduleKey }, tx) => {
    const p = permissionFor(role.roleKey, moduleKey);
    return tx.execute(sql`
      INSERT INTO role_permissions
        (role_id, module_key, can_view, can_create, can_edit, can_delete, can_approve)
      VALUES (${role.id}, ${moduleKey}, ${p.view}, ${p.create}, ${p.edit}, ${p.delete}, ${p.approve})
      ON CONFLICT DO NOTHING
    `);
  });
  const categories: [string, string][] = [
    ["Electrical", "Fan"],
    ["Electrical", "Light"],
    ["Electrical", "Power socket"],
    ["Plumbing", "Tap / leaking"],
    ["Plumbing", "Toilet"],
    ["Plumbing", "Water heater"],
    ["Air-conditioner", "Not cooling"],
    ["Furniture", "Bed / wardrobe"],
    ["Access card / key", "Door unlocking"],
    ["Internet", "Wi-Fi connection"],
    ["Cleaning", "Room cleaning"],
    ["Other", "General issue"],
  ];
  await runBatches(
    categories.map(([category, subcategory], index) => ({
      category,
      subcategory,
      index,
    })),
    ({ category, subcategory, index }, tx) =>
      tx.execute(
        sql`INSERT INTO ticket_categories (category, subcategory, sort_order) VALUES (${category}, ${subcategory}, ${index}) ON CONFLICT DO NOTHING`,
      ),
  );
  const reminders: [string, number, string, string][] = [
    [
      "due-date",
      5,
      "Payment due today",
      "Your monthly hostel payment is due today. Please upload your payment slip in the portal.",
    ],
    [
      "first-overdue",
      8,
      "Payment overdue reminder",
      "Your hostel account is overdue. Please make payment and upload your payment slip.",
    ],
    [
      "second-overdue",
      15,
      "Important payment reminder",
      "Your hostel account remains overdue. Late-payment charges may apply.",
    ],
    [
      "final-overdue",
      21,
      "Final payment reminder",
      "This is the final scheduled reminder for the month. Please contact Accounts if assistance is required.",
    ],
  ];
  await runBatches(
    reminders.map(([key, day, subject, message]) => ({
      key,
      day,
      subject,
      message,
    })),
    ({ key, day, subject, message }, tx) =>
      tx.execute(
        sql`INSERT INTO reminder_templates (reminder_key, day_of_month, subject, message) VALUES (${key}, ${day}, ${subject}, ${message}) ON CONFLICT DO NOTHING`,
      ),
  );
}
```

- [ ] **Step 3: Convert `applyLatePaymentCharges`**

```ts
// Before (lines 414-488)
async function applyLatePaymentCharges() {
  const d1 = getD1();
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
  const rows = await d1
    .prepare(
      `
    SELECT i.id, i.due_date, i.amount_paid,
      COALESCE((SELECT SUM(amount) FROM billing_items WHERE invoice_id=i.id AND item_type='room-rental'),0) rental,
      (SELECT id FROM billing_items WHERE invoice_id=i.id AND item_type='late-payment-charge' LIMIT 1) late_item_id
    FROM billing_invoices i
    JOIN billing_cycles c ON c.id=i.cycle_id
    WHERE c.status='posted' AND i.due_date < ?
  `,
    )
    .bind(today)
    .all<{
      id: number;
      due_date: string;
      amount_paid: number;
      rental: number;
      late_item_id: number | null;
    }>();
  for (const invoice of rows.results) {
    if (
      Number(invoice.amount_paid || 0) >= Number(invoice.rental || 0) ||
      Number(invoice.rental || 0) <= 0
    )
      continue;
    const days = Math.max(
      0,
      Math.floor(
        (Date.parse(`${today}T00:00:00Z`) -
          Date.parse(`${invoice.due_date}T00:00:00Z`)) /
          86400000,
      ),
    );
    const amount = days * 3;
    if (!amount) continue;
    if (invoice.late_item_id)
      await d1
        .prepare(
          "UPDATE billing_items SET quantity=?, rate=3, amount=?, description=? WHERE id=?",
        )
        .bind(
          days,
          amount,
          `Late payment charge (${days} day${days === 1 ? "" : "s"})`,
          invoice.late_item_id,
        )
        .run();
    else
      await d1
        .prepare(
          "INSERT INTO billing_items (invoice_id,item_type,description,quantity,rate,amount) VALUES (?,'late-payment-charge',?,?,3,?)",
        )
        .bind(
          invoice.id,
          `Late payment charge (${days} day${days === 1 ? "" : "s"})`,
          days,
          amount,
        )
        .run();
    await d1
      .prepare(
        "UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=?) WHERE id=?",
      )
      .bind(invoice.id, invoice.id)
      .run();
  }
}
```

```ts
// After
async function applyLatePaymentCharges() {
  const db = getDb();
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
  const rows = await db.execute<{
    id: number;
    due_date: string;
    amount_paid: number;
    rental: number;
    late_item_id: number | null;
  }>(sql`
    SELECT i.id, i.due_date, i.amount_paid,
      COALESCE((SELECT SUM(amount) FROM billing_items WHERE invoice_id=i.id AND item_type='room-rental'),0) rental,
      (SELECT id FROM billing_items WHERE invoice_id=i.id AND item_type='late-payment-charge' LIMIT 1) late_item_id
    FROM billing_invoices i
    JOIN billing_cycles c ON c.id=i.cycle_id
    WHERE c.status='posted' AND i.due_date < ${today}
  `);
  for (const invoice of rows) {
    if (
      Number(invoice.amount_paid || 0) >= Number(invoice.rental || 0) ||
      Number(invoice.rental || 0) <= 0
    )
      continue;
    const days = Math.max(
      0,
      Math.floor(
        (Date.parse(`${today}T00:00:00Z`) -
          Date.parse(`${invoice.due_date}T00:00:00Z`)) /
          86400000,
      ),
    );
    const amount = days * 3;
    if (!amount) continue;
    const description = `Late payment charge (${days} day${days === 1 ? "" : "s"})`;
    if (invoice.late_item_id)
      await db.execute(
        sql`UPDATE billing_items SET quantity=${days}, rate=3, amount=${amount}, description=${description} WHERE id=${invoice.late_item_id}`,
      );
    else
      await db.execute(
        sql`INSERT INTO billing_items (invoice_id,item_type,description,quantity,rate,amount) VALUES (${invoice.id},'late-payment-charge',${description},${days},3,${amount})`,
      );
    await db.execute(
      sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${invoice.id}) WHERE id=${invoice.id}`,
    );
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported for lines 110-488 of `app/api/system/route.ts`. Errors elsewhere in the file (not yet converted) are expected at this point.

- [ ] **Step 5: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert runBatches, seedAdministration, applyLatePaymentCharges to Postgres"
```

---

### Task 7: Convert the remaining helper functions

**Files:**
- Modify: `app/api/system/route.ts:490-557` (`resolveCurrentUser`)
- Modify: `app/api/system/route.ts:655-834` (`seedKnownRoomFeatures`, `seedStudentAssignments`, `replaceReservationCharges`, `addReservationPayment`)

- [ ] **Step 1: Fix the three `.get()` calls in `resolveCurrentUser`**

Apply rule R2 to each of the three `.get()` calls at (current) lines 525, 530, 536:

```ts
// Before
  let user = await db
    .select({ /* ... */ })
    .from(appUsers)
    .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
    .where(eq(appUsers.email, email))
    .get();
  if (!user) {
    const count = await db
      .select({ value: sql<number>`count(*)` })
      .from(appUsers)
      .get();
    const roleKey = Number(count?.value || 0) === 0 ? "director" : "tenant";
    const role = await db
      .select()
      .from(appRoles)
      .where(eq(appRoles.roleKey, roleKey))
      .get();
```

```ts
// After
  let user = (
    await db
      .select({ /* ... unchanged ... */ })
      .from(appUsers)
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(eq(appUsers.email, email))
  )[0];
  if (!user) {
    const count = (
      await db.select({ value: sql<number>`count(*)` }).from(appUsers)
    )[0];
    const roleKey = Number(count?.value || 0) === 0 ? "director" : "tenant";
    const role = (
      await db.select().from(appRoles).where(eq(appRoles.roleKey, roleKey))
    )[0];
```

(Keep the full original field list inside the first `.select({...})` — only wrap the query and drop `.get()`, per the pattern shown.)

- [ ] **Step 2: Convert `seedKnownRoomFeatures`**

```ts
// Before (lines 655-697)
async function seedKnownRoomFeatures() {
  const d1 = getD1();
  const known = [
    ["1201", "A", "non-attached"],
    ["1201", "B", "attached"],
    ["1201", "C", "non-attached"],
    ["1201", "D", "non-attached"],
    ["1304", "A", "non-attached"],
  ];
  await runBatches(
    known.map(([unitCode, roomLabel, bathroomType]) =>
      d1
        .prepare(
          `
    UPDATE hostel_rooms SET bathroom_type = ?
    WHERE bathroom_type = 'unknown' AND id IN (
      SELECT r.id FROM hostel_rooms r JOIN hostel_units u ON r.unit_id = u.id
      JOIN hostel_properties h ON u.hostel_id = h.id
      WHERE h.code = 'ATR' AND u.unit_code = ? AND r.room_label = ?
    )
  `,
        )
        .bind(bathroomType, unitCode, roomLabel),
    ),
    25,
  );
  await d1
    .prepare(
      `
    UPDATE hostel_rooms SET room_type = CASE
      WHEN (SELECT COUNT(*) FROM bed_spaces b WHERE b.room_id = hostel_rooms.id) > 1 THEN 'sharing'
      ELSE 'single' END WHERE room_type = 'auto'
  `,
    )
    .run();
  await d1
    .prepare(
      `UPDATE hostel_properties
       SET electricity_rate = CASE WHEN code = 'NDY' THEN 0.751 ELSE 0.685 END
       WHERE electricity_rate IN (0, 0.57)`,
    )
    .run();
}
```

```ts
// After
async function seedKnownRoomFeatures() {
  const db = getDb();
  const known: [string, string, string][] = [
    ["1201", "A", "non-attached"],
    ["1201", "B", "attached"],
    ["1201", "C", "non-attached"],
    ["1201", "D", "non-attached"],
    ["1304", "A", "non-attached"],
  ];
  await runBatches(known, ([unitCode, roomLabel, bathroomType], tx) =>
    tx.execute(sql`
    UPDATE hostel_rooms SET bathroom_type = ${bathroomType}
    WHERE bathroom_type = 'unknown' AND id IN (
      SELECT r.id FROM hostel_rooms r JOIN hostel_units u ON r.unit_id = u.id
      JOIN hostel_properties h ON u.hostel_id = h.id
      WHERE h.code = 'ATR' AND u.unit_code = ${unitCode} AND r.room_label = ${roomLabel}
    )
  `),
  );
  await db.execute(sql`
    UPDATE hostel_rooms SET room_type = CASE
      WHEN (SELECT COUNT(*) FROM bed_spaces b WHERE b.room_id = hostel_rooms.id) > 1 THEN 'sharing'
      ELSE 'single' END WHERE room_type = 'auto'
  `);
  await db.execute(sql`
    UPDATE hostel_properties
       SET electricity_rate = CASE WHEN code = 'NDY' THEN 0.751 ELSE 0.685 END
       WHERE electricity_rate IN (0, 0.57)
  `);
}
```

- [ ] **Step 3: Convert `seedStudentAssignments`**

```ts
// Before (lines 699-777)
async function seedStudentAssignments() {
  const db = getDb();
  const d1 = getD1();
  const [profiles, assignments, beds] = await Promise.all([
    db.select({ sourceKey: studentProfiles.sourceKey }).from(studentProfiles),
    db
      .select({ sourceKey: accommodationAssignments.sourceKey })
      .from(accommodationAssignments),
    db
      .select({ id: bedSpaces.id, legacyCode: bedSpaces.legacyCode })
      .from(bedSpaces),
  ]);
  const profileKeys = new Set(profiles.map((row) => row.sourceKey));
  const missingProfiles = importedAssignments.filter(
    (record) => !profileKeys.has(record.sourceKey),
  );
  await runBatches(
    missingProfiles.map((record) =>
      d1
        .prepare(
          `
    INSERT OR IGNORE INTO student_profiles (source_key, student_code, full_name, nationality, hometown, course)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
        )
        .bind(
          record.sourceKey,
          record.student.sourceCode,
          record.student.fullName,
          record.student.nationality,
          record.student.hometown,
          record.student.course,
        ),
    ),
  );

  const allProfiles = await db
    .select({ id: studentProfiles.id, sourceKey: studentProfiles.sourceKey })
    .from(studentProfiles);
  const profileIds = new Map(allProfiles.map((row) => [row.sourceKey, row.id]));
  const bedIds = new Map(beds.map((row) => [row.legacyCode, row.id]));
  const assignmentKeys = new Set(assignments.map((row) => row.sourceKey));
  const missingAssignments = importedAssignments.filter(
    (record) =>
      !assignmentKeys.has(record.sourceKey) &&
      profileIds.has(record.sourceKey) &&
      bedIds.has(record.legacyCode),
  );
  await runBatches(
    missingAssignments.map((record) =>
      d1
        .prepare(
          `
    INSERT OR IGNORE INTO accommodation_assignments
      (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit,
       salesperson, check_in_date, agreement_start_date, agreement_end_date, agreement_duration,
       check_out_date, check_in_meter, remarks, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `,
        )
        .bind(
          record.sourceKey,
          profileIds.get(record.sourceKey),
          bedIds.get(record.legacyCode),
          record.assignment.monthlyRental,
          record.assignment.securityDeposit,
          record.assignment.accessCardDeposit,
          record.assignment.salesperson,
          record.assignment.checkInDate,
          record.assignment.agreementStartDate,
          record.assignment.agreementEndDate,
          record.assignment.agreementDuration,
          record.assignment.checkOutDate,
          record.assignment.checkInMeter,
          record.assignment.remarks,
        ),
    ),
  );
}
```

```ts
// After
async function seedStudentAssignments() {
  const db = getDb();
  const [profiles, assignments, beds] = await Promise.all([
    db.select({ sourceKey: studentProfiles.sourceKey }).from(studentProfiles),
    db
      .select({ sourceKey: accommodationAssignments.sourceKey })
      .from(accommodationAssignments),
    db
      .select({ id: bedSpaces.id, legacyCode: bedSpaces.legacyCode })
      .from(bedSpaces),
  ]);
  const profileKeys = new Set(profiles.map((row) => row.sourceKey));
  const missingProfiles = importedAssignments.filter(
    (record) => !profileKeys.has(record.sourceKey),
  );
  await runBatches(missingProfiles, (record, tx) =>
    tx.execute(sql`
    INSERT INTO student_profiles (source_key, student_code, full_name, nationality, hometown, course)
    VALUES (${record.sourceKey}, ${record.student.sourceCode}, ${record.student.fullName}, ${record.student.nationality}, ${record.student.hometown}, ${record.student.course})
    ON CONFLICT DO NOTHING
  `),
  );

  const allProfiles = await db
    .select({ id: studentProfiles.id, sourceKey: studentProfiles.sourceKey })
    .from(studentProfiles);
  const profileIds = new Map(allProfiles.map((row) => [row.sourceKey, row.id]));
  const bedIds = new Map(beds.map((row) => [row.legacyCode, row.id]));
  const assignmentKeys = new Set(assignments.map((row) => row.sourceKey));
  const missingAssignments = importedAssignments.filter(
    (record) =>
      !assignmentKeys.has(record.sourceKey) &&
      profileIds.has(record.sourceKey) &&
      bedIds.has(record.legacyCode),
  );
  await runBatches(missingAssignments, (record, tx) =>
    tx.execute(sql`
    INSERT INTO accommodation_assignments
      (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit,
       salesperson, check_in_date, agreement_start_date, agreement_end_date, agreement_duration,
       check_out_date, check_in_meter, remarks, status)
    VALUES (${record.sourceKey}, ${profileIds.get(record.sourceKey)}, ${bedIds.get(record.legacyCode)}, ${record.assignment.monthlyRental}, ${record.assignment.securityDeposit}, ${record.assignment.accessCardDeposit}, ${record.assignment.salesperson}, ${record.assignment.checkInDate}, ${record.assignment.agreementStartDate}, ${record.assignment.agreementEndDate}, ${record.assignment.agreementDuration}, ${record.assignment.checkOutDate}, ${record.assignment.checkInMeter}, ${record.assignment.remarks}, 'active')
    ON CONFLICT DO NOTHING
  `),
  );
}
```

- [ ] **Step 4: Convert `replaceReservationCharges` and `addReservationPayment`**

```ts
// Before (lines 779-834)
async function replaceReservationCharges(reservationId: number, raw: unknown) {
  const d1 = getD1();
  let values: Record<string, unknown> = {};
  if (typeof raw === "string" && raw) {
    try {
      values = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      values = {};
    }
  } else if (raw && typeof raw === "object")
    values = raw as Record<string, unknown>;
  await d1
    .prepare("DELETE FROM reservation_charges WHERE reservation_id = ?")
    .bind(reservationId)
    .run();
  const rows = chargeTypes
    .map((type) => ({ type, amount: asNumber(values[type], 0) }))
    .filter((row) => row.amount > 0);
  if (rows.length)
    await runBatches(
      rows.map((row) =>
        d1
          .prepare(
            "INSERT INTO reservation_charges (reservation_id, charge_type, amount) VALUES (?, ?, ?)",
          )
          .bind(reservationId, row.type, row.amount),
      ),
    );
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function addReservationPayment(
  reservationId: number,
  body: Record<string, unknown>,
) {
  const amount = asNumber(body.paymentAmount ?? body.amountPaid, 0);
  if (amount > 0 || asText(body.paymentReference)) {
    await getDb()
      .insert(reservationPayments)
      .values({
        reservationId,
        amount,
        reference: asText(body.paymentReference),
        paymentMethod: asText(body.paymentMethod, "bank-transfer"),
        paidAt: asNullableText(body.paidAt) || nowIso(),
        notes: asText(body.paymentNotes),
      });
  }
  const total = await getD1()
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM reservation_payments WHERE reservation_id = ?",
    )
    .bind(reservationId)
    .first<{ total: number }>();
  return Number(total?.total || 0);
}
```

```ts
// After
async function replaceReservationCharges(reservationId: number, raw: unknown) {
  const db = getDb();
  let values: Record<string, unknown> = {};
  if (typeof raw === "string" && raw) {
    try {
      values = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      values = {};
    }
  } else if (raw && typeof raw === "object")
    values = raw as Record<string, unknown>;
  await db.execute(
    sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
  );
  const rows = chargeTypes
    .map((type) => ({ type, amount: asNumber(values[type], 0) }))
    .filter((row) => row.amount > 0);
  if (rows.length)
    await runBatches(rows, (row, tx) =>
      tx.execute(
        sql`INSERT INTO reservation_charges (reservation_id, charge_type, amount) VALUES (${reservationId}, ${row.type}, ${row.amount})`,
      ),
    );
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function addReservationPayment(
  reservationId: number,
  body: Record<string, unknown>,
) {
  const db = getDb();
  const amount = asNumber(body.paymentAmount ?? body.amountPaid, 0);
  if (amount > 0 || asText(body.paymentReference)) {
    await db.insert(reservationPayments).values({
      reservationId,
      amount,
      reference: asText(body.paymentReference),
      paymentMethod: asText(body.paymentMethod, "bank-transfer"),
      paidAt: asNullableText(body.paidAt) || nowIso(),
      notes: asText(body.paymentNotes),
    });
  }
  const total = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount), 0) AS total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  return Number(total?.total || 0);
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for lines 490-834. Errors from `electricityShareForAssignment` (1633+) and the POST handler (1705+) are expected and handled in later tasks.

- [ ] **Step 6: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert resolveCurrentUser, seed and reservation-charge helpers to Postgres"
```

---

### Task 8: Convert `electricityShareForAssignment`

**Files:**
- Modify: `app/api/system/route.ts:1633-1704`

- [ ] **Step 1: Apply R1, R3, R4**

```ts
// Before
async function electricityShareForAssignment(
  assignmentId: number,
  roomId: number,
  cutoffDate: string,
  electricityRate: number,
) {
  const d1 = getD1();
  const readings = await d1
    .prepare(
      `
    SELECT reading_value FROM meter_readings
    WHERE COALESCE(room_id, (SELECT room_id FROM bed_spaces WHERE id=bed_space_id))=?
      AND reading_date<=?
    ORDER BY reading_date DESC, id DESC LIMIT 2
  `,
    )
    .bind(roomId, cutoffDate)
    .all<{ reading_value: number }>();
  if (readings.results.length < 2) return { usage: 0, amount: 0 };
  const current = Number(readings.results[0].reading_value);
  const previous = Number(readings.results[1].reading_value);
  if (!(current > previous)) return { usage: 0, amount: 0 };
  const occupants = await d1
    .prepare(
      `
    SELECT a.id, a.check_in_meter, a.check_out_meter FROM accommodation_assignments a
    JOIN bed_spaces b ON a.bed_space_id=b.id
    WHERE b.room_id=? AND (a.status='active' OR a.check_out_date>=substr(?,1,7)||'-01')
  `,
    )
    .bind(roomId, cutoffDate)
    .all<{
      id: number;
      check_in_meter: number | null;
      check_out_meter: number | null;
    }>();
  const intervals = occupants.results
    .map((occupant) => ({
```

```ts
// After
async function electricityShareForAssignment(
  assignmentId: number,
  roomId: number,
  cutoffDate: string,
  electricityRate: number,
) {
  const db = getDb();
  const readings = await db.execute<{ reading_value: number }>(sql`
    SELECT reading_value FROM meter_readings
    WHERE COALESCE(room_id, (SELECT room_id FROM bed_spaces WHERE id=bed_space_id))=${roomId}
      AND reading_date<=${cutoffDate}
    ORDER BY reading_date DESC, id DESC LIMIT 2
  `);
  if (readings.length < 2) return { usage: 0, amount: 0 };
  const current = Number(readings[0].reading_value);
  const previous = Number(readings[1].reading_value);
  if (!(current > previous)) return { usage: 0, amount: 0 };
  const occupants = await db.execute<{
    id: number;
    check_in_meter: number | null;
    check_out_meter: number | null;
  }>(sql`
    SELECT a.id, a.check_in_meter, a.check_out_meter FROM accommodation_assignments a
    JOIN bed_spaces b ON a.bed_space_id=b.id
    WHERE b.room_id=${roomId} AND (a.status='active' OR a.check_out_date>=substr(${cutoffDate},1,7)||'-01')
  `);
  const intervals = occupants
    .map((occupant) => ({
```

The rest of the function body (from `id: occupant.id,` through the closing `}`) is unchanged **except** every remaining `occupants.results` becomes `occupants` (there is exactly one more reference, in the `.filter(...)` chain immediately after `.map(...)` — confirm by reading the current file before editing, since this function's tail was already pure JS array logic with no more D1 calls).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for lines 1633-1704.

- [ ] **Step 3: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert electricityShareForAssignment to Postgres"
```

---

### Task 9: POST handler setup + Units & Rooms action handlers

**Files:**
- Modify: `app/api/system/route.ts:1705-1710` (POST handler top)
- Modify: action handlers: `unit-create`, `room-details`, `room-delete`, `bed-delete`, `room-add`, `bulk-room-price`, `promotion-end`

- [ ] **Step 1: Remove the top-level `d1` binding**

```ts
// Before
export async function POST(request: Request) {
  try {
    const db = getDb();
    const d1 = getD1();
```

```ts
// After
export async function POST(request: Request) {
  try {
    const db = getDb();
```

- [ ] **Step 2: `unit-create`**

```ts
// Before
      const result = await d1
        .prepare(
          "INSERT INTO hostel_units (hostel_id, unit_code, address, gender, status, notes, owner_name, surrender_notes) VALUES (?, ?, ?, ?, 'active', '', '', '') RETURNING id",
        )
        .bind(
          asNumber(body.hostelId),
          unitCode,
          fullUnitAddress(unitCode, property.code, property.address),
          asText(body.gender, "unspecified"),
        )
        .first<{ id: number }>();
      createdId = result?.id;
```

```ts
// After
      const result = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO hostel_units (hostel_id, unit_code, address, gender, status, notes, owner_name, surrender_notes)
          VALUES (${asNumber(body.hostelId)}, ${unitCode}, ${fullUnitAddress(unitCode, property.code, property.address)}, ${asText(body.gender, "unspecified")}, 'active', '', '', '')
          RETURNING id
        `)
      )[0];
      createdId = result?.id;
```

- [ ] **Step 3: `room-details`**

```ts
// Before
      if (asText(body.roomType) === "single") {
        const room = await d1
          .prepare(
            `
          SELECT r.room_label, u.unit_code FROM hostel_rooms r
          JOIN hostel_units u ON r.unit_id=u.id WHERE r.id=?
        `,
          )
          .bind(asNumber(body.roomId))
          .first<{ room_label: string; unit_code: string }>();
        const roomBeds = await d1
          .prepare(
            `
          SELECT b.id, b.legacy_code,
            (SELECT COUNT(*) FROM accommodation_assignments a WHERE a.bed_space_id=b.id) assignments
          FROM bed_spaces b WHERE b.room_id=? ORDER BY b.id
        `,
          )
          .bind(asNumber(body.roomId))
          .all<{ id: number; legacy_code: string; assignments: number }>();
        if (roomBeds.results.length > 1) {
          const removable = roomBeds.results.slice(1);
          if (removable.some((bed) => Number(bed.assignments) > 0))
            throw new Error(
              "This room cannot become single until the extra bed assignment history is cleared",
            );
          await runBatches(
            removable.map((bed) =>
              d1.prepare("DELETE FROM bed_spaces WHERE id=?").bind(bed.id),
            ),
          );
        }
        const first = roomBeds.results[0];
        if (first && room)
          await d1
            .prepare(
              "UPDATE bed_spaces SET bed_label='1', legacy_code=? WHERE id=?",
            )
            .bind(`${room.unit_code}-${room.room_label}1`, first.id)
            .run();
      }
```

```ts
// After
      if (asText(body.roomType) === "single") {
        const room = (
          await db.execute<{ room_label: string; unit_code: string }>(sql`
          SELECT r.room_label, u.unit_code FROM hostel_rooms r
          JOIN hostel_units u ON r.unit_id=u.id WHERE r.id=${asNumber(body.roomId)}
        `)
        )[0];
        const roomBeds = await db.execute<{
          id: number;
          legacy_code: string;
          assignments: number;
        }>(sql`
          SELECT b.id, b.legacy_code,
            (SELECT COUNT(*) FROM accommodation_assignments a WHERE a.bed_space_id=b.id) assignments
          FROM bed_spaces b WHERE b.room_id=${asNumber(body.roomId)} ORDER BY b.id
        `);
        if (roomBeds.length > 1) {
          const removable = roomBeds.slice(1);
          if (removable.some((bed) => Number(bed.assignments) > 0))
            throw new Error(
              "This room cannot become single until the extra bed assignment history is cleared",
            );
          await runBatches(removable, (bed, tx) =>
            tx.execute(sql`DELETE FROM bed_spaces WHERE id=${bed.id}`),
          );
        }
        const first = roomBeds[0];
        if (first && room)
          await db.execute(
            sql`UPDATE bed_spaces SET bed_label='1', legacy_code=${`${room.unit_code}-${room.room_label}1`} WHERE id=${first.id}`,
          );
      }
```

- [ ] **Step 4: `room-delete`**

```ts
// Before
    } else if (action === "room-delete") {
      const roomId = asNumber(body.roomId);
      if (!roomId) throw new Error("Room is required");
      const used = await d1
        .prepare(
          `
        SELECT COUNT(*) total FROM accommodation_assignments
        WHERE bed_space_id IN (SELECT id FROM bed_spaces WHERE room_id=?)
      `,
        )
        .bind(roomId)
        .first<{ total: number }>();
      if (Number(used?.total || 0) > 0)
        throw new Error("Rooms with assignment history cannot be deleted");
      await d1.batch([
        d1.prepare("DELETE FROM bed_spaces WHERE room_id=?").bind(roomId),
        d1.prepare("DELETE FROM hostel_rooms WHERE id=?").bind(roomId),
      ]);
    } else if (action === "bed-delete") {
      const bedId = asNumber(body.bedId);
      if (!bedId) throw new Error("Room code is required");
      const used = await d1
        .prepare(
          "SELECT COUNT(*) total FROM accommodation_assignments WHERE bed_space_id=?",
        )
        .bind(bedId)
        .first<{ total: number }>();
```

```ts
// After
    } else if (action === "room-delete") {
      const roomId = asNumber(body.roomId);
      if (!roomId) throw new Error("Room is required");
      const used = (
        await db.execute<{ total: number }>(sql`
        SELECT COUNT(*) total FROM accommodation_assignments
        WHERE bed_space_id IN (SELECT id FROM bed_spaces WHERE room_id=${roomId})
      `)
      )[0];
      if (Number(used?.total || 0) > 0)
        throw new Error("Rooms with assignment history cannot be deleted");
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM bed_spaces WHERE room_id=${roomId}`);
        await tx.execute(sql`DELETE FROM hostel_rooms WHERE id=${roomId}`);
      });
    } else if (action === "bed-delete") {
      const bedId = asNumber(body.bedId);
      if (!bedId) throw new Error("Room code is required");
      const used = (
        await db.execute<{ total: number }>(
          sql`SELECT COUNT(*) total FROM accommodation_assignments WHERE bed_space_id=${bedId}`,
        )
      )[0];
```

(The remainder of `bed-delete` after this point is already pure Drizzle builder — no further change needed.)

- [ ] **Step 5: `room-add`**

```ts
// Before
    } else if (action === "room-add") {
      if (!body.unitId || !asText(body.roomLabel))
        throw new Error("Unit and room category are required");
      const unit = await d1
        .prepare("SELECT unit_code FROM hostel_units WHERE id = ?")
        .bind(asNumber(body.unitId))
        .first<{ unit_code: string }>();
      if (!unit) throw new Error("Unit not found");
      const room = await d1
        .prepare(
          "INSERT INTO hostel_rooms (unit_id, room_label, status, bathroom_type, room_type) VALUES (?, ?, 'active', ?, ?) RETURNING id",
        )
        .bind(
          asNumber(body.unitId),
          asText(body.roomLabel),
          asText(body.bathroomType, "unknown"),
          asText(body.roomType, "single"),
        )
        .first<{ id: number }>();
      if (!room) throw new Error("Unable to create room");
      const bedCount = Math.max(1, Math.min(5, asNumber(body.bedCount, 1)));
      const bedType = asText(body.bedType, "unknown");
      const prefix = asText(
        body.codePrefix,
        `${unit.unit_code}-${asText(body.roomLabel)}`,
      );
      await runBatches(
        Array.from({ length: bedCount }, (_, index) =>
          d1
            .prepare(
              "INSERT INTO bed_spaces (room_id, bed_label, legacy_code, status, bed_type) VALUES (?, ?, ?, 'vacant', ?)",
            )
            .bind(
              room.id,
              String(index + 1),
              `${prefix}${bedCount === 1 ? "1" : index + 1}`,
              bedType,
            ),
        ),
      );
      createdId = room.id;
```

```ts
// After
    } else if (action === "room-add") {
      if (!body.unitId || !asText(body.roomLabel))
        throw new Error("Unit and room category are required");
      const unit = (
        await db.execute<{ unit_code: string }>(
          sql`SELECT unit_code FROM hostel_units WHERE id = ${asNumber(body.unitId)}`,
        )
      )[0];
      if (!unit) throw new Error("Unit not found");
      const room = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO hostel_rooms (unit_id, room_label, status, bathroom_type, room_type)
          VALUES (${asNumber(body.unitId)}, ${asText(body.roomLabel)}, 'active', ${asText(body.bathroomType, "unknown")}, ${asText(body.roomType, "single")})
          RETURNING id
        `)
      )[0];
      if (!room) throw new Error("Unable to create room");
      const bedCount = Math.max(1, Math.min(5, asNumber(body.bedCount, 1)));
      const bedType = asText(body.bedType, "unknown");
      const prefix = asText(
        body.codePrefix,
        `${unit.unit_code}-${asText(body.roomLabel)}`,
      );
      await runBatches(
        Array.from({ length: bedCount }, (_, index) => ({
          label: String(index + 1),
          code: `${prefix}${bedCount === 1 ? "1" : index + 1}`,
        })),
        (bed, tx) =>
          tx.execute(
            sql`INSERT INTO bed_spaces (room_id, bed_label, legacy_code, status, bed_type) VALUES (${room.id}, ${bed.label}, ${bed.code}, 'vacant', ${bedType})`,
          ),
      );
      createdId = room.id;
```

- [ ] **Step 6: `bulk-room-price`**

```ts
// Before
      await runBatches(
        roomIds.map((roomId) =>
          d1
            .prepare(
              `UPDATE hostel_rooms SET ${field} = ?, promotion_start_date = CASE WHEN ? = 'promotion_rate' THEN ? ELSE promotion_start_date END, promotion_end_date = CASE WHEN ? = 'promotion_rate' THEN ? ELSE promotion_end_date END WHERE id = ? AND EXISTS (SELECT 1 FROM bed_spaces WHERE room_id = ? AND status = 'vacant')`,
            )
            .bind(
              rate,
              field,
              asNullableText(body.promotionStartDate),
              field,
              asNullableText(body.promotionEndDate),
              roomId,
              roomId,
            ),
        ),
      );
```

```ts
// After
      await runBatches(roomIds, (roomId, tx) =>
        tx.execute(sql`
          UPDATE hostel_rooms
          SET ${sql.raw(field)} = ${rate},
              promotion_start_date = CASE WHEN ${field} = 'promotion_rate' THEN ${asNullableText(body.promotionStartDate)} ELSE promotion_start_date END,
              promotion_end_date = CASE WHEN ${field} = 'promotion_rate' THEN ${asNullableText(body.promotionEndDate)} ELSE promotion_end_date END
          WHERE id = ${roomId} AND EXISTS (SELECT 1 FROM bed_spaces WHERE room_id = ${roomId} AND status = 'vacant')
        `),
      );
```

Note: `field` is one of exactly two hardcoded literal strings (`"promotion_rate"` or `"sales_rate"`, set a few lines above from `asText(body.priceType, "standard") === "promotion" ? "promotion_rate" : "sales_rate"` — never taken directly from user input), so `sql.raw(field)` for the **column name** position keeps the same safety property the original code had. The `field` value used as a **string comparison value** (`WHEN ${field} = 'promotion_rate'`) is parameterized normally, since there it's a value not an identifier.

- [ ] **Step 7: `promotion-end`**

```ts
// Before
      values.push(asText(body.endDate, new Date().toISOString().slice(0, 10)));
      await d1
        .prepare(
          `
        UPDATE hostel_rooms AS r SET promotion_end_date = ? WHERE r.id IN (
          SELECT r2.id FROM hostel_rooms r2 JOIN hostel_units u ON r2.unit_id=u.id
          WHERE ${conditions.map((value) => value.replace(/\br\./g, "r2.")).join(" AND ")}
        )
      `,
        )
        .bind(values[values.length - 1], ...values.slice(0, -1))
        .run();
```

```ts
// After
      values.push(asText(body.endDate, new Date().toISOString().slice(0, 10)));
      const whereClause = sql.raw(
        conditions
          .map((value) => value.replace(/\br\./g, "r2.").replace(/\?/g, () => "?"))
          .join(" AND "),
      );
      await db.execute(sql`
        UPDATE hostel_rooms AS r SET promotion_end_date = ${values[values.length - 1]} WHERE r.id IN (
          SELECT r2.id FROM hostel_rooms r2 JOIN hostel_units u ON r2.unit_id=u.id
          WHERE ${whereClause}
        )
      `);
```

This one needs closer attention: `conditions` is an array of literal SQL fragment strings (e.g. `"u.hostel_id = ?"`) built up conditionally earlier in the handler, each with a matching `?` placeholder value pushed into `values` in the same order. Converting `?`-per-condition to Drizzle's `${}` interpolation cleanly requires switching this one handler to build the WHERE clause with `sql.join` instead of raw string concatenation, since the number of conditions (and thus placeholders) is dynamic. Read the full handler (current lines 2043-2073) before editing, then implement it as:

```ts
    } else if (action === "promotion-end") {
      if (!body.hostelId) throw new Error("Hostel is required");
      const endDate = asText(body.endDate, new Date().toISOString().slice(0, 10));
      const conditions = [
        sql`u.hostel_id = ${asNumber(body.hostelId)}`,
        sql`r2.promotion_rate IS NOT NULL`,
        sql`(r2.promotion_end_date IS NULL OR r2.promotion_end_date > ${endDate})`,
      ];
      if (asText(body.roomCategory, "any") !== "any")
        conditions.push(sql`r2.room_label = ${asText(body.roomCategory)}`);
      if (asText(body.roomType, "any") !== "any")
        conditions.push(sql`r2.room_type = ${asText(body.roomType)}`);
      await db.execute(sql`
        UPDATE hostel_rooms AS r SET promotion_end_date = ${endDate} WHERE r.id IN (
          SELECT r2.id FROM hostel_rooms r2 JOIN hostel_units u ON r2.unit_id=u.id
          WHERE ${sql.join(conditions, sql` AND `)}
        )
      `);
```

This is a genuine restructure (not pure mechanical substitution), because the original built its condition list as raw `r.`-prefixed strings and rewrote them to `r2.`-prefixed at the last moment (a workaround for not having named subquery aliases available when the strings were first built). Building the conditions directly with the `r2.` alias from the start (as above) is simpler and behaves identically. `sql.join(array, separator)` is part of the same `drizzle-orm` `sql` API already imported — verify with `grep -n "join" node_modules/drizzle-orm/sql/sql.d.ts` before use if unsure of the exact export name.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for the handlers touched in this task.

- [ ] **Step 9: Live test — units and rooms**

Start the dev server, sign in (use `node scripts/set-password.mjs <email> <password>` first if needed against the live Supabase-backed `app_users`, then log in via `/login`), and:
1. Unit Information → open a unit → add a room → confirm it appears with the correct room label.
2. Add 2 bed spaces to that room → confirm both appear with sequential legacy codes.
3. Change the room to "single" (if it has 2+ beds) → confirm the extra bed is removed and the remaining bed's code updates.
4. Delete the test room → confirm it's gone and no error.
Clean up any test units/rooms/beds created, directly via SQL against Supabase if the UI doesn't offer a delete-unit path (mirror the cleanup approach used throughout this project's earlier sessions — check row counts before and after).

- [ ] **Step 10: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert units/rooms action handlers to Postgres"
```

---

### Task 10: Reservations action handlers

**Files:**
- Modify action handlers: `reservation`/`reservation-update`, `reservation-delete`, `reservation-convert`

- [ ] **Step 1: `reservation`/`reservation-update`'s one raw read**

```ts
// Before
      const amountPaid =
        action === "reservation"
          ? await addReservationPayment(reservationId, body)
          : Number(
              (
                await d1
                  .prepare(
                    "SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ?",
                  )
                  .bind(reservationId)
                  .first<{ total: number }>()
              )?.total || 0,
            );
```

```ts
// After
      const amountPaid =
        action === "reservation"
          ? await addReservationPayment(reservationId, body)
          : Number(
              (
                await db.execute<{ total: number }>(
                  sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
                )
              )[0]?.total || 0,
            );
```

- [ ] **Step 2: `reservation-delete`**

```ts
// Before
    } else if (action === "reservation-delete") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      await d1.batch([
        d1
          .prepare("DELETE FROM reservation_payments WHERE reservation_id = ?")
          .bind(reservationId),
        d1
          .prepare("DELETE FROM reservation_charges WHERE reservation_id = ?")
          .bind(reservationId),
        d1.prepare("DELETE FROM reservations WHERE id = ?").bind(reservationId),
      ]);
```

```ts
// After
    } else if (action === "reservation-delete") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservations WHERE id = ${reservationId}`,
        );
      });
```

- [ ] **Step 3: `reservation-convert`**

```ts
// Before
    } else if (action === "reservation-convert") {
      const reservationId = asNumber(body.reservationId);
      const reservation = await db
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .get();
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.reservationType === "group") {
        if (!body.unitId) throw new Error("Select the confirmed unit / house");
        await db
          .update(reservations)
          .set({
            preferredUnitId: asNumber(body.unitId),
            status: "converted",
            convertedAt: nowIso(),
          })
          .where(eq(reservations.id, reservationId));
      } else {
        const bedId = asNumber(
          body.bedSpaceId || reservation.provisionalBedSpaceId,
        );
        if (!bedId) throw new Error("Select the actual room code manually");
        const key = `reservation:${reservationId}`;
        await d1
          .prepare(
            "INSERT OR IGNORE INTO student_profiles (source_key, student_code, full_name, gender, salesperson, status) VALUES (?, ?, ?, ?, ?, 'active')",
          )
          .bind(
            key,
            `STU-${reservationId}`,
            reservation.studentName,
            reservation.preferredGender,
            reservation.salesPerson,
          )
          .run();
        const student = await d1
          .prepare("SELECT id FROM student_profiles WHERE source_key = ?")
          .bind(key)
          .first<{ id: number }>();
        if (!student) throw new Error("Unable to create student profile");
        await d1
          .prepare(
            "INSERT OR IGNORE INTO accommodation_assignments (source_key, student_id, bed_space_id, salesperson, check_in_date, agreement_start_date, status, remarks, source_reservation_id) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
          )
          .bind(
            key,
            student.id,
            bedId,
            reservation.salesPerson,
            reservation.targetMoveInDate,
            reservation.targetMoveInDate,
            reservation.notes,
            reservationId,
          )
          .run();
        await d1.batch([
          d1
            .prepare(
              "UPDATE bed_spaces SET status = 'occupied', updated_at = ? WHERE id = ?",
            )
            .bind(nowIso(), bedId),
          d1
            .prepare(
              "UPDATE reservations SET assigned_bed_space_id = ?, status = 'converted', converted_at = ? WHERE id = ?",
            )
            .bind(bedId, nowIso(), reservationId),
        ]);
      }
```

```ts
// After
    } else if (action === "reservation-convert") {
      const reservationId = asNumber(body.reservationId);
      const reservation = (
        await db.select().from(reservations).where(eq(reservations.id, reservationId))
      )[0];
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.reservationType === "group") {
        if (!body.unitId) throw new Error("Select the confirmed unit / house");
        await db
          .update(reservations)
          .set({
            preferredUnitId: asNumber(body.unitId),
            status: "converted",
            convertedAt: nowIso(),
          })
          .where(eq(reservations.id, reservationId));
      } else {
        const bedId = asNumber(
          body.bedSpaceId || reservation.provisionalBedSpaceId,
        );
        if (!bedId) throw new Error("Select the actual room code manually");
        const key = `reservation:${reservationId}`;
        await db.execute(sql`
          INSERT INTO student_profiles (source_key, student_code, full_name, gender, salesperson, status)
          VALUES (${key}, ${`STU-${reservationId}`}, ${reservation.studentName}, ${reservation.preferredGender}, ${reservation.salesPerson}, 'active')
          ON CONFLICT DO NOTHING
        `);
        const student = (
          await db.execute<{ id: number }>(
            sql`SELECT id FROM student_profiles WHERE source_key = ${key}`,
          )
        )[0];
        if (!student) throw new Error("Unable to create student profile");
        await db.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, salesperson, check_in_date, agreement_start_date, status, remarks, source_reservation_id)
          VALUES (${key}, ${student.id}, ${bedId}, ${reservation.salesPerson}, ${reservation.targetMoveInDate}, ${reservation.targetMoveInDate}, 'active', ${reservation.notes}, ${reservationId})
          ON CONFLICT DO NOTHING
        `);
        const now = nowIso();
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'occupied', updated_at = ${now} WHERE id = ${bedId}`,
          );
          await tx.execute(
            sql`UPDATE reservations SET assigned_bed_space_id = ${bedId}, status = 'converted', converted_at = ${now} WHERE id = ${reservationId}`,
          );
        });
      }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for the reservation handlers.

- [ ] **Step 5: Live test — reservations**

Via the Hostel Information → Reservations UI (or direct `curl` POST calls to `/api/system` with `action: "reservation"`, matching the pattern used earlier in this project's session for testing):
1. Create a new individual reservation.
2. Convert it (assign an actual vacant bed) → confirm a new student profile and assignment appear, and the bed's status flips to `occupied`.
3. Create a second reservation and delete it → confirm it's gone with no orphaned `reservation_payments`/`reservation_charges` rows (check via SQL).
Clean up all test reservations/students/assignments created, and revert the test bed back to `vacant` if it was a real bed.

- [ ] **Step 6: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert reservation action handlers to Postgres"
```

---

### Task 11: Student action handlers

**Files:**
- Modify action handlers: `student-update`, `student-create`, `student-move-out`, `student-room-change`

- [ ] **Step 1: `student-update`'s parking-rental cleanup**

```ts
// Before
        if (activeParking.length) {
          await runBatches(
            activeParking.map((rental) =>
              d1
                .prepare(
                  "UPDATE parking_rentals SET status='ended', end_date=COALESCE(end_date, ?) WHERE id=?",
                )
                .bind(
                  asText(
                    body.checkOutDate,
                    new Date().toISOString().slice(0, 10),
                  ),
                  rental.id,
                ),
            ),
          );
          await runBatches(
            activeParking.map((rental) =>
              d1
                .prepare(
                  "UPDATE parking_lots SET status='available' WHERE id=?",
                )
                .bind(rental.parkingLotId),
            ),
          );
        }
```

```ts
// After
        if (activeParking.length) {
          const checkOutDate = asText(
            body.checkOutDate,
            new Date().toISOString().slice(0, 10),
          );
          await runBatches(activeParking, (rental, tx) =>
            tx.execute(
              sql`UPDATE parking_rentals SET status='ended', end_date=COALESCE(end_date, ${checkOutDate}) WHERE id=${rental.id}`,
            ),
          );
          await runBatches(activeParking, (rental, tx) =>
            tx.execute(
              sql`UPDATE parking_lots SET status='available' WHERE id=${rental.parkingLotId}`,
            ),
          );
        }
```

- [ ] **Step 2: `student-create`**

```ts
// Before
    } else if (action === "student-create") {
      if (!asText(body.fullName)) throw new Error("Full name is required");
      const result = await d1
        .prepare(
          "INSERT INTO student_profiles (source_key, student_code, full_name, identity_no, contact_number, email, date_of_birth, gender, race, religion, nationality, hometown, course, school, application_form_no, receipt_no, salesperson, agency, remarks, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          `manual:${Date.now()}`,
          asText(body.studentCode),
          asText(body.fullName),
          asText(body.identityNo),
          asText(body.contactNumber),
          asText(body.email),
          asNullableText(body.dateOfBirth),
          asText(body.gender, "unspecified"),
          asText(body.race),
          asText(body.religion),
          asText(body.nationality),
          asText(body.hometown),
          asText(body.course),
          asText(body.school),
          asText(body.applicationFormNo),
          asText(body.receiptNo),
          asText(body.salesperson),
          asText(body.agency),
          asText(body.remarks),
          asText(body.profileStatus, "active"),
        )
        .run();
      const newStudentId = Number(result.meta.last_row_id);
      createdId = newStudentId;
      if (body.bedSpaceId) {
        const bedId = asNumber(body.bedSpaceId);
        await d1
          .prepare(
            "INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, parking_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
          )
          .bind(
            `manual:${newStudentId}:${Date.now()}`,
            newStudentId,
            bedId,
            asNullableNumber(body.monthlyRental),
            asNullableNumber(body.securityDeposit),
            asNullableNumber(body.accessCardDeposit),
            asNullableNumber(body.parkingDeposit),
            asText(body.salesperson),
            asNullableText(body.checkInDate),
            asNullableText(body.leaseStartDate),
            asNullableText(body.leaseEndDate),
          )
          .run();
        await d1
          .prepare(
            "UPDATE bed_spaces SET status='occupied', updated_at=? WHERE id=?",
          )
          .bind(nowIso(), bedId)
          .run();
      }
```

```ts
// After
    } else if (action === "student-create") {
      if (!asText(body.fullName)) throw new Error("Full name is required");
      const result = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO student_profiles (source_key, student_code, full_name, identity_no, contact_number, email, date_of_birth, gender, race, religion, nationality, hometown, course, school, application_form_no, receipt_no, salesperson, agency, remarks, status)
          VALUES (${`manual:${Date.now()}`}, ${asText(body.studentCode)}, ${asText(body.fullName)}, ${asText(body.identityNo)}, ${asText(body.contactNumber)}, ${asText(body.email)}, ${asNullableText(body.dateOfBirth)}, ${asText(body.gender, "unspecified")}, ${asText(body.race)}, ${asText(body.religion)}, ${asText(body.nationality)}, ${asText(body.hometown)}, ${asText(body.course)}, ${asText(body.school)}, ${asText(body.applicationFormNo)}, ${asText(body.receiptNo)}, ${asText(body.salesperson)}, ${asText(body.agency)}, ${asText(body.remarks)}, ${asText(body.profileStatus, "active")})
          RETURNING id
        `)
      )[0];
      const newStudentId = Number(result.id);
      createdId = newStudentId;
      if (body.bedSpaceId) {
        const bedId = asNumber(body.bedSpaceId);
        await db.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, parking_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, status)
          VALUES (${`manual:${newStudentId}:${Date.now()}`}, ${newStudentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asNullableNumber(body.parkingDeposit)}, ${asText(body.salesperson)}, ${asNullableText(body.checkInDate)}, ${asNullableText(body.leaseStartDate)}, ${asNullableText(body.leaseEndDate)}, 'active')
        `);
        await db.execute(
          sql`UPDATE bed_spaces SET status='occupied', updated_at=${nowIso()} WHERE id=${bedId}`,
        );
      }
```

- [ ] **Step 3: `student-move-out`**

```ts
// Before
      if (body.assignmentId) {
        const assignment = await db
          .select()
          .from(accommodationAssignments)
          .where(eq(accommodationAssignments.id, asNumber(body.assignmentId)))
          .get();
        await d1
          .prepare(
            "UPDATE accommodation_assignments SET status='ended', check_out_date=COALESCE(check_out_date, ?), check_out_meter=COALESCE(?, check_out_meter) WHERE id=?",
          )
          .bind(
            checkOut,
            asNullableNumber(body.checkOutMeter),
            asNumber(body.assignmentId),
          )
          .run();
        if (assignment?.bedSpaceId)
          await d1
            .prepare(
              "UPDATE bed_spaces SET status='vacant', updated_at=? WHERE id=?",
            )
            .bind(nowIso(), assignment.bedSpaceId)
            .run();
      }
```

```ts
// After
      if (body.assignmentId) {
        const assignment = (
          await db
            .select()
            .from(accommodationAssignments)
            .where(eq(accommodationAssignments.id, asNumber(body.assignmentId)))
        )[0];
        await db.execute(
          sql`UPDATE accommodation_assignments SET status='ended', check_out_date=COALESCE(check_out_date, ${checkOut}), check_out_meter=COALESCE(${asNullableNumber(body.checkOutMeter)}, check_out_meter) WHERE id=${asNumber(body.assignmentId)}`,
        );
        if (assignment?.bedSpaceId)
          await db.execute(
            sql`UPDATE bed_spaces SET status='vacant', updated_at=${nowIso()} WHERE id=${assignment.bedSpaceId}`,
          );
      }
```

Then apply the same `runBatches` conversion shown in Step 1 to `student-move-out`'s own (separate, further down) parking-rental cleanup block — it has the identical shape.

- [ ] **Step 4: `student-room-change`**

```ts
// Before
      const old = await db
        .select()
        .from(accommodationAssignments)
        .where(eq(accommodationAssignments.id, oldAssignmentId))
        .get();
      if (!old) throw new Error("Current assignment not found");
      const key = `move:${studentId}:${Date.now()}`;
      await d1.batch([
        d1
          .prepare(
            "UPDATE accommodation_assignments SET status='moved', check_out_date=?, check_out_meter=? WHERE id=?",
          )
          .bind(
            asText(body.effectiveDate),
            asNullableNumber(body.checkOutMeter),
            oldAssignmentId,
          ),
        d1
          .prepare(
            "UPDATE bed_spaces SET status='vacant', updated_at=? WHERE id=?",
          )
          .bind(nowIso(), old.bedSpaceId),
        d1
          .prepare(
            "INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, check_in_meter, remarks, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')",
          )
          .bind(
            key,
            studentId,
            bedId,
            asNullableNumber(body.monthlyRental),
            asNullableNumber(body.securityDeposit),
            asNullableNumber(body.accessCardDeposit),
            asText(body.salesperson),
            asText(body.effectiveDate),
            asText(body.effectiveDate),
            asNullableText(body.leaseEndDate),
            asNullableNumber(body.checkInMeter),
            asText(body.reason),
          ),
        d1
          .prepare(
            "UPDATE bed_spaces SET status='occupied', updated_at=? WHERE id=?",
          )
          .bind(nowIso(), bedId),
      ]);
```

```ts
// After
      const old = (
        await db
          .select()
          .from(accommodationAssignments)
          .where(eq(accommodationAssignments.id, oldAssignmentId))
      )[0];
      if (!old) throw new Error("Current assignment not found");
      const key = `move:${studentId}:${Date.now()}`;
      const changeNow = nowIso();
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE accommodation_assignments SET status='moved', check_out_date=${asText(body.effectiveDate)}, check_out_meter=${asNullableNumber(body.checkOutMeter)} WHERE id=${oldAssignmentId}`,
        );
        await tx.execute(
          sql`UPDATE bed_spaces SET status='vacant', updated_at=${changeNow} WHERE id=${old.bedSpaceId}`,
        );
        await tx.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, check_in_meter, remarks, status)
          VALUES (${key}, ${studentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asText(body.salesperson)}, ${asText(body.effectiveDate)}, ${asText(body.effectiveDate)}, ${asNullableText(body.leaseEndDate)}, ${asNullableNumber(body.checkInMeter)}, ${asText(body.reason)}, 'active')
        `);
        await tx.execute(
          sql`UPDATE bed_spaces SET status='occupied', updated_at=${changeNow} WHERE id=${bedId}`,
        );
      });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for the student handlers.

- [ ] **Step 6: Live test — students**

1. Student Information → Add student (with a room) → confirm the new profile and assignment appear, and the bed flips to `occupied`.
2. Move the student out → confirm assignment status becomes `ended`, bed flips back to `vacant`.
3. Create another student with a room, then use "Change room" → confirm old bed frees, new bed occupies, a new assignment row exists.
Clean up all test data (students, assignments) and restore bed statuses, exactly as done for earlier features in this project.

- [ ] **Step 7: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert student action handlers to Postgres"
```

---

### Task 12: Maintenance action handlers (includes the one semantic fix)

**Files:**
- Modify action handlers: `ticket-create`, `meter-reading-bulk`

- [ ] **Step 1: `ticket-create`**

```ts
// Before
        if (localDay > 20) {
          const outstanding = await d1
            .prepare(
              "SELECT COALESCE(SUM(total_amount - amount_paid),0) amount FROM billing_invoices WHERE student_id=? AND status IN ('unpaid','partial')",
            )
            .bind(currentUser.studentId)
            .first<{ amount: number }>();
          if (Number(outstanding?.amount || 0) > 0)
```

```ts
// After
        if (localDay > 20) {
          const outstanding = (
            await db.execute<{ amount: number }>(
              sql`SELECT COALESCE(SUM(total_amount - amount_paid),0) amount FROM billing_invoices WHERE student_id=${currentUser.studentId} AND status IN ('unpaid','partial')`,
            )
          )[0];
          if (Number(outstanding?.amount || 0) > 0)
```

- [ ] **Step 2: `meter-reading-bulk` — apply the GROUP BY fix (rule R9)**

```ts
// Before
      for (const row of rows) {
        const code = asText(row.roomCode).toLowerCase();
        const match = await d1
          .prepare(
            `
          SELECT r.id room_id, MIN(b.id) bed_id FROM hostel_rooms r
          JOIN hostel_units u ON r.unit_id=u.id JOIN bed_spaces b ON b.room_id=r.id
          WHERE lower(u.unit_code || '-' || r.room_label)=? OR lower(b.legacy_code)=?
        `,
          )
          .bind(code, code)
          .first<{ room_id: number; bed_id: number }>();
        if (!match) continue;
```

```ts
// After
      for (const row of rows) {
        const code = asText(row.roomCode).toLowerCase();
        const match = (
          await db.execute<{ room_id: number; bed_id: number }>(sql`
          SELECT r.id room_id, MIN(b.id) bed_id FROM hostel_rooms r
          JOIN hostel_units u ON r.unit_id=u.id JOIN bed_spaces b ON b.room_id=r.id
          WHERE lower(u.unit_code || '-' || r.room_label)=${code} OR lower(b.legacy_code)=${code}
          GROUP BY r.id
        `)
        )[0];
        if (!match) continue;
```

The `GROUP BY r.id` is the only line added beyond dialect translation — without it, Postgres rejects the query with `column "r.id" must appear in the GROUP BY clause or be used in an aggregate function` (SQLite silently tolerates the same query; Postgres does not). This is the one place in the whole file where SQLite's looser aggregate rules mask a query that Postgres considers genuinely invalid.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors for the maintenance handlers.

- [ ] **Step 4: Live test — maintenance**

1. Submit a maintenance ticket via the UI → confirm it appears in the Maintenance module.
2. Use "Download CSV template" from the meter readings tab, fill in one row with a real room code, upload it via "Upload updated CSV" → confirm a new meter reading appears with the correct `room_id`/`bed_space_id` resolved (this specifically exercises the `GROUP BY` fix — if it's missing, this step will fail with a 500 and a Postgres error visible in `preview_logs`, not a silent wrong result, so the test is self-verifying).
Clean up the test ticket and meter reading.

- [ ] **Step 5: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert maintenance handlers to Postgres, fix GROUP BY for meter lookup"
```

---

### Task 13: Finance/billing action handlers (the largest single handler)

**Files:**
- Modify action handlers: `billing-cycle`, `billing-item-adjust`, `billing-adjust-approve`

- [ ] **Step 1: `billing-cycle`**

```ts
// Before
    } else if (action === "billing-cycle") {
      if (!asText(body.periodLabel) || !body.cutoffDate || !body.dueDate)
        throw new Error(
          "Billing month, cut-off date and due date are required",
        );
      const cycle = await d1
        .prepare(
          "INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status) VALUES (?, ?, ?, 'draft') ON CONFLICT(period_label) DO UPDATE SET cutoff_date=excluded.cutoff_date, due_date=excluded.due_date RETURNING id",
        )
        .bind(
          asText(body.periodLabel),
          asText(body.cutoffDate),
          asText(body.dueDate),
        )
        .first<{ id: number }>();
      if (!cycle) throw new Error("Unable to create billing cycle");
      createdId = cycle.id;
      const active = await d1
        .prepare(
          "SELECT a.id assignment_id, a.student_id, a.monthly_rental, a.bed_space_id, r.id room_id, h.electricity_rate FROM accommodation_assignments a JOIN bed_spaces b ON a.bed_space_id=b.id JOIN hostel_rooms r ON b.room_id=r.id JOIN hostel_units u ON r.unit_id=u.id JOIN hostel_properties h ON u.hostel_id=h.id WHERE a.status='active'",
        )
        .all<{
          assignment_id: number;
          student_id: number;
          monthly_rental: number | null;
          bed_space_id: number;
          room_id: number;
          electricity_rate: number;
        }>();
      for (const assignment of active.results) {
        const existing = await d1
          .prepare(
            "SELECT id FROM billing_invoices WHERE cycle_id=? AND student_id=?",
          )
          .bind(cycle.id, assignment.student_id)
          .first<{ id: number }>();
        if (existing) continue;
        const rateChange = await d1
          .prepare(
            "SELECT monthly_rental FROM student_rate_changes WHERE assignment_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1",
          )
          .bind(assignment.assignment_id, asText(body.cutoffDate))
          .first<{ monthly_rental: number | null }>();
        const rent = Number(
          rateChange?.monthly_rental ?? assignment.monthly_rental ?? 0,
        );
        const electricity = await electricityShareForAssignment(
          assignment.assignment_id,
          assignment.room_id,
          asText(body.cutoffDate),
          Number(assignment.electricity_rate || 0),
        );
        const parking = await d1
          .prepare(
            "SELECT COALESCE(SUM(monthly_rental),0) amount FROM parking_rentals WHERE student_id=? AND status='active'",
          )
          .bind(assignment.student_id)
          .first<{ amount: number }>();
        const extra = await d1
          .prepare(
            "SELECT COALESCE(SUM(student_charge),0) amount FROM maintenance_tickets WHERE student_id=? AND student_charge>0 AND status IN ('completed','closed')",
          )
          .bind(assignment.student_id)
          .first<{ amount: number }>();
        const previousInvoice = await d1
          .prepare(
            `
          SELECT total_amount, amount_paid FROM billing_invoices
          WHERE student_id=? ORDER BY id DESC LIMIT 1
        `,
          )
          .bind(assignment.student_id)
          .first<{ total_amount: number; amount_paid: number }>();
        const carryForward = previousInvoice
          ? Math.min(
              0,
              Number(previousInvoice.total_amount || 0) -
                Number(previousInvoice.amount_paid || 0),
            )
          : 0;
        const total =
          rent +
          electricity.amount +
          Number(parking?.amount || 0) +
          Number(extra?.amount || 0) +
          carryForward;
        const invoice = await d1
          .prepare(
            "INSERT INTO billing_invoices (invoice_no, cycle_id, student_id, assignment_id, due_date, status, total_amount, amount_paid, invoice_frequency) VALUES (?, ?, ?, ?, ?, 'unpaid', ?, 0, ?) RETURNING id",
          )
          .bind(
            `INV-${cycle.id}-${assignment.student_id}`,
            cycle.id,
            assignment.student_id,
            assignment.assignment_id,
            asText(body.dueDate),
            total,
            asText(body.invoiceFrequency, "on-request"),
          )
          .first<{ id: number }>();
        if (invoice) {
          const items = [
            ["room-rental", "Room rental", 1, rent, rent],
            [
              "electricity",
              `Electricity usage (${electricity.usage.toFixed(2)} kWh)`,
              electricity.usage,
              Number(assignment.electricity_rate || 0),
              electricity.amount,
            ],
            [
              "parking",
              "Parking rental",
              1,
              Number(parking?.amount || 0),
              Number(parking?.amount || 0),
            ],
            [
              "other",
              "Additional / penalty charges",
              1,
              Number(extra?.amount || 0),
              Number(extra?.amount || 0),
            ],
            [
              "carry-forward",
              "Previous excess payment carried forward",
              1,
              carryForward,
              carryForward,
            ],
          ].filter((item) => Number(item[4]) !== 0);
          await runBatches(
            items.map((item) =>
              d1
                .prepare(
                  "INSERT INTO billing_items (invoice_id, item_type, description, quantity, rate, amount) VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(invoice.id, ...item),
            ),
          );
        }
      }
```

```ts
// After
    } else if (action === "billing-cycle") {
      if (!asText(body.periodLabel) || !body.cutoffDate || !body.dueDate)
        throw new Error(
          "Billing month, cut-off date and due date are required",
        );
      const cycle = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status)
          VALUES (${asText(body.periodLabel)}, ${asText(body.cutoffDate)}, ${asText(body.dueDate)}, 'draft')
          ON CONFLICT(period_label) DO UPDATE SET cutoff_date=excluded.cutoff_date, due_date=excluded.due_date
          RETURNING id
        `)
      )[0];
      if (!cycle) throw new Error("Unable to create billing cycle");
      createdId = cycle.id;
      const active = await db.execute<{
        assignment_id: number;
        student_id: number;
        monthly_rental: number | null;
        bed_space_id: number;
        room_id: number;
        electricity_rate: number;
      }>(sql`
        SELECT a.id assignment_id, a.student_id, a.monthly_rental, a.bed_space_id, r.id room_id, h.electricity_rate
        FROM accommodation_assignments a
        JOIN bed_spaces b ON a.bed_space_id=b.id
        JOIN hostel_rooms r ON b.room_id=r.id
        JOIN hostel_units u ON r.unit_id=u.id
        JOIN hostel_properties h ON u.hostel_id=h.id
        WHERE a.status='active'
      `);
      for (const assignment of active) {
        const existing = (
          await db.execute<{ id: number }>(
            sql`SELECT id FROM billing_invoices WHERE cycle_id=${cycle.id} AND student_id=${assignment.student_id}`,
          )
        )[0];
        if (existing) continue;
        const rateChange = (
          await db.execute<{ monthly_rental: number | null }>(
            sql`SELECT monthly_rental FROM student_rate_changes WHERE assignment_id=${assignment.assignment_id} AND effective_date<=${asText(body.cutoffDate)} ORDER BY effective_date DESC LIMIT 1`,
          )
        )[0];
        const rent = Number(
          rateChange?.monthly_rental ?? assignment.monthly_rental ?? 0,
        );
        const electricity = await electricityShareForAssignment(
          assignment.assignment_id,
          assignment.room_id,
          asText(body.cutoffDate),
          Number(assignment.electricity_rate || 0),
        );
        const parking = (
          await db.execute<{ amount: number }>(
            sql`SELECT COALESCE(SUM(monthly_rental),0) amount FROM parking_rentals WHERE student_id=${assignment.student_id} AND status='active'`,
          )
        )[0];
        const extra = (
          await db.execute<{ amount: number }>(
            sql`SELECT COALESCE(SUM(student_charge),0) amount FROM maintenance_tickets WHERE student_id=${assignment.student_id} AND student_charge>0 AND status IN ('completed','closed')`,
          )
        )[0];
        const previousInvoice = (
          await db.execute<{ total_amount: number; amount_paid: number }>(
            sql`SELECT total_amount, amount_paid FROM billing_invoices WHERE student_id=${assignment.student_id} ORDER BY id DESC LIMIT 1`,
          )
        )[0];
        const carryForward = previousInvoice
          ? Math.min(
              0,
              Number(previousInvoice.total_amount || 0) -
                Number(previousInvoice.amount_paid || 0),
            )
          : 0;
        const total =
          rent +
          electricity.amount +
          Number(parking?.amount || 0) +
          Number(extra?.amount || 0) +
          carryForward;
        const invoice = (
          await db.execute<{ id: number }>(sql`
            INSERT INTO billing_invoices (invoice_no, cycle_id, student_id, assignment_id, due_date, status, total_amount, amount_paid, invoice_frequency)
            VALUES (${`INV-${cycle.id}-${assignment.student_id}`}, ${cycle.id}, ${assignment.student_id}, ${assignment.assignment_id}, ${asText(body.dueDate)}, 'unpaid', ${total}, 0, ${asText(body.invoiceFrequency, "on-request")})
            RETURNING id
          `)
        )[0];
        if (invoice) {
          const items: [string, string, number, number, number][] = [
            ["room-rental", "Room rental", 1, rent, rent],
            [
              "electricity",
              `Electricity usage (${electricity.usage.toFixed(2)} kWh)`,
              electricity.usage,
              Number(assignment.electricity_rate || 0),
              electricity.amount,
            ],
            [
              "parking",
              "Parking rental",
              1,
              Number(parking?.amount || 0),
              Number(parking?.amount || 0),
            ],
            [
              "other",
              "Additional / penalty charges",
              1,
              Number(extra?.amount || 0),
              Number(extra?.amount || 0),
            ],
            [
              "carry-forward",
              "Previous excess payment carried forward",
              1,
              carryForward,
              carryForward,
            ],
          ].filter((item) => Number(item[4]) !== 0);
          await runBatches(items, ([itemType, description, quantity, rate, amount], tx) =>
            tx.execute(
              sql`INSERT INTO billing_items (invoice_id, item_type, description, quantity, rate, amount) VALUES (${invoice.id}, ${itemType}, ${description}, ${quantity}, ${rate}, ${amount})`,
            ),
          );
        }
      }
```

- [ ] **Step 2: `billing-item-adjust` and `billing-adjust-approve`**

```ts
// Before (billing-item-adjust, tail)
      if (item.itemType !== "electricity") {
        await db
          .update(billingItems)
          .set({ amount: newAmount, rate: newAmount })
          .where(eq(billingItems.id, itemId));
        await d1
          .prepare(
            "UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=?) WHERE id=?",
          )
          .bind(item.invoiceId, item.invoiceId)
          .run();
      }
    } else if (action === "billing-adjust-approve") {
      const adjustmentId = asNumber(body.adjustmentId);
      const adjustment = await db
        .select()
        .from(billingItemAdjustments)
        .where(eq(billingItemAdjustments.id, adjustmentId))
        .get();
      if (!adjustment) throw new Error("Adjustment request not found");
      const item = await db
        .select()
        .from(billingItems)
        .where(eq(billingItems.id, adjustment.billingItemId))
        .get();
      if (!item) throw new Error("Billing item not found");
      // Electricity fees always carry up to the next whole ringgit.
      const appliedAmount =
        item.itemType === "electricity"
          ? Math.ceil(adjustment.newAmount)
          : adjustment.newAmount;
      await db
        .update(billingItems)
        .set({ amount: appliedAmount, rate: appliedAmount })
        .where(eq(billingItems.id, item.id));
      await db
        .update(billingItemAdjustments)
        .set({
          approvalStatus: "approved",
          approvedBy: currentUser.displayName,
          approvedAt: nowIso(),
        })
        .where(eq(billingItemAdjustments.id, adjustmentId));
      await d1
        .prepare(
          "UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=?) WHERE id=?",
        )
        .bind(item.invoiceId, item.invoiceId)
        .run();
```

```ts
// After (billing-item-adjust, tail)
      if (item.itemType !== "electricity") {
        await db
          .update(billingItems)
          .set({ amount: newAmount, rate: newAmount })
          .where(eq(billingItems.id, itemId));
        await db.execute(
          sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${item.invoiceId}) WHERE id=${item.invoiceId}`,
        );
      }
    } else if (action === "billing-adjust-approve") {
      const adjustmentId = asNumber(body.adjustmentId);
      const adjustment = (
        await db
          .select()
          .from(billingItemAdjustments)
          .where(eq(billingItemAdjustments.id, adjustmentId))
      )[0];
      if (!adjustment) throw new Error("Adjustment request not found");
      const item = (
        await db.select().from(billingItems).where(eq(billingItems.id, adjustment.billingItemId))
      )[0];
      if (!item) throw new Error("Billing item not found");
      // Electricity fees always carry up to the next whole ringgit.
      const appliedAmount =
        item.itemType === "electricity"
          ? Math.ceil(adjustment.newAmount)
          : adjustment.newAmount;
      await db
        .update(billingItems)
        .set({ amount: appliedAmount, rate: appliedAmount })
        .where(eq(billingItems.id, item.id));
      await db
        .update(billingItemAdjustments)
        .set({
          approvalStatus: "approved",
          approvedBy: currentUser.displayName,
          approvedAt: nowIso(),
        })
        .where(eq(billingItemAdjustments.id, adjustmentId));
      await db.execute(
        sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${item.invoiceId}) WHERE id=${item.invoiceId}`,
      );
```

Also fix `billing-item-adjust`'s own earlier `.get()` at its top (`const item = await db.select().from(billingItems).where(eq(billingItems.id, itemId)).get();`) using rule R2, same pattern as above.

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: **zero errors from all three.** If `tsc` reports any remaining error anywhere in `app/api/system/route.ts` at this point, it means a call site was missed somewhere in Tasks 6-13 — search for it with `grep -n "getD1\|\.get()\|d1\." app/api/system/route.ts` and fix it before proceeding; do not skip this check.

- [ ] **Step 4: Live test — billing cycle (the highest-value test in this whole plan)**

This is the most complex handler in the app — it reads across 6+ tables per active tenancy and writes invoices + line items. Test with real data:
1. Note the current `billing_cycles`/`billing_invoices`/`billing_items` row counts in Supabase (`SELECT COUNT(*) FROM billing_invoices;` etc.).
2. Prepare/post a new billing cycle via the Finance UI for a period that hasn't been billed yet (or reuse a test period label).
3. Confirm invoices were created for every active assignment, with room rental + electricity + parking + outstanding-ticket charges lining up with what's shown elsewhere in the app for a couple of spot-checked students.
4. Delete the test cycle's invoices/items/cycle row directly via SQL to restore the original row counts (there's no "delete billing cycle" UI action in this app, matching the pattern from earlier in this project's session where test billing data was cleaned up manually).

- [ ] **Step 5: Commit**

```bash
git add app/api/system/route.ts
git commit -m "db: convert billing-cycle and billing-adjustment handlers to Postgres"
```

---

### Task 14: Migration baseline for future schema changes

**Files:**
- Create: `drizzle/pg/` (generated)

- [ ] **Step 1: Generate a baseline migration from the new schema**

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .dev.vars | cut -d= -f2-)" npm run db:generate
```

Expected: a new file under `drizzle/pg/0000_<name>.sql` containing `CREATE TABLE` statements matching `db/schema.ts`.

- [ ] **Step 2: Do NOT apply it — the tables already exist**

The Supabase database already has this exact schema (created by the earlier data-migration export). Do not run `drizzle-kit migrate` or `drizzle-kit push` against the live database — that would try to re-create existing tables and fail (or, worse, if it succeeds partially, could conflict with existing data). This generated migration file exists purely as the starting point for the *next* schema change (e.g. adding a column later) — `drizzle-kit` needs a baseline to diff against.

- [ ] **Step 3: Commit the baseline migration as historical record**

```bash
git add drizzle/pg/
git commit -m "db: add Postgres migration baseline (schema already applied to Supabase manually)"
```

---

### Task 15: Full end-to-end verification pass

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three pass with zero errors.

- [ ] **Step 2: Confirm zero remaining D1 references in application code**

```bash
grep -rn "getD1\|D1Database\|D1PreparedStatement\|\.get();" app/ db/ --include=*.ts
```
Expected: no matches (D1 references may still legitimately appear in `wrangler.json` and `worker/index.ts`'s `Env` interface — those are fine to leave per the Global Constraints; this check is specifically for `app/` and `db/`).

- [ ] **Step 3: Walk every module against live Supabase data**

Using a temporary test account (create one, verify, delete it — same pattern used throughout this project's session), sign in and exercise every module at least once:
- **Dashboard** — loads with correct totals (compare a couple of numbers against a direct `SELECT COUNT(*)`/`SUM(...)` on Supabase).
- **Hostel Information** — availability search, filters, a reservation create → convert cycle (already tested in Task 10, just re-confirm it still works after Task 13's changes).
- **Unit Information** — open a unit, edit owner details, add/remove a Wi-Fi service.
- **Student Information** — already tested in Task 11; spot check the list/search/filter views load.
- **Parking** — add a lot, add a rental, edit it, delete it.
- **Maintenance** — already tested in Task 12; spot check ticket list/filter and the costing tab.
- **Finance** — already tested in Task 13; spot check invoice list, record a payment, verify a payment.
- **Announcements** — post one, confirm it appears, delete it.
- **Reports** — open each report tab, confirm data loads and CSV export works.
- **User Management** — Users tab loads, Roles tab loads and permission toggles save, Reminders tab loads and saves.
- **Login/logout** — sign out, sign back in with the real admin account, confirm session persists across a page reload.

For every piece of test data created during this pass, delete it afterward and confirm row counts return to their pre-test baseline (`SELECT COUNT(*) FROM <table>` before and after, matching the verification discipline used throughout this project's session).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "db: complete Supabase database-layer switch, verified end-to-end"
```

---

## Self-review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-07-30-supabase-connection-design.md` is covered — driver/connection (Task 1), schema (Task 3), query-site rewrite (Tasks 6-13), migration baseline (Task 14), verification plan (Task 15), rollback safety (Global Constraints — D1 untouched throughout).

**Placeholder scan:** No TBD/TODO. Every step shows real before/after code taken directly from the current file (verified by direct reads during planning, not reconstructed from memory) or, where a step is a mechanical repeat of an already-fully-shown pattern (e.g. the second `runBatches` call in `student-move-out`'s parking cleanup), the plan says exactly which earlier step's pattern to apply and to what code, not "similar to above" without specifics.

**Type consistency:** `runBatches<T>(items: T[], build: (item: T, tx: PgTransaction) => Promise<unknown>)` — this exact signature is used identically at every one of its 9 call sites across Tasks 6-13. `db.execute<T>(sql...)` resolving to `T[]` directly (no `.rows`/`.results` wrapper) is used consistently throughout, matching the verified `PostgresJsQueryResultHKT` type from the installed driver.

**Scope check:** This is one atomic unit of work — the schema and query layer must convert together (a partially-converted app doesn't run), so it isn't decomposed into independent sub-plans, per the design spec's own reasoning.
