# Meter overdue reminder — nag Maintenance before the cut-off, not Accounts after

**Date**: 2026-09-14
**Scope**: Warn Maintenance, ahead of time, about rooms whose electricity
usage for the coming billing round will be permanently unbillable once that
round's invoices are generated — before Accounts ever gets involved.

---

## Why

`computeCycleInvoices()` already knows, at the moment "Generate invoices" is
clicked, which occupied rooms will get no electricity line this cycle: the
room was never read, or its newest reading still predates the *previous*
cycle's cut-off. That list (`unreadMeterRooms`) is real — those rooms'
electricity for this period is not deferred, it is dropped, because the next
cycle's usage calculation only ever pairs the two most recent readings and
never revisits an invoice that already exists.

Today the only place this list surfaces is a paragraph of text in Accounts'
"Preview & generate" modal, seconds before they click the button that makes
the loss permanent. By then it is too late for anyone to act on it, and the
person who actually needs to act — Maintenance, who reads the meter — never
sees it at all.

## Decisions taken

| Question | Decision |
|---|---|
| What counts as "overdue"? | The exact same rule already used for real billing: a room's newest reading predates the previous cycle's cut-off (or it has never been read). Not a fixed day-count — this keeps it provably in sync with what actually gets billed |
| Does it need a cycle to already exist? | No. The "next" cut-off is computed from `autoBillingCutoffDay` off the last real cycle's cut-off (same math `ensureBillingCycle`/`cycleDatesFor` already use), so the warning is live all month, not just after Accounts clicks "Prepare billing month" |
| Ticket or derived list? | **Derived list**, same pattern as the existing "Check-out meter readings to take" section — no `maintenance_tickets` row, nothing to assign or close. The room drops off the instant a qualifying reading is saved |
| Where does Maintenance see it? | A count badge on the existing "Meter readings" tab (same visual pattern as the "Room turnover" tab's badge), plus a callout block above the entry grid listing the rooms |
| Does Accounts' existing warning change? | No. It stays exactly as-is in Finance.tsx's Preview & generate modal — this is additive, an earlier and better-targeted version of the same signal |

## Out of scope

- Any change to the billing math itself (`computeCycleInvoices`, the
  proration rules, how usage is paired between readings).
- A way to retroactively add electricity to an invoice that already exists
  with none — that gap (no "add a line item" action, only "adjust an
  existing one") is unchanged and untouched by this spec.
- Any new role/permission — this is visible to whoever can already see the
  Maintenance module today (not tenants).

---

## Data & computation

The room-scan block currently inline inside `computeCycleInvoices()`
(app/api/system/route.ts, roughly lines 3332–3598 — the `active` tenancy
query, the `tnbDirectUnitIds`/block-let handling, `readingRows`,
`staleMeterRooms`, and the `unreadMeterRooms` construction) is extracted into
a standalone function:

```ts
async function computeUnreadMeterRooms(
  db: ReturnType<typeof getDb>,
  input: { cutoffDate: string; previousCutoff: string | null },
): Promise<{ roomCode: string; lastReadingDate: string | null }[]>
```

It takes only `cutoffDate` and `previousCutoff` — not a `cycleId` — because
the reminder needs to run against a cut-off that may not have a
`billing_cycles` row yet. `computeCycleInvoices` is refactored to call this
same function with its own `input.cutoffDate` and the previous-cycle lookup
it already does, so real billing behaviour is unchanged (this is a pure
extraction, not a rewrite).

A second small helper works out what "the coming cut-off" is right now:

```ts
async function upcomingMeterCutoff(
  db: ReturnType<typeof getDb>,
): Promise<{ cutoffDate: string; previousCutoff: string | null }>
```

- `previousCutoff` = the cut-off of the most recently created
  `billing_cycles` row (any status — even a "reserved" placeholder already
  fixes the boundary Accounts intends).
- `cutoffDate` = the next cut-off after that, computed with the same
  `Math.min(28, Math.max(1, autoBillingCutoffDay))` + month-rollover formula
  already duplicated between `ensureBillingCycle`'s caller and
  `Finance.tsx`'s `cycleDatesFor`. If no cycle exists at all yet (a brand
  new system), fall back to computing from today's date the same way
  `Finance.tsx`'s `openCycleModal` does.

The main `GET`/`POST /api/system` handler calls `upcomingMeterCutoff()` then
`computeUnreadMeterRooms()` once per request (alongside the other
already-precomputed fields like `meterMonths`) and ships the result as:

```ts
overdueMeterRooms: { roomCode: string; lastReadingDate: string | null }[]
```

Cost: one extra pass of the same query shape `computeCycleInvoices` already
runs, on every load. This is the same tier of cost as `meterMonths` and the
dashboard's other precomputed rollups — not gated behind a role check at the
data layer, since Maintenance/Accounts/Director all load the same payload;
excluded only from the tenant-scoped response (added next to the other
staff-only fields dropped there, e.g. `owners: []`).

## Frontend (Maintenance.tsx)

**Tab badge** — same JSX pattern as the existing "Room turnover" badge
(~line 689):

```tsx
<button className={tab === "meters" ? "active" : ""} onClick={() => setTab("meters")}>
  Meter readings
  {data.overdueMeterRooms.length > 0 && (
    <span className="tab-count pending">{data.overdueMeterRooms.length}</span>
  )}
</button>
```

**Callout block** — rendered above the entry grid when `tab === "meters" &&
meterView === "entry"` and the list is non-empty. Amber, same family as the
other warning callouts already in this file. Content:

- A heading naming the coming cut-off date.
- One sentence stating the stakes plainly: once this cycle is generated,
  these rooms' electricity for this round will not be billed to anyone.
- One line of guidance on the backdating trap (see Copy note below).
- A wrapped row of chips, one per room: room code + "last read `<date>`" or
  "never read". Clicking a chip sets `entryHostelId` to that room's hostel
  and `entryQuery` to that room's code — the entry grid's own search box —
  so the grid immediately narrows to just that one row, ready to type into.
  Both are state the entry grid already has; nothing new to add for this.

**Copy note — the backdating trap.** If Maintenance keys in a reading and
dates it for the day they actually visited the room, and that date falls on
or before a cut-off whose cycle has already been generated, the usage for
that gap is still permanently lost — the next cycle only pairs the two most
recent readings and this one would already be "old" relative to the cycle
it should have caught. Entering the reading with **today's actual date**
avoids this, because it then falls after every already-generated cut-off and
gets picked up correctly next round. The callout's guidance line says this
plainly: "输入的日期请填今天，不要填实际去看表的那一天，不然这笔用量可能还是收不到。"

## Testing

Verified the same way the billing-cycle review feature was verified earlier
this session: synthetic `ZZTEST`-prefixed rooms/readings/cycles against the
real dev database, never touching real tenancies, cleaned up after. Specific
checks:

1. A room with no reading at all appears in `overdueMeterRooms` with
   `lastReadingDate: null`.
2. A room whose newest reading predates the previous real cycle's cut-off
   appears with that date.
3. A room read after the previous cycle's cut-off does **not** appear.
4. `computeCycleInvoices`'s own `unreadMeterRooms` output is unchanged
   before/after the extraction (same synthetic fixture, same result).
5. Entering a reading for a listed room removes it from
   `overdueMeterRooms` on the next load, with no separate action needed.
6. Tenant-role response does not include `overdueMeterRooms`.
