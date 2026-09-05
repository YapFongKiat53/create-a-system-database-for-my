# Reservation charges can't record a partial payment

**Status:** Noted during admin-flow QA testing (2026-09-05) — not scheduled, no design agreed yet.

## What was found

Testing the reservation → payment → move-in flow as admin (new test reservation
plus an audit of the 14 live reservations with recorded payments) surfaced a
gap between how much money a reservation shows as paid
(`reservations.amount_paid`, summed from `reservation_payments` — the correct
source of truth per the comment on `recomputeReservationPaymentStatus`) and
how much is itemized against specific `reservation_charges` rows (each charge
is only ever fully "paid" or fully "unpaid" — there's no partial-amount field).

For a real student (Neng Xin Er, RSV-378353446): RM 2,000 was received, but
only RM 920 is itemized against charges that are individually payable in
full (first month rental, admin fee, access card deposit, access card
handling fee). The RM 3,000 deposit charge can't be marked paid because only
RM 1,080 of it (if that's even what happened) was covered — there's no way
to record "RM 1,080 of this RM 3,000 deposit has been paid" at the charge
level today.

This isn't a bug in the current payment-recording code path
(`addChargeLinkedReservationPayment` in `app/api/system/route.ts`) — it
correctly derives the payment amount from whichever whole charges are
selected, and always links them. The gap only shows up when a payment
doesn't neatly cover a whole number of charges, which today has no
representation at all.

## Why it matters

An admin looking at a reservation's "Charges covered by this payment"
checklist can't fully account for the money on file once a payment is
meant to partially cover a large charge (most commonly the deposit,
which tends to be the single biggest line item and the one most likely to
be paid in installments in practice). The aggregate figures
(Total payable / Total paid / Balance required) stay correct regardless —
this is about the itemized breakdown, not the headline numbers.

## Possible direction (not decided)

- Add a partial-amount concept to `reservation_charges` (e.g. an
  `amount_paid` column alongside `amount`, replacing the boolean
  `paid_at IS NOT NULL` check with `amount_paid >= amount`), and let
  `addChargeLinkedReservationPayment` split a payment across a charge
  instead of requiring the whole thing.
- Needs a matching UI change in the reservation Manage panel — likely a
  per-charge amount input instead of (or alongside) the current checkbox,
  at minimum for the deposit line.
- Worth checking whether `billing_items` / `billing_payment_records`
  (the post-move-in monthly billing side) has the same limitation before
  designing a fix, so both don't need solving twice.

## Related data cleanup already done

While auditing this, 13 of 14 live reservations with payments were also
missing `reservation_charges.payment_id` (the FK linking a paid charge to
the payment that covered it) — a separate, narrower issue from the above.
That was backfilled for reservation ids 2, 10, 23, 31, 33, 42, 43, 47, 49,
50, 55 (safe: it only fills a previously-null FK, never changes an amount).
Reservation ids 4 and 15 had orphaned test payments with zero charges and
a corrupted `payment_status` value (`"admin-fee"`, not a valid status) —
confirmed as test data and reset to a clean unpaid state. Reservation id 51
("hello", confirmed test data) still has 3 charges that couldn't be
confidently attributed to either of its two payments and were left
unlinked rather than guessed.
