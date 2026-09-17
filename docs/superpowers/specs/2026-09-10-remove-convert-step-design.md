# Reserve straight to check-in — design

**Date**: 2026-09-10
**Scope**: Remove the manual "Convert assignment" step. A reservation becomes
a tenancy the moment money is taken, and the next thing staff do is check the
student in.

---

## Why

Booking a room takes three staff actions today: create the reservation, record
the payment, then press **Convert assignment**. The third one is the odd one
out — nothing about it is a decision. By the time money has been taken the
room is already held, the rate is already agreed, and the room was already
chosen when the reservation was made. Staff press Convert because the system
asks them to, not because anything is being decided.

It also leaves the system holding the same fact twice, in two different
places, for as long as the gap lasts:

| Mechanism | Set when | Kind |
|---|---|---|
| the reservation's `inventoryCommitted` | any payment arrives | soft — the availability count subtracts it on the client |
| the bed's own `status = 'reserved'` | **only at convert** | hard — the actual state in the database |

Closing the gap collapses those into one. That is a real simplification, not
just a shorter click path.

## Decisions taken

| Question | Decision |
|---|---|
| When are the profile, tenancy and move-in invoice created? | The moment a payment is recorded |
| How much money counts? | Any amount — matching the rule that already holds the bed |
| A tenancy whose move-in date has not arrived yet | Bills no rent until that date |
| Keep or rename the `converted` status value | Keep it. Renaming buys readability and costs a sweep of 18 call sites plus a migration of live rows |
| An escape hatch for placing someone before payment | Not wanted. No money, no tenancy |

## Out of scope

The other two Rooms & reservations changes — status colours, and dispatching
vacant rooms to maintenance for cleaning and inspection — are separate specs.
The cleaning work introduces a new room state, and that state is what the
colours have to encode, so the colours are best done after it rather than
twice.

---

## The change

```
Now:    create reservation → record payment → [press Convert] → check in
After:  create reservation → record payment ────────────────→ check in
                                    ↑
                     profile, tenancy and move-in invoice appear here
```

### Where the code goes

The 112 lines inside `reservation-convert` become a shared function:

```ts
promoteReservationToTenancy(db, reservationId, actor)
```

`reservation-payment` calls it once a payment lands. What it does is unchanged
— choose the room from `provisionalBedSpaceId`, create the student profile,
create the tenancy, set the bed to `reserved`, and raise the move-in invoice
carrying every charge collected during the reservation.

**It must be idempotent**, because a second and third payment will call it
again. Both halves already are: the tenancy insert carries
`ON CONFLICT DO NOTHING`, and `syncMoveInInvoice` reconciles an existing
invoice rather than adding another. The function returns early when the
reservation is already `converted`.

### When no room has been chosen yet

Every individual reservation in the system happens to have a
`provisional_bed_space_id` — but **nothing requires one**. Creating a
reservation validates only the name and the target move-in date, so a booking
with no room against it is possible, and a payment could arrive on one.

Recording the money must never be blocked by that: the cash has arrived and
Finance has to see it. So the payment is recorded either way, and promotion is
what waits:

- No room set → the payment is saved, the reservation stays `reserved`, and
  the card says **"Room not chosen — pick one to complete this booking."**
- A room is chosen later → promotion runs then, on the same code path, because
  `reservation-update` calls it too once a payment already exists.

The alternative — refusing the payment until somebody picks a room — would
leave money received and nowhere to record it. That is worse than a booking
sitting one step short.

### Group reservations keep a step

A group booking has no bed — it takes a whole unit, and no tenancy is created
until the individual names are known. Its half of the convert action stays, as
its own action:

| | |
|---|---|
| Action | `reservation-confirm-unit` (was the group branch of `reservation-convert`) |
| Button | "Confirm unit" |
| What it does | Sets `preferredUnitId` and `status = 'converted'`. No tenancy, exactly as now |

The individual branch of `reservation-convert`, the "Convert assignment"
button and the individual half of `ConvertAssignmentForm` are removed.

### Choosing a different room

The convert modal existed so staff could override the provisional room. That
need is already served by **Move this reservation to a different room**
(`reservation-room-change`), which recalculates the charges and the balance.
The entry point moves from "choose while converting" to "change afterwards";
the capability does not change.

---

## The billing fix, which is not optional

`computeCycleInvoices` selects tenancies with `WHERE a.status='active'` and
never looks at when the tenancy starts. There is a patch for the month a
student arrives in — arrive on the 10th and that month is free, on the 20th
and it is half — but it only fires when the check-in date falls inside the
period being billed. A tenancy starting in a *later* month falls straight
through it and is charged a full month's rent.

Nobody is being wrongly charged today, because a tenancy only exists once
staff have pressed Convert, and they press it when move-in is imminent.
Creating tenancies at payment makes future-dated tenancies ordinary, and then
this bites. So:

```sql
AND (a.check_in_date IS NULL OR a.check_in_date <= <the cycle's cut-off>)
```

The deposit, the access-card deposit and the first month's advance rental are
unaffected — they are on the move-in invoice, which is raised once and does
not go through the monthly run.

---

## Edge cases

| Situation | Behaviour |
|---|---|
| Second or third payment recorded | Nothing is created twice — see idempotency above |
| Group reservation receives payment | Status only. No tenancy, no move-in invoice |
| Cancelled after payment | `reservation-cancel` already releases the bed, ends the tenancy, marks an auto-created profile moved-out and keeps the payment history |
| Deleted after payment | `reservation-delete` already cascades invoices, items, deposit adjustments, rate changes, the tenancy, the bed and the auto-created profile |
| Reservation never paid | Never becomes a tenancy. It stays `reserved` until cancelled |
| Paid but no room chosen | Payment recorded, promotion waits, the card says which step is missing |
| The 11 rows already `converted` | No migration. They are already in the end state |
| A payment is later deleted | Out of scope: `payment-delete` does not unwind a tenancy today either, and doing so needs the undo work in its own spec |

---

## Verification

No test framework here (`npm test` runs a build), so this follows the existing
practice: throwaway scripts in `.claude-scratch/` plus a temporary route that
calls the real function, both removed afterwards.

| Check | Expected |
|---|---|
| Create a reservation, record a payment | Profile, tenancy and move-in invoice all exist; bed is `reserved` |
| Record a second payment | Still exactly one profile, one tenancy, one invoice |
| Group reservation, record a payment | Status `converted`, and **no** tenancy |
| Tenancy with a future check-in date | Billing preview shows **no** room-rental line for them |
| Tenancy checked in this month on the 10th | Still free for that month, as now |
| **Regression** | Run the 2026-08 preview immediately before the change, note the invoice count and every item-type total, then run it again after: identical to the ringgit. (It was 362 invoices / RM 23,500 electricity when this was written, but staff are using the system, so the figure to match is the one measured on the day.) |

The regression line is the one that matters most: this changes when a tenancy
comes into existence, and it must not change what anybody is charged.

---

## Files

| Action | File | What |
|---|---|---|
| Modify | `app/api/system/route.ts` | Extract `promoteReservationToTenancy`; call it from `reservation-payment`; reduce `reservation-convert` to the group case and rename it; add the check-in-date condition to `computeCycleInvoices` |
| Modify | `app/modules/HostelInformation.tsx` | Remove the "Convert assignment" button and the individual half of the convert form; relabel the group path "Confirm unit" |
| Modify | `app/SystemContext.tsx` | Nothing, unless the renamed action needs a scoped-refresh entry — it falls into the reservation group, which still reloads in full |
