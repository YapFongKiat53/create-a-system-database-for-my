import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { systemSettings } from "../../../db/schema";

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Money in
// ---------------------------------------------------------------------------

/**
 * Reads a money field off a request body.
 *
 * Deliberately has no fallback: asNumber(x, 0) turns a mistyped rent into
 * RM 0, and a tenancy at RM 0 is skipped by every billing run from then on
 * without a word — the mistake only surfaces a year later when somebody asks
 * why that student has never been charged. A number that cannot be read is an
 * error, not a zero.
 *
 * Formatting people actually paste in — thousands separators, an RM prefix —
 * is cleaned off first, so "RM 1,200" is accepted rather than rejected on a
 * technicality. Eleven of the system's money inputs are plain text fields and
 * the meter CSV splits on commas, so this is not a hypothetical.
 */
export function parseMoney(
  raw: unknown,
  fieldLabel: string,
  options: { allowNegative?: boolean } = {},
): number {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/^rm\s*/i, "")
    .replace(/[,\s]/g, "")
    .replace(/^(rm|myr)/i, "");
  if (!cleaned)
    throw new Error(`${fieldLabel} is required — enter an amount.`);
  const value = Number(cleaned);
  if (!Number.isFinite(value))
    throw new Error(
      `${fieldLabel} is not an amount this can read: "${String(raw)}"`,
    );
  if (!options.allowNegative && value < 0)
    throw new Error(`${fieldLabel} cannot be negative: "${String(raw)}"`);
  return value;
}

/** parseMoney for a field that is genuinely optional — blank stays blank. */
export function parseOptionalMoney(
  raw: unknown,
  fieldLabel: string,
  options: { allowNegative?: boolean } = {},
): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  return parseMoney(raw, fieldLabel, options);
}

// ---------------------------------------------------------------------------
// Amounts that are valid numbers but probably wrong
// ---------------------------------------------------------------------------

export type MoneyGuards = {
  meterJumpKwh: number;
  overpayPct: number;
  overpayRm: number;
  rentMax: number;
};

export const DEFAULT_GUARDS: MoneyGuards = {
  // The whole estate averages ~89 kWh a room per month over 3,557 real
  // readings, so 500 is generous — it catches a mis-keyed extra digit
  // without stopping a room that genuinely ran air-conditioning all month.
  meterJumpKwh: 500,
  overpayPct: 20,
  overpayRm: 100,
  rentMax: 5000,
};

export const GUARD_SETTING_KEYS = {
  meterJumpKwh: "money-guard-meter-jump-kwh",
  overpayPct: "money-guard-overpay-pct",
  overpayRm: "money-guard-overpay-rm",
  rentMax: "money-guard-rent-max",
} as const;

/**
 * Thresholds live in system_settings so they can be tuned when staff find
 * them too tight or too loose, without a code change or a deploy.
 */
export async function loadMoneyGuards(db: Db): Promise<MoneyGuards> {
  const rows = await db.select().from(systemSettings);
  const read = (key: string, fallback: number) => {
    const raw = rows.find((row) => row.settingKey === key)?.settingValue;
    const value = Number(raw);
    return raw !== undefined && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  };
  return {
    meterJumpKwh: read(GUARD_SETTING_KEYS.meterJumpKwh, DEFAULT_GUARDS.meterJumpKwh),
    overpayPct: read(GUARD_SETTING_KEYS.overpayPct, DEFAULT_GUARDS.overpayPct),
    overpayRm: read(GUARD_SETTING_KEYS.overpayRm, DEFAULT_GUARDS.overpayRm),
    rentMax: read(GUARD_SETTING_KEYS.rentMax, DEFAULT_GUARDS.rentMax),
  };
}

/**
 * Thrown when a figure is a valid number but looks like a slip. Staff can
 * push it through — some months really are like that — but only by saying so
 * explicitly, which is then recorded against the record itself.
 */
export class SuspiciousAmountError extends Error {
  readonly suspicious = true;
  constructor(message: string) {
    super(message);
    this.name = "SuspiciousAmountError";
  }
}

const money = (value: number) =>
  `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * A month's usage far above what any room here uses. The message carries the
 * comparison, not just the verdict — "too big" tells staff nothing they can
 * act on, "1,240 kWh against an estate average of 89" tells them where to look.
 */
export function checkMeterJump(
  usage: number,
  guards: MoneyGuards,
  context: { roomCode: string; previous: number; current: number },
) {
  if (usage <= guards.meterJumpKwh) return;
  throw new SuspiciousAmountError(
    `${context.roomCode} would bill ${usage.toLocaleString()} kWh this round ` +
      `(${context.previous.toLocaleString()} → ${context.current.toLocaleString()}), over the ` +
      `${guards.meterJumpKwh.toLocaleString()} kWh check. A room here averages 89 kWh a month, ` +
      `and one extra digit on a reading looks exactly like this. Check it, then confirm below.`,
  );
}

/** A receipt materially larger than what the invoice still owes. */
export function checkOverpayment(
  amount: number,
  guards: MoneyGuards,
  context: { outstanding: number; invoiceNo: string },
) {
  const excess = amount - context.outstanding;
  if (excess <= 0) return;
  const pct = context.outstanding > 0 ? (excess / context.outstanding) * 100 : Infinity;
  if (excess < guards.overpayRm && pct < guards.overpayPct) return;
  throw new SuspiciousAmountError(
    `${context.invoiceNo} still owes ${money(context.outstanding)}, but this receipt is ` +
      `${money(amount)} — ${money(excess)} more. Paying several months at once is normal, ` +
      `so confirm below if that is what this is.`,
  );
}

/** A monthly rent well outside anything the estate charges. */
export function checkRentOutlier(
  rent: number,
  guards: MoneyGuards,
  context: { label: string },
) {
  if (rent <= guards.rentMax) return;
  throw new SuspiciousAmountError(
    `A monthly rent of ${money(rent)} on ${context.label} is over the ${money(guards.rentMax)} check. ` +
      `A whole-unit contract really does run this high, so confirm below if that is what this is.`,
  );
}

/** The line appended to a record's notes when somebody overrides a guard. */
export function confirmationNote(who: string, what: string) {
  return `[Checked] ${who} confirmed on ${new Date().toISOString().slice(0, 16).replace("T", " ")}: ${what}`;
}

// ---------------------------------------------------------------------------
// Before the invoices go out
// ---------------------------------------------------------------------------

export type PreflightIssue = {
  key: "no-rent" | "no-meter" | "expired-agreement" | "no-end-date";
  title: string;
  detail: string;
  count: number;
  rows: { label: string; note: string }[];
};

export type PreflightReport = { issues: PreflightIssue[]; checkedAt: string };

/**
 * The other half of getting the money right: a figure can be perfectly valid
 * and still never be charged, because nobody set it. Run against the cycle
 * about to be generated and shown above the preview — reported, never
 * blocking, since "preview then generate" is already the gate.
 */
export async function billingPreflight(
  db: Db,
  input: { cutoffDate: string },
): Promise<PreflightReport> {
  const cap = 20;

  const [noRent, noMeter, expired, noEndDate] = await Promise.all([
    // Rent of zero is correct in a block let — one contract carries the unit
    // and the students under it are recorded at zero. It is only a problem
    // where nobody in the unit pays anything at all.
    db.execute<{ label: string; note: string }>(sql`
      SELECT s.full_name AS label, u.unit_code || '-' || r.room_label AS note
      FROM accommodation_assignments a
      JOIN student_profiles s ON s.id = a.student_id
      JOIN bed_spaces b ON b.id = a.bed_space_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_units u ON u.id = r.unit_id
      WHERE a.status = 'active' AND COALESCE(a.monthly_rental, 0) <= 0
        AND NOT EXISTS (
          SELECT 1 FROM accommodation_assignments a2
          JOIN bed_spaces b2 ON b2.id = a2.bed_space_id
          JOIN hostel_rooms r2 ON r2.id = b2.room_id
          WHERE r2.unit_id = u.id AND a2.status = 'active'
            AND COALESCE(a2.monthly_rental, 0) > 0
        )
      ORDER BY u.unit_code, r.room_label
    `),
    // No baseline at all, as opposed to "not read this round" — a room with
    // one reading still cannot charge anything until a second one lands.
    db.execute<{ label: string; note: string }>(sql`
      SELECT DISTINCT u.unit_code || '-' || r.room_label AS label,
             CASE WHEN (SELECT count(*) FROM meter_readings m WHERE m.room_id = r.id) = 0
                  THEN 'never read' ELSE 'only one reading' END AS note
      FROM accommodation_assignments a
      JOIN bed_spaces b ON b.id = a.bed_space_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_units u ON u.id = r.unit_id
      WHERE a.status = 'active' AND u.electricity_billing <> 'tnb-direct'
        AND (SELECT count(*) FROM meter_readings m WHERE m.room_id = r.id) < 2
      ORDER BY 1
    `),
    db.execute<{ label: string; note: string }>(sql`
      SELECT s.full_name AS label,
             u.unit_code || '-' || r.room_label || ' · ended ' || a.agreement_end_date AS note
      FROM accommodation_assignments a
      JOIN student_profiles s ON s.id = a.student_id
      JOIN bed_spaces b ON b.id = a.bed_space_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_units u ON u.id = r.unit_id
      WHERE a.status = 'active' AND a.agreement_end_date IS NOT NULL
        AND a.agreement_end_date < ${input.cutoffDate}
      ORDER BY a.agreement_end_date
    `),
    db.execute<{ label: string; note: string }>(sql`
      SELECT s.full_name AS label, u.unit_code || '-' || r.room_label AS note
      FROM accommodation_assignments a
      JOIN student_profiles s ON s.id = a.student_id
      JOIN bed_spaces b ON b.id = a.bed_space_id
      JOIN hostel_rooms r ON r.id = b.room_id
      JOIN hostel_units u ON u.id = r.unit_id
      WHERE a.status = 'active' AND a.agreement_end_date IS NULL
      ORDER BY u.unit_code, r.room_label
    `),
  ]);

  const issue = (
    key: PreflightIssue["key"],
    title: string,
    detail: string,
    rows: { label: string; note: string }[],
  ): PreflightIssue => ({
    key,
    title,
    detail,
    count: rows.length,
    rows: rows.slice(0, cap).map((row) => ({
      label: String(row.label ?? ""),
      note: String(row.note ?? ""),
    })),
  });

  return {
    checkedAt: new Date().toISOString(),
    issues: [
      issue(
        "no-rent",
        "Living here with no rent set",
        "Nobody in their unit pays anything either, so this cycle bills them nothing at all.",
        noRent,
      ),
      issue(
        "no-meter",
        "Room has no meter baseline",
        "Electricity is the movement between two readings; fewer than two cannot produce a usage figure.",
        noMeter,
      ),
      issue(
        "expired-agreement",
        "Agreement expired, still living here",
        "The agreement ended before this cycle's cut-off, and neither a renewal nor a move-out has been recorded.",
        expired,
      ),
      issue(
        "no-end-date",
        "Agreement has no end date",
        "Nothing to renew from, and the tenancy never reaches the expiry reminders.",
        noEndDate,
      ),
    ].filter((row) => row.count > 0),
  };
}
