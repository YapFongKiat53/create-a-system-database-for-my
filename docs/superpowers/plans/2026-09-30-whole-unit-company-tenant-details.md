# Whole-Unit Company Details & Up-Front Tenant List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a whole-unit ("group") reservation be booked under a company/agency (with proper organisation fields), record who bears the TNB/Air Selangor bill, and let staff name some or all of the actual occupants up front when creating the booking, instead of only one room at a time afterward.

**Design spec (authoritative — read it first):** `docs/superpowers/specs/2026-09-30-whole-unit-company-tenant-details-design.md`

**Architecture:** No new reservation type — everything here is additive to the existing whole-unit ("group") reservation flow built in `docs/superpowers/plans/2026-09-28-whole-unit-reservation.md`. `reservations` gains five columns (organisation details + a utility-billed-to label) and a new child table, `reservation_group_tenants`, holding an optional, ordered, partially-or-fully-filled tenant list while the booking is still `reserved`. Confirming the unit consumes that list: a room with a filled slot is claimed immediately (a real tenant, exactly as if claimed through Manage right after confirming); a room with no matching slot stays `pending-occupant`, unchanged from before. `student_profiles` gains one column, `is_student`, settable both from the up-front list and from the existing per-room claim form.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (real dev DB via `DATABASE_URL`), no test framework — every task verifies with `npx tsc --noEmit`, `npx eslint <files>`, and live checks against the dev DB with synthetic `ZZTEST` fixtures cleaned up after.

## Global Constraints

- No git commits during implementation. No `rm -rf` on any directory (`.claude-scratch/` is git-tracked; delete only files you created there).
- Every DB check runs against the real dev database (`DATABASE_URL`) — use synthetic `ZZTEST`-prefixed rows and delete them when a task's verification is done, even if a later step in the same task fails partway.
- Source env before any script: `set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a`.
- Migration workflow (same as every prior schema change this project): edit `db/schema.ts` → `npm run db:generate` (produces a tracked `drizzle/pg/00XX_*.sql`, drift-only) → hand-write a temporary idempotent `ALTER/CREATE ... IF NOT EXISTS`-style script in `.claude-scratch/`, run it once with `node` against the real `DATABASE_URL`, confirm with a query, then delete the script. There is no `db:migrate` script.
- `app/api/system/route.ts` and `app/modules/HostelInformation.tsx` are both single very large files. Every task below anchors its edits with an exact quoted snippet of the *current* file (verified while writing this plan) — re-read the surrounding code before editing in case an earlier task in this plan already shifted it.
- Known pre-existing eslint baseline: two warnings in `app/api/system/route.ts` (`TURNOVER_OPEN_STATUSES`, `invoiceFrequency` unused) and eleven in `app/modules/HostelInformation.tsx` (unused locals/hook-dependency warnings already present before this plan). No other warnings are acceptable in files this plan touches — confirm the exact count is unchanged, not just "still warnings only".
- There is a REAL reservation in the dev database today with `representative_type = 'institute'`: id `63`, reference `RSV-670839117`, `student_name = 'a'`, `status = 'converted'`. Task 5's verification uses this exact row — read it, do not modify its stored `representative_type` (editing and saving it without touching the booking-type dropdown must leave it as `'institute'`, per the spec's Decisions section).
- Existing baseline behaviour that must not regress in any task: an individual (non-group) reservation's create/edit/convert/payment flow, and a whole-unit booking created with **zero** tenant-slot entries filled in (must behave exactly as the previous plan left it — every room `pending-occupant`, claimable later through Manage).

---

### Task 1: Schema — organisation fields, `reservation_group_tenants`, `student_profiles.is_student`

**Files:**
- Modify: `db/schema.ts`
- Create (generated, tracked): `drizzle/pg/00XX_*.sql`
- Temp: a script in `.claude-scratch/` (delete after)

**Interfaces:**
- Produces: five new nullable-or-defaulted columns on `reservations`; a new `reservationGroupTenants` table; `studentProfiles.isStudent` (boolean, default true). Every later task in this plan depends on all three.

- [ ] **Step 1: Add five columns to `reservations`**

In `db/schema.ts`, find:

```ts
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
  // Whole-unit bookings only: the agreed total monthly rent for the whole
  // unit (defaults to the sum of its rooms' rates, editable by staff for a
  // negotiated block price). Null for an individual booking.
  wholeUnitMonthlyRent: doublePrecision("whole_unit_monthly_rent"),
  // Soft-cancel: status becomes "cancelled" and this is stamped, but the
  // row (and its payments/charges) stays — unlike reservation-delete, which
  // hard-deletes everything. Kept for accounting history and audit trail.
  cancelledAt: text("cancelled_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
```

Replace with:

```ts
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
  // Whole-unit bookings only: the agreed total monthly rent for the whole
  // unit (defaults to the sum of its rooms' rates, editable by staff for a
  // negotiated block price). Null for an individual booking.
  wholeUnitMonthlyRent: doublePrecision("whole_unit_monthly_rent"),
  // Agency/Company whole-unit bookings only — blank for an individual
  // booking or an Individual-type group. The existing studentName/
  // identityNo/contactNumber/email fields stay the company's own contact
  // person; these four describe the organisation itself.
  organisationName: text("organisation_name").notNull().default(""),
  companyRegistrationNo: text("company_registration_no").notNull().default(""),
  organisationAddress: text("organisation_address").notNull().default(""),
  companyEmail: text("company_email").notNull().default(""),
  // "company" | "tenant" — who the TNB/Air Selangor bill goes to. A label
  // for staff only; it does not change how electricity is actually billed.
  utilityBilledTo: text("utility_billed_to").notNull().default("tenant"),
  // Soft-cancel: status becomes "cancelled" and this is stamped, but the
  // row (and its payments/charges) stays — unlike reservation-delete, which
  // hard-deletes everything. Kept for accounting history and audit trail.
  cancelledAt: text("cancelled_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
```

- [ ] **Step 2: Add `reservation_group_tenants`**

Add this new table definition immediately after the `reservations` table closes (right after the `});` shown above):

```ts
// The up-front, optional tenant list a whole-unit booking can be created
// with — see docs/superpowers/specs/2026-09-30-whole-unit-company-tenant-
// details-design.md. Only ever holds rows for slots staff actually filled
// in (a blank slot is never inserted at all), and only while the booking is
// still "reserved" — confirming the unit consumes these rows into real
// accommodation_assignments/student_profiles rows and deletes them.
export const reservationGroupTenants = pgTable("reservation_group_tenants", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  // Position among the unit's rooms at the time this was saved (0-based) —
  // used only to match a slot to a bed when confirming. Can have gaps
  // (e.g. only slots 0 and 2 filled), since a blank slot is never stored.
  slotIndex: bigint("slot_index", { mode: "number" }).notNull(),
  fullName: text("full_name").notNull().default(""),
  identityNo: text("identity_no").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  gender: text("gender").notNull().default("unspecified"),
  isStudent: boolean("is_student").notNull().default(true),
  isPayer: boolean("is_payer").notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
```

- [ ] **Step 3: Add `is_student` to `student_profiles`**

Find, in `studentProfiles`:

```ts
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
```

(This exact four-line sequence is unique to `studentProfiles` — confirm before editing, since `status`/`createdAt` alone appear in many tables.) Replace with:

```ts
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  // Not read anywhere outside the whole-unit booking flow yet (the
  // creation-time tenant list and the per-room claim form) — every
  // existing row defaults to true, the overwhelming majority case, so
  // nothing else in the app changes behaviour.
  isStudent: boolean("is_student").notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
```

- [ ] **Step 4: Generate and apply the migration**

```bash
npm run db:generate
```

Produces `drizzle/pg/00XX_<name>.sql` (next number after `0028`). Read it to confirm it contains: five `ALTER TABLE "reservations" ADD COLUMN ...` statements, one `CREATE TABLE "reservation_group_tenants" (...)` with its FK to `reservations`, and one `ALTER TABLE "student_profiles" ADD COLUMN "is_student" boolean NOT NULL DEFAULT true`.

Write a temporary `.claude-scratch/wu2_apply.mjs` (using the `postgres` package, `postgres(process.env.DATABASE_URL, { prepare: false })`) that runs, idempotently:

```sql
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS organisation_name text NOT NULL DEFAULT '';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS company_registration_no text NOT NULL DEFAULT '';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS organisation_address text NOT NULL DEFAULT '';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS company_email text NOT NULL DEFAULT '';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS utility_billed_to text NOT NULL DEFAULT 'tenant';
CREATE TABLE IF NOT EXISTS reservation_group_tenants (
  id bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  reservation_id bigint NOT NULL REFERENCES reservations(id),
  slot_index bigint NOT NULL,
  full_name text NOT NULL DEFAULT '',
  identity_no text NOT NULL DEFAULT '',
  contact_number text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT 'unspecified',
  is_student boolean NOT NULL DEFAULT true,
  is_payer boolean NOT NULL DEFAULT false,
  created_at text NOT NULL DEFAULT (CURRENT_TIMESTAMP)::text
);
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS is_student boolean NOT NULL DEFAULT true;
```

Run it with `node .claude-scratch/wu2_apply.mjs`. Confirm with queries against `information_schema.columns` for each new column and `information_schema.tables` for `reservation_group_tenants`. Delete the script.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

---

### Task 2: Server — save the new reservation fields and the tenant list

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 1's five new `reservations` columns and `reservation_group_tenants` table.
- Produces: `POST /api/system {action: "reservation"|"reservation-update", ..., organisationName, companyRegistrationNo, organisationAddress, companyEmail, utilityBilledTo, groupTenants}` persists all six; `groupTenants` (a JSON array in the body, one entry per slot, blank or not) replaces this reservation's `reservation_group_tenants` rows, dropping blank entries. `reservation-delete` also cleans up any leftover rows for a still-`reserved` booking being deleted.

- [ ] **Step 1: Add `reservationGroupTenants` to the schema import**

Find, near the top of the file:

```ts
  reservationCharges,
  reservationPayments,
  reservations,
```

Replace with:

```ts
  reservationCharges,
  reservationGroupTenants,
  reservationPayments,
  reservations,
```

- [ ] **Step 2: Add the five new fields to the shared `values` object**

Find, inside the `action === "reservation" || action === "reservation-update"` branch:

```ts
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        // Whole-unit bookings only — null for an individual booking, exactly
        // as the client only ever sends it when reservationType is "group".
        wholeUnitMonthlyRent: asNullableNumber(body.wholeUnitMonthlyRent),
        notes: asText(body.notes),
      };
```

Replace with:

```ts
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        // Whole-unit bookings only — null for an individual booking, exactly
        // as the client only ever sends it when reservationType is "group".
        wholeUnitMonthlyRent: asNullableNumber(body.wholeUnitMonthlyRent),
        // Agency/Company whole-unit bookings only — blank string for every
        // other booking, exactly as the client only ever sends these when
        // representativeType is "company" (or the legacy "institute").
        organisationName: asText(body.organisationName),
        companyRegistrationNo: asText(body.companyRegistrationNo),
        organisationAddress: asText(body.organisationAddress),
        companyEmail: asText(body.companyEmail),
        utilityBilledTo: asText(body.utilityBilledTo, "tenant"),
        notes: asText(body.notes),
      };
```

- [ ] **Step 3: Add the `replaceReservationGroupTenants` helper**

Add this function immediately after `replaceReservationCharges` ends (find its closing `}` followed by two blank lines and the comment `// Records a payment for a specific set of still-unpaid reservation_charges` — insert between them):

```ts
// Mirrors replaceReservationCharges immediately above: delete-then-insert,
// called unconditionally from reservation/reservation-update (a no-op for
// an individual booking, which never sends body.groupTenants). Only a
// filled slot (a non-blank full name) is ever stored — see the design
// spec's Decisions section for why a blank slot must not create a row.
async function replaceReservationGroupTenants(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  raw: unknown,
) {
  const entries = Array.isArray(raw) ? raw : [];
  await db.execute(
    sql`DELETE FROM reservation_group_tenants WHERE reservation_id = ${reservationId}`,
  );
  const filled = entries
    .map((entry, index) => {
      const row = (entry && typeof entry === "object" ? entry : {}) as Record<
        string,
        unknown
      >;
      return {
        slotIndex: index,
        fullName: asText(row.fullName),
        identityNo: asText(row.identityNo),
        contactNumber: asText(row.contactNumber),
        gender: asText(row.gender, "unspecified"),
        isStudent: boolValue(row.isStudent),
        isPayer: boolValue(row.isPayer),
      };
    })
    .filter((row) => row.fullName);
  if (!filled.length) return;
  await runBatches(db, filled, (row, tx) =>
    tx.execute(sql`
      INSERT INTO reservation_group_tenants
        (reservation_id, slot_index, full_name, identity_no, contact_number, gender, is_student, is_payer)
      VALUES
        (${reservationId}, ${row.slotIndex}, ${row.fullName}, ${row.identityNo}, ${row.contactNumber}, ${row.gender}, ${row.isStudent}, ${row.isPayer})
    `),
  );
}
```

- [ ] **Step 4: Call it from `reservation`/`reservation-update`**

Find:

```ts
      const totalPayable = await replaceReservationCharges(
        db,
        reservationId,
        body.chargeBreakdown,
      );
```

Replace with:

```ts
      const totalPayable = await replaceReservationCharges(
        db,
        reservationId,
        body.chargeBreakdown,
      );
      await replaceReservationGroupTenants(db, reservationId, body.groupTenants);
```

- [ ] **Step 5: Clean up `reservation_group_tenants` on delete**

Find, in the `reservation-delete` branch's transaction:

```ts
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservations WHERE id = ${reservationId}`,
        );
      });
```

Replace with:

```ts
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_group_tenants WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservations WHERE id = ${reservationId}`,
        );
      });
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 7: Verify live**

Using a synthetic `ZZTEST` staff session (same technique as every prior task this project has used):
1. `POST` `action: "reservation"` for a `reservationType: "group"` booking with all five new fields set and `groupTenants: [{fullName:"ZZTEST Tenant A", identityNo:"1", contactNumber:"2", gender:"male", isStudent:true, isPayer:true}, {fullName:"", ...}, {fullName:"ZZTEST Tenant C", identityNo:"3", contactNumber:"4", gender:"female", isStudent:false, isPayer:false}]` (3 slots, middle one blank). Confirm the reservation row has all five fields, and `reservation_group_tenants` has exactly 2 rows with `slot_index` 0 and 2 (not 0 and 1), correct `is_payer`/`is_student` values.
2. `POST` `action: "reservation-update"` on the same reservation with a *different* `groupTenants` array (e.g. drop tenant C, add a new one) → confirm the old rows are gone and only the new set exists.
3. `POST` `action: "reservation-update"` with `groupTenants` omitted entirely → confirm existing rows are deleted (matches the "replace with what was submitted" semantics — omitting the array means "no tenants", not "leave alone"; note this explicitly in your report so the human can confirm it's the intended behaviour, since the spec doesn't explicitly call out this exact case).
4. `POST` `action: "reservation-delete"` on a fresh throwaway reservation that still has `reservation_group_tenants` rows and no payments/tenancy → confirm it deletes cleanly and the rows are gone.
5. Confirm an ordinary individual-booking `reservation`/`reservation-update` call (no `groupTenants` in the body) behaves exactly as before — no `reservation_group_tenants` rows ever created for it.
6. Clean up every fixture.

**Addendum (already applied by the controller after this task's own implementer finished — do not redo):** confirming this task's own "replace with what was submitted" semantics (step 3 above) surfaced a real gap: the GET payload never sent a reservation's saved `reservation_group_tenants` rows back to the client, so Task 6's edit form would have had no way to know what was already saved and would submit an empty array on any unrelated edit, silently deleting real tenant entries. Fixed directly in `app/api/system/route.ts`'s main (unscoped) GET handler: `groupTenantRows` added to the same `Promise.all` destructuring as `chargeRows` (query: `db.select().from(reservationGroupTenants).orderBy(asc(reservationGroupTenants.slotIndex))`), and `groupTenants: groupTenantRows.filter((row) => row.reservationId === reservation.id)` added to `reservationList`'s per-reservation mapping, right next to the existing `charges: chargeRows.filter(...)` line. Live-verified: a reservation with saved slots now returns them under `data.reservations[].groupTenants`, correctly scoped and ordered by `slotIndex`. Task 6 (below) already assumes this field exists — it does.

---

### Task 3: Server — `reservation-confirm-unit` auto-claims filled slots

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 2's `reservation_group_tenants` rows.
- Produces: confirming a unit claims a bed immediately (real `active` assignment + `student_profiles` row) when a slot at the matching position was filled in; otherwise the bed becomes `pending-occupant`, exactly as before this plan.

- [ ] **Step 1: Read the current handler in full**

Find `} else if (action === "reservation-confirm-unit") {` and re-read the whole branch — this plan was written against the file as it stood after the previous plan's fixes (row-locking, the disqualification checks). Nothing in Task 2 touches this branch, but re-check line numbers anyway.

- [ ] **Step 2: Look up the tenant slots inside the transaction**

Find, inside the transaction, right after the `disqualified` check and its `throw`:

```ts
        if (disqualified.length)
          throw new Error(
            `${disqualified[0].legacy_code || "A room"} in this unit is no longer available for this move-in date — refresh and pick again`,
          );
        for (const bed of lockedBeds) {
          await tx.execute(sql`
            INSERT INTO accommodation_assignments
              (source_key, student_id, bed_space_id, monthly_rental, status, check_in_date, agreement_start_date, source_reservation_id)
            VALUES
              (${`whole-unit:${reservationId}:${bed.id}`}, NULL, ${bed.id}, 0, 'pending-occupant', ${reservation.targetMoveInDate}, ${reservation.targetMoveInDate}, ${reservationId})
          `);
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'reserved', updated_at = ${now} WHERE id = ${bed.id}`,
          );
        }
      });
```

Replace with:

```ts
        if (disqualified.length)
          throw new Error(
            `${disqualified[0].legacy_code || "A room"} in this unit is no longer available for this move-in date — refresh and pick again`,
          );
        // Slots the reservation form's up-front tenant list saved, if any.
        // Only filled slots are ever stored, so slot_index can have gaps —
        // looked up by that value, never by array position.
        const tenantSlots = await tx.execute<{
          slot_index: number;
          full_name: string;
          identity_no: string;
          contact_number: string;
          gender: string;
          is_student: boolean;
          is_payer: boolean;
        }>(sql`
          SELECT slot_index, full_name, identity_no, contact_number, gender, is_student, is_payer
          FROM reservation_group_tenants
          WHERE reservation_id = ${reservationId}
          ORDER BY slot_index
        `);
        const tenantBySlot = new Map(
          tenantSlots.map((row) => [Number(row.slot_index), row]),
        );
        // Same guard whole-unit-claim already has: any filled slot always
        // resolves to exactly one payer below (explicit, or the first
        // filled one by default) — without this, confirming with tenant
        // slots but no rent set would silently create that payer at
        // NULL/0, the same "nobody actually pays" footgun the claim
        // action already rejects.
        if (tenantSlots.length && !((resolvedRent ?? 0) > 0))
          throw new Error(
            "Set the whole-unit rent on this booking before confirming it with tenants filled in",
          );
        const anyPayerMarked = tenantSlots.some((row) => row.is_payer);
        let payerAssigned = false;
        for (const [i, bed] of lockedBeds.entries()) {
          const slot = tenantBySlot.get(i);
          if (!slot) {
            await tx.execute(sql`
              INSERT INTO accommodation_assignments
                (source_key, student_id, bed_space_id, monthly_rental, status, check_in_date, agreement_start_date, source_reservation_id)
              VALUES
                (${`whole-unit:${reservationId}:${bed.id}`}, NULL, ${bed.id}, 0, 'pending-occupant', ${reservation.targetMoveInDate}, ${reservation.targetMoveInDate}, ${reservationId})
            `);
            await tx.execute(
              sql`UPDATE bed_spaces SET status = 'reserved', updated_at = ${now} WHERE id = ${bed.id}`,
            );
            continue;
          }
          const isPayer =
            slot.is_payer || (!anyPayerMarked && !payerAssigned);
          if (isPayer) payerAssigned = true;
          const studentInsert = await tx.execute<{ id: number }>(sql`
            INSERT INTO student_profiles
              (source_key, full_name, identity_no, contact_number, gender, is_student, status)
            VALUES
              (${`whole-unit-tenant:${reservationId}:${bed.id}`}, ${slot.full_name}, ${slot.identity_no}, ${slot.contact_number}, ${slot.gender}, ${slot.is_student}, 'active')
            RETURNING id
          `);
          const newStudentId = Number(studentInsert[0].id);
          await tx.execute(sql`
            INSERT INTO accommodation_assignments
              (source_key, student_id, bed_space_id, monthly_rental, status, check_in_date, agreement_start_date, source_reservation_id)
            VALUES
              (${`whole-unit:${reservationId}:${bed.id}`}, ${newStudentId}, ${bed.id}, ${isPayer ? resolvedRent : 0}, 'active', ${reservation.targetMoveInDate}, ${reservation.targetMoveInDate}, ${reservationId})
          `);
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'reserved', updated_at = ${now} WHERE id = ${bed.id}`,
          );
        }
        // These rows are now real tenants (or were dropped for having no
        // matching room) — leaving the draft behind would be a second,
        // increasingly stale copy of the same information.
        await tx.execute(
          sql`DELETE FROM reservation_group_tenants WHERE reservation_id = ${reservationId}`,
        );
      });
```

Note: an auto-claimed occupant's bed goes straight to `'reserved'` with `status: 'active'` — not `'occupied'` — exactly like every other claim in this codebase (Manage's "Fill in student" does the same; physically arriving and being checked in is always a separate, later step via `assignment-check-in`).

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify live**

Using synthetic `ZZTEST` fixtures (a hostel + 3-room unit + a `reservationType: "group"` reservation with `wholeUnitMonthlyRent` set):
1. Save the reservation with `groupTenants` filling slots 0 and 2 (slot 1 blank), slot 0 marked `isPayer: true`. Call `reservation-confirm-unit`. Confirm: exactly 2 `active` assignments exist (for the 1st and 3rd bed in `bed_spaces.id` order), each with a real `student_profiles` row (`is_student` matching what was submitted), the slot-0 occupant's assignment carries the full `wholeUnitMonthlyRent`, the slot-2 occupant's is `0`; the 2nd bed has a `pending-occupant` assignment with `student_id IS NULL`, exactly as before this plan; `reservation_group_tenants` is now empty for this reservation.
2. Repeat with no slot marked `isPayer` (both slots 0 and 2 filled, no `is_payer: true`) → confirm the FIRST filled slot by position (slot 0) becomes the payer, not slot 2.
3. Repeat with zero `groupTenants` rows saved at all → confirm every bed becomes `pending-occupant`, unchanged from the previous plan's behaviour (a straight regression check).
4. Confirm the disqualification/locking behaviour from the previous plan is untouched — e.g. a unit with a bed held by another reservation is still rejected before any of this new code runs (it's after the existing `disqualified` check, unreachable if that throws).
5. On a reservation with `wholeUnitMonthlyRent` left unset (null) but at least one filled tenant slot, call `reservation-confirm-unit` → confirm it's rejected with the new "Set the whole-unit rent..." error and nothing was written (no assignments created, no beds touched, `reservation_group_tenants` still has its rows) — this is the new guard from Step 2; also confirm a reservation with zero filled tenant slots and no rent set still confirms successfully (the guard only fires when slots exist).
6. Clean up every fixture.

---

### Task 4: Server — `whole-unit-claim` records `is_student`

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 1's `student_profiles.is_student` column.
- Produces: `POST /api/system {action: "whole-unit-claim", ..., isStudent}` sets the new profile's `is_student` (existing `gender` handling is untouched — it's already there).

- [ ] **Step 1: Read the current handler**

Find `} else if (action === "whole-unit-claim") {` and re-read it. Confirm the new-student INSERT already includes `gender: asText(body.gender, "unspecified")` (it does, from the previous plan) — this task adds `is_student` alongside it, nothing else.

- [ ] **Step 2: Add `is_student` to the insert**

Find:

```ts
          const inserted = await tx.execute<{ id: number }>(sql`
            INSERT INTO student_profiles
              (source_key, full_name, identity_no, contact_number, email, gender, nationality, status)
            VALUES
              (${`whole-unit-claim:${assignmentId}:${Date.now()}`}, ${newStudentFullName}, ${asText(body.identityNo)}, ${asText(body.contactNumber)}, ${asText(body.email)}, ${asText(body.gender, "unspecified")}, ${asText(body.nationality)}, 'active')
            RETURNING id
          `);
```

Replace with:

```ts
          const inserted = await tx.execute<{ id: number }>(sql`
            INSERT INTO student_profiles
              (source_key, full_name, identity_no, contact_number, email, gender, nationality, is_student, status)
            VALUES
              (${`whole-unit-claim:${assignmentId}:${Date.now()}`}, ${newStudentFullName}, ${asText(body.identityNo)}, ${asText(body.contactNumber)}, ${asText(body.email)}, ${asText(body.gender, "unspecified")}, ${asText(body.nationality)}, ${
                body.isStudent === undefined ? true : boolValue(body.isStudent)
              }, 'active')
            RETURNING id
          `);
```

(`body.isStudent === undefined ? true : boolValue(body.isStudent)` — not a bare `boolValue(body.isStudent)` — because `boolValue` has no default-value parameter and reads a missing field as `false`; the client always sends a real boolean explicitly per Task 7 below, but a direct API call that omits it should still get the "assume student" default the schema itself uses, not silently become non-student.)

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify live**

Using a `pending-occupant` bed from a synthetic whole-unit booking (same fixture pattern as every earlier task): call `whole-unit-claim` with `isStudent: false` → confirm the new profile's `is_student` is `false`. Call it again on a different pending bed with `isStudent` omitted entirely → confirm the new profile's `is_student` is `true` (the fallback). Clean up every fixture.

---

### Task 5: Frontend Step 1 — Individual / Agency or Company

**Files:** Modify `app/modules/HostelInformation.tsx` (the `ReservationEditor` component)

**Interfaces:**
- Consumes: Task 2's five new reservation fields (submitted alongside the rest of this form's `formValues(event)` — no special handling needed for these four text inputs since they're normal named `<input>`s).
- Produces: choosing "Agency or Company" (or editing a booking whose stored `representativeType` is the legacy `"institute"`) shows four organisation fields and hides Date of birth; choosing "Individual" behaves exactly as the current form does today.

- [ ] **Step 1: Add controlled state for `representativeType`**

Find, near this component's other `useState` declarations (search `const [bedSpaceId, setBedSpaceId] = useState(` inside `ReservationEditor` — the whole-unit-rent state was added right after it by the previous plan):

```ts
  const [wholeUnitRent, setWholeUnitRent] = useState<number | "">(
    editingReservation?.wholeUnitMonthlyRent ?? "",
  );
```

Add immediately after it:

```ts
  const [representativeType, setRepresentativeType] = useState(
    editingReservation?.representativeType || "person",
  );
  // A booking made before this plan can be 'institute' — no longer an
  // offered choice, but still shown as the company-style form (and left
  // untouched in the database) unless the user explicitly changes the
  // dropdown. See the design spec's Decisions section.
  const isCompanyBooking =
    representativeType === "company" || representativeType === "institute";
```

- [ ] **Step 2: Replace the `representativeType` select and hide Date of birth**

Find:

```tsx
        <label>
          Date of birth
          <DateField
            name="dateOfBirth"
            type="date"
            defaultValue={editingReservation?.dateOfBirth || ""}
          />
        </label>
```

Replace with:

```tsx
        {!(kind === "group" && isCompanyBooking) && (
          <label>
            Date of birth
            <DateField
              name="dateOfBirth"
              type="date"
              defaultValue={editingReservation?.dateOfBirth || ""}
            />
          </label>
        )}
```

Find:

```tsx
        {kind === "group" && (
          <>
            <label>
              Representative type
              <select
                name="representativeType"
                defaultValue={editingReservation?.representativeType || "person"}
              >
                <option value="person">Person</option>
                <option value="company">Company</option>
                <option value="institute">Institute</option>
              </select>
            </label>
            <label>
              Estimated group size
              <input
                name="groupSize"
                type="number"
                min="1"
                max="99"
                defaultValue={editingReservation?.groupSize || 1}
              />
            </label>
          </>
        )}
```

Replace with:

```tsx
        {kind === "group" && (
          <>
            <label>
              Booking type
              <select
                name="representativeType"
                value={representativeType}
                onChange={(event) => setRepresentativeType(event.target.value)}
              >
                <option value="person">Individual</option>
                <option value="company">Agency or Company</option>
              </select>
            </label>
            <label>
              Estimated group size
              <input
                name="groupSize"
                type="number"
                min="1"
                max="99"
                defaultValue={editingReservation?.groupSize || 1}
              />
            </label>
            {isCompanyBooking && (
              <>
                <label>
                  Organisation name
                  <input
                    name="organisationName"
                    placeholder="e.g. Acme Sdn Bhd"
                    defaultValue={editingReservation?.organisationName || ""}
                  />
                </label>
                <label>
                  Company registration number
                  <input
                    name="companyRegistrationNo"
                    placeholder="e.g. 202301012345"
                    defaultValue={editingReservation?.companyRegistrationNo || ""}
                  />
                </label>
                <label className="wide">
                  Organisation address
                  <input
                    name="organisationAddress"
                    placeholder="e.g. 12 Jalan Ampang, Kuala Lumpur"
                    defaultValue={editingReservation?.organisationAddress || ""}
                  />
                </label>
                <label>
                  Company email
                  <input
                    name="companyEmail"
                    type="email"
                    placeholder="e.g. admin@acme.com"
                    defaultValue={editingReservation?.companyEmail || ""}
                  />
                </label>
              </>
            )}
          </>
        )}
```

Note: `representativeType` was previously an *uncontrolled* select (`defaultValue` only) — it is now controlled (`value`/`onChange`), which is why the new state was needed. If `editingReservation` is null (creating a new booking), `representativeType` correctly initialises to `"person"`, matching the old `defaultValue` fallback.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 4: Verify in the browser**

Dev server on :3000 (start if not running). Using a synthetic staff session (Browser pane, same cookie-injection technique used throughout this project):
1. Open "New reservation", pick "Whole unit", pick "Agency or Company" — confirm Date of birth disappears and the four organisation fields appear; fill them, save, reopen the reservation for editing → confirm all four persisted and reload correctly, and the dropdown still shows "Agency or Company".
2. Pick "Individual" — confirm Date of birth is back and the organisation fields are gone.
3. **Using the real reservation id `63` (reference `RSV-670839117`, `student_name = 'a'`, `representative_type = 'institute'` today — do not use a synthetic copy, this is the actual row the spec calls out):** open it for editing. Confirm the dropdown shows "Agency or Company" (institute treated as company for display) and the four organisation fields are visible. Change only an unrelated field (e.g. re-save with no changes, or edit `notes`) **without touching the Booking type dropdown**, save, then query the database directly to confirm `representative_type` is still exactly `'institute'`, not silently rewritten to `'company'`. This is a real production-adjacent row — do not leave it saved in an inconsistent state; if anything about this check goes wrong, stop and report rather than guessing at a fix live on this row.
4. Clean up every *synthetic* fixture used for steps 1–2 (not row 63, which is real data and was never supposed to be deleted).

---

### Task 6: Frontend Step 2 — utility field + up-front tenant list

**Files:** Modify `app/modules/HostelInformation.tsx` (the `ReservationEditor` component)

**Interfaces:**
- Consumes: Task 5's `isCompanyBooking`/state pattern (independent — this task's utility field shows for any whole-unit booking, not only company ones); the existing `wholeUnitOptions` computation from the previous plan.
- Produces: a "Utilities billed to" field; once a qualifying unit is picked, one tenant-slot block per room in it, all fields optional; the form's final `save(...)` call includes a `groupTenants` array reflecting the slots whenever `kind === "group"`.

- [ ] **Step 1: Add `roomCount` to `wholeUnitOptions`**

Find:

```ts
    .map(([id, beds]) => {
      const rooms = roomOptionsFrom(beds, () => true);
      return {
        id,
        code: beds[0].unitCode,
        // A bed only qualifies here because its tenancy has ENDED by the
        // move-in date — it may still show "occupied" if nobody has
        // formally checked that tenant out yet. Worth a heads-up, not a
        // block.
        warnings: beds
          .filter((bed) => bed.status === "occupied")
          .map(
            (bed) =>
              `${bed.legacyCode || `Room ${bed.roomLabel}`} — current tenant's agreement ends ${dateLabel(bed.agreementEndDate)}, not yet checked out`,
          ),
        suggestedRent: rooms.reduce((sum, room) => sum + (room.rate ?? 0), 0),
        missingRate: rooms.some((room) => room.rate === null),
      };
    })
```

Replace with:

```ts
    .map(([id, beds]) => {
      const rooms = roomOptionsFrom(beds, () => true);
      return {
        id,
        code: beds[0].unitCode,
        // A bed only qualifies here because its tenancy has ENDED by the
        // move-in date — it may still show "occupied" if nobody has
        // formally checked that tenant out yet. Worth a heads-up, not a
        // block.
        warnings: beds
          .filter((bed) => bed.status === "occupied")
          .map(
            (bed) =>
              `${bed.legacyCode || `Room ${bed.roomLabel}`} — current tenant's agreement ends ${dateLabel(bed.agreementEndDate)}, not yet checked out`,
          ),
        suggestedRent: rooms.reduce((sum, room) => sum + (room.rate ?? 0), 0),
        missingRate: rooms.some((room) => room.rate === null),
        roomCount: rooms.length,
      };
    })
```

- [ ] **Step 2: Add tenant-slot state and a small update helper**

Find, right after the `isCompanyBooking` block added in Task 5 Step 1:

```ts
  const isCompanyBooking =
    representativeType === "company" || representativeType === "institute";
```

Add immediately after it:

```ts
  type GroupTenantSlot = {
    fullName: string;
    identityNo: string;
    contactNumber: string;
    gender: string;
    isStudent: boolean;
    isPayer: boolean;
  };
  const blankGroupTenantSlot = (): GroupTenantSlot => ({
    fullName: "",
    identityNo: "",
    contactNumber: "",
    gender: "unspecified",
    isStudent: true,
    isPayer: false,
  });
  // Hydrated from the reservation's own already-saved slots when editing
  // (Task 2 was extended, after it shipped, to attach `groupTenants` to
  // every reservation the GET payload returns — same pattern as the
  // existing `charges` array). Without this, opening an existing whole-unit
  // booking to fix an unrelated field and saving would submit an EMPTY
  // groupTenants array, and Task 2's "replace with whatever was submitted"
  // semantics would silently delete every already-typed tenant.
  const [groupTenants, setGroupTenants] = useState<GroupTenantSlot[]>(() => {
    const saved: Row[] = editingReservation?.groupTenants || [];
    if (!saved.length) return [];
    const bySlot = new Map(saved.map((row) => [Number(row.slotIndex), row]));
    const maxIndex = Math.max(...saved.map((row) => Number(row.slotIndex)));
    return Array.from({ length: maxIndex + 1 }, (_, i) => {
      const row = bySlot.get(i);
      return row
        ? {
            fullName: row.fullName || "",
            identityNo: row.identityNo || "",
            contactNumber: row.contactNumber || "",
            gender: row.gender || "unspecified",
            isStudent: Boolean(row.isStudent),
            isPayer: Boolean(row.isPayer),
          }
        : blankGroupTenantSlot();
    });
  });
  const updateGroupTenant = (index: number, patch: Partial<GroupTenantSlot>) =>
    setGroupTenants((current) =>
      current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  // The state above sizes itself to the saved data's own extent, which can
  // be shorter than the unit's actual room count (trailing rooms nobody
  // filled in aren't stored at all). This one-time effect brings it up to
  // the unit's real room count on mount, exactly like the select's own
  // onChange does on every later change — deliberately empty deps: it
  // exists only to correct the initial size once, not to re-run on every
  // render (wholeUnitOptions is recomputed fresh every render) or every
  // unitId change (the onChange handler already covers that).
  useEffect(() => {
    if (kind !== "group" || !editingReservation) return;
    const option = wholeUnitOptions.find((opt) => opt.id === unitId);
    if (!option) return;
    setGroupTenants((current) =>
      Array.from(
        { length: option.roomCount },
        (_, i) => current[i] ?? blankGroupTenantSlot(),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Resize `groupTenants` when the unit selection changes**

Find (the unit `<select>`'s `onChange`, in the `kind === "group"` step-2 JSX):

```tsx
                onChange={(event) => {
                  setUnitId(event.target.value);
                  const option = wholeUnitOptions.find(
                    (opt) => opt.id === event.target.value,
                  );
                  setWholeUnitRent(option ? option.suggestedRent : "");
                }}
```

Replace with:

```tsx
                onChange={(event) => {
                  setUnitId(event.target.value);
                  const option = wholeUnitOptions.find(
                    (opt) => opt.id === event.target.value,
                  );
                  setWholeUnitRent(option ? option.suggestedRent : "");
                  // Keep already-typed slots when the count doesn't shrink;
                  // pad with blanks or truncate otherwise. Every field stays
                  // optional either way — see the tenant-slot block below.
                  const roomCount = option?.roomCount ?? 0;
                  setGroupTenants((current) =>
                    Array.from(
                      { length: roomCount },
                      (_, i) => current[i] ?? blankGroupTenantSlot(),
                    ),
                  );
                }}
```

- [ ] **Step 4: Add the utility field and the tenant-slot list**

Find:

```tsx
            <label>
              Monthly rent for the whole unit
              <input
                name="wholeUnitMonthlyRent"
                type="number"
                min="0"
                value={wholeUnitRent}
                onChange={(event) =>
                  setWholeUnitRent(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
              />
              <small className="field-note">
                {wholeUnitOptions.find((opt) => opt.id === unitId)?.missingRate
                  ? "One or more rooms in this unit has no rate set — check before confirming. "
                  : ""}
                Defaults to the sum of the unit&apos;s room rates; edit for a
                negotiated price.
              </small>
            </label>
          </>
        ) : (
```

Replace with:

```tsx
            <label>
              Monthly rent for the whole unit
              <input
                name="wholeUnitMonthlyRent"
                type="number"
                min="0"
                value={wholeUnitRent}
                onChange={(event) =>
                  setWholeUnitRent(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
              />
              <small className="field-note">
                {wholeUnitOptions.find((opt) => opt.id === unitId)?.missingRate
                  ? "One or more rooms in this unit has no rate set — check before confirming. "
                  : ""}
                Defaults to the sum of the unit&apos;s room rates; edit for a
                negotiated price.
              </small>
            </label>
            <label>
              Utilities (TNB & Air Selangor) billed to
              <select
                name="utilityBilledTo"
                defaultValue={editingReservation?.utilityBilledTo || "tenant"}
              >
                <option value="tenant">Tenant</option>
                <option value="company">Company</option>
              </select>
              <small className="field-note">
                A record for staff only — does not change how electricity is
                actually billed.
              </small>
            </label>
            {groupTenants.length > 0 && (
              <div
                className="wide"
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <strong style={{ fontSize: "13px" }}>
                  Tenants (optional — fill in as many as you already know)
                </strong>
                {groupTenants.map((slot, index) => (
                  <div
                    key={index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 1fr auto auto",
                      gap: "6px",
                      alignItems: "center",
                    }}
                  >
                    <input
                      placeholder={`Room ${index + 1} — full name`}
                      value={slot.fullName}
                      onChange={(event) =>
                        updateGroupTenant(index, { fullName: event.target.value })
                      }
                    />
                    <input
                      placeholder="IC"
                      value={slot.identityNo}
                      onChange={(event) =>
                        updateGroupTenant(index, { identityNo: event.target.value })
                      }
                    />
                    <input
                      placeholder="Contact"
                      value={slot.contactNumber}
                      onChange={(event) =>
                        updateGroupTenant(index, { contactNumber: event.target.value })
                      }
                    />
                    <select
                      value={slot.gender}
                      onChange={(event) =>
                        updateGroupTenant(index, { gender: event.target.value })
                      }
                    >
                      <option value="unspecified">Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="checkbox"
                        checked={slot.isStudent}
                        onChange={(event) =>
                          updateGroupTenant(index, { isStudent: event.target.checked })
                        }
                      />
                      Student
                    </label>
                    <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <input
                        type="radio"
                        name="groupTenantPayer"
                        checked={slot.isPayer}
                        onChange={() =>
                          setGroupTenants((current) =>
                            current.map((s, i) => ({ ...s, isPayer: i === index })),
                          )
                        }
                      />
                      Payer
                    </label>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
```

- [ ] **Step 5: Send `groupTenants` on submit**

Find this component's final `save(...)` call:

```ts
        const ok = await save(
          {
            action: editingReservation ? "reservation-update" : "reservation",
            reservationId: editingReservation?.id,
            chargeBreakdown: charges,
            ...formValues(event),
            // The month picker carries no `name` — its own "YYYY-MM" value
            // never reaches FormData — so the full date tracked in state
            // (rounded to the 1st) is what actually goes out here.
            targetMoveInDate: date,
          },
          editingReservation ? "Reservation updated" : "Reservation created",
        );
```

Replace with:

```ts
        const ok = await save(
          {
            action: editingReservation ? "reservation-update" : "reservation",
            reservationId: editingReservation?.id,
            chargeBreakdown: charges,
            ...formValues(event),
            // The month picker carries no `name` — its own "YYYY-MM" value
            // never reaches FormData — so the full date tracked in state
            // (rounded to the 1st) is what actually goes out here.
            targetMoveInDate: date,
            ...(kind === "group" ? { groupTenants } : {}),
          },
          editingReservation ? "Reservation updated" : "Reservation created",
        );
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 7: Verify in the browser**

Using a synthetic 3-room qualifying unit (same fixture pattern as the previous plan's Task 6):
1. Pick the unit — confirm 3 tenant-slot rows appear, all blank, "Utilities billed to" defaults to "Tenant".
2. Fill slot 1 and slot 3, mark slot 3 as payer, leave slot 2 blank, save the reservation (don't confirm the unit yet) → reopen it for editing → confirm slots 1 and 3 still show their values and slot 3 is still marked payer (round-trips through `reservation_group_tenants` correctly).
3. Switch the "Unit / house to reserve" dropdown to a *different* qualifying unit with a different room count → confirm the slot list resizes (more or fewer rows) rather than erroring.
4. Confirm the unit (`Confirm unit` button) → confirm (via a DB query) that slots 1 and 3 became real `active` assignments with slot 3 carrying the rent, slot 2's room is `pending-occupant`.
5. Clean up every fixture.

---

### Task 7: Frontend — `ClaimRoomForm` gains gender and student/non-student

**Files:** Modify `app/modules/HostelInformation.tsx` (the `ClaimRoomForm` component)

**Interfaces:**
- Consumes: Task 4's `whole-unit-claim` handling of `body.isStudent` (`gender` was already handled by the previous plan).
- Produces: claiming a room as a **new** student now also submits `gender`/`isStudent`, explicitly as real booleans/strings in the `save(...)` call's object — not through `formValues`, which cannot represent an unchecked checkbox the way `boolValue` expects (see the design spec's Decisions/Frontend section for exactly why).

- [ ] **Step 1: Add state**

Find, in `ClaimRoomForm`:

```ts
  const [isPayer, setIsPayer] = useState(!hasExistingPayer);
```

Add immediately after it:

```ts
  const [gender, setGender] = useState("unspecified");
  const [isStudent, setIsStudent] = useState(true);
```

- [ ] **Step 2: Add the fields to the "New student" branch**

Find:

```tsx
      ) : (
        <>
          <label className="wide">
            Full name
            <input name="fullName" required placeholder="e.g. John Doe" />
          </label>
          <label>
            IC / Passport
            <input name="identityNo" />
          </label>
          <label>
            Phone number
            <input name="contactNumber" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
        </>
      )}
```

Replace with:

```tsx
      ) : (
        <>
          <label className="wide">
            Full name
            <input name="fullName" required placeholder="e.g. John Doe" />
          </label>
          <label>
            IC / Passport
            <input name="identityNo" />
          </label>
          <label>
            Phone number
            <input name="contactNumber" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Gender
            <select value={gender} onChange={(event) => setGender(event.target.value)}>
              <option value="unspecified">Not set</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="checkbox"
              checked={isStudent}
              onChange={(event) => setIsStudent(event.target.checked)}
            />
            Student
          </label>
        </>
      )}
```

- [ ] **Step 3: Send them explicitly, only in "New student" mode**

Find:

```ts
        const ok = await save(
          {
            action: "whole-unit-claim",
            assignmentId: bed.assignmentId,
            isPayer,
            ...formValues(e),
          },
          "Room claimed",
        );
```

Replace with:

```ts
        const ok = await save(
          {
            action: "whole-unit-claim",
            assignmentId: bed.assignmentId,
            isPayer,
            // Sent explicitly (not through formValues) and only when
            // claiming a NEW profile — an unchecked checkbox is simply
            // absent from FormData and a checked one sends the string
            // "on", neither of which boolValue on the server expects;
            // linking an EXISTING student must never overwrite their real
            // gender/student status with these fields' form defaults.
            ...(mode === "new" ? { gender, isStudent } : {}),
            ...formValues(e),
          },
          "Room claimed",
        );
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 5: Verify in the browser**

Using a `pending-occupant` room from a synthetic whole-unit booking: claim it as a new student, set Gender to Female and uncheck Student → confirm (via a DB query) the new profile's `gender`/`is_student` match. Claim a second room by linking an *existing* student → confirm that student's own `gender`/`is_student` are unchanged by the claim. Clean up every fixture.

---

### Task 8: End-to-end pass + final sweep

**Files:** none (verification only)

- [ ] **Step 1: Full end-to-end pass**

One synthetic hostel with a 3-room unit. Run the entire flow exactly as a real user would: create a whole-unit reservation, pick "Agency or Company", fill the four organisation fields, pick a qualifying unit, fill 2 of the 3 tenant slots (mark one payer), set "Utilities billed to" = Company, save → confirm the unit → verify 2 real active tenants exist (correct payer/rent split) and 1 `pending-occupant` room remains → claim the remaining room through Manage with Gender/Student set → check that occupant in → open the Manage drawer and confirm the "Rooms in this unit" panel (from the previous plan) correctly shows all three rooms in their right states. Also re-run one individual (non-group) reservation create → convert (via payment) → check-in end to end, and one existing whole-unit booking edit (representativeType left as "Individual" throughout) to confirm neither path regressed.

- [ ] **Step 2: Final sweep**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts app/modules/HostelInformation.tsx
```

Confirm the warning counts are exactly the pre-existing baseline (2 in `route.ts`, 11 in `HostelInformation.tsx` — re-check the current count before starting this task, since it may have shifted slightly from other work; report the exact before/after either way). Confirm zero `ZZTEST` rows remain across every table touched by this plan's verification steps (`reservations`, `reservation_group_tenants`, `accommodation_assignments`, `student_profiles`, and any synthetic `hostel_properties`/`hostel_units`/`hostel_rooms`/`bed_spaces`/`app_users`/`user_sessions`), and no leftover files in `.claude-scratch/` beyond what was already tracked (`git status --short .claude-scratch`). Confirm the real reservation id `63` (`RSV-670839117`) still has `representative_type = 'institute'` and was not left modified by Task 5's verification.
