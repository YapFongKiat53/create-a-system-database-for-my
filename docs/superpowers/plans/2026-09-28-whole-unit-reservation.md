# Whole-Unit Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the existing "Whole unit" reservation type (`reservationType: "group"`) actually hold rooms, price itself, and let staff fill in occupants room by room, instead of only flipping a status flag.

**Design spec (authoritative — read it first):** `docs/superpowers/specs/2026-09-28-whole-unit-reservation-design.md`

**Architecture:** No new tables. `accommodation_assignments.student_id` becomes nullable so a bed can be held by a placeholder ("pending-occupant") row before anyone is named; `reservations` gains one nullable `whole_unit_monthly_rent` column. Converting a whole-unit reservation now creates one placeholder assignment per bed in the unit and marks every one of those beds `reserved`, in one transaction. A new `whole-unit-claim` action turns a placeholder into a real tenant (new or existing student profile), with exactly one occupant per booking flagged as the rent payer at any time. The reservation form's unit picker is filtered to only units where every bed actually qualifies (vacant, or the current tenant's agreement ends on/before the target move-in date).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (real dev DB via `DATABASE_URL`), no test framework — every task verifies with `npx tsc --noEmit`, `npx eslint <files>`, and live checks against the dev DB with synthetic `ZZTEST` fixtures cleaned up after.

## Global Constraints

- No git commits during implementation. No `rm -rf` on any directory (`.claude-scratch/` is git-tracked; delete only files you created there).
- Every DB check runs against the real dev database (`DATABASE_URL`) — use synthetic `ZZTEST`-prefixed rows and delete them when a task's verification is done, even if a later step in the same task fails partway.
- Source env before any script: `set -a && source .env.local 2>/dev/null; source .env 2>/dev/null; set +a`.
- Migration workflow (same as every prior schema change this project): edit `db/schema.ts` → `npm run db:generate` (produces a tracked `drizzle/pg/00XX_*.sql`, drift-only) → hand-write a temporary idempotent `ALTER/CREATE ... IF NOT EXISTS`-style script in `.claude-scratch/`, run it once with `node` against the real `DATABASE_URL`, confirm with a query, then delete the script. There is no `db:migrate` script — this project has never used one.
- `app/api/system/route.ts` is a single very large file. Every task below anchors its edits with an exact quoted snippet of the *current* file (verified while writing this plan) — re-read the surrounding code before editing in case an earlier task in this plan already shifted it.
- Known pre-existing eslint baseline: two warnings (`TURNOVER_OPEN_STATUSES`, `invoiceFrequency` unused) in `app/api/system/route.ts`. No other warnings are acceptable in files this plan touches.
- Existing baseline behaviour that must not regress in any task: an individual (non-group) reservation's create/edit/convert flow, and the existing Room Information board for ordinary vacant/occupied/reserved beds.

---

### Task 1: Schema — nullable `studentId`, new `wholeUnitMonthlyRent` column

**Files:**
- Modify: `db/schema.ts`
- Create (generated, tracked): `drizzle/pg/00XX_*.sql`
- Temp: a script in `.claude-scratch/` (delete after)

**Interfaces:**
- Produces: `accommodationAssignments.studentId` accepts `null` at the type level; `reservations.wholeUnitMonthlyRent` (`doublePrecision`, nullable) exists in the real dev DB and in the Drizzle schema. Every later task in this plan depends on both.

- [ ] **Step 1: Make `accommodationAssignments.studentId` nullable**

In `db/schema.ts`, find:

```ts
export const accommodationAssignments = pgTable("accommodation_assignments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  sourceKey: text("source_key").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => studentProfiles.id),
```

Change `studentId` to:

```ts
  // Null while a whole-unit booking's room is held but nobody has been
  // named for it yet ("pending-occupant" status below). Every other status
  // (active, ended, ...) always has a real student.
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
```

Add this comment immediately above the `status` field in the same table (find `status: text("status").notNull().default("active"),` in this table and put the comment directly above it):

```ts
  // "pending-occupant" (studentId null): a whole-unit booking has claimed
  // this bed but nobody has been named yet. See docs/superpowers/specs/
  // 2026-09-28-whole-unit-reservation-design.md.
```

- [ ] **Step 2: Add `wholeUnitMonthlyRent` to `reservations`**

In the same file, find the `reservations` table's `status`/`convertedAt` fields:

```ts
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
```

Insert a new field right after `convertedAt`:

```ts
  convertedAt: text("converted_at"),
  // Whole-unit bookings only: the agreed total monthly rent for the whole
  // unit (defaults to the sum of its rooms' rates, editable by staff for a
  // negotiated block price). Null for an individual booking.
  wholeUnitMonthlyRent: doublePrecision("whole_unit_monthly_rent"),
```

(`doublePrecision` is already imported at the top of `db/schema.ts` — confirm before adding a duplicate import.)

- [ ] **Step 3: Generate and apply the migration**

```bash
npm run db:generate
```

This produces `drizzle/pg/00XX_<name>.sql` (next number after `0027`). Read it to confirm it contains exactly: `ALTER TABLE "accommodation_assignments" ALTER COLUMN "student_id" DROP NOT NULL;` and `ALTER TABLE "reservations" ADD COLUMN "whole_unit_monthly_rent" double precision;` (statement order/exact wording may differ slightly — the two effects are what matter).

Write a temporary `.claude-scratch/wu1_apply.mjs` using the `postgres` package (see any earlier script in `.claude-scratch/` for the connection idiom: `postgres(process.env.DATABASE_URL, { prepare: false })`) that runs, idempotently:

```sql
ALTER TABLE accommodation_assignments ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS whole_unit_monthly_rent double precision;
```

Run it with `node .claude-scratch/wu1_apply.mjs` against the real dev DB. Confirm with a query (`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='accommodation_assignments' AND column_name='student_id'` should show `YES`; `SELECT column_name FROM information_schema.columns WHERE table_name='reservations' AND column_name='whole_unit_monthly_rent'` should return one row). Delete the script.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors (existing code that inserts into `accommodationAssignments` always supplies a `studentId` today, so nothing breaks from the widened type).

---

### Task 2: `selectRawBeds` — surface pending-occupant assignments to the client

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 1's schema (reads `accommodationAssignments.status` values including the new `"pending-occupant"`).
- Produces: every row in `data.bedSpaces` (client-side) gains two fields, `assignmentStatus: string | null` and `sourceReservationId: number | null`, both `null` for a bed with no matching assignment or only an `ended` one. `bed.assignmentStatus === "pending-occupant"` is what later tasks (6, 7) use to detect an unclaimed whole-unit room.

- [ ] **Step 1: Read `selectRawBeds` in full before editing**

Find the function (search `async function selectRawBeds`). Confirm the exact current `leftJoin` and select list match what's quoted below — this plan was written against the file as it stood before Task 1; nothing in Task 1 touches this function, but re-check anyway.

- [ ] **Step 2: Widen the assignment join and add two fields**

Find:

```ts
      assignmentId: accommodationAssignments.id,
      assignmentCheckInDate: accommodationAssignments.checkInDate,
      agreementEndDate: accommodationAssignments.agreementEndDate,
      assignmentRental: accommodationAssignments.monthlyRental,
    })
    .from(bedSpaces)
    .innerJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
    .innerJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
    .innerJoin(
      hostelProperties,
      eq(hostelUnits.hostelId, hostelProperties.id),
    )
    .leftJoin(
      accommodationAssignments,
      and(
        eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
        eq(accommodationAssignments.status, "active"),
      ),
    )
```

Replace with:

```ts
      assignmentId: accommodationAssignments.id,
      assignmentCheckInDate: accommodationAssignments.checkInDate,
      agreementEndDate: accommodationAssignments.agreementEndDate,
      assignmentRental: accommodationAssignments.monthlyRental,
      // "active" is a real tenant; "pending-occupant" is a whole-unit
      // booking's bed with nobody named yet — the client tells the two
      // apart by this field (an active tenant's occupant* fields below are
      // populated via studentId, a pending-occupant's are all null since
      // studentId itself is null).
      assignmentStatus: accommodationAssignments.status,
      sourceReservationId: accommodationAssignments.sourceReservationId,
    })
    .from(bedSpaces)
    .innerJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
    .innerJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
    .innerJoin(
      hostelProperties,
      eq(hostelUnits.hostelId, hostelProperties.id),
    )
    .leftJoin(
      accommodationAssignments,
      and(
        eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
        inArray(accommodationAssignments.status, [
          "active",
          "pending-occupant",
        ]),
      ),
    )
```

(`inArray` is already imported from `drizzle-orm` at the top of this file.)

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify live**

No pending-occupant rows exist yet (Task 4 is what creates them), so this step only confirms nothing broke: hit `GET /api/system?modules=rooms` (or the full payload) as an authenticated staff session and confirm `bedSpaces` rows still show the correct `occupantName`/`assignmentId` for ordinary occupied/vacant/reserved beds exactly as before, and that every row now has an `assignmentStatus` key (either `"active"`, `null`, or — for a normal reserved individual booking's bed — `"active"`, since `promoteReservationToTenancy` creates those as `active` immediately). No fixtures needed for this task; it's a read-only check against real data.

---

### Task 3: Store the whole-unit rent on the reservation

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 1's `reservations.wholeUnitMonthlyRent` column.
- Produces: `POST /api/system {action: "reservation"|"reservation-update", ..., wholeUnitMonthlyRent}` stores it; every reservation payload the client already receives (`db.select().from(reservations)`, unchanged) now includes `wholeUnitMonthlyRent`.

- [ ] **Step 1: Add the field to the shared `values` object**

Find, inside the `action === "reservation" || action === "reservation-update"` branch:

```ts
        targetMoveInDate: asText(body.targetMoveInDate),
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        notes: asText(body.notes),
      };
```

Replace with:

```ts
        targetMoveInDate: asText(body.targetMoveInDate),
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        // Whole-unit bookings only — null for an individual booking, exactly
        // as the client only ever sends it when reservationType is "group".
        wholeUnitMonthlyRent: asNullableNumber(body.wholeUnitMonthlyRent),
        notes: asText(body.notes),
      };
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 3: Verify live**

Using a staff session (synthetic `user_sessions` row, `hostel_session` cookie — same technique as every prior task this project has used), `POST /api/system` with `action: "reservation"`, `reservationType: "group"`, the other required fields (`studentName`, `targetMoveInDate`, `salesPerson`, `preferredGender`), and `wholeUnitMonthlyRent: 2400`. Confirm the response reservation (or a follow-up `GET`) shows `wholeUnitMonthlyRent: 2400`. Repeat with `action: "reservation-update"` changing it to `2600` and confirm it updates. Delete the fixture reservation row (`DELETE FROM reservations WHERE id = ...` via a `.claude-scratch/` script) when done.

---

### Task 4: `reservation-confirm-unit` creates placeholder assignments

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 1 (nullable `studentId`, `pending-occupant` as a valid `status` value — `status` is free text, no schema change needed for the value itself).
- Produces: converting a whole-unit reservation creates one `accommodation_assignments` row per bed in the confirmed unit (`studentId: null`, `status: "pending-occupant"`), sets every one of those beds to `bed_spaces.status = "reserved"`, and rejects the whole conversion (no partial writes) if any bed in the unit no longer qualifies.

- [ ] **Step 1: Read the current handler**

Find `} else if (action === "reservation-confirm-unit") {` and re-read the full branch (it currently ends at the `notifyRole(...)` call before `} else if (action === "reservation-room-change")`).

- [ ] **Step 2: Add a shared qualification check**

Add this helper function above `moduleForAction` (search for `function moduleForAction(action: string) {` and insert immediately before it), reusing the exact same rule as the client-side picker in Task 6 so server and client never disagree:

```ts
// A bed qualifies for a whole-unit booking targeting `moveInDate` if it's
// vacant, or its current tenancy is contractually due to end on or before
// that date (whether the tenant has actually checked out is a separate,
// non-blocking concern the caller surfaces as a warning, not a rejection).
function bedQualifiesForWholeUnit(
  bed: { status: string; agreementEndDate: string | null },
  moveInDate: string,
) {
  return (
    bed.status === "vacant" ||
    (bed.status === "occupied" &&
      Boolean(bed.agreementEndDate) &&
      bed.agreementEndDate! <= moveInDate)
  );
}
```

- [ ] **Step 3: Rewrite the conversion branch**

Find the full current branch:

```ts
    } else if (action === "reservation-confirm-unit") {
      // Only group bookings still need a step of their own. A group takes a
      // whole unit and creates no tenancy — the individual names arrive
      // later — so there is nothing for a payment to promote. Individual
      // bookings no longer have this action at all: recording their payment
      // is what creates the tenancy (see promoteReservationToTenancy).
      const reservationId = asNumber(body.reservationId);
      const reservation = (
        await db
          .select()
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.reservationType !== "group")
        throw new Error(
          "Only a group booking confirms a unit. An individual booking becomes a tenancy when its payment is recorded.",
        );
      if (!body.unitId) throw new Error("Select the confirmed unit / house");
      await db
        .update(reservations)
        .set({
          preferredUnitId: asNumber(body.unitId),
          status: "converted",
          convertedAt: nowIso(),
        })
        .where(eq(reservations.id, reservationId));
      await notifyRole(db, "sales", {
        type: "reservation-changed",
        title: `Reservation ${reservation.referenceNo} — room confirmed`,
        body: reservation.studentName,
        link: "/hostels?tab=reservations",
      });
    } else if (action === "reservation-room-change") {
```

Replace with:

```ts
    } else if (action === "reservation-confirm-unit") {
      // A group takes a whole unit: converting it now actually holds every
      // room in that unit (one placeholder assignment per bed, all beds
      // marked reserved) rather than only flipping the reservation's own
      // status. The individual occupant names arrive later, one room at a
      // time, via the whole-unit-claim action below.
      const reservationId = asNumber(body.reservationId);
      const reservation = (
        await db
          .select()
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.reservationType !== "group")
        throw new Error(
          "Only a group booking confirms a unit. An individual booking becomes a tenancy when its payment is recorded.",
        );
      if (reservation.status !== "reserved")
        throw new Error("This reservation has already been converted");
      const unitId = asNumber(body.unitId);
      if (!unitId) throw new Error("Select the confirmed unit / house");
      const unitBeds = await db
        .select({
          id: bedSpaces.id,
          status: bedSpaces.status,
          legacyCode: bedSpaces.legacyCode,
        })
        .from(bedSpaces)
        .innerJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
        .where(eq(hostelRooms.unitId, unitId));
      if (!unitBeds.length) throw new Error("This unit has no rooms");
      // Re-check every bed against the same rule the picker used — closing
      // the race between "the picker loaded this unit as available" and
      // "confirm was clicked". agreementEndDate is read directly, not from
      // the client-derived `bed.availableFrom`, so a stale client payload
      // can't slip a disqualified bed through.
      const assignmentEndDates = await db
        .select({
          bedSpaceId: accommodationAssignments.bedSpaceId,
          agreementEndDate: accommodationAssignments.agreementEndDate,
        })
        .from(accommodationAssignments)
        .where(
          and(
            inArray(
              accommodationAssignments.bedSpaceId,
              unitBeds.map((bed) => bed.id),
            ),
            eq(accommodationAssignments.status, "active"),
          ),
        );
      const endDateByBed = new Map(
        assignmentEndDates.map((row) => [row.bedSpaceId, row.agreementEndDate]),
      );
      const disqualified = unitBeds.filter(
        (bed) =>
          !bedQualifiesForWholeUnit(
            {
              status: bed.status,
              agreementEndDate: endDateByBed.get(bed.id) ?? null,
            },
            reservation.targetMoveInDate,
          ),
      );
      if (disqualified.length)
        throw new Error(
          `${disqualified[0].legacyCode || "A room"} in this unit is no longer available for this move-in date — refresh and pick again`,
        );
      const now = nowIso();
      const resolvedRent = asNullableNumber(
        body.wholeUnitMonthlyRent ?? reservation.wholeUnitMonthlyRent,
      );
      // Every transaction elsewhere in this file uses tx.execute(sql`...`)
      // rather than the ORM builder methods on tx — matched here rather than
      // introducing a new style.
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE reservations
          SET preferred_unit_id = ${unitId}, status = 'converted',
              converted_at = ${now}, whole_unit_monthly_rent = ${resolvedRent}
          WHERE id = ${reservationId}
        `);
        for (const bed of unitBeds) {
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
      await notifyRole(db, "sales", {
        type: "reservation-changed",
        title: `Reservation ${reservation.referenceNo} — room confirmed`,
        body: reservation.studentName,
        link: "/hostels?tab=reservations",
      });
    } else if (action === "reservation-room-change") {
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 5: Verify live**

Using synthetic `ZZTEST` fixtures (a hostel unit with e.g. 2 rooms/2 beds is enough — reuse an existing test hostel/unit if one already exists from earlier sessions, or create one with the same idempotent-script convention): create a `reservationType: "group"` reservation targeting a fully-vacant synthetic unit, then `POST` `reservation-confirm-unit` with that `unitId`. Confirm:
1. The reservation's `status` is `"converted"`.
2. There are exactly as many new `accommodation_assignments` rows as beds in the unit, each `student_id IS NULL`, `status = 'pending-occupant'`, `source_reservation_id` = the reservation's id.
3. Every one of those beds now has `bed_spaces.status = 'reserved'`.
4. Repeat with one bed in the unit set to `status='occupied'` with an `agreementEndDate` *after* the reservation's `targetMoveInDate` (a fresh active assignment on that bed) — confirm the whole call is rejected, and that NEITHER the reservation nor any bed nor any assignment changed (query all three before and after).
5. Clean up every fixture (reservation, assignments, revert bed statuses, delete the synthetic hostel/unit/beds you created for this test).

---

### Task 5: `whole-unit-claim` action

**Files:** Modify `app/api/system/route.ts`

**Interfaces:**
- Consumes: Task 4's `pending-occupant` assignments.
- Produces: `POST /api/system {action: "whole-unit-claim", assignmentId, isPayer, ...}` either creates a new `student_profiles` row or links an existing one (`studentId`), fills in the given `pending-occupant` assignment (`studentId`, `status: "active"`, `monthlyRental`), and — when `isPayer` is true — zeroes any other `active` assignment sharing the same `sourceReservationId` that currently carries rent. Exactly one payer at a time is enforced.

- [ ] **Step 1: Add the module gate**

Find, in `moduleForAction`:

```ts
  if (
    /^(student-|school-|course-|race-|religion-|assignment-check-in)/.test(
      action,
    )
  )
    return "students";
```

Replace with:

```ts
  if (
    /^(student-|school-|course-|race-|religion-|assignment-check-in|whole-unit-claim)/.test(
      action,
    )
  )
    return "students";
```

- [ ] **Step 2: Add the action handler**

Find the end of the `reservation-room-change` branch and the start of the next one (search for `} else if (action === "reservation-room-change") {` — this task inserts a new branch right after it ends, before whatever `} else if` currently follows it. Re-read that boundary exactly, since Task 4 did not touch it, but confirm the branch this plan is about to follow still starts with `} else if (action ===` as expected).

Insert a new branch (place it anywhere among the other action branches — grouping it next to `student-assign` for readability is fine; search for `} else if (action === "student-assign") {` and its closing `});` to insert right after that branch ends):

```ts
    } else if (action === "whole-unit-claim") {
      // Turns one bed of a whole-unit booking from "pending-occupant" into a
      // real tenant — either a brand-new student profile or an existing one
      // — without creating a second assignment for the same bed.
      const assignmentId = asNumber(body.assignmentId);
      if (!assignmentId) throw new Error("Room is required");
      const assignment = (
        await db
          .select()
          .from(accommodationAssignments)
          .where(eq(accommodationAssignments.id, assignmentId))
      )[0];
      if (!assignment) throw new Error("Assignment not found");
      if (assignment.status !== "pending-occupant")
        throw new Error("This room has already been claimed");
      let studentId = asNullableNumber(body.studentId);
      if (studentId) {
        const alreadyLinked = (
          await db
            .select({ id: accommodationAssignments.id })
            .from(accommodationAssignments)
            .where(
              and(
                eq(accommodationAssignments.studentId, studentId),
                inArray(accommodationAssignments.status, [
                  "active",
                  "pending-occupant",
                ]),
              ),
            )
        )[0];
        if (alreadyLinked)
          throw new Error(
            "This student already has a room — pick a different student or move them first",
          );
      } else {
        if (!asText(body.fullName))
          throw new Error("Full name is required for a new student");
        const inserted = await db
          .insert(studentProfiles)
          .values({
            sourceKey: `whole-unit-claim:${assignmentId}:${Date.now()}`,
            fullName: asText(body.fullName),
            identityNo: asText(body.identityNo),
            contactNumber: asText(body.contactNumber),
            email: asText(body.email),
            gender: asText(body.gender, "unspecified"),
            nationality: asText(body.nationality),
            status: "active",
          })
          .returning({ id: studentProfiles.id });
        studentId = inserted[0].id;
      }
      const isPayer = boolValue(body.isPayer);
      const reservation = assignment.sourceReservationId
        ? (
            await db
              .select({ wholeUnitMonthlyRent: reservations.wholeUnitMonthlyRent })
              .from(reservations)
              .where(eq(reservations.id, assignment.sourceReservationId))
          )[0]
        : undefined;
      const payerRent = reservation?.wholeUnitMonthlyRent ?? 0;
      // Same style note as reservation-confirm-unit above: raw sql inside
      // the transaction, matching every other tx in this file.
      await db.transaction(async (tx) => {
        if (isPayer && assignment.sourceReservationId) {
          await tx.execute(sql`
            UPDATE accommodation_assignments SET monthly_rental = 0
            WHERE source_reservation_id = ${assignment.sourceReservationId}
              AND status = 'active'
          `);
        }
        await tx.execute(sql`
          UPDATE accommodation_assignments
          SET student_id = ${studentId}, status = 'active',
              monthly_rental = ${isPayer ? payerRent : 0}
          WHERE id = ${assignmentId}
        `);
      });
    } else if (action === "reservation-room-change") {
```

Note the closing line repeats the next branch's own opening — this shows where the new branch ends and the untouched next one resumes; do not duplicate `reservation-room-change`'s body.

`studentProfiles` and `boolValue` are already imported/defined in this file (used by other branches already read in this plan).

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

- [ ] **Step 4: Verify live**

Using the fixtures from Task 4's verification (or fresh equivalents — a converted whole-unit reservation with 2+ `pending-occupant` assignments):
1. Claim the first bed with `isPayer: true` and a new student's `fullName` — confirm a new `student_profiles` row exists, the assignment is now `status='active'`, `studentId` set, `monthlyRental` equals the reservation's `wholeUnitMonthlyRent`.
2. Claim the second bed with `isPayer: false` — confirm `monthlyRental = 0`.
3. Claim a third bed (if the test unit has one) with `isPayer: true` — confirm the *first* claimed assignment's `monthlyRental` is now `0` and the third one carries the full rent. Exactly one assignment in the reservation has non-zero rent at any point — check this explicitly with a query after each step.
4. Attempt to claim an already-claimed bed again — confirm rejection, no changes.
5. Attempt to claim a bed with a `studentId` that's already linked to another active/pending assignment — confirm rejection.
6. Clean up every fixture created (assignments, student profiles, reservation, and anything from Task 4 you're reusing).

---

### Task 6: Reservation form — filtered unit picker + suggested rent

**Files:** Modify `app/modules/HostelInformation.tsx`

**Interfaces:**
- Consumes: `bed.availableFrom`, `bed.status`, `bed.salesRate`, `bed.monthlyRental`, `bed.agreementEndDate` (all already present on `data.bedSpaces` — no server change needed for this task), `roomOptionsFrom` (already imported from `./shared`).
- Produces: the "Unit / house to reserve" picker (step 2 of `ReservationForm`, `kind === "group"`) only lists units where every bed qualifies; selecting one shows a warning for any bed whose current tenant hasn't checked out yet, and auto-fills a new editable "Monthly rent" field with the sum of the unit's room rates. The same filtering is applied to `ConvertAssignmentForm`'s "change unit" picker.

- [ ] **Step 1: Read the current `ReservationForm` step-2 code in full**

Re-find `isSelectable`, `genderFits`, `hostelBeds`, `blockOptions`, `blockedBeds`, `unitOptions`, and the `kind === "group"` JSX block around the "Unit / house to reserve" `<select>` before editing — this plan was written against the current file, but re-confirm nothing has shifted.

- [ ] **Step 2: Compute whole-unit-qualifying options**

Find:

```ts
  const unitOptions = [
    ...new Map(
      blockedBeds.map((bed) => [String(bed.unitId), String(bed.unitCode)]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
```

Add immediately after it:

```ts
  // Whole-unit picker: a unit qualifies only if EVERY bed in it qualifies —
  // vacant, or occupied by a tenant contractually due out on or before the
  // target move-in date. Built from every bed regardless of current status
  // (hostelBeds/blockedBeds above only keep the already-selectable ones),
  // so an occupied bed can still be seen and tested, not silently dropped.
  const allUnitBeds = data.bedSpaces.filter(
    (bed) =>
      (!hostelId || String(bed.hostelId) === hostelId) &&
      (!block || blockOf(bed.unitCode) === block) &&
      genderFits(bed.gender),
  );
  const bedsByUnit = new Map<string, Row[]>();
  for (const bed of allUnitBeds) {
    const key = String(bed.unitId);
    const list = bedsByUnit.get(key);
    if (list) list.push(bed);
    else bedsByUnit.set(key, [bed]);
  }
  const wholeUnitOptions = [...bedsByUnit.entries()]
    // isSelectable(bed) alone is correct here — do NOT add a
    // `bed.status === "vacant" ||` short-circuit in front of it. A vacant
    // bed can still be provisionally held by another open reservation;
    // isSelectable's own !reservedBedIds.has(bed.id) check is what excludes
    // that, and a `vacant ||` in front of it would bypass that check for
    // every vacant bed, silently reintroducing the double-booking bug this
    // task exists to close (confirmed by review during Task 4's server-side
    // equivalent of this same check).
    .filter(([, beds]) => beds.every((bed) => isSelectable(bed)))
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
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
```

- [ ] **Step 3: Add rent state and wire the picker to `wholeUnitOptions`**

Find, near the other `useState` declarations at the top of this component:

```ts
  const [bedSpaceId, setBedSpaceId] = useState(
    String(
      editingReservation?.provisionalBedSpaceId || reservationBed?.id || "",
    ),
  );
```

Add immediately after it:

```ts
  const [wholeUnitRent, setWholeUnitRent] = useState<number | "">(
    editingReservation?.wholeUnitMonthlyRent ?? "",
  );
```

Find the existing `kind === "group"` unit-picker JSX:

```tsx
        {kind === "group" ? (
          <label className="wide">
            Unit / house to reserve
            <select
              name="preferredUnitId"
              required
              value={unitId}
              disabled={!hostelId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <option value="">
                {hostelId ? "Select a unit" : "Select a hostel first"}
              </option>
              {unitOptions.map(([id, code]) => (
                <option key={id} value={id}>
                  {code}
                </option>
              ))}
            </select>
            <small className="field-note">
              The whole unit is reserved for this group.
            </small>
          </label>
        ) : (
```

Replace with:

```tsx
        {kind === "group" ? (
          <>
            <label className="wide">
              Unit / house to reserve
              <select
                name="preferredUnitId"
                required
                value={unitId}
                disabled={!hostelId}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  const option = wholeUnitOptions.find(
                    (opt) => opt.id === event.target.value,
                  );
                  setWholeUnitRent(option ? option.suggestedRent : "");
                }}
              >
                <option value="">
                  {hostelId
                    ? wholeUnitOptions.length
                      ? "Select a unit"
                      : "No unit is fully available for this move-in date"
                    : "Select a hostel first"}
                </option>
                {wholeUnitOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.code}
                  </option>
                ))}
              </select>
              <small className="field-note">
                Only units where every room is vacant, or free by the move-in
                date, are shown.
              </small>
            </label>
            {(() => {
              const selected = wholeUnitOptions.find(
                (opt) => opt.id === unitId,
              );
              return selected?.warnings.length ? (
                <div
                  className="wide"
                  style={{
                    background: "#fef3c7",
                    border: "1px solid #fde68a",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    fontSize: "13px",
                    color: "#92400e",
                  }}
                >
                  {selected.warnings.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              ) : null;
            })()}
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
                Defaults to the sum of the unit's room rates; edit for a
                negotiated price.
              </small>
            </label>
          </>
        ) : (
```

**Deliberately out of scope:** `ConvertAssignmentForm`'s own "change unit" fallback picker (shown only when the unit chosen at creation time is no longer available at confirm time — a rare path) is not filtered by this task. It doesn't need to be for correctness: Task 4's server-side re-check rejects any disqualified unit at confirm time regardless of what this fallback picker offers, so the worst case is a clear rejection error asking staff to pick again, not a bad conversion. Filtering this secondary picker too is a reasonable follow-up, not required here.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 5: Verify in the browser**

Dev server on :3000 (start if not running). Using synthetic `ZZTEST` fixtures (hostel + unit + a few rooms/beds in varying states — vacant, occupied-ending-before-target, occupied-ending-after-target):
1. Open the reservation form, pick "Whole unit", pick the hostel — confirm only the fully-qualifying unit(s) appear, and the unit with a bed ending *after* the target move-in date does not appear at all.
2. Pick the unit with a bed ending on/before the target date but not yet checked out — confirm the warning box shows the right room and date.
3. Confirm "Monthly rent for the whole unit" auto-fills to the sum of that unit's room rates, and can be edited.
4. Change the target move-in date to something that now excludes the previously-qualifying unit — confirm the picker drops it (may need to reselect the hostel to re-trigger the memoized list if it isn't already reactive to `date` — `isSelectable` already closes over `date`, so this should update automatically; confirm it does).
5. Clean up every fixture.

---

### Task 7: Room Information — claim a pending-occupant bed

**Files:** Modify `app/modules/HostelInformation.tsx`

**Interfaces:**
- Consumes: Task 2's `bed.assignmentStatus`/`bed.sourceReservationId`, Task 5's `whole-unit-claim` action.
- Produces: a `pending-occupant` bed's chip still reads "Reserved" (unchanged `roomStatus`/`ROOM_STATE_LABELS` — no new `RoomState` needed), but its popover shows "Part of a whole-unit booking — not yet claimed" instead of the generic "no student profile" message, with a "Claim this room" button that opens a small new modal to name the occupant (new student or an existing one) and mark them payer or not.

- [ ] **Step 1: Extend `reservationByBedId` to cover whole-unit beds**

Find:

```ts
  const reservationByBedId = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of data.reservations) {
      if (row.status !== "reserved" && row.status !== "converted") continue;
      for (const bedId of [row.provisionalBedSpaceId, row.assignedBedSpaceId]) {
        if (bedId) map.set(String(bedId), row);
      }
    }
    return map;
  }, [data.reservations]);
```

Replace with:

```ts
  const reservationByBedId = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of data.reservations) {
      if (row.status !== "reserved" && row.status !== "converted") continue;
      for (const bedId of [row.provisionalBedSpaceId, row.assignedBedSpaceId]) {
        if (bedId) map.set(String(bedId), row);
      }
    }
    // A whole-unit booking's beds aren't referenced by the reservation's own
    // bed-pointer fields (it holds a whole unit, not one bed) — link them
    // via the placeholder assignment's sourceReservationId instead.
    const byId = new Map(data.reservations.map((row) => [row.id, row]));
    for (const bed of data.bedSpaces) {
      if (bed.assignmentStatus !== "pending-occupant" || !bed.sourceReservationId)
        continue;
      const row = byId.get(bed.sourceReservationId);
      if (row) map.set(String(bed.id), row);
    }
    return map;
  }, [data.reservations, data.bedSpaces]);
```

- [ ] **Step 2: Add a "claim" modal state and open/close wiring**

Find, near the `occupantPopoverBedId` state:

```ts
  const [occupantPopoverBedId, setOccupantPopoverBedId] = useState<
    number | null
  >(null);
```

Add after it:

```ts
  const [claimBed, setClaimBed] = useState<Row | null>(null);
```

- [ ] **Step 3: Extend `OccupantPopover` with a claim branch**

Find, in `OccupantPopover`:

```tsx
      ) : (
        <p className="occupant-popover-empty">
          No student profile is linked to this tenancy.
        </p>
      )}
      {isReserved && onEdit && (
```

Replace with:

```tsx
      ) : bed.assignmentStatus === "pending-occupant" ? (
        <>
          <p className="occupant-popover-empty">
            Part of a whole-unit booking — not yet claimed.
          </p>
          {onClaim && (
            <button
              type="button"
              className="secondary compact occupant-popover-edit"
              onClick={onClaim}
            >
              Claim this room
            </button>
          )}
        </>
      ) : (
        <p className="occupant-popover-empty">
          No student profile is linked to this tenancy.
        </p>
      )}
      {isReserved && onEdit && (
```

Add `onClaim` to the component's props type (find the props destructuring `{ bed, chipState, popoverRef, onClose, onEdit }: {` and its type block right after) — add `onClaim?: () => void;` alongside the existing `onEdit?: () => void;`.

- [ ] **Step 4: Wire `onClaim` at the call site and add the modal**

Find where `<OccupantPopover ... onEdit={...} />` is rendered (inside the room-chip map). Add `onClaim` alongside the existing `onEdit` prop:

```tsx
                                        onClaim={
                                          bed.assignmentStatus ===
                                          "pending-occupant"
                                            ? () => {
                                                setOccupantPopoverBedId(null);
                                                setClaimBed(bed);
                                              }
                                            : undefined
                                        }
```

Add the modal itself near the other modals in this file's return statement (alongside `{convertReservation && (<Modal ...>)}` — insert a sibling block):

```tsx
      {claimBed && (
        <Modal
          title={claimBed.legacyCode || `Room ${claimBed.roomLabel}`}
          kicker="WHOLE-UNIT BOOKING"
          description="Name who is actually staying in this room."
          onClose={() => setClaimBed(null)}
        >
          <ClaimRoomForm
            data={data}
            save={save}
            busy={busy}
            bed={claimBed}
            reservation={reservationByBedId.get(String(claimBed.id))}
            onDone={() => setClaimBed(null)}
          />
        </Modal>
      )}
```

- [ ] **Step 5: Write `ClaimRoomForm`**

Add this new component near `ConvertAssignmentForm` (same file):

```tsx
// A whole-unit booking's room starts as a placeholder (Task 4/5 in the
// implementation plan) — this names who's actually staying in it. Kept
// deliberately smaller than the full Student Information "add student"
// form: full name plus the handful of fields staff realistically have on
// hand when someone moves in; anything else is filled in later from
// Student Information the normal way.
function ClaimRoomForm({
  data,
  save,
  busy,
  bed,
  reservation,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  bed: Row;
  reservation: Row | undefined;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [isPayer, setIsPayer] = useState(true);
  const existingStudentOptions = data.students
    .filter((student: Row) => student.status === "active")
    .map((student: Row) => ({
      value: student.id,
      label: `${student.fullName}${student.studentCode ? ` (${student.studentCode})` : ""}`,
    }));
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          {
            action: "whole-unit-claim",
            assignmentId: bed.assignmentId,
            isPayer,
            ...formValues(e),
          },
          "Room claimed",
        );
        if (ok) onDone();
      }}
    >
      <div className="wide" style={{ display: "flex", gap: "12px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input
            type="radio"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          New student
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input
            type="radio"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          Existing student
        </label>
      </div>
      {mode === "existing" ? (
        <label className="wide">
          Student
          <SearchSelect
            name="studentId"
            options={existingStudentOptions}
            required
          />
        </label>
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
      <label className="wide" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <input
          type="checkbox"
          checked={isPayer}
          onChange={(event) => setIsPayer(event.target.checked)}
        />
        This person pays the full unit rent
        {reservation?.wholeUnitMonthlyRent
          ? ` (${money(reservation.wholeUnitMonthlyRent)}/month)`
          : ""}
      </label>
      <div className="form-actions wide">
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Claim room
        </button>
      </div>
    </form>
  );
}
```

(`SearchSelect`, `formValues`, `money` are already imported/available in this file from `./shared` — confirm before adding a duplicate import.)

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 7: Verify in the browser**

Using a converted whole-unit reservation from Task 4/6's fixtures (or fresh ones): open Room Information, click a "Reserved" chip that has no occupant — confirm the popover shows "Part of a whole-unit booking" and the "Claim this room" button. Claim it as a new student, non-payer first (confirm rent stays 0), then claim a second room as payer (confirm the reservation's rent amount shows in the checkbox label). Reopen the first (already-claimed) bed's chip — confirm it now shows as a normal occupied/reserved tenant, not the claim UI again. Clean up every fixture.

---

### Task 8: Manage-drawer progress panel + end-to-end pass

**Files:** Modify `app/modules/HostelInformation.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: a reservation's "Manage" drawer shows, for a converted whole-unit booking, every room in the unit with either the claimed student's name (and a payer badge) or "Pending".

- [ ] **Step 1: Add the panel to `ReservationManageDetails`**

Find the end of the "Reservation state" block:

```tsx
      <div
        className={`reservation-commitment ${commitmentClass}`}
        style={{ padding: '12px 16px', gap: '12px' }}
      >
```

... (the block continues to its closing `</div>` — find that closing tag, immediately followed by whatever section comes next in the current file) and insert a new sibling section right after that block's closing `</div>`:

```tsx
      {/* Whole-unit claim progress */}
      {r.reservationType === "group" && isConverted && (
        <div className="reservation-preferences" style={{ flexDirection: "column", gap: "6px" }}>
          <strong style={{ fontSize: "13px" }}>Rooms in this unit</strong>
          {data.bedSpaces
            .filter((bed: Row) => bed.sourceReservationId === r.id)
            .map((bed: Row) => (
              <div
                key={bed.id}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}
              >
                <span>{bed.legacyCode || `Room ${bed.roomLabel}`}</span>
                <span>
                  {bed.assignmentStatus === "pending-occupant"
                    ? "Pending"
                    : `${bed.occupantName}${Number(bed.assignmentRental || 0) > 0 ? " · payer" : ""}`}
                </span>
              </div>
            ))}
        </div>
      )}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/HostelInformation.tsx
```

- [ ] **Step 3: Verify in the browser**

Open the "Manage" drawer for a converted whole-unit reservation with a mix of claimed/pending rooms — confirm every room in the unit is listed, pending ones say "Pending", claimed ones show the name, and the payer shows "· payer".

- [ ] **Step 4: Full end-to-end pass**

One synthetic hostel with a 3–4 room unit, run the entire flow start to finish exactly as a real user would: create a whole-unit reservation → confirm it only offers qualifying units → confirm the unit → verify beds reserved + placeholders created → claim two of the rooms (one payer, one not) → check the Manage drawer panel reflects it → change the payer to the other claimed room → confirm the rent moves correctly. Also re-run one individual (non-group) reservation create → convert → check-in end to end to confirm nothing in this plan regressed that unrelated path.

- [ ] **Step 5: Final sweep**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts app/modules/HostelInformation.tsx
```

Confirm zero `ZZTEST` rows remain across `reservations`, `accommodation_assignments`, `student_profiles`, `bed_spaces`/`hostel_rooms`/`hostel_units`/`hostel_properties` (only if you created synthetic ones for this plan), and no leftover files in `.claude-scratch/` beyond what was already tracked (`git status --short .claude-scratch`).
