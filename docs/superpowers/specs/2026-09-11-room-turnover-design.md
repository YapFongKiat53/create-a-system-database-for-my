# Room turnover — inspection and cleaning after a move-out

**Date**: 2026-09-11
**Scope**: A room a student has just left is not ready to let. Give
maintenance the work to schedule, and make "not ready yet" visible in
Availability search.

---

## Why

`student-move-out` sets the bed to `vacant` in the same statement that ends
the tenancy. From that instant the system cannot tell the difference between:

| | |
|---|---|
| a room somebody walked out of an hour ago | keys not collected, damage unrecorded, nobody has cleaned it |
| a room that has been sitting ready for a month | a student could move in this afternoon |

Both read `vacant`, both land in Availability search as `available-now`, and
both count toward the 151 vacant beds on the dashboard. The work in between —
the inspection that decides what comes out of the deposit, and the cleaning —
happens on WhatsApp, which means nobody can see whether it happened.

## Decisions taken

| Question | Decision |
|---|---|
| Where does the work live? | Maintenance tickets. The module already assigns a person, records attendance, completion and cost, and has Open/Completed tabs |
| Add a bed status (`turnover`)? | **No.** `bed_spaces.status` is read in dozens of places, including billing and availability counts. A new value there is a sweep with real money downstream; a derived state is not |
| One ticket or two? | **Two** — Inspection and Cleaning. They go to different people, and the inspection is what feeds a deposit deduction |
| Does a room being prepared still count as sellable? | **Yes**, flagged but not deducted. Sales can book it — move-in is usually days away. The sellable figure does not move, so no money is touched |
| Who raises them? | The move-out does, automatically. Maintenance schedules and assigns |
| Rooms already vacant today (151 beds) | No backfill. They get a manual **Schedule turnover** button instead |
| When is a room ready? | When both of its open turnover tickets are completed |

## Out of scope

Charging a student for damage found at inspection. The ticket already carries
`studentCharge` / `chargedStudentId` and the existing flow handles it — this
spec only makes sure the inspection gets raised and assigned.

---

## Data

One additive column, so a turnover ticket is identifiable without depending on
free-text category names that staff can rename:

```sql
ALTER TABLE maintenance_tickets ADD COLUMN turnover_stage text;
```

`'inspection' | 'cleaning' | NULL`. Every existing ticket is NULL, which is
correct — none of them are turnover work.

The two category rows (`Turnover / Inspection`, `Turnover / Cleaning`) are
seeded into `ticket_categories` so the manual ticket form offers them too.

## Server

### Raising the tickets

```ts
raiseTurnoverTickets(db, bedSpaceId, actor, movedOutOn)
```

Looks up the bed's room, unit and hostel, then inserts one ticket per stage —
skipping a stage that already has an **open** ticket on that room, so a second
move-out from a sharing room does not stack duplicates.

- `category` `"Turnover"`, `subcategory` `"Inspection"` / `"Cleaning"`
- `subject` names the bed: `"Move-out inspection — NB-1210-A1"`
- `studentId` is the departing student on the inspection ticket (it is their
  deposit that the findings land against) and null on the cleaning one
- `status` `"submitted"`, `priority` `"average"`, `assignedTo` empty —
  maintenance assigns it

Called from both paths that free a bed:

| Action | Today | Added |
|---|---|---|
| `student-move-out` | sets the bed `vacant` | raise both tickets |
| `assignment-room-change` | sets the **old** bed `vacant` | raise both tickets on the old room |

A new action `turnover-schedule` raises the same pair on demand, for a room
that was already vacant before this feature existed.

### Reporting it back

A single grouped read of open turnover tickets, keyed by room:

```sql
SELECT room_id, turnover_stage FROM maintenance_tickets
WHERE turnover_stage IS NOT NULL AND status NOT IN ('completed','closed')
```

`deriveBeds` attaches `turnoverPending: ("inspection"|"cleaning")[]` to each
bed. `availabilityState` is **not** changed — a room being prepared stays
`available-now`, per the decision above.

## Client

**Room chips** (Hostel Information) gain a sixth state, ahead of `available`:

```
preparing  — vacant, but an inspection or cleaning is still open
```

Its colour sits between vacant-green and reserved-amber (a desaturated teal),
and the legend gains a sixth count. The other five are unchanged.

**Availability search** shows a `Being prepared · Inspection, Cleaning` mark on
those rows plus a "Ready to let only" toggle, so sales can filter to rooms
somebody can walk into today.

**Maintenance** gains a *Rooms to prepare* panel above the ticket list: every
vacant bed, its two stages with tick or open, and a **Schedule turnover**
button on the ones that have none. This is the answer to "maintenance needs to
see the vacant rooms" — they see them with the work attached, not as a bare
list.

---

## Edge cases

| Situation | Behaviour |
|---|---|
| Sharing room, one of two students leaves | Tickets are raised (the departing student's deposit still needs an inspection). Only the vacated bed shows `preparing`; the roommate's bed stays `occupied` |
| Second move-out while a stage is still open | No duplicate. The open ticket covers the room |
| Move-out reversed / re-let before cleaning | The tickets stay open and the bed shows `reserved` or `occupied`, so `preparing` stops showing — the work is still on maintenance's list, which is right |
| Ticket completed then reopened | Derived live from status, so the room goes back to `preparing` |
| A room that never gets cleaned | Stays flagged indefinitely. That is the point |

## Verification

No test framework (`npm test` runs a build), so the existing practice: a
throwaway script in `.claude-scratch/` against real data, plus the browser.

| Check | Expected |
|---|---|
| Move a test student out | Two tickets appear, Open tab, correct room code |
| The freed bed | Chip reads `preparing`; legend count +1; vacant count unchanged |
| Availability search | Row still listed, marked; "Ready to let only" hides it |
| Complete the cleaning ticket only | Still `preparing` — one stage left |
| Complete both | Chip returns to `available`, mark disappears |
| Second move-out from the same room | Still two tickets, not four |
| Sellable / vacant totals | Identical before and after the change |

## Files

| Action | File | What |
|---|---|---|
| Create | `drizzle/pg/0022_*.sql` | `turnover_stage` column |
| Modify | `db/schema.ts` | the column |
| Modify | `app/api/system/route.ts` | `raiseTurnoverTickets`, calls from the two move paths, `turnover-schedule` action, the grouped read, `turnoverPending` on beds |
| Modify | `app/modules/HostelInformation.tsx` | `preparing` room state, legend, availability mark and filter |
| Modify | `app/modules/Maintenance.tsx` | Rooms to prepare panel |
| Modify | `app/globals.css` | the sixth chip state and the panel |
