# Meter Overdue Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn Maintenance, ahead of a billing cut-off, about rooms whose
electricity usage will be permanently unbillable once that cycle's invoices
are generated — a count badge on the "Meter readings" tab plus a callout
listing the rooms, driven by the exact same staleness rule real billing
already uses.

**Architecture:** Extract the "which occupied rooms would get no electricity
line" scan out of `computeCycleInvoices()` into a standalone function that
takes a cut-off date and a previous-cut-off date instead of a live cycle id.
Call it twice: once from `computeCycleInvoices` itself (unchanged real
billing behaviour), and once from a new small helper that works out "the
next cut-off that hasn't happened yet" from settings alone, so the warning
is live all month — not just after Accounts creates a cycle placeholder.
Ship the result as `overdueMeterRooms` on both the full `/api/system` load
and the scoped `?modules=meter-readings` reload a meter-reading save
triggers, so the badge updates the moment a reading is saved without a full
page reload. Maintenance.tsx renders the badge and a dismissable-by-reading
callout panel above the existing monthly entry grid.

**Tech Stack:** Next.js App Router, Drizzle ORM raw `sql` helpers, Supabase
Postgres, React (no external state library).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-meter-overdue-reminder-design.md`.
- This codebase has **no unit test framework** (`npm test` runs `vinext
  build`, i.e. a typecheck/build gate — see `package.json`). The project's
  established verification method, used throughout this session and
  written into the spec's own Testing section, is: synthetic
  `ZZTEST`-prefixed fixtures written directly against the real dev Postgres
  database via a scratch Node script (using the `postgres` package and
  `.env.local`'s `DATABASE_URL`), verified through the actual running dev
  server (already running on `localhost:3000`, started by the user outside
  this session — do not start a second one) via the Claude Browser MCP
  tools or `curl`, then fully cleaned up. Every task below substitutes this
  for the template's pytest-style steps; treat "write the failing test,
  watch it fail, make it pass" as "write the verification script, run it
  against the old code to confirm the old behaviour, make the change, run
  it again to confirm the new behaviour."
- `npx tsc --noEmit` and `npx eslint <changed files>` must both be clean
  before any task is considered done.
- Never leave `ZZTEST`-prefixed rows in the real database after a task's
  verification step — every script that creates them must have a `clean`
  mode, and it must be run before moving to the next task.
- Never push. Commit locally only, matching this session's practice.

---

### Task 1: Extract `computeUnreadMeterRooms` and wire it into `computeCycleInvoices`

**Files:**
- Modify: `app/api/system/route.ts` (insert new function before line 3309;
  replace lines 3571–3598 inside `computeCycleInvoices`)
- Scratch (create, then delete after use): `.claude-scratch/verify_unread_extraction.mjs`

**Interfaces:**
- Produces: `async function computeUnreadMeterRooms(db: ReturnType<typeof getDb>, input: { cutoffDate: string; previousCutoff: string | null }): Promise<{ roomCode: string; lastReadingDate: string | null }[]>` — module-level function in `app/api/system/route.ts`, placed directly after `expectedRoomRent` (which currently ends at line 3303) and before `computeCycleInvoices` (currently starts at line 3309).
- Consumes inside `computeCycleInvoices`: the existing local `cutoffDate` (`const cutoffDate = input.cutoffDate;`, already defined near the top of the function) and the existing local `previousCutoff` (computed a few lines above the block being replaced, from `previousCutoffRow?.cutoff_date || null`).

This task is a pure extraction: `computeCycleInvoices`'s own `active`,
`roomIds`, `readingRows`, `staleMeterRooms`, `readingsByRoom`,
`lastReadingByRoom`, `replacedFinalByRoom` — all still used afterwards for
the real per-student rent/electricity math — are left completely
untouched. Only the final `unreadMeterRooms` construction is replaced with
a call to the new function. This means the underlying reads-query runs
twice per real cycle generation (once inline, once inside the new
function) — accepted deliberately so the *staleness rule itself* is
defined in exactly one place, per the spec's "never drift" principle,
without touching the working block-let/whole-unit billing code at all.

- [ ] **Step 1: Read the current block to confirm line numbers haven't drifted**

```bash
sed -n '3560,3599p' app/api/system/route.ts
```

Expected: lines 3571–3598 are the `// Every occupied room that will bill
no electricity...` comment through the closing `);` of the
`unreadMeterRooms` sort call, immediately followed by a blank line then
`type OccupantRow = {`. If line numbers have shifted, locate the same code
by searching for `const unreadMeterRooms = [` instead and adjust the step
below to match.

- [ ] **Step 2: Insert `computeUnreadMeterRooms` before `computeCycleInvoices`**

Find this text (the end of `expectedRoomRent`, immediately before
`computeCycleInvoices` begins):

```ts
  const day = Number(checkInDate.slice(8, 10));
  if (day <= 15) return 0;
  if (day <= 28) return fullRent / 2;
  return 0;
}

// Works out what everyone currently owes for a cycle, without writing
```

Replace it with:

```ts
  const day = Number(checkInDate.slice(8, 10));
  if (day <= 15) return 0;
  if (day <= 28) return fullRent / 2;
  return 0;
}

// Which occupied, non-TNB-direct rooms would get no electricity line if a
// cycle billed at `cutoffDate` ran right now: never read, or their newest
// reading is no newer than `previousCutoff` — meaning it was already on
// hand the last time a cycle ran, so it cannot represent new movement
// since then. This is the exact rule computeCycleInvoices uses below to
// decide whether to charge electricity at all; it is factored out here so
// Maintenance's overdue-reading reminder (computed ahead of any real
// cycle, in the main /api/system handler) can ask the identical question
// without a cycleId to run against, and the two call sites can never
// quietly answer it differently.
async function computeUnreadMeterRooms(
  db: ReturnType<typeof getDb>,
  input: { cutoffDate: string; previousCutoff: string | null },
): Promise<{ roomCode: string; lastReadingDate: string | null }[]> {
  const { cutoffDate, previousCutoff } = input;
  const active = await db.execute<{
    room_id: number;
    room_code: string;
    electricity_billing: string;
  }>(sql`
    SELECT r.id AS room_id, u.unit_code || '-' || r.room_label AS room_code,
           u.electricity_billing
    FROM accommodation_assignments a
    JOIN bed_spaces b ON a.bed_space_id = b.id
    JOIN hostel_rooms r ON b.room_id = r.id
    JOIN hostel_units u ON r.unit_id = u.id
    WHERE a.status = 'active'
      AND (a.check_in_date IS NULL OR a.check_in_date <= ${cutoffDate})
  `);
  if (!active.length) return [];
  const roomIds = [...new Set(active.map((row) => Number(row.room_id)))];
  const idList = (ids: number[]) =>
    sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
  const readingRows = await db.execute<{
    room_id: number;
    reading_date: string;
  }>(sql`
    SELECT room_id, reading_date FROM (
      SELECT
        COALESCE(mr.room_id, bs.room_id) AS room_id,
        mr.reading_date,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(mr.room_id, bs.room_id)
          ORDER BY mr.reading_date DESC, mr.id DESC
        ) AS rn
      FROM meter_readings mr
      LEFT JOIN bed_spaces bs ON bs.id = mr.bed_space_id
      WHERE mr.reading_date <= ${cutoffDate}
        AND COALESCE(mr.room_id, bs.room_id) IN (${idList(roomIds)})
    ) ranked
    WHERE rn <= 2
    ORDER BY room_id, rn
  `);
  const staleMeterRooms = new Set<number>();
  if (previousCutoff)
    for (const row of readingRows)
      if (
        readingRows.filter(
          (other) => Number(other.room_id) === Number(row.room_id),
        )[0] === row &&
        String(row.reading_date) <= previousCutoff
      )
        staleMeterRooms.add(Number(row.room_id));
  const readingCountByRoom = new Map<number, number>();
  const lastReadingByRoom = new Map<number, string>();
  for (const row of readingRows) {
    const roomId = Number(row.room_id);
    readingCountByRoom.set(roomId, (readingCountByRoom.get(roomId) || 0) + 1);
    if (!lastReadingByRoom.has(roomId))
      lastReadingByRoom.set(roomId, String(row.reading_date));
  }
  return [
    ...new Map(
      active
        .filter(
          (row) =>
            row.electricity_billing !== "tnb-direct" &&
            (staleMeterRooms.has(Number(row.room_id)) ||
              (readingCountByRoom.get(Number(row.room_id)) || 0) < 2),
        )
        .map((row) => [
          String(row.room_code),
          {
            roomCode: String(row.room_code),
            lastReadingDate: lastReadingByRoom.get(Number(row.room_id)) || null,
          },
        ]),
    ).values(),
  ].sort((left, right) =>
    left.roomCode.localeCompare(right.roomCode, undefined, { numeric: true }),
  );
}

// Works out what everyone currently owes for a cycle, without writing
```

- [ ] **Step 3: Replace the inline `unreadMeterRooms` construction inside `computeCycleInvoices`**

Find (the block confirmed in Step 1):

```ts
          // Every occupied room that will bill no electricity, and why: the
          // meter was never read, or it hasn't been read since the previous
          // cycle already charged the movement up to that point.
          const unreadMeterRooms = [
            ...new Map(
              active
                .filter(
                  (row) =>
                    // A TNB-billed unit has no room meters; listing it here
                    // would send staff to read something that isn't there.
                    row.electricity_billing !== "tnb-direct" &&
                    (staleMeterRooms.has(Number(row.room_id)) ||
                      (readingsByRoom.get(Number(row.room_id)) || []).length < 2),
                )
                .map((row) => [
                  String(row.room_code),
                  {
                    roomCode: String(row.room_code),
                    lastReadingDate:
                      lastReadingByRoom.get(Number(row.room_id)) || null,
                  },
                ]),
            ).values(),
          ].sort((left, right) =>
            left.roomCode.localeCompare(right.roomCode, undefined, {
              numeric: true,
            }),
          );
```

Replace with:

```ts
          // Same rule Maintenance's overdue-reading reminder uses
          // (computeUnreadMeterRooms, above) — called fresh here instead of
          // reusing the maps built above so the two call sites can never
          // quietly answer this differently. Costs a second pass of the
          // same query shape; accepted so the rule has exactly one
          // definition.
          const unreadMeterRooms = await computeUnreadMeterRooms(db, {
            cutoffDate,
            previousCutoff,
          });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Verify computeCycleInvoices's own output is unchanged**

Write `.claude-scratch/verify_unread_extraction.mjs`:

```js
// Confirms the Task 1 extraction didn't change computeCycleInvoices's own
// unreadMeterRooms output, using a synthetic ZZTEST room+tenancy with no
// electricity reading at all — must show up as unread both before and
// after the refactor. Run with "clean" to remove the fixture afterward.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const MARK = "ZZTEST-UNREAD-EXTRACT";

if (process.argv[2] === "clean") {
  const cycles = (await sql`SELECT id FROM billing_cycles WHERE period_label = ${MARK}`).map((c) => c.id);
  for (const cycleId of cycles) await sql`DELETE FROM billing_cycles WHERE id = ${cycleId}`;
  console.log("cleaned cycles:", cycles.length);
  await sql.end();
  process.exit(0);
}

// Reuse the real "testing 2" fixture (student 525 / assignment 526) already
// established in this session's earlier verification work — no reading has
// ever been recorded for its room, so it is unread by construction.
const [cycle] = await sql`
  INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status)
  VALUES (${MARK}, '2026-09-24', '2026-10-05', 'draft')
  RETURNING id`;
console.log(JSON.stringify({ cycleId: cycle.id }));
await sql.end();
```

- [ ] **Step 6: Run it and hit the preview action through the real dev server**

```bash
set -a; source .env.local; set +a
node .claude-scratch/verify_unread_extraction.mjs
```

Expected: prints `{"cycleId": <n>}`.

Then, with the dev server already running on `localhost:3000`, call the
existing `billing-cycle-preview` action for period `ZZTEST-UNREAD-EXTRACT`
as an authenticated staff/director session (reuse the session-cookie
technique from this session's earlier billing-review verification — create
a temporary `app_users`/`user_sessions` row via raw SQL, or use an existing
logged-in browser tab if one is open) and confirm the response's
`preview.unreadMeterRooms` array includes the room code for "testing 2"'s
room (`NB-1210-A`). This is the same output shape `computeCycleInvoices`
always produced — the point of this step is confirming the refactor didn't
change it, not testing new behaviour.

- [ ] **Step 7: Clean up and lint**

```bash
set -a; source .env.local; set +a
node .claude-scratch/verify_unread_extraction.mjs clean
rm .claude-scratch/verify_unread_extraction.mjs
npx eslint app/api/system/route.ts
```

Expected: cleaned message, file removed, eslint output unchanged from
baseline (the two pre-existing unrelated warnings only — no new errors).

- [ ] **Step 8: Commit**

```bash
git add app/api/system/route.ts
git commit -m "$(cat <<'EOF'
Extract computeUnreadMeterRooms from computeCycleInvoices

Pure extraction, no behaviour change — gives the "which rooms will bill
no electricity" rule a single definition so a later, cycle-independent
caller can ask the same question without drifting from real billing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `upcomingMeterCutoff` and ship `overdueMeterRooms` on the full load

**Files:**
- Modify: `app/api/system/route.ts` (insert new function after
  `computeUnreadMeterRooms` from Task 1; modify the `GET` handler around
  line 2767 and the tenant-scoped response around line 3004–3011)

**Interfaces:**
- Consumes: `computeUnreadMeterRooms` from Task 1 (exact signature above).
- Produces: `async function upcomingMeterCutoff(db: ReturnType<typeof getDb>): Promise<{ cutoffDate: string; previousCutoff: string | null }>` — module-level function, self-contained (queries `systemSettings` and `billing_cycles` itself; does not depend on any caller-supplied state), reusable by both the `GET` handler (this task) and the scoped `meter-readings` reload (Task 3).
- Produces: `overdueMeterRooms: { roomCode: string; lastReadingDate: string | null }[]` on `responseData` in the `GET` handler, and explicitly `[]` in the tenant-scoped response override.

- [ ] **Step 1: Insert `upcomingMeterCutoff` after `computeUnreadMeterRooms`**

Find (the end of the function added in Task 1):

```ts
  ].sort((left, right) =>
    left.roomCode.localeCompare(right.roomCode, undefined, { numeric: true }),
  );
}

// Works out what everyone currently owes for a cycle, without writing
```

Replace with:

```ts
  ].sort((left, right) =>
    left.roomCode.localeCompare(right.roomCode, undefined, { numeric: true }),
  );
}

// The cut-off of the next billing cycle that has not happened yet — the
// one whose electricity is still salvageable if Maintenance reads the
// meters in time. Self-contained (queries settings and billing_cycles
// itself) so it can be called from both the full /api/system load and the
// scoped meter-readings reload without either needing to already have this
// state on hand.
async function upcomingMeterCutoff(
  db: ReturnType<typeof getDb>,
): Promise<{ cutoffDate: string; previousCutoff: string | null }> {
  const settings = await db.select().from(systemSettings);
  const cutoffDay = Math.min(
    28,
    Math.max(
      1,
      Number(
        settings.find((row) => row.settingKey === "auto-billing-cutoff-day")
          ?.settingValue ?? 24,
      ),
    ),
  );
  const latest = (
    await db.execute<{ cutoff_date: string }>(
      sql`SELECT cutoff_date FROM billing_cycles ORDER BY cutoff_date DESC LIMIT 1`,
    )
  )[0];
  const previousCutoff = latest?.cutoff_date ? String(latest.cutoff_date) : null;
  if (previousCutoff) {
    // A real cut-off already happened — the coming one is always the month
    // right after it, whether or not that month has arrived yet. Staff
    // being late to generate a cycle does not move this forward.
    const [year, month] = previousCutoff.split("-").map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    return {
      cutoffDate: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`,
      previousCutoff,
    };
  }
  // No cycle has ever been created — a brand new system. Anchor on today:
  // this month's cut-off if it hasn't passed yet, otherwise next month's.
  const todayKL = todayInKL();
  const [ty, tm, td] = todayKL.split("-").map(Number);
  const anchor = new Date(Date.UTC(ty, tm - 1, 1));
  if (td > cutoffDay) anchor.setUTCMonth(anchor.getUTCMonth() + 1);
  return {
    cutoffDate: `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`,
    previousCutoff: null,
  };
}

// Works out what everyone currently owes for a cycle, without writing
```

- [ ] **Step 2: Compute `overdueMeterRooms` before `responseData` is built**

Find:

```ts
    ].sort();
    const responseData = {
      hostels,
```

Replace with:

```ts
    ].sort();
    const overdueMeterRooms = await computeUnreadMeterRooms(
      db,
      await upcomingMeterCutoff(db),
    );
    const responseData = {
      hostels,
```

- [ ] **Step 3: Add the field to `responseData`, next to `meterMonths`**

Find:

```ts
      meterMonths: meterMonthRows.map((row) => String(row.month)),
```

Replace with:

```ts
      meterMonths: meterMonthRows.map((row) => String(row.month)),
      overdueMeterRooms,
```

- [ ] **Step 4: Exclude it from the tenant-scoped response**

Find (the tail of the tenant `Response.json` override, immediately before
its closing `});`):

```ts
        generalCosts: [],
        billingAdjustments: [],
        roles: [],
        users: [],
        rolePermissions: [],
        reminderTemplates: [],
      });
    }
    return Response.json(responseData);
```

Replace with:

```ts
        generalCosts: [],
        billingAdjustments: [],
        roles: [],
        users: [],
        rolePermissions: [],
        reminderTemplates: [],
        overdueMeterRooms: [],
      });
    }
    return Response.json(responseData);
```

- [ ] **Step 5: Add the field to the client `Data` type**

File: `app/modules/shared.tsx`. Find:

```ts
  meterMonths: string[];
```

Replace with:

```ts
  meterMonths: string[];
  // Rooms whose electricity would go unbilled if the next, not-yet-run
  // cycle were generated right now — see computeUnreadMeterRooms /
  // upcomingMeterCutoff in app/api/system/route.ts. Empty for tenants.
  overdueMeterRooms: Row[];
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts app/modules/shared.tsx
```

Expected: both clean (same two pre-existing warnings only).

- [ ] **Step 7: Verify against the real dev server**

With the dev server running on `localhost:3000` and no billing cycle
covering the current month yet reserved (check via `curl -s
http://localhost:3000/api/system | python3 -c "import json,sys;
d=json.load(sys.stdin); print(d.get('overdueMeterRooms'))"` as an
authenticated non-tenant session — reuse this session's established
session-cookie technique), confirm `overdueMeterRooms` is present and is
an array (it may legitimately be empty on the real dataset if every
occupied room happens to be current — that's fine; the check here is that
the field exists, is well-formed, and the endpoint doesn't error).

Separately, confirm a tenant-role session's response has
`overdueMeterRooms: []` regardless.

- [ ] **Step 8: Commit**

```bash
git add app/api/system/route.ts app/modules/shared.tsx
git commit -m "$(cat <<'EOF'
Ship overdueMeterRooms on the full /api/system load

Computed from a settings-derived "next cut-off that hasn't happened yet",
independent of whether Accounts has reserved a cycle for it — so the
reminder is live all month, not just after "Prepare billing month".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Ship `overdueMeterRooms` on the scoped `meter-readings` reload too

**Files:**
- Modify: `app/api/system/route.ts` (`loadScopedModules`, around line 1129)

**Interfaces:**
- Consumes: `computeUnreadMeterRooms` and `upcomingMeterCutoff` (Tasks 1–2).

This task exists because `app/SystemContext.tsx`'s `scopedModulesForAction()`
maps every `meter-reading*` action to `["meter-readings"]` (see its comment
at line 44–46), meaning `save()` after entering a reading calls `GET
/api/system?modules=meter-readings` — **not** the full load this feature's
Task 2 touched. Without this task, the badge and callout would show stale
data until the next full page load, silently defeating the "drops off the
list the instant a qualifying reading is saved" requirement from the spec.

- [ ] **Step 1: Add `overdueMeterRooms` to the meter-readings scope**

Find:

```ts
  if (scopes.has("meter-history") || scopes.has("meter-readings")) {
    tasks.push(
      (async () => {
        result.meterReadings = await selectMeterReadings(
          db,
          scopes.has("meter-history") ? null : METER_READINGS_PER_ROOM,
        );
      })(),
    );
  }
```

Replace with:

```ts
  if (scopes.has("meter-history") || scopes.has("meter-readings")) {
    tasks.push(
      (async () => {
        result.meterReadings = await selectMeterReadings(
          db,
          scopes.has("meter-history") ? null : METER_READINGS_PER_ROOM,
        );
      })(),
    );
  }
  // A saved reading can take a room off the overdue list, so the same
  // reload that refreshes meterReadings has to refresh this too — a save()
  // after "meter-reading*" only asks for the "meter-readings" scope (see
  // scopedModulesForAction() in app/SystemContext.tsx), never the full load.
  if (scopes.has("meter-readings")) {
    tasks.push(
      (async () => {
        result.overdueMeterRooms = await computeUnreadMeterRooms(
          db,
          await upcomingMeterCutoff(db),
        );
      })(),
    );
  }
```

- [ ] **Step 2: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts
```

Expected: clean.

- [ ] **Step 3: Verify the scoped reload actually refreshes it**

```bash
curl -s "http://localhost:3000/api/system?modules=meter-readings" \
  -H "Cookie: hostel_session=<a valid non-tenant session token>" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('overdueMeterRooms' in d, d.get('overdueMeterRooms'))"
```

Expected: `True <array>` — confirming the scoped response includes the
field (a bare full-load check from Task 2 would not have caught this, since
that request never goes through `loadScopedModules`).

- [ ] **Step 4: Commit**

```bash
git add app/api/system/route.ts
git commit -m "$(cat <<'EOF'
Refresh overdueMeterRooms on the scoped meter-readings reload

save() after a meter-reading action only re-fetches the "meter-readings"
scope, not the full payload — without this, a room saved off the overdue
list would keep showing as overdue until the next full page load.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tab badge on "Meter readings"

**Files:**
- Modify: `app/modules/Maintenance.tsx` (the tab button around line 696–703)

**Interfaces:**
- Consumes: `data.overdueMeterRooms` (Task 2's `Data` type addition).

The badge needs no new CSS: it is a bare `<span>` inside
`.workspace-tabs.module-tabs`, and `.workspace-tabs span` already exists in
`app/globals.css` (~line 3516) giving every such span a white-on-green
pill — the exact same rule the existing "Room turnover" tab's badge
(`turnoverRooms.length + pendingCheckoutMeters.length`, line 689–693)
already relies on. Confirm this before writing new CSS, not after.

- [ ] **Step 1: Confirm the existing badge styling applies to a plain span**

```bash
grep -n "workspace-tabs span" app/globals.css
```

Expected: one rule, `.workspace-tabs span { margin-left: 5px; padding: ...;
color: white; background: var(--green); font-size: 10px; }` (or
equivalent) — confirming no new CSS class is needed for this step.

- [ ] **Step 2: Add the badge**

Find:

```tsx
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "meters" ? "active" : ""}
            onClick={() => setTab("meters")}
          >
            Meter readings
          </button>
        )}
```

Replace with:

```tsx
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "meters" ? "active" : ""}
            onClick={() => setTab("meters")}
          >
            Meter readings
            {data.overdueMeterRooms.length > 0 && (
              <span className="tab-count pending">
                {data.overdueMeterRooms.length}
              </span>
            )}
          </button>
        )}
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/Maintenance.tsx
```

Expected: clean.

- [ ] **Step 4: Visual check against the real dev server**

Using the Claude Browser MCP tools, navigate to `localhost:3000/maintenance`
as a non-tenant session. If `data.overdueMeterRooms` is currently empty on
the real dataset (possible — the real hostel data may be fully current),
temporarily insert one synthetic unread room via a scratch script (a
`ZZTEST` room already exists from earlier sessions, or create a minimal one
following the pattern in Task 1's Step 5 script but targeting a room with
zero meter readings) so the badge has something to show, screenshot the
tab strip to confirm the badge renders, then clean the fixture up.

- [ ] **Step 5: Commit**

```bash
git add app/modules/Maintenance.tsx
git commit -m "$(cat <<'EOF'
Add overdue-reading count badge to the Meter readings tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Overdue callout panel + click-to-filter + copy

**Files:**
- Modify: `app/modules/Maintenance.tsx` (insert a new section immediately
  before line 890, `{tab === "meters" && meterView === "entry" && (`)
- Modify: `app/globals.css` (new rules for the panel and its chips)

**Interfaces:**
- Consumes: `data.overdueMeterRooms` (`{ roomCode: string; lastReadingDate: string | null }[]`), and the entry grid's existing state setters `setEntryHostelId`, `setEntryQuery` (already declared in this file — see lines 245 and 247), and the already-computed `meterRooms` array (line 371–373, each row carrying `hostelId`, `unitCode`, `roomLabel`) used here only to resolve a clicked room's `hostelId` (the payload itself carries only `roomCode`/`lastReadingDate`, so this is done client-side by matching `${room.unitCode}-${room.roomLabel}` against the clicked chip's `roomCode` — the same string this file already builds for every other room-code comparison, e.g. in `entryRowsAll`).

- [ ] **Step 1: Add the callout panel**

Find:

```tsx
      {tab === "meters" && meterView === "entry" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>MONTHLY METER ENTRY</small>
```

Replace with:

```tsx
      {tab === "meters" &&
        meterView === "entry" &&
        data.overdueMeterRooms.length > 0 && (
          <section className="panel meter-overdue-panel">
            <div className="section-heading">
              <div>
                <small>BEFORE THE NEXT CUT-OFF</small>
                <h3>
                  {data.overdueMeterRooms.length} room
                  {data.overdueMeterRooms.length === 1 ? "" : "s"} still need
                  {data.overdueMeterRooms.length === 1 ? "s" : ""} a reading
                </h3>
                <p>
                  Once this cycle is generated, these rooms&apos; electricity
                  for this round will not be billed to anyone — it is not
                  deferred to next month, it is gone. Read the meter and key
                  it in below before then.
                </p>
                <p className="meter-overdue-note">
                  输入的日期请填今天，不要填实际去看表的那一天，不然这笔用量可能还是收不到。
                </p>
              </div>
            </div>
            <div className="meter-overdue-chips">
              {data.overdueMeterRooms.map((room: Row) => (
                <button
                  key={room.roomCode}
                  type="button"
                  className="meter-overdue-chip"
                  onClick={() => {
                    const match = meterRooms.find(
                      (candidate) =>
                        `${candidate.unitCode}-${candidate.roomLabel}` ===
                        room.roomCode,
                    );
                    if (match) setEntryHostelId(String(match.hostelId));
                    setEntryQuery(String(room.roomCode));
                  }}
                >
                  <strong>{room.roomCode}</strong>
                  <small>
                    {room.lastReadingDate
                      ? `last read ${dateLabel(room.lastReadingDate)}`
                      : "never read"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        )}
      {tab === "meters" && meterView === "entry" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>MONTHLY METER ENTRY</small>
```

`dateLabel` is already imported in this file (confirmed: line 18, and
already used at lines 850–852 and 998 for other date displays) — no new
import needed.

- [ ] **Step 2: Add CSS**

File: `app/globals.css`. Find the end of the meter-hostel-tabs rules (used
as an anchor — insert immediately after):

```css
.meter-hostel-tabs .tab-count.done {
  /* --green-dark is an alias of the brand indigo, which would put indigo
     text on a green pill. --ok-text is the actual green. */
  color: var(--ok-text);
  background: var(--ok-fill);
}
```

Replace with:

```css
.meter-hostel-tabs .tab-count.done {
  /* --green-dark is an alias of the brand indigo, which would put indigo
     text on a green pill. --ok-text is the actual green. */
  color: var(--ok-text);
  background: var(--ok-fill);
}

/* =========================================================
   METER OVERDUE REMINDER
   ========================================================= */

.meter-overdue-panel {
  border-color: var(--warn-line);
  background: var(--warn-wash);
}

.meter-overdue-panel h3 {
  color: var(--warn-text);
}

.meter-overdue-note {
  margin-top: var(--sp-2);
  font-weight: 600;
  color: var(--warn-text);
}

.meter-overdue-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  padding: 0 var(--sp-6) var(--sp-6);
}

.meter-overdue-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--warn-line);
  border-radius: var(--r-md);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
}

.meter-overdue-chip:hover {
  background: var(--warn-fill);
}

.meter-overdue-chip strong {
  font-size: 13px;
  color: var(--ink);
}

.meter-overdue-chip small {
  font-size: 11px;
  color: var(--warn-text);
}
```

All four tokens used above (`--surface`, `--ink`, `--sp-6`, `--sp-5`) are
already defined in `app/globals.css`'s `:root` block (confirmed at lines
29, 36, 114–115). `.meter-overdue-chips`'s horizontal padding
(`var(--sp-6)`) matches `.section-heading`'s own horizontal padding
(`padding: var(--sp-6) var(--sp-6) var(--sp-4)`, confirmed at line 3540),
so the chip row lines up under the heading text above it rather than
guessing at a value.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint app/modules/Maintenance.tsx
```

Expected: clean.

- [ ] **Step 4: Visual + interaction check against the real dev server**

Using the Claude Browser MCP tools (reusing the synthetic overdue room from
Task 4 Step 4, or creating a fresh one), navigate to
`localhost:3000/maintenance`, click the "Meter readings" tab, and confirm:
1. The callout panel renders above the entry grid with the amber styling
   and the chip(s).
2. Clicking a chip switches `entryHostelId` to that room's hostel (the
   hostel tab strip below should now show that hostel active) and the entry
   grid's search box now shows the room's code, narrowing the grid to that
   one row.
3. Entering and saving a reading for that room (via the normal entry grid
   flow) makes the chip disappear from the callout and the tab badge count
   decrement, without a full page reload — this specifically exercises
   Task 3's scoped-reload fix.

Clean up the synthetic fixture afterward.

- [ ] **Step 5: Commit**

```bash
git add app/modules/Maintenance.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add overdue meter-reading callout to Maintenance

Lists rooms whose electricity will go permanently unbilled once the next
cycle runs, with a click-to-filter shortcut into the entry grid and a
note against the backdating trap (a reading dated to the day it was
physically read, rather than today, can still land inside an
already-generated cycle and lose the usage anyway).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full end-to-end verification and final checks

**Files:** None modified — verification only.

**Interfaces:** None new.

- [ ] **Step 1: Full typecheck and lint across every file this plan touched**

```bash
npx tsc --noEmit
npx eslint app/api/system/route.ts app/modules/shared.tsx app/modules/Maintenance.tsx app/globals.css
```

Expected: clean (the two pre-existing unrelated warnings in
`app/api/system/route.ts` only).

- [ ] **Step 2: Build a complete synthetic scenario proving the three staleness cases**

Write `.claude-scratch/verify_overdue_reminder_e2e.mjs`:

```js
// End-to-end fixture for the overdue-reading reminder: one room never read
// (should appear, lastReadingDate null), one room read but before the
// previous real cycle's cut-off (should appear, with that date), one room
// read after it (should NOT appear). Uses the same three "testing N"
// assignments established earlier this session. Run with "clean" to remove.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2, idle_timeout: 10 });
await sql`SET search_path TO public`;

const MARK = "ZZTEST-OVERDUE-E2E";

if (process.argv[2] === "clean") {
  await sql`DELETE FROM meter_readings WHERE notes = ${MARK}`;
  console.log("cleaned readings tagged", MARK);
  await sql.end();
  process.exit(0);
}

const [latestCycle] = await sql`
  SELECT cutoff_date FROM billing_cycles ORDER BY cutoff_date DESC LIMIT 1`;
console.log("most recent real cutoff:", latestCycle?.cutoff_date || "(none)");

// testing 4's room (assignment 530) — give it a reading dated BEFORE the
// most recent real cutoff, so it should still show as overdue.
const [room4] = await sql`
  SELECT b.room_id FROM accommodation_assignments a
  JOIN bed_spaces b ON a.bed_space_id = b.id
  WHERE a.id = 530`;
const staleDate = latestCycle?.cutoff_date
  ? new Date(new Date(latestCycle.cutoff_date).getTime() - 5 * 86_400_000)
      .toISOString()
      .slice(0, 10)
  : "2026-01-01";
await sql`
  INSERT INTO meter_readings (room_id, reading_date, reading_value, reading_type, notes)
  VALUES (${room4.room_id}, ${staleDate}, 500, 'monthly', ${MARK})`;

// testing 15's room (assignment 546) — give it a reading dated AFTER the
// most recent real cutoff, so it should NOT show as overdue.
const [room15] = await sql`
  SELECT b.room_id FROM accommodation_assignments a
  JOIN bed_spaces b ON a.bed_space_id = b.id
  WHERE a.id = 546`;
const freshDate = new Date().toISOString().slice(0, 10);
await sql`
  INSERT INTO meter_readings (room_id, reading_date, reading_value, reading_type, notes)
  VALUES (${room15.room_id}, ${freshDate}, 500, 'monthly', ${MARK})`;

// testing 2's room (assignment 526) is left with whatever readings it
// already has from earlier this session's cleanup — if genuinely none,
// it demonstrates the "never read" case for free.

console.log(JSON.stringify({ staleDate, freshDate }));
await sql.end();
```

- [ ] **Step 3: Run it and inspect the live payload**

```bash
set -a; source .env.local; set +a
node .claude-scratch/verify_overdue_reminder_e2e.mjs
```

Then, using a non-tenant session cookie (reuse or recreate the temporary
`app_users`/`user_sessions` technique from earlier billing verification
work this session):

```bash
curl -s http://localhost:3000/api/system -H "Cookie: hostel_session=<token>" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
rooms = {r['roomCode']: r['lastReadingDate'] for r in d.get('overdueMeterRooms', [])}
print(rooms)
"
```

Expected: testing 4's room code appears with `lastReadingDate` equal to
the stale date just inserted; testing 15's room code does **not** appear
(its fresh reading takes it off the list); testing 2's room code appears
with `lastReadingDate: null` if it truly has no reading, or with whatever
date it already had otherwise.

- [ ] **Step 4: Verify through the browser one more time, end to end**

Using the Claude Browser MCP tools: load `/maintenance` as a non-tenant
session, confirm the tab badge count matches the API response's array
length, open the "Meter readings" tab, confirm the callout lists exactly
the expected rooms with the expected last-read labels, click testing 4's
chip, confirm it filters to that room in the entry grid, key in and save a
fresh reading for it, and confirm both the chip and the badge count update
immediately (no manual reload).

- [ ] **Step 5: Clean up every fixture from this entire plan**

```bash
set -a; source .env.local; set +a
node .claude-scratch/verify_overdue_reminder_e2e.mjs clean
rm .claude-scratch/verify_overdue_reminder_e2e.mjs
```

Also remove any other synthetic session/user rows or scratch scripts
created ad hoc during Tasks 3–5's manual verification steps (session
tokens, temporary `app_users` rows) using the same delete pattern
established earlier this session (delete `user_sessions` rows for the
user, then the `app_users` row itself).

- [ ] **Step 6: Confirm the real dataset is untouched**

Write `.claude-scratch/check_cleanup.mjs` (do not use `node -e` with an
inline string for this — this session hit unreliable shell-quoting of `%`
and `'` inside a `node -e` argument earlier; a file sidesteps it entirely):

```js
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
const cycles = await sql`SELECT id FROM billing_cycles WHERE period_label LIKE 'ZZTEST%'`;
const readings = await sql`SELECT id FROM meter_readings WHERE notes LIKE 'ZZTEST%'`;
const users = await sql`SELECT id FROM app_users WHERE email LIKE 'zztest%'`;
console.log({ cycles: cycles.length, readings: readings.length, users: users.length });
await sql.end();
```

```bash
set -a; source .env.local; set +a
node .claude-scratch/check_cleanup.mjs
rm .claude-scratch/check_cleanup.mjs
```

Expected: `{ cycles: 0, readings: 0, users: 0 }`.

- [ ] **Step 7: Final commit (if Step 5's cleanup touched any tracked files)**

Only if `.claude-scratch/` scripts were accidentally left tracked by git —
they should not be, per this session's established convention of scratch
files staying untracked. Run `git status` to confirm nothing unexpected is
staged before finishing.
