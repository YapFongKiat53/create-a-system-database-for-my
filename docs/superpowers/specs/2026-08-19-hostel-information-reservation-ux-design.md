# Hostel Information reservation workflow — UX cleanup + gaps

**Goal:** Fix two things in Hostel Information's Reservations area: (1) the
reservation card has accumulated too much inline content across many
feature additions and needs restructuring, and (2) close three small
workflow gaps the user identified — a missing "Course" field, and a
reminder mechanism for temporary room changes.

**Architecture:** Frontend-only restructuring of `HostelInformation.tsx`'s
reservation card and filter row, one small schema addition (reservations.course),
one new optional field + follow-up tracking on room changes
(`accommodation_assignments.expected_return_date`), and a small "pending
room decisions" badge/list reusing the existing pending-review UI pattern
already used for reservation deposits and billing adjustments.

**Tech Stack:** Next.js App Router, Drizzle ORM / Postgres, existing
`save()`/`formValues()` conventions in `app/modules/shared.tsx`.

## Global Constraints

- No new UI libraries — reuse existing `Modal`, `SearchSelect`, pill-select
  patterns already in `app/modules/shared.tsx` and `Finance.tsx`.
- Every schema change needs a `drizzle-kit generate` migration, applied to
  the live Supabase Postgres instance the same way prior migrations this
  project were applied (disposable Node script using `postgres` + the
  generated `.sql` file, `DATABASE_URL` from `.dev.vars`).
- Existing reservation actions (`reservation`, `reservation-update`,
  `reservation-convert`, `reservation-room-change`, `reservation-payment`,
  `reservation-cancel`, `reservation-delete`, `reservation-finance-review`)
  keep their current names and payload shapes — this is a UI reorganization,
  not an API redesign, except where a section explicitly adds a new field.

---

## 1. Reservation card restructuring (Option A — confirmed)

**Current problem:** a single `.reservation-card` in `HostelInformation.tsx`
stacks: header badges, student meta, preference chips, assignment status
row, a 3-column money-summary grid, a conditional credit note, a payment
history list, a conditional quick-payment form (already gated behind
`paymentStatus !== "full"` from the previous session's work), and up to
four action buttons (Edit reservation / Convert assignment or Change room /
Cancel / Delete). That's 8+ visually distinct blocks in one card.

**New shape — collapsed summary + "Manage" modal:**

The card keeps only:
- Header: reference code + payment-status badge, student name, "Converted"
  label when applicable (unchanged from today).
- One compact meta line: reservation type · check-in date · salesperson
  (unchanged from today).
- One compact money line (single row, not a 3-box grid): `Payable RM X ·
  Paid RM Y · Owes RM Z` (or `· Credit RM Z` in place of "Owes" when
  overpaid, reusing the existing `balanceRequired`/`creditBalance` math
  already computed in the card — just rendered as one line instead of a
  3-column grid + separate credit banner).
- Two buttons: the single primary action for the card's status (`Convert
  assignment` when reserved, `Change room` when converted, nothing when
  cancelled), and a `Manage` button.

Everything else — the preference chips, assignment status description,
payment history list, quick-payment form, `Edit reservation`, `Cancel`,
`Delete` — moves into a `Modal` opened by `Manage`. That modal is a new
component, `ReservationManageModal`, taking the same `reservation` row and
rendering the moved sections in their current form (same JSX, same actions,
same `save()` calls) — this is a relocation, not a rewrite of that logic.

**Data/behavior unchanged:** all existing `save()` action calls
(`reservation-payment`, `reservation-update` via `openReservation`,
`reservation-cancel`, `reservation-delete`) keep firing exactly as they do
today; only their trigger buttons move from the card body into the modal.

## 2. Filter/navigation consolidation

**Current problem:** three stacked layers before a reservation card is
visible — the Hostel Information page's top-level tabs (`Availability
search` / `Reservations` / `Room pricing & rates`), the reservation status
tabs (`Reserved` / `Converted` / `Cancelled`), and a full row of
payment-status filter pills (`All` / `Partial` / `Unpaid` / `Admin Fee` /
`Full Payment`).

**Fix:** keep the top-level tabs and the status tabs (both are genuinely
different axes — module area, and reservation lifecycle stage). Replace the
payment-status pill row with a `<select>` dropdown folded into the existing
search toolbar row (same visual treatment as the payment-status filter
`<select className="v2-pill-select">` already used in `Finance.tsx`'s
Invoices tab). The filtering logic (`reservationPaymentFilter` state,
same option values) is unchanged — only the control type changes from a
row of buttons to one dropdown.

## 3. Course field (closes a gap in the "essential data" checklist)

The user supplied a checklist of fields a converted reservation should
carry: S/R No, Unit, Tenant name, IC/Passport, Contact, Monthly rental,
Security deposit, Access card deposit, Salesperson, CI date, TA start,
TA end, TA duration, CO date, CI meter, Nationality, Hometown, Course,
Remarks. Every field already exists on `reservations` and/or
`accommodation_assignments` except **Course**, which currently only
exists on `student_profiles` (populated after conversion, not captured at
reservation time).

- Add `course: text("course").notNull().default("")` to the `reservations`
  table (mirrors how `identityNo` was added earlier this session for the
  same reason — a field needed at reservation time so conversion doesn't
  lose information).
- Add a "Course" input to the reservation form's Personal Information step
  in `HostelInformation.tsx`, next to the existing IC/Nationality fields.
- Carry `reservation.course` into `student_profiles.course` at conversion
  time (`reservation-convert` action), the same way other demographic
  fields are already carried over.
- Confirms payment is *not* required to convert — `reservation-convert`
  already has no payment check today, so no backend change needed there;
  this section is purely about not losing the Course data point.

## 4. Temporary room change — expected return date + follow-up

Extends the `reservation-room-change` action and `ChangeRoomForm` built in
the previous session.

- Add `expectedReturnDate: text("expected_return_date")` (nullable) to
  `accommodation_assignments`.
- `ChangeRoomForm` gets one new optional date input, "Expected return date
  (optional)" — left blank means "permanent move, no follow-up needed."
- `reservation-room-change` action accepts and stores it on the
  assignment.
- New read-only computed list (not a new action): any active assignment
  whose `expectedReturnDate` is today or earlier and hasn't been resolved
  yet. Surfaced as a small pending-count badge on the `Converted` tab
  button, same visual pattern as the existing `Reservation deposits`
  pending-review badge in `Finance.tsx`.
- Clicking the badge (or a room card flagged this way) opens a small
  confirmation prompt with two actions: **"Moved back"** (fires
  `reservation-room-change` back to the original room — reuses the
  existing action and its existing vacancy check as-is, so if the
  original room isn't vacant anymore the action fails with the same
  "Selected room is no longer vacant" error `reservation-room-change`
  already raises today, and staff picks a different room instead) or
  **"Staying"** (clears `expectedReturnDate` on the current assignment
  via a small new action `assignment-clear-return-date`, making the
  current room permanent). No cron/background job — this is a
  computed-on-read list,
  consistent with the rest of this app's request-driven architecture (no
  scheduled tasks exist anywhere in this codebase).

---

## Testing

Each of the four sections above is independently verifiable through the
UI with the same disposable-QA-account pattern used throughout this
session (create a test director account, exercise the flow, verify via
direct SQL read, clean up). No new testing infrastructure needed.
