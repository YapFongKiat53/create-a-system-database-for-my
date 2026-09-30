# Whole-Unit Company Details & Up-Front Tenant List Design

## Why

The whole-unit reservation form (built in the previous plan,
`docs/superpowers/plans/2026-09-28-whole-unit-reservation.md`) only collects
one person's details — the "representative" — regardless of whether the
booking is really a handful of friends renting together or a company signing
a lease for its staff. Real bookings need:

- Proper company/agency fields (registration number, address, billing
  email) distinct from the personal contact who happens to deal with the
  hostel day to day.
- A record of who pays the electricity/water bill (the company, or each
  tenant individually) so staff know where to send it.
- A way to name some or all of the actual occupants **while creating the
  booking**, when staff often already have a tenant list in hand (e.g. from
  the company's HR), instead of only being able to name them one room at a
  time, later, through Manage.

## Decisions taken

- The existing "Representative type" (Person / Company / Institute) becomes
  a two-way choice, **Individual** / **Agency or Company**, shown only for a
  whole-unit ("group") booking — this does not touch the top-level
  Individual/Whole-unit reservation type choice at all.
- **Agency or Company** adds four new fields: Organisation Name, Company
  Registration Number, Organisation Address, Company Email. The existing
  Representative Name/IC/Phone/Email fields (`studentName`/`identityNo`/
  `contactNumber`/`email`) are kept as-is and now read as "the person at
  this company we actually deal with" — a company booking still has exactly
  one point-of-contact person, same as today. Date of birth is hidden (not
  merely optional) for **Agency or Company** — it has no bearing on a
  company contact.
- One real reservation today has `representativeType = 'institute'`
  (confirmed via a live query). The new two-option `<select>` no longer
  offers "Institute" as a choice, but **must not silently reclassify that
  row** the next time someone edits it and saves without touching this
  field. The form treats `representativeType === "institute"` exactly like
  `"company"` for display (shows the organisation fields, hides date of
  birth) and leaves the stored value alone unless the user explicitly
  changes the dropdown — which then saves as `"company"`, same as choosing
  it for a brand new booking.
- A single new field, **"Utilities (TNB & Air Selangor) billed to":
  Company / Tenant**, is added to the whole-unit form (shown regardless of
  Individual/Agency choice — even an individual group might have one person
  handling the utility account). It is purely a record for staff — it does
  **not** change the billing cycle's existing electricity calculation. Only
  electricity is ever actually billed to a tenant in this system today
  (confirmed with the user); this field exists so staff know who a bill
  should be handed to, nothing more.
- Once a qualifying unit is picked (the same picker from the previous
  plan), the form shows one **tenant slot** per room in that unit — Name,
  IC, Contact number, Gender, Student / Non-student. **Every field in every
  slot is optional**, and leaving all of them blank behaves exactly as
  today (every room stays unclaimed, to be filled in later through Manage).
  Exactly one filled slot can be marked as the payer, mirroring the
  existing Manage-drawer claim form's own payer checkbox; if none is
  explicitly marked, the first filled slot is treated as the payer, the
  same "first claim defaults to payer" rule already used for the room's
  claim.
- Confirming the unit (`reservation-confirm-unit`) now does, for each bed,
  one of two things instead of always creating a placeholder: a bed with a
  matching filled tenant slot is claimed immediately (a real
  `student_profiles` row and an `active` assignment, exactly as if
  Manage's "Fill in student" form had been used right after confirming); a
  bed with no matching filled slot becomes `pending-occupant`, exactly as
  today. Slots are matched to beds by position (the unit's rooms in the
  same order the picker already lists them), not by any stronger identity —
  if the unit's rooms somehow changed between filling the list and
  confirming (rare — normally minutes apart, same session), extra slots
  beyond the number of rooms are dropped and extra rooms beyond the number
  of filled slots stay pending, rather than erroring.
- The existing Manage-drawer "Fill in student" form (`ClaimRoomForm`,
  built in the previous plan) gains the same two fields — Gender and
  Student / Non-student — so a room filled in later, one at a time, collects
  exactly the same information as one filled in up front.

## Out of scope for this spec

- Any change to the billing cycle's electricity calculation based on the
  new "billed to" field — it is a label only, as decided above.
- Adding Gender/Student-or-not to the *general* "add student"
  flows elsewhere in the app (Student Information's own "+ Add student",
  `student-create`/`student-assign`) — scoped to the whole-unit booking
  flow (the creation-time tenant list and `ClaimRoomForm`) only.
- Hiding any field other than Date of birth for an Agency/Company booking.
  School, course, race, religion, nationality etc. on the representative
  stay exactly as they are today; only date of birth is dropped, because
  it's the one field the user explicitly named as not needed.
- Editing or removing a tenant slot's entry after the unit has been
  confirmed (once confirmed, that occupant is a real tenant, corrected the
  same way any other tenant's details are corrected today — Student
  Information — not through this form).
- A payer-reassignment feature. This spec's up-front slots use the exact
  same "first filled defaults to payer, one explicit override" rule the
  existing Manage claim flow already has, and shares its known, deliberate
  limitation: moving payer status between two *already-claimed* rooms still
  has no dedicated action (tracked separately, not solved here).

## Data model

### `reservations` — five new columns

```ts
export const reservations = pgTable("reservations", {
  // ...existing columns...
  organisationName: text("organisation_name").notNull().default(""),
  companyRegistrationNo: text("company_registration_no").notNull().default(""),
  organisationAddress: text("organisation_address").notNull().default(""),
  companyEmail: text("company_email").notNull().default(""),
  // "company" | "tenant" — who the TNB/Air Selangor bill goes to. A label
  // for staff only; see "Out of scope" above.
  utilityBilledTo: text("utility_billed_to").notNull().default("tenant"),
});
```

### New table: `reservation_group_tenants`

Holds the up-front tenant list while the booking is still `reserved` — one
row per filled slot (a slot left entirely blank is never inserted, so this
table only ever holds real, partial or complete entries). Confirming the
unit consumes these rows and deletes them; they never coexist with the real
`accommodation_assignments` rows they become.

```ts
export const reservationGroupTenants = pgTable("reservation_group_tenants", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  // Position among the unit's rooms at the time this was saved (0-based),
  // used only to match a slot to a bed when confirming — see "Decisions
  // taken" above for what happens if the room count has since changed.
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

(`boolean` is already imported in `db/schema.ts` — used by `inventoryCommitted`
on the same `reservations` table.)

### `student_profiles` — one new column

```ts
export const studentProfiles = pgTable("student_profiles", {
  // ...existing columns...
  isStudent: boolean("is_student").notNull().default(true),
});
```

Applies to every student profile, not only ones created through this flow —
existing rows default to `true` (the overwhelming majority of profiles in
this system are, in fact, students), and nothing else in the app reads this
column yet (per "Out of scope" above), so the default causes no behaviour
change anywhere else.

## Server changes (`app/api/system/route.ts`)

### `reservation` / `reservation-update`

Add the five new fields to the existing `values` object (same pattern as
every other reservation field there):

```ts
organisationName: asText(body.organisationName),
companyRegistrationNo: asText(body.companyRegistrationNo),
organisationAddress: asText(body.organisationAddress),
companyEmail: asText(body.companyEmail),
utilityBilledTo: asText(body.utilityBilledTo, "tenant"),
```

After the reservation row is inserted/updated (`reservationId` known), add a
new step mirroring `replaceReservationCharges`: replace this reservation's
`reservation_group_tenants` rows with whatever the client just submitted.
Add a small helper near `replaceReservationCharges`:

```ts
async function replaceReservationGroupTenants(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  tenants: Array<{
    slotIndex: number;
    fullName: string;
    identityNo: string;
    contactNumber: string;
    gender: string;
    isStudent: boolean;
    isPayer: boolean;
  }>,
) {
  await db
    .delete(reservationGroupTenants)
    .where(eq(reservationGroupTenants.reservationId, reservationId));
  const filled = tenants.filter((tenant) => tenant.fullName.trim());
  if (!filled.length) return;
  await db.insert(reservationGroupTenants).values(
    filled.map((tenant) => ({
      reservationId,
      slotIndex: tenant.slotIndex,
      fullName: tenant.fullName,
      identityNo: tenant.identityNo,
      contactNumber: tenant.contactNumber,
      gender: tenant.gender,
      isStudent: tenant.isStudent,
      isPayer: tenant.isPayer,
    })),
  );
}
```

Only ever called when `values.reservationType === "group"` and
`body.groupTenants` is present (an array — the client sends one entry per
slot, blank or not; this function itself drops the blank ones). Skip the
call entirely for an individual booking or when the array is absent, so
nothing changes for every other reservation type.

`body.groupTenants` arrives as a JSON array in the POST body (the tenant
slots are not simple named `<input>`s `formValues` already collects — see
Frontend below), so read it as
`Array.isArray(body.groupTenants) ? body.groupTenants : []` and map/validate
each entry with the existing `asText`/`boolValue`/`asNumber` helpers before
passing to the function above.

### `reservation-confirm-unit`

Inside the existing per-bed loop (already inside the one transaction, after
the beds are locked and validated — see the previous plan's Task 4), look up
this reservation's `reservation_group_tenants` rows first (also inside the
transaction, for a consistent view), keyed by `slotIndex`:

```ts
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
```

Only *filled* slots are ever stored (`replaceReservationGroupTenants` drops
blank ones), so `slot_index` values can have gaps — build a lookup by that
value, not by array position:

```ts
const tenantBySlot = new Map(tenantSlots.map((row) => [Number(row.slot_index), row]));
const anyPayerMarked = tenantSlots.some((row) => row.is_payer);
let payerAssigned = false;
```

For bed at position `i` in `lockedBeds` (already ordered — see the previous
plan's `ORDER BY b.id`): look up `tenantBySlot.get(i)`. If found, insert the
`accommodation_assignments` row as `active` with a freshly-created
`student_profiles` row (same insert shape `whole-unit-claim` already uses,
now also setting `is_student` from the slot), `monthly_rental` equal to
`resolvedRent` if this slot is the payer — `is_payer` true, or (when
`!anyPayerMarked`) the first filled slot encountered while walking `i` from
0 upward, tracked with `payerAssigned` so only one ever qualifies this way —
else `0`. A bed with no matching slot gets `pending-occupant` exactly as
today. After all beds are written, delete every
`reservation_group_tenants` row for this reservation — they're now real
tenants, and leaving the draft rows behind would be a second, stale copy of
the same information.

### `whole-unit-claim`

Add `gender` and `isStudent` to the new-student-profile insert (existing
`fullName`/`identityNo`/`contactNumber`/`email`/`nationality` already
there):

```ts
gender: asText(body.gender, "unspecified"),
// boolValue(value) (already in this file) takes no default-value
// parameter and reads a missing field as false — checked explicitly here
// so an old client that never sends isStudent still gets the same
// "assume student" default the schema itself uses, rather than silently
// flipping every such profile to non-student.
isStudent: body.isStudent === undefined ? true : boolValue(body.isStudent),
```

## Frontend changes (`app/modules/HostelInformation.tsx`)

### Step 1 — Individual / Agency or Company

Replace the existing `representativeType` `<select>` (Person/Company/
Institute) with a controlled two-option one:

```tsx
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
```

New state, seeded so an existing `"institute"` row still displays as the
company-style form (per Decisions above) without rewriting its stored
value on an unrelated save:

```ts
const [representativeType, setRepresentativeType] = useState(
  editingReservation?.representativeType || "person",
);
const isCompanyBooking =
  representativeType === "company" || representativeType === "institute";
```

Hide the existing "Date of birth" field when `isCompanyBooking`. Add the
four organisation fields, shown only when `isCompanyBooking`, next to the
existing Representative Name/IC/Phone/Email fields (which keep their
current labels and behaviour unchanged):

```tsx
{kind === "group" && isCompanyBooking && (
  <>
    <label>
      Organisation name
      <input name="organisationName" placeholder="e.g. Acme Sdn Bhd" />
    </label>
    <label>
      Company registration number
      <input name="companyRegistrationNo" placeholder="e.g. 202301012345" />
    </label>
    <label className="wide">
      Organisation address
      <input name="organisationAddress" placeholder="e.g. 12 Jalan Ampang, KL" />
    </label>
    <label>
      Company email
      <input name="companyEmail" type="email" placeholder="e.g. admin@acme.com" />
    </label>
  </>
)}
```

### Step 2 — utility billed-to + tenant slots

Add the utility field once `kind === "group"` (alongside the existing
"Monthly rent for the whole unit" field, same step):

```tsx
<label>
  Utilities (TNB & Air Selangor) billed to
  <select name="utilityBilledTo" defaultValue={editingReservation?.utilityBilledTo || "tenant"}>
    <option value="tenant">Tenant</option>
    <option value="company">Company</option>
  </select>
</label>
```

Once a qualifying unit is selected (`unitId` set, matching `wholeUnitOptions`),
render one tenant-slot block per room in that unit. Room count comes from
`roomOptionsFrom(allUnitBeds-for-this-unit, () => true).length` — the same
computation `wholeUnitOptions` already does per option; reuse the selected
option's own room list rather than recomputing (add a `roomCount` alongside
`suggestedRent`/`missingRate`/`warnings` in the `wholeUnitOptions.map(...)`
result: `roomCount: rooms.length`).

State for the slots (array, length synced to `roomCount` whenever the unit
selection changes):

```ts
type GroupTenantSlot = {
  fullName: string;
  identityNo: string;
  contactNumber: string;
  gender: string;
  isStudent: boolean;
  isPayer: boolean;
};
const blankSlot = (): GroupTenantSlot => ({
  fullName: "",
  identityNo: "",
  contactNumber: "",
  gender: "unspecified",
  isStudent: true,
  isPayer: false,
});
const [groupTenants, setGroupTenants] = useState<GroupTenantSlot[]>([]);
```

On unit change (the same `onChange` that sets `unitId` and
`wholeUnitRent`), resize `groupTenants` to the newly-selected option's
`roomCount` (padding with `blankSlot()` or truncating), preserving already-
typed values for the slots that still exist.

Render (inside the existing `kind === "group"` block, after the rent
field):

```tsx
{groupTenants.length > 0 && (
  <div className="wide" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
    <strong style={{ fontSize: "13px" }}>
      Tenants (optional — fill in as many as you already know)
    </strong>
    {groupTenants.map((slot, index) => (
      <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto auto", gap: "6px" }}>
        <input
          placeholder={`Room ${index + 1} — full name`}
          value={slot.fullName}
          onChange={(event) => updateSlot(index, { fullName: event.target.value })}
        />
        <input
          placeholder="IC"
          value={slot.identityNo}
          onChange={(event) => updateSlot(index, { identityNo: event.target.value })}
        />
        <input
          placeholder="Contact"
          value={slot.contactNumber}
          onChange={(event) => updateSlot(index, { contactNumber: event.target.value })}
        />
        <select
          value={slot.gender}
          onChange={(event) => updateSlot(index, { gender: event.target.value })}
        >
          <option value="unspecified">Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <label style={{ fontSize: "12px" }}>
          <input
            type="checkbox"
            checked={slot.isStudent}
            onChange={(event) => updateSlot(index, { isStudent: event.target.checked })}
          />
          Student
        </label>
        <label style={{ fontSize: "12px" }}>
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
```

(`updateSlot(index, patch)` is a small helper that maps `groupTenants`,
merging `patch` into the entry at `index` — write it once near
`blankSlot`.)

On submit, this form currently builds its POST body from `formValues(e)`
(named inputs) plus whatever extra keys the caller adds — the tenant slots
are state, not named inputs, so add `groupTenants` to the submitted body
explicitly alongside `formValues(e)` in the `save(...)` call this form
already makes, but only when `kind === "group"`:

```ts
...(kind === "group" ? { groupTenants } : {}),
```

If no slot is explicitly marked `isPayer` and at least one slot has a
`fullName`, the server (not the client) defaults the first filled slot to
payer — the client sends whatever `isPayer` flags exist (possibly none) and
does not need its own fallback logic, keeping this one rule in one place
(`reservation-confirm-unit`, per Server changes above).

### `ClaimRoomForm` — gender and student/non-student

`formValues(e)` (`Object.fromEntries(new FormData(...))`) is the wrong tool
for the student flag: a `<select>` submits its value as a normal string
either way, but a plain checkbox is simply **absent** from `FormData` when
unchecked and sends the string `"on"` (not `"true"`) when checked — neither
matches what `boolValue` checks for, and the existing codebase already has
the answer for a boolean like this: track it as state and pass it as a real
JS boolean in the `save(...)` call's own object, the same way this form
already does for `isPayer`, and the same way `CheckInModal` already does for
`confirmSuspicious`. `gender` has no such trap — a `<select>` is fine and
`formValues(e)` already collects it — but for consistency within this one
form, both new fields are handled as state, in the "New student" branch
only (an existing profile's gender/student status is corrected in Student
Information, not re-asked here):

```ts
const [gender, setGender] = useState("unspecified");
const [isStudent, setIsStudent] = useState(true);
```

```tsx
{mode === "new" && (
  <>
    {/* ...existing full name / IC / phone / email fields... */}
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

And in the form's `onSubmit`, add both to the object already passed to
`save(...)` alongside the existing `isPayer`:

```ts
const ok = await save(
  {
    action: "whole-unit-claim",
    assignmentId: bed.assignmentId,
    isPayer,
    ...(mode === "new" ? { gender, isStudent } : {}),
    ...formValues(e),
  },
  "Room claimed",
);
```

(Only sent in "New student" mode — claiming an existing profile must never
overwrite that profile's own gender/student status with these fields'
default values.)

## Error handling

- A tenant slot's IC/phone are never validated for format here (the
  existing individual-booking IC field does apply a pattern — this spec
  deliberately does not, since these are quick, optional, often-incomplete
  entries staff type from a list) — left free text, exactly like
  `ClaimRoomForm`'s own IC field today.
- If `reservation-confirm-unit` finds more filled tenant slots than rooms in
  the unit (a mismatch since the list was filled in), the extra slots are
  silently dropped — not an error — per the "Decisions taken" section.
- If two slots are both marked `isPayer` (a client bug or a very fast
  double-click), the server's simple "first payer slot found" read takes
  only one — no explicit rejection needed since the client radio-button
  pattern already prevents this by construction (one `name` group per
  form).
- Deleting a reservation while it's still `reserved` (before confirming)
  already deletes the reservation row via the existing `reservation-delete`
  action; add `reservation_group_tenants` to the set of rows that action
  cleans up (it currently has no FK cascade, matching every other
  reservation-scoped table there).

## Testing

Synthetic `ZZTEST` fixtures against the real dev database, cleaned up
after, as with every feature this session:

1. Create a group reservation, pick "Agency or Company" → confirm the four
   organisation fields appear and Date of birth disappears; save and
   confirm all four persist and reload correctly.
2. Edit the one real `representativeType = 'institute'` reservation (read
   its id, don't actually save unless reverted) — confirm it renders with
   the organisation fields shown (institute treated as company for
   display) and that saving it WITHOUT touching the booking-type dropdown
   does not change its stored `representative_type` away from
   `'institute'` — actually verify this precisely, since it's a real row.
3. Pick a qualifying 3-room unit → confirm 3 tenant slots render; fill 2,
   leave 1 blank, mark the second as payer; save the reservation → confirm
   `reservation_group_tenants` has exactly 2 rows with the right
   `is_payer` flags.
4. Confirm the unit → confirm exactly 2 real `active` assignments were
   created (matching the 2 filled slots, in slot order against the unit's
   rooms) with the marked payer carrying the full rent and the other at 0,
   1 `pending-occupant` assignment for the unmatched room, and that
   `reservation_group_tenants` is now empty for this reservation.
5. Repeat with zero slots filled → confirm behaviour is unchanged from the
   previous plan (every room `pending-occupant`).
6. Claim a still-pending room via Manage's "Fill in student" → confirm the
   new Gender/Student checkbox submit correctly onto the new profile's
   `gender`/`is_student` columns.
7. `tsc --noEmit` / `eslint` clean on every changed file.
