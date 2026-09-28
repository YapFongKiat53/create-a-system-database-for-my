# Whole-Unit Reservation Design

## Why

`reservationType: "group"` ("Whole unit" in the UI) already exists as an option
in the reservation form, but it is only half-built:

1. Converting a whole-unit reservation (`reservation-confirm-unit`) only
   flips the reservation's own `status` to `converted` — it never touches
   `bed_spaces.status` or creates any `accommodation_assignments`. Every room
   in the unit still shows as vacant in Room Information, so another member
   of staff can (and does) hand one of those rooms to an unrelated
   reservation.
2. The "Unit / house to reserve" picker lists every unit in the hostel with
   no regard for whether its rooms are actually free — a unit that already
   has occupied rooms can still be picked for a whole-unit booking.
3. There is no price suggested for a whole-unit booking; staff have to know
   the individual room rates and add them up by hand.
4. Once a whole-unit reservation is converted, there is no structured way to
   record which student ends up in which room. Staff currently have to use
   the general "+ Add student" flow in Student Information, with nothing
   tying the new student back to "this is part of that block booking", and
   nothing enforcing the "one payer, the rest at RM0" billing pattern the
   billing cycle already relies on (see `wholeUnitIds` in
   `app/api/system/route.ts`).

This spec fixes all four gaps without changing the billing engine itself —
the billing cycle's existing "one assignment with rent > 0, the rest at 0 in
the same unit = block let" rule is reused as-is.

## Decisions taken

- A unit only appears in the whole-unit picker if **every** bed in it
  qualifies: a vacant bed always qualifies; an occupied bed qualifies only if
  its current tenancy's `agreementEndDate <= targetMoveInDate` (the tenant is
  contractually due to be gone by move-in day — whether they've formally
  checked out yet is a separate, non-blocking concern, handled by the
  warning below). A unit with any bed whose tenancy ends *after* the target
  move-in date is excluded outright — not shown, not selectable, no
  override.
- A unit that qualifies only because a bed's agreement has already ended but
  the tenant hasn't formally checked out yet is still shown, with a warning
  (mirrors the existing individual-booking "frees up on X — previous tenant
  still needs checking out" treatment).
- The suggested monthly rent for a whole-unit reservation is the sum of the
  unit's rooms' current rates (same `salesRate ?? monthlyRental` figure Room
  availability already shows). It is a starting value in an editable field,
  not a locked computed one — staff can override it for a negotiated block
  rate.
- Converting a whole-unit reservation creates one `accommodation_assignments`
  row per bed in the unit, all in a new `pending-occupant` status, monthly
  rent 0, `studentId` left null. `bed_spaces.status` becomes `reserved` for
  every bed in the unit at the same time, in the same transaction.
- Filling in who actually occupies each room happens later, one room at a
  time, through a "claim" action on the existing check-in / add-student flow
  — never required up front. A `pending-occupant` bed can sit unclaimed
  indefinitely.
- Exactly one claimed occupant in the unit is marked as the payer at any
  time. Claiming the first occupant defaults them to payer with the full
  (editable) unit rent; every other occupant's assignment carries RM0.
  Staff can move "payer" to a different occupant later, which zeroes the
  previous payer's rent and moves the full rent onto the new one.

## Out of scope for this spec

- Changing the billing cycle's block-let detection logic — it already infers
  a block let from "one payer, the rest RM0 in the same unit" and needs no
  changes.
- Letting a whole-unit reservation span more than one hostel unit.
- A dedicated "un-claim" / release-back-to-vacant flow for a
  `pending-occupant` bed that turns out not to be needed (e.g. the company
  downsizes from 4 rooms to 3) — staff can already delete/adjust an
  assignment through the existing tools; this spec does not add a new one.
- Automatically notifying anyone when a `pending-occupant` bed sits unclaimed
  for a long time.

## Data model

`accommodation_assignments.studentId` (`db/schema.ts`) becomes nullable —
today it is `.notNull().references(() => studentProfiles.id)`. Change to:

```ts
studentId: bigint("student_id", { mode: "number" }).references(
  () => studentProfiles.id,
),
```

No existing row is affected (every current row already has a real
`studentId`); this only widens what a *new* row is allowed to be.

`accommodation_assignments.status` gains one new value, `pending-occupant`,
alongside the existing `active` / whatever else it already carries. No schema
change needed — `status` is already a free-text column.

`reservations` gains one new nullable column, used only by whole-unit
bookings:

```ts
wholeUnitMonthlyRent: doublePrecision("whole_unit_monthly_rent"),
```

This is deliberately separate from the existing `totalPayable` /
`reservationCharges` machinery, which represents one-off upfront charges
(first month, deposits, admin fees) on an individual booking — a recurring
monthly rent for a not-yet-claimed unit is a different concept and must not
be conflated with it. It holds the staff-edited suggested total from the
reservation form, survives a page reload, and is what the first claim
defaults the payer's `monthlyRental` to (Decisions section).

Every other read of `accommodation_assignments` in the codebase that assumes
`studentId` is always present (joins, `student.assignmentId` maps, tenant
scoping in `app/api/system/route.ts`, billing) must treat a `pending-occupant`
row as **not a real tenant**: excluded from billing, excluded from the
tenant-scoping `ownStudents` computation, excluded from occupancy counts that
represent "students living here" (it should still make the bed **not**
offered as vacant to a new booking, which `bed_spaces.status = 'reserved'`
already handles independently of the assignment's own status).

## Reservation form (`app/modules/HostelInformation.tsx`)

The existing step-2 "Unit / house to reserve" `<select>` (shown when
`kind === "group"`) changes its source list. Today `unitOptions` comes from
`data.units` with no availability filtering at all for the group case. It
needs a new computation, scoped to the chosen hostel/block/gender exactly
like the individual flow already does, that:

1. Groups `data.bedSpaces` by `unitId`.
2. For each unit, checks every bed: vacant → passes; occupied → passes only
   if its tenancy's `agreementEndDate <= targetMoveInDate` (read from the
   date field already bound to `date` in this form).
3. Drops any unit with a bed that fails that check.
4. For the units that remain, flags (but does not exclude) any unit
   containing a bed whose tenancy has ended but is not yet checked out
   (`agreementEndDate <= today` but no `checkedInAt`... more precisely,
   mirrors whatever field the individual flow's `reservedBedAvailable` /
   `availableFrom` already reads — reuse that exact signal, don't invent a
   new one).

A short reason string per flagged unit (e.g. "Room 2 — current tenant's
lease ends 15 Mar, not yet checked out") is shown as a warning under the
picker when that unit is selected, matching the existing amber-box pattern
used elsewhere in this form (`reservationBed?.status === "occupied"` block).

A new "Suggested monthly rent" number field appears once a unit is selected,
pre-filled with the sum of `roomOptionsFrom(...).rate` (falling back to 0 for
any room with no rate set — and visibly flagging that in the field's helper
text, e.g. "1 room has no rate set — check before confirming") for every room
in the chosen unit. It is a normal editable input, submitted as
`monthlyRental` on the confirm-unit action.

## Conversion (`app/api/system/route.ts`, `reservation-confirm-unit`)

Today this action only does an `UPDATE reservations SET status='converted',
preferred_unit_id=...`. For a group reservation it must now, in the same
transaction:

1. Look up every `bedSpaces` row for the confirmed `unitId`.
2. Reject (throw, rolling back) if any of those beds is not vacant and not
   eligible under the same rule the picker used — this is the server-side
   mirror of the client-side filter, closing the race window between
   "picker loaded" and "convert clicked".
3. Insert one `accommodation_assignments` row per bed:
   `studentId: null`, `status: "pending-occupant"`, `monthlyRental: 0`,
   `sourceReservationId: reservationId`, `checkInDate` /
   `agreementStartDate` from the reservation's `targetMoveInDate`.
4. Update every one of those beds' `bed_spaces.status` to `"reserved"`.
5. Existing behaviour (notify the sales role) stays as is.

The reservation's submitted rent (from the new suggested-rent field) is
stored on `reservations.wholeUnitMonthlyRent` at confirm time. It is the
starting point handed to whichever occupant becomes the payer in the claim
step below, and survives a page reload before anyone has been claimed yet.

## Claiming a room (new, small addition)

Room Information's room/bed card, when a bed's assignment status is
`pending-occupant`, shows a "Pending occupant — part of a whole-unit booking"
label instead of "Vacant", plus a "Claim / add student" action. This action
reuses the existing add-student / check-in flow (same modal, same fields),
with one difference: instead of creating a brand-new
`accommodation_assignments` row, it fills in the `studentId` on the existing
`pending-occupant` row and flips its `status` to `active`.

The claim form adds one control: a checkbox or radio, "This person pays the
full unit rent." Checking it:
- Sets this assignment's `monthlyRental` to the unit's suggested/edited
  total.
- Finds any other `active` assignment in the same unit whose
  `sourceReservationId` matches this booking and zeroes its `monthlyRental`
  (moving payer status off it).

If nobody has been marked payer yet and this is the first claim, the
checkbox defaults to checked (first occupant defaults to payer, per the
Decisions section) but remains editable before submit.

A small panel on the reservation's "Manage" drawer (`ReservationManageDetails`)
shows claim progress for a whole-unit booking: each room, its `roomLabel`,
and either the claimed student's name (with a "payer" badge on the one
carrying rent) or "Pending".

## Error handling

- Convert-time race (a bed stopped qualifying between picker load and
  submit): the whole conversion is rejected, nothing is created or changed,
  and the error names the offending room so staff know what changed.
- Claiming a bed that is no longer `pending-occupant` (already claimed by
  someone else in a concurrent request): rejected with a clear "already
  claimed" error, no partial update.
- Marking a new payer always succeeds atomically with un-marking the old one
  (single transaction) — never a moment with two payers or zero payers if a
  request fails partway.

## Testing

Synthetic `ZZTEST` fixtures against the real dev database, as with every
other feature this session, cleaned up after:

1. A unit with all beds vacant → appears in the whole-unit picker; suggested
   rent equals the sum of its rooms' rates.
2. A unit with one bed occupied, tenancy ending after the target move-in
   date → does not appear at all.
3. A unit with one bed occupied, tenancy ending before the target move-in
   date, tenant not yet checked out → appears, with the warning shown.
4. Convert a qualifying whole-unit reservation → confirm one
   `pending-occupant` assignment per bed, all beds now `reserved`, none of
   them offered by the individual-booking room picker any more.
5. Convert-time race: mark one bed occupied between picker load and submit
   (simulate by not re-checking) → confirm the whole conversion is rejected
   and no assignment/bed-status change survives.
6. Claim the first pending bed → confirms as payer by default, rent set to
   the unit total; claim a second bed → defaults to RM0, checkbox unchecked.
7. Move payer from the first claimed occupant to the second → confirm first
   drops to RM0 and second carries the full rent, and only one of them ever
   shows as payer at a time.
8. Run this whole-unit tenancy through a billing cycle generation and
   confirm the existing block-let detection (`wholeUnitIds`) picks it up
   correctly — one invoice for the payer with the full rent, RM0 invoices
   (or no invoice, whichever the existing logic already does for a RM0
   assignment) for the rest.
9. Confirm an existing (non-whole-unit) individual booking and its
   conversion are completely unaffected.
10. `tsc --noEmit` / `eslint` clean on every changed file.
