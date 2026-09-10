import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { getDb, type PgTx } from "../../../db";
import {
  getSessionUser,
  hashPassword,
  permissionsForRole,
} from "../../../db/auth";
import {
  accessCards,
  accommodationAssignments,
  announcements,
  appRoles,
  appUsers,
  bedSpaces,
  billingItemAdjustments,
  billingCycles,
  billingInvoices,
  billingItems,
  depositAdjustments,
  billingPaymentRecords,
  courses,
  generalCosts,
  hostelCategoryRates,
  hostelProperties,
  hostelRooms,
  hostelUnits,
  maintenanceTickets,
  meterReadings,
  parkingLots,
  parkingRentals,
  reservationCharges,
  reservationPayments,
  reservations,
  schools,
  storedAttachments,
  studentProfiles,
  studentRateChanges,
  ticketCategories,
  ticketMessages,
  reminderTemplates,
  rolePermissions,
  systemSettings,
  unitOwnerDetails,
  unitServices,
  userSessions,
} from "../../../db/schema";
import inventorySource from "../../../data/hostel-inventory.json";
import assignmentSource from "../../../data/student-assignments.json";

type SeedBed = {
  bedLabel: string;
  legacyCode: string;
  status: string;
  specialUse: string | null;
  monthlyRental: number | null;
  legacyAccessCardDeposit: number | null;
};
type SeedRoom = { roomLabel: string; bedSpaces: SeedBed[] };
type SeedUnit = {
  unitCode: string;
  address: string;
  gender: string;
  rooms: SeedRoom[];
};
type SeedHostel = {
  name: string;
  code: string;
  address: string;
  units: SeedUnit[];
};
type AssignmentImport = {
  sourceKey: string;
  legacyCode: string;
  student: {
    sourceCode: string;
    fullName: string;
    nationality: string;
    hometown: string;
    course: string;
  };
  assignment: {
    monthlyRental: number | null;
    securityDeposit: number | null;
    accessCardDeposit: number | null;
    salesperson: string;
    checkInDate: string | null;
    agreementStartDate: string | null;
    agreementEndDate: string | null;
    agreementDuration: string;
    checkOutDate: string | null;
    checkInMeter: number | null;
    remarks: string;
  };
};

const inventory = inventorySource as SeedHostel[];
const importedAssignments = (
  assignmentSource as { records: AssignmentImport[] }
).records;
const chargeTypes = [
  "first-month-rental",
  "deposit",
  "admin-fee",
  "access-card-deposit",
  "access-card-handling",
  "stamping-fee",
  "cleaning-package",
  "bedding-set",
  "advance-rental",
  "advance-utility",
] as const;
const chargeLabels: Record<string, string> = {
  "first-month-rental": "First month advance rental",
  deposit: "Deposit",
  "admin-fee": "Admin fee",
  "access-card-deposit": "Access card deposit",
  "access-card-handling": "Access card handling fee",
  "stamping-fee": "Stamping fee",
  "cleaning-package": "Cleaning package",
  "bedding-set": "Bedding set",
  "advance-rental": "Advance rental",
  "advance-utility": "Advance utility fee",
  // Not in chargeTypes: this one is added by reservation-room-change, not
  // edited through the reservation Payment step's charge breakdown.
  "room-transfer-fee": "Room transfer fee",
};
// A room change can raise a charge the student already settled (deposit
// 2,250 -> 3,000). Rather than flipping the whole line back to unpaid and
// losing sight of the 2,250, the settled part stays paid and the increase
// becomes its own line — same charge type, so Finance still files it under
// deposit — carrying one of these notes to explain where it came from.
const CHARGE_TOPUP_NOTE = "Room change top-up";
const CHARGE_BALANCE_NOTE = "Remaining balance";

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function runBatches<T>(
  db: ReturnType<typeof getDb>,
  items: readonly T[],
  build: (item: T, tx: PgTx) => Promise<unknown>,
) {
  if (!items.length) return;
  await db.transaction(async (tx) => {
    for (const item of items) await build(item, tx);
  });
}

function nextDay(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Whole days from `today` to `value` (negative if `value` is in the past).
function daysUntil(today: string, value: string | null) {
  if (!value) return null;
  const diffMs =
    Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(diffMs / 86_400_000);
}

function asText(value: unknown, fallback = "") {
  return value === null || value === undefined
    ? fallback
    : String(value).trim();
}
function asNullableText(value: unknown) {
  const result = asText(value);
  return result || null;
}
function asNumber(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}
function asNullableNumber(value: unknown) {
  const result = Number(value);
  return value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(result)
    ? null
    : result;
}
function boolValue(value: unknown) {
  return (
    value === true ||
    value === "true" ||
    value === "1" ||
    value === 1 ||
    value === "on"
  );
}
function nowIso() {
  return new Date().toISOString();
}
function todayInKL() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());
}

// seedAdministration/seedInventory/seedKnownRoomFeatures/seedStudentAssignments
// are one-time idempotent data loads (INSERT ... ON CONFLICT DO NOTHING /
// UPDATE ... WHERE still-default) that were re-running on every single
// request to app/api/system, each costing several DB round trips for work
// that only ever needs to happen once the data already exists. Caching
// "already done" per isolate (reset on cold start, harmless since re-running
// is a no-op) skips that cost on every request after the first.
// applyLatePaymentCharges is genuinely date-driven — it needs to reflect
// "today," but only once per calendar day, not once per request — cached by
// the KL calendar date it last ran on.
let administrationSeeded = false;
let inventorySeeded = false;
let knownRoomFeaturesSeeded = false;
let studentAssignmentsSeeded = false;
let lateChargesAppliedOn: string | null = null;

function fullUnitAddress(
  unitCode: string,
  hostelCode: string,
  hostelAddress: string,
) {
  const clean = unitCode.trim();
  const number =
    hostelCode === "ATR" && /^\d{4}$/.test(clean)
      ? `1-${clean.slice(0, 2)}-${clean.slice(2)}`
      : clean;
  return [number, hostelAddress].filter(Boolean).join(", ");
}

// The bed-space query and the fields derived from it, shared by the full
// GET payload and the narrow ?modules=rooms scope. Kept as one definition on
// purpose: currentRental / rateSource decide what a bed is charged at, and a
// second copy would eventually disagree with this one.
function selectRawBeds(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: bedSpaces.id,
      roomId: hostelRooms.id,
      hostelId: hostelProperties.id,
      hostelName: hostelProperties.name,
      hostelCode: hostelProperties.code,
      unitId: hostelUnits.id,
      unitCode: hostelUnits.unitCode,
      unitStatus: hostelUnits.status,
      unitSurrenderDate: hostelUnits.surrenderDate,
      // "tnb-direct" units have no room meters — the whole-unit electricity
      // report has to say that rather than report them as unread.
      electricityBilling: hostelUnits.electricityBilling,
      gender: hostelUnits.gender,
      roomLabel: hostelRooms.roomLabel,
      configuredRoomType: hostelRooms.roomType,
      bathroomType: hostelRooms.bathroomType,
      salesRate: hostelRooms.salesRate,
      promotionRate: hostelRooms.promotionRate,
      promotionStartDate: hostelRooms.promotionStartDate,
      promotionEndDate: hostelRooms.promotionEndDate,
      bedLabel: bedSpaces.bedLabel,
      bedType: bedSpaces.bedType,
      legacyCode: bedSpaces.legacyCode,
      meterSerial: hostelRooms.meterSerial,
      status: bedSpaces.status,
      specialUse: bedSpaces.specialUse,
      monthlyRental: bedSpaces.monthlyRental,
      legacyAccessCardDeposit: bedSpaces.legacyAccessCardDeposit,
      occupantId: studentProfiles.id,
      occupantName: studentProfiles.fullName,
      occupantCode: studentProfiles.studentCode,
      occupantGender: studentProfiles.gender,
      occupantNationality: studentProfiles.nationality,
      occupantHometown: studentProfiles.hometown,
      occupantCourse: studentProfiles.course,
      occupantSchool: studentProfiles.school,
      assignmentId: accommodationAssignments.id,
      agreementEndDate: accommodationAssignments.agreementEndDate,
      assignmentRental: accommodationAssignments.monthlyRental,
      renewalAppliedAt: accommodationAssignments.renewalAppliedAt,
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
    .leftJoin(
      studentProfiles,
      eq(accommodationAssignments.studentId, studentProfiles.id),
    )
    .orderBy(
      asc(hostelProperties.name),
      asc(hostelUnits.unitCode),
      asc(hostelRooms.roomLabel),
      asc(bedSpaces.bedLabel),
    );
}

type RawBed = Awaited<ReturnType<typeof selectRawBeds>>[number];

function deriveBeds(rawBeds: RawBed[], today: string) {
  const roomCounts = new Map<number, number>();
  for (const bed of rawBeds)
    roomCounts.set(bed.roomId, (roomCounts.get(bed.roomId) || 0) + 1);
  return rawBeds.map((bed) => {
    const agreementEnded = Boolean(
      bed.agreementEndDate && bed.agreementEndDate < today,
    );
    // A room can be pre-reserved while its current student is still
    // living there once their 1-year contract is within its last 14
    // days and they haven't applied to renew — reservedBedIds elsewhere
    // still keeps it out of the "any hostel" search until it's actually
    // vacant, this only affects the Availability search chip.
    const daysLeft = daysUntil(today, bed.agreementEndDate);
    const renewalDueSoon =
      bed.status === "occupied" &&
      !agreementEnded &&
      !bed.renewalAppliedAt &&
      daysLeft !== null &&
      daysLeft <= 14;
    const roomType =
      bed.configuredRoomType === "auto"
        ? (roomCounts.get(bed.roomId) || 1) > 1
          ? "sharing"
          : "single"
        : bed.configuredRoomType;
    return {
      ...bed,
      roomType,
      renewalDueSoon,
      currentRental:
        bed.salesRate ?? bed.assignmentRental ?? bed.monthlyRental,
      rateSource:
        bed.salesRate !== null
          ? "sales-rate"
          : bed.assignmentRental !== null
            ? "current-tenancy"
            : bed.monthlyRental !== null
              ? "legacy-rate"
              : "not-set",
      availableFrom:
        bed.status === "vacant"
          ? today
          : bed.status === "occupied"
            ? nextDay(bed.agreementEndDate)
            : null,
      availabilityState:
        // A bed held for a converted booking is never sellable, whatever
        // dates sit on its assignment — the student has paid for it and is
        // simply not here yet.
        bed.status === "reserved"
          ? "unavailable"
          : bed.status === "vacant" || agreementEnded
            ? "available-now"
            : bed.status === "occupied" && bed.agreementEndDate
              ? "upcoming"
              : "unavailable",
    };
  });
}

function deriveHostels(
  properties: { id: number }[],
  units: { hostelId: number }[],
  beds: ReturnType<typeof deriveBeds>,
) {
  return properties.map((property) => {
    const rows = beds.filter((bed) => bed.hostelId === property.id);
    return {
      ...property,
      units: units.filter((unit) => unit.hostelId === property.id).length,
      bedSpaces: rows.length,
      occupied: rows.filter((bed) => bed.status === "occupied").length,
      vacant: rows.filter((bed) => bed.status === "vacant").length,
      // Converted and paid for, but the student hasn't arrived yet: the bed
      // is physically empty (so Maintenance can still clean/inspect it) but
      // is not sellable to anyone else.
      awaitingCheckIn: rows.filter((bed) => bed.status === "reserved").length,
      vacantFemale: rows.filter(
        (bed) => bed.status === "vacant" && bed.gender === "female",
      ).length,
      vacantMale: rows.filter(
        (bed) => bed.status === "vacant" && bed.gender === "male",
      ).length,
      vacantUnassigned: rows.filter(
        (bed) =>
          bed.status === "vacant" && !["female", "male"].includes(bed.gender),
      ).length,
      specialUse: rows.filter((bed) => bed.status === "special-use").length,
    };
  });
}

function selectStudents(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: studentProfiles.id,
      sourceKey: studentProfiles.sourceKey,
      studentCode: studentProfiles.studentCode,
      fullName: studentProfiles.fullName,
      identityNo: studentProfiles.identityNo,
      contactNumber: studentProfiles.contactNumber,
      email: studentProfiles.email,
      dateOfBirth: studentProfiles.dateOfBirth,
      gender: studentProfiles.gender,
      race: studentProfiles.race,
      raceOther: studentProfiles.raceOther,
      religion: studentProfiles.religion,
      religionOther: studentProfiles.religionOther,
      nationality: studentProfiles.nationality,
      nationalityOther: studentProfiles.nationalityOther,
      state: studentProfiles.state,
      hometown: studentProfiles.hometown,
      course: studentProfiles.course,
      school: studentProfiles.school,
      applicationFormNo: studentProfiles.applicationFormNo,
      receiptNo: studentProfiles.receiptNo,
      salesperson: studentProfiles.salesperson,
      agency: studentProfiles.agency,
      remarks: studentProfiles.remarks,
      profileStatus: studentProfiles.status,
      assignmentId: accommodationAssignments.id,
      bedSpaceId: accommodationAssignments.bedSpaceId,
      roomId: hostelRooms.id,
      // Room, not bed: staff let and bill by room, and the pickers all
      // speak room codes now. The bed is an internal slot.
      roomCode: sql<string>`${hostelUnits.unitCode} || '-' || ${hostelRooms.roomLabel}`,
      roomLabel: hostelRooms.roomLabel,
      unitId: hostelUnits.id,
      unitCode: hostelUnits.unitCode,
      hostelId: hostelProperties.id,
      hostelName: hostelProperties.name,
      monthlyRental: accommodationAssignments.monthlyRental,
      securityDeposit: accommodationAssignments.securityDeposit,
      accessCardDeposit: accommodationAssignments.accessCardDeposit,
      parkingDeposit: accommodationAssignments.parkingDeposit,
      checkInDate: accommodationAssignments.checkInDate,
      checkOutDate: accommodationAssignments.checkOutDate,
      // Null while the tenancy is converted-but-not-arrived. The Tenants
      // list uses it to show the "Check in" action, and the bed status
      // alongside it is what the counters key off.
      checkedInAt: accommodationAssignments.checkedInAt,
      checkInMeter: accommodationAssignments.checkInMeter,
      bedStatus: bedSpaces.status,
      // Lets the reservation screens find the tenancy a booking became, so
      // they can offer check-in from the card the sale was converted on.
      sourceReservationId: accommodationAssignments.sourceReservationId,
      leaseStartDate: accommodationAssignments.agreementStartDate,
      leaseEndDate: accommodationAssignments.agreementEndDate,
      assignmentStatus: accommodationAssignments.status,
      renewalAppliedAt: accommodationAssignments.renewalAppliedAt,
    })
    .from(studentProfiles)
    .leftJoin(
      accommodationAssignments,
      and(
        eq(accommodationAssignments.studentId, studentProfiles.id),
        eq(accommodationAssignments.status, "active"),
      ),
    )
    .leftJoin(
      bedSpaces,
      eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
    )
    .leftJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
    .leftJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
    .leftJoin(
      hostelProperties,
      eq(hostelUnits.hostelId, hostelProperties.id),
    )
    .orderBy(asc(studentProfiles.fullName));
}

function selectInvoices(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: billingInvoices.id,
      invoiceNo: billingInvoices.invoiceNo,
      cycleId: billingInvoices.cycleId,
      studentId: billingInvoices.studentId,
      studentName: studentProfiles.fullName,
      assignmentId: billingInvoices.assignmentId,
      // Room, not bed: staff let and bill by room, and the pickers all
      // speak room codes now. The bed is an internal slot.
      roomCode: sql<string>`${hostelUnits.unitCode} || '-' || ${hostelRooms.roomLabel}`,
      unitCode: hostelUnits.unitCode,
      hostelId: hostelProperties.id,
      hostelName: hostelProperties.name,
      dueDate: billingInvoices.dueDate,
      status: billingInvoices.status,
      totalAmount: billingInvoices.totalAmount,
      amountPaid: billingInvoices.amountPaid,
      invoiceFrequency: billingInvoices.invoiceFrequency,
      createdAt: billingInvoices.createdAt,
    })
    .from(billingInvoices)
    .innerJoin(
      studentProfiles,
      eq(billingInvoices.studentId, studentProfiles.id),
    )
    .leftJoin(
      accommodationAssignments,
      eq(billingInvoices.assignmentId, accommodationAssignments.id),
    )
    .leftJoin(
      bedSpaces,
      eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
    )
    .leftJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
    .leftJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
    .leftJoin(
      hostelProperties,
      eq(hostelUnits.hostelId, hostelProperties.id),
    )
    .orderBy(desc(billingInvoices.id));
}

function selectProperties(db: ReturnType<typeof getDb>) {
  return db.select().from(hostelProperties).orderBy(asc(hostelProperties.name));
}

// Narrow refresh scopes for GET /api/system?modules=... — used after a save()
// that only touches these tables, so the client doesn't have to re-run the
// full ~30-query load (see db/index.ts's getClient() comment for why that
// full load is expensive). Each scope is self-contained: verified against
// every action handler that can trigger it that it never writes outside the
// tables it queries here. Deliberately NOT covering units/students/finance/
// reservations/hostel-rates/meter-readings — those actions can ripple into
// bedSpaces occupancy or other fields (e.g. a meter reading updates
// hostelRooms.meterSerial, which is embedded in the bedSpaces payload) that
// this scoped path doesn't refresh, so they keep using the full,
// already-correct reload rather than risk a stale-data bug for speed.
// Tenant-role requests always fall through to the full load instead (see
// call site) since the tenant-scoped row filtering below is not replicated
// here.
//
// "rooms" and "tenants" are a different case from the six above. Those exist
// to refresh a client after a save(); these are read-only bulk loads for a
// client that is opening a page cold, so the stale-data risk described above
// does not arise — nothing was just written that they might miss. They are
// safe to request at any time and are NOT reachable from
// scopedModulesForAction() in app/SystemContext.tsx, so the existing app
// never asks for them after a write. If you ever map an action to one of
// these, re-read the paragraph above first: a save that moves a tenant
// changes bedSpaces occupancy, and "tenants" alone would not refresh it.
const SCOPED_MODULE_KEYS = [
  "parking",
  "maintenance-tickets",
  "announcements",
  "users",
  "schools-courses",
  "attachments",
  "rooms",
  "tenants",
] as const;
type ScopedModuleKey = (typeof SCOPED_MODULE_KEYS)[number];

async function loadScopedModules(
  db: ReturnType<typeof getDb>,
  scopes: Set<ScopedModuleKey>,
) {
  const result: Record<string, unknown> = {};
  const tasks: Promise<void>[] = [];

  // Both of these need the hostel bed counts, and those counts are derived
  // from the same rows the room grid draws. Deriving them once here (rather
  // than adding a second COUNT query) keeps one definition of "how many beds
  // are occupied" instead of two that can drift apart.
  const needsBeds = scopes.has("rooms") || scopes.has("tenants");
  const bedsPromise = needsBeds
    ? (async () => {
        const today = new Date().toISOString().slice(0, 10);
        const [rawBeds, properties, units] = await Promise.all([
          selectRawBeds(db),
          selectProperties(db),
          db
            .select({ hostelId: hostelUnits.hostelId })
            .from(hostelUnits),
        ]);
        const beds = deriveBeds(rawBeds, today);
        return { beds, hostels: deriveHostels(properties, units, beds) };
      })()
    : null;

  if (scopes.has("rooms")) {
    tasks.push(
      (async () => {
        const [derived, reservationRows] = await Promise.all([
          bedsPromise!,
          // Only the fields needed to mark a bed as held. The full
          // reservation payload (payments, charges, preferences) belongs to
          // the reservations screen, not to the room grid.
          db
            .select({
              id: reservations.id,
              status: reservations.status,
              studentName: reservations.studentName,
              provisionalBedSpaceId: reservations.provisionalBedSpaceId,
              assignedBedSpaceId: reservations.assignedBedSpaceId,
              targetMoveInDate: reservations.targetMoveInDate,
            })
            .from(reservations)
            .where(eq(reservations.status, "reserved")),
        ]);
        result.bedSpaces = derived.beds;
        result.hostels = derived.hostels;
        result.reservations = reservationRows;
      })(),
    );
  }

  if (scopes.has("tenants")) {
    tasks.push(
      (async () => {
        const [students, invoices, derived] = await Promise.all([
          selectStudents(db),
          selectInvoices(db),
          bedsPromise!,
        ]);
        result.students = students;
        // Invoice headers only — the `items` and `payments` arrays the full
        // payload attaches are left off. The tenant list needs totalAmount
        // and amountPaid to work out a balance and nothing more; the
        // breakdown belongs to Billing.
        result.invoices = invoices;
        result.hostels = derived.hostels;
      })(),
    );
  }

  if (scopes.has("parking")) {
    tasks.push(
      (async () => {
        const [lots, rentals] = await Promise.all([
          db
            .select({
              id: parkingLots.id,
              hostelId: parkingLots.hostelId,
              hostelName: hostelProperties.name,
              unitId: parkingLots.unitId,
              unitCode: hostelUnits.unitCode,
              lotNumber: parkingLots.lotNumber,
              status: parkingLots.status,
              notes: parkingLots.notes,
            })
            .from(parkingLots)
            .innerJoin(
              hostelProperties,
              eq(parkingLots.hostelId, hostelProperties.id),
            )
            .leftJoin(hostelUnits, eq(parkingLots.unitId, hostelUnits.id))
            .orderBy(asc(hostelProperties.name), asc(parkingLots.lotNumber)),
          db
            .select({
              id: parkingRentals.id,
              parkingLotId: parkingRentals.parkingLotId,
              studentId: parkingRentals.studentId,
              tenantType: parkingRentals.tenantType,
              tenantName: parkingRentals.tenantName,
              contactNumber: parkingRentals.contactNumber,
              unitNumber: parkingRentals.unitNumber,
              carPlateNumber: parkingRentals.carPlateNumber,
              carModel: parkingRentals.carModel,
              monthlyRental: parkingRentals.monthlyRental,
              depositAmount: parkingRentals.depositAmount,
              startDate: parkingRentals.startDate,
              endDate: parkingRentals.endDate,
              paidUntil: parkingRentals.paidUntil,
              billingFrequency: parkingRentals.billingFrequency,
              packageMonths: parkingRentals.packageMonths,
              nextDueDate: parkingRentals.nextDueDate,
              paymentStatus: parkingRentals.paymentStatus,
              status: parkingRentals.status,
              notes: parkingRentals.notes,
              lotNumber: parkingLots.lotNumber,
              hostelName: hostelProperties.name,
            })
            .from(parkingRentals)
            .innerJoin(
              parkingLots,
              eq(parkingRentals.parkingLotId, parkingLots.id),
            )
            .innerJoin(
              hostelProperties,
              eq(parkingLots.hostelId, hostelProperties.id),
            )
            .orderBy(desc(parkingRentals.id)),
        ]);
        result.parkingLots = lots;
        result.parkingRentals = rentals;
      })(),
    );
  }

  if (scopes.has("maintenance-tickets")) {
    tasks.push(
      (async () => {
        const [tickets, messages, categories, costs] = await Promise.all([
          db
            .select({
              id: maintenanceTickets.id,
              ticketNo: maintenanceTickets.ticketNo,
              studentId: maintenanceTickets.studentId,
              studentName: studentProfiles.fullName,
              hostelId: maintenanceTickets.hostelId,
              hostelName: hostelProperties.name,
              unitId: maintenanceTickets.unitId,
              unitCode: hostelUnits.unitCode,
              roomId: maintenanceTickets.roomId,
              roomLabel: hostelRooms.roomLabel,
              category: maintenanceTickets.category,
              subcategory: maintenanceTickets.subcategory,
              subject: maintenanceTickets.subject,
              description: maintenanceTickets.description,
              priority: maintenanceTickets.priority,
              status: maintenanceTickets.status,
              submittedByType: maintenanceTickets.submittedByType,
              assignedTo: maintenanceTickets.assignedTo,
              attendedAt: maintenanceTickets.attendedAt,
              completedAt: maintenanceTickets.completedAt,
              costResponsibility: maintenanceTickets.costResponsibility,
              estimatedCost: maintenanceTickets.estimatedCost,
              actualCost: maintenanceTickets.actualCost,
              studentCharge: maintenanceTickets.studentCharge,
              createdAt: maintenanceTickets.createdAt,
              updatedAt: maintenanceTickets.updatedAt,
            })
            .from(maintenanceTickets)
            .leftJoin(
              studentProfiles,
              eq(maintenanceTickets.studentId, studentProfiles.id),
            )
            .leftJoin(
              hostelProperties,
              eq(maintenanceTickets.hostelId, hostelProperties.id),
            )
            .leftJoin(
              hostelUnits,
              eq(maintenanceTickets.unitId, hostelUnits.id),
            )
            .leftJoin(
              hostelRooms,
              eq(maintenanceTickets.roomId, hostelRooms.id),
            )
            .orderBy(desc(maintenanceTickets.id)),
          db.select().from(ticketMessages).orderBy(asc(ticketMessages.createdAt)),
          db
            .select()
            .from(ticketCategories)
            .orderBy(
              asc(ticketCategories.sortOrder),
              asc(ticketCategories.category),
            ),
          db
            .select({
              id: generalCosts.id,
              costDate: generalCosts.costDate,
              hostelId: generalCosts.hostelId,
              hostelName: hostelProperties.name,
              unitId: generalCosts.unitId,
              unitCode: hostelUnits.unitCode,
              ticketId: generalCosts.ticketId,
              costType: generalCosts.costType,
              description: generalCosts.description,
              responsibility: generalCosts.responsibility,
              amount: generalCosts.amount,
              studentCharge: generalCosts.studentCharge,
              notes: generalCosts.notes,
              createdBy: generalCosts.createdBy,
              createdAt: generalCosts.createdAt,
            })
            .from(generalCosts)
            .leftJoin(
              hostelProperties,
              eq(generalCosts.hostelId, hostelProperties.id),
            )
            .leftJoin(hostelUnits, eq(generalCosts.unitId, hostelUnits.id))
            .orderBy(desc(generalCosts.costDate), desc(generalCosts.id)),
        ]);
        result.tickets = tickets;
        result.ticketMessages = messages;
        result.ticketCategories = categories;
        result.generalCosts = costs;
      })(),
    );
  }

  if (scopes.has("announcements")) {
    tasks.push(
      (async () => {
        result.announcements = await db
          .select({
            id: announcements.id,
            title: announcements.title,
            body: announcements.body,
            audienceType: announcements.audienceType,
            hostelId: announcements.hostelId,
            hostelName: hostelProperties.name,
            blockCode: announcements.blockCode,
            unitId: announcements.unitId,
            unitCode: hostelUnits.unitCode,
            priority: announcements.priority,
            status: announcements.status,
            pinned: announcements.pinned,
            publishAt: announcements.publishAt,
            expiresAt: announcements.expiresAt,
            createdBy: announcements.createdBy,
            createdAt: announcements.createdAt,
          })
          .from(announcements)
          .leftJoin(
            hostelProperties,
            eq(announcements.hostelId, hostelProperties.id),
          )
          .leftJoin(hostelUnits, eq(announcements.unitId, hostelUnits.id))
          .orderBy(desc(announcements.pinned), desc(announcements.id));
      })(),
    );
  }

  if (scopes.has("users")) {
    tasks.push(
      (async () => {
        const [roles, users, permissions, reminders] = await Promise.all([
          db.select().from(appRoles).orderBy(asc(appRoles.id)),
          db
            .select({
              id: appUsers.id,
              email: appUsers.email,
              displayName: appUsers.displayName,
              roleId: appUsers.roleId,
              roleKey: appRoles.roleKey,
              roleName: appRoles.name,
              studentId: appUsers.studentId,
              studentName: studentProfiles.fullName,
              status: appUsers.status,
              lastLoginAt: appUsers.lastLoginAt,
              createdAt: appUsers.createdAt,
            })
            .from(appUsers)
            .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
            .leftJoin(
              studentProfiles,
              eq(appUsers.studentId, studentProfiles.id),
            )
            .orderBy(asc(appUsers.displayName)),
          db
            .select()
            .from(rolePermissions)
            .orderBy(asc(rolePermissions.roleId), asc(rolePermissions.moduleKey)),
          db
            .select()
            .from(reminderTemplates)
            .orderBy(asc(reminderTemplates.dayOfMonth)),
        ]);
        result.roles = roles;
        result.users = users;
        result.rolePermissions = permissions;
        result.reminderTemplates = reminders;
      })(),
    );
  }

  if (scopes.has("schools-courses")) {
    tasks.push(
      (async () => {
        const [schoolRows, courseRows] = await Promise.all([
          db.select().from(schools).orderBy(asc(schools.name)),
          db.select().from(courses).orderBy(asc(courses.name)),
        ]);
        result.schools = schoolRows;
        result.courses = courseRows;
      })(),
    );
  }

  if (scopes.has("attachments")) {
    tasks.push(
      (async () => {
        result.attachments = await db
          .select()
          .from(storedAttachments)
          .orderBy(desc(storedAttachments.id));
      })(),
    );
  }

  await Promise.all(tasks);
  return result;
}

function moduleForAction(action: string) {
  if (action === "reservation-finance-review") return "finance";
  if (
    /^(reservation|bulk-room-price|promotion-end|system-setting-update)/.test(
      action,
    )
  )
    return "hostels-sales";
  if (/^bed-/.test(action)) return "units-general";
  if (/^(unit-|access-card|room-|service-)/.test(action))
    return action === "unit-owner" ? "units-owner" : "units-general";
  // Check-in changes a tenancy's state and its room's status, so it is
  // gated like the other tenant actions. The remaining assignment-* actions
  // are follow-up flags raised from the sales screens and stay ungated.
  if (/^(student-|school-|course-|assignment-check-in)/.test(action))
    return "students";
  if (/^parking-/.test(action)) return "parking";
  if (/^(ticket-|meter-|general-cost)/.test(action)) return "maintenance";
  if (/^billing-/.test(action)) return "finance";
  if (/^announcement/.test(action)) return "announcements";
  if (/^(user-|role-|reminder-)/.test(action)) return "users";
  return "";
}

const permissionModules = [
  "hostels",
  "hostels-sales",
  "hostels-rates",
  "hostels-occupancy",
  "units-general",
  "units-owner",
  "students",
  "parking",
  "maintenance",
  "finance",
  "announcements",
  "reports",
  "users",
] as const;

const roleBlueprints = [
  {
    key: "director",
    name: "Director",
    description: "Full system access and approvals.",
  },
  {
    key: "manager",
    name: "Manager",
    description: "Full operational access and approvals.",
  },
  {
    key: "finance",
    name: "Finance",
    description: "Billing, owner agreements and financial reports.",
  },
  {
    key: "sales",
    name: "Sales",
    description: "Availability, reservations and student information.",
  },
  {
    key: "maintenance",
    name: "Maintenance",
    description: "Units, occupants, tickets, meters and operational costs.",
  },
  {
    key: "technician",
    name: "Technician",
    description: "Maintenance tickets assigned to the technician.",
  },
  {
    key: "tenant",
    name: "Tenant",
    description: "Own room, billing, announcements and maintenance requests.",
  },
] as const;

function permissionFor(role: string, moduleKey: string) {
  if (["director", "manager"].includes(role))
    return {
      view: true,
      create: true,
      edit: true,
      delete: true,
      approve: true,
    };
  if (role === "tenant") {
    const view = ["finance", "maintenance", "announcements"].includes(
      moduleKey,
    );
    return {
      view,
      create: ["finance", "maintenance"].includes(moduleKey),
      edit: moduleKey === "maintenance",
      delete: false,
      approve: false,
    };
  }
  if (role === "technician") {
    const view = moduleKey === "maintenance";
    return { view, create: view, edit: view, delete: false, approve: false };
  }
  const view =
    role === "finance"
      ? [
          "units-general",
          "units-owner",
          "students",
          "finance",
          "reports",
        ].includes(moduleKey)
      : role === "sales"
        ? [
            "hostels",
            "hostels-sales",
            "hostels-rates",
            "hostels-occupancy",
            "units-general",
            "students",
            "parking",
            "announcements",
            "reports",
          ].includes(moduleKey)
        : role === "maintenance"
          ? [
              "hostels",
              "hostels-rates",
              "hostels-occupancy",
              "units-general",
              "units-owner",
              "students",
              "parking",
              "maintenance",
              "announcements",
              "reports",
            ].includes(moduleKey)
          : false;
  const write = view && !["reports", "units-owner"].includes(moduleKey);
  return {
    view,
    create: write,
    edit: write,
    delete: write,
    approve: role === "finance" && moduleKey === "finance",
  };
}

async function seedAdministration(db: ReturnType<typeof getDb>) {
  await runBatches(db, roleBlueprints, (role, tx) =>
    tx.execute(
      sql`INSERT INTO app_roles (role_key, name, description, is_system) VALUES (${role.key}, ${role.name}, ${role.description}, true) ON CONFLICT DO NOTHING`,
    ),
  );
  const roles = await db.select().from(appRoles);
  const permissionRows = roles.flatMap((role) =>
    permissionModules.map((moduleKey) => ({ role, moduleKey })),
  );
  await runBatches(db, permissionRows, ({ role, moduleKey }, tx) => {
    const p = permissionFor(role.roleKey, moduleKey);
    return tx.execute(sql`
      INSERT INTO role_permissions
        (role_id, module_key, can_view, can_create, can_edit, can_delete, can_approve)
      VALUES (${role.id}, ${moduleKey}, ${p.view}, ${p.create}, ${p.edit}, ${p.delete}, ${p.approve})
      ON CONFLICT DO NOTHING
    `);
  });
  const categories: [string, string][] = [
    ["Electrical", "Fan"],
    ["Electrical", "Light"],
    ["Electrical", "Power socket"],
    ["Plumbing", "Tap / leaking"],
    ["Plumbing", "Toilet"],
    ["Plumbing", "Water heater"],
    ["Air-conditioner", "Not cooling"],
    ["Furniture", "Bed / wardrobe"],
    ["Access card / key", "Door unlocking"],
    ["Internet", "Wi-Fi connection"],
    ["Cleaning", "Room cleaning"],
    ["Other", "General issue"],
  ];
  await runBatches(
    db,
    categories.map(([category, subcategory], index) => ({
      category,
      subcategory,
      index,
    })),
    ({ category, subcategory, index }, tx) =>
      tx.execute(
        sql`INSERT INTO ticket_categories (category, subcategory, sort_order) VALUES (${category}, ${subcategory}, ${index}) ON CONFLICT DO NOTHING`,
      ),
  );
  const reminders: [string, number, string, string][] = [
    [
      "due-date",
      5,
      "Payment due today",
      "Your monthly hostel payment is due today. Please upload your payment slip in the portal.",
    ],
    [
      "first-overdue",
      8,
      "Payment overdue reminder",
      "Your hostel account is overdue. Please make payment and upload your payment slip.",
    ],
    [
      "second-overdue",
      15,
      "Important payment reminder",
      "Your hostel account remains overdue. Late-payment charges may apply.",
    ],
    [
      "final-overdue",
      21,
      "Final payment reminder",
      "This is the final scheduled reminder for the month. Please contact Accounts if assistance is required.",
    ],
  ];
  await runBatches(
    db,
    reminders.map(([key, day, subject, message]) => ({
      key,
      day,
      subject,
      message,
    })),
    ({ key, day, subject, message }, tx) =>
      tx.execute(
        sql`INSERT INTO reminder_templates (reminder_key, day_of_month, subject, message) VALUES (${key}, ${day}, ${subject}, ${message}) ON CONFLICT DO NOTHING`,
      ),
  );
}

async function applyLatePaymentCharges(db: ReturnType<typeof getDb>) {
  const today = todayInKL();
  const rows = await db.execute<{
    id: number;
    due_date: string;
    amount_paid: number;
    rental: number;
  }>(sql`
    SELECT i.id, i.due_date, i.amount_paid,
      COALESCE((SELECT SUM(amount) FROM billing_items WHERE invoice_id=i.id AND item_type='room-rental'),0) rental
    FROM billing_invoices i
    JOIN billing_cycles c ON c.id=i.cycle_id
    WHERE c.status='posted' AND i.due_date < ${today}
  `);

  // Same eligibility/amount rules as before. The write is now a single
  // batched upsert keyed on billing_item_late_charge_unique (one
  // late-payment-charge row per invoice) instead of a select-then-branch —
  // two concurrent runs of this function can no longer each decide "no
  // existing row" and insert a duplicate.
  const toApply: {
    invoiceId: number;
    days: number;
    amount: number;
    description: string;
  }[] = [];

  for (const invoice of rows) {
    if (
      Number(invoice.amount_paid || 0) >= Number(invoice.rental || 0) ||
      Number(invoice.rental || 0) <= 0
    )
      continue;
    const days = Math.max(
      0,
      Math.floor(
        (Date.parse(`${today}T00:00:00Z`) -
          Date.parse(`${invoice.due_date}T00:00:00Z`)) /
          86400000,
      ),
    );
    const amount = days * 3;
    if (!amount) continue;
    const description = `Late payment charge (${days} day${days === 1 ? "" : "s"})`;
    toApply.push({ invoiceId: Number(invoice.id), days, amount, description });
  }

  if (!toApply.length) return;

  const idList = (ids: number[]) =>
    sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );

  for (const batch of chunks(toApply, 200)) {
    const valueRows = batch.map(
      (item) =>
        sql`(${item.invoiceId}, 'late-payment-charge', ${item.description}, ${item.days}, 3, ${item.amount})`,
    );
    await db.execute(sql`
      INSERT INTO billing_items (invoice_id, item_type, description, quantity, rate, amount)
      VALUES ${sql.join(valueRows, sql`, `)}
      ON CONFLICT (invoice_id) WHERE item_type = 'late-payment-charge'
      DO UPDATE SET
        quantity = excluded.quantity,
        rate = excluded.rate,
        amount = excluded.amount,
        description = excluded.description
    `);
  }

  const affectedInvoiceIds = toApply.map((item) => item.invoiceId);
  for (const batch of chunks(affectedInvoiceIds, 500))
    await db.execute(sql`
      UPDATE billing_invoices
      SET total_amount = (SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id = billing_invoices.id)
      WHERE id IN (${idList(batch)})
    `);
}

async function resolveCurrentUser(
  request: Request,
  db: ReturnType<typeof getDb>,
) {
  // A signed-in session always wins over the platform SSO headers.
  const sessionUser = await getSessionUser(request, db);
  if (sessionUser)
    return {
      ...sessionUser,
      permissions: await permissionsForRole(sessionUser.roleId, db),
    };
  const headerEmail = request.headers.get("oai-authenticated-user-email");
  if (!headerEmail) return null;
  const email = asText(headerEmail).toLowerCase();
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let displayName =
    email === "local-admin@hostelpro.internal" ? "Irena" : email;
  if (encodedName)
    try {
      displayName = decodeURIComponent(encodedName);
    } catch {
      /* fall back to email */
    }
  let user = (
    await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        displayName: appUsers.displayName,
        status: appUsers.status,
        studentId: appUsers.studentId,
        roleId: appRoles.id,
        roleKey: appRoles.roleKey,
        roleName: appRoles.name,
      })
      .from(appUsers)
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(eq(appUsers.email, email))
  )[0];
  if (!user) {
    const count = (
      await db.select({ value: sql<number>`count(*)` }).from(appUsers)
    )[0];
    const roleKey = Number(count?.value || 0) === 0 ? "director" : "tenant";
    const role = (
      await db.select().from(appRoles).where(eq(appRoles.roleKey, roleKey))
    )[0];
    if (role) {
      await db.insert(appUsers).values({ email, displayName, roleId: role.id });
      user = {
        id: 0,
        email,
        displayName,
        status: "active",
        studentId: null,
        roleId: role.id,
        roleKey: role.roleKey,
        roleName: role.name,
      };
    }
  }
  if (!user) return null;
  const permissions = await db
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, user.roleId));
  return { ...user, permissions };
}

async function seedInventory(db: ReturnType<typeof getDb>) {
  const propertyRows = await db.select().from(hostelProperties);
  const existingPropertyCodes = new Set(propertyRows.map((row) => row.code));
  const missingProperties = inventory
    .filter((hostel) => !existingPropertyCodes.has(hostel.code))
    .map((hostel) => ({
      code: hostel.code,
      name: hostel.name,
      address: hostel.address,
    }));
  if (missingProperties.length)
    await db
      .insert(hostelProperties)
      .values(missingProperties)
      .onConflictDoNothing();

  const allProperties = await db.select().from(hostelProperties);
  const hostelIds = new Map(allProperties.map((row) => [row.code, row.id]));
  const currentUnits = await db.select().from(hostelUnits);
  const existingUnitKeys = new Set(
    currentUnits.map((row) => `${row.hostelId}:${row.unitCode}`),
  );
  const missingUnits = inventory
    .flatMap((hostel) =>
      hostel.units.map((unit) => ({
        hostelId: hostelIds.get(hostel.code)!,
        unitCode: unit.unitCode,
        address: unit.address,
        gender: unit.gender,
      })),
    )
    .filter(
      (unit) => !existingUnitKeys.has(`${unit.hostelId}:${unit.unitCode}`),
    );
  for (const group of chunks(missingUnits, 10))
    await db.insert(hostelUnits).values(group).onConflictDoNothing();

  const allUnits = await db.select().from(hostelUnits);
  const unitIds = new Map(
    allUnits.map((row) => [`${row.hostelId}:${row.unitCode}`, row.id]),
  );
  const currentRooms = await db.select().from(hostelRooms);
  const existingRoomKeys = new Set(
    currentRooms.map((row) => `${row.unitId}:${row.roomLabel}`),
  );
  const missingRooms = inventory
    .flatMap((hostel) =>
      hostel.units.flatMap((unit) => {
        const unitId = unitIds.get(
          `${hostelIds.get(hostel.code)}:${unit.unitCode}`,
        )!;
        return unit.rooms.map((room) => ({
          unitId,
          roomLabel: room.roomLabel,
        }));
      }),
    )
    .filter(
      (room) => !existingRoomKeys.has(`${room.unitId}:${room.roomLabel}`),
    );
    for (const group of chunks(missingRooms, 10))
          await db.insert(hostelRooms).values(group).onConflictDoNothing();

  const allRooms = await db.select().from(hostelRooms);
  const roomIds = new Map(
    allRooms.map((row) => [`${row.unitId}:${row.roomLabel}`, row.id]),
  );
  const currentBeds = await db
    .select({ legacyCode: bedSpaces.legacyCode })
    .from(bedSpaces);
  const existingBedCodes = new Set(currentBeds.map((row) => row.legacyCode));
  const missingBeds = inventory
    .flatMap((hostel) =>
      hostel.units.flatMap((unit) => {
        const unitId = unitIds.get(
          `${hostelIds.get(hostel.code)}:${unit.unitCode}`,
        )!;
        return unit.rooms.flatMap((room) =>
          room.bedSpaces.map((bed) => ({
            roomId: roomIds.get(`${unitId}:${room.roomLabel}`)!,
            bedLabel: bed.bedLabel,
            legacyCode: bed.legacyCode,
            status: bed.status,
            specialUse: bed.specialUse,
            monthlyRental: bed.monthlyRental,
            legacyAccessCardDeposit: bed.legacyAccessCardDeposit,
          })),
        );
      }),
    )
    .filter((bed) => !existingBedCodes.has(bed.legacyCode));
  for (const group of chunks(missingBeds, 10))
    await db.insert(bedSpaces).values(group).onConflictDoNothing();
}

async function seedKnownRoomFeatures(db: ReturnType<typeof getDb>) {
  const known: [string, string, string][] = [
    ["1201", "A", "non-attached"],
    ["1201", "B", "attached"],
    ["1201", "C", "non-attached"],
    ["1201", "D", "non-attached"],
    ["1304", "A", "non-attached"],
  ];
  await runBatches(db, known, ([unitCode, roomLabel, bathroomType], tx) =>
    tx.execute(sql`
    UPDATE hostel_rooms SET bathroom_type = ${bathroomType}
    WHERE bathroom_type = 'unknown' AND id IN (
      SELECT r.id FROM hostel_rooms r JOIN hostel_units u ON r.unit_id = u.id
      JOIN hostel_properties h ON u.hostel_id = h.id
      WHERE h.code = 'ATR' AND u.unit_code = ${unitCode} AND r.room_label = ${roomLabel}
    )
  `),
  );
  await db.execute(sql`
    UPDATE hostel_rooms SET room_type = CASE
      WHEN (SELECT COUNT(*) FROM bed_spaces b WHERE b.room_id = hostel_rooms.id) > 1 THEN 'sharing'
      ELSE 'single' END WHERE room_type = 'auto'
  `);
  await db.execute(sql`
    UPDATE hostel_properties
       SET electricity_rate = CASE WHEN code = 'NDY' THEN 0.751 ELSE 0.685 END
       WHERE electricity_rate IN (0, 0.57)
  `);
}

async function seedStudentAssignments(db: ReturnType<typeof getDb>) {
  const [profiles, assignments, beds] = await Promise.all([
    db.select({ sourceKey: studentProfiles.sourceKey }).from(studentProfiles),
    db
      .select({ sourceKey: accommodationAssignments.sourceKey })
      .from(accommodationAssignments),
    db
      .select({ id: bedSpaces.id, legacyCode: bedSpaces.legacyCode })
      .from(bedSpaces),
  ]);
  const profileKeys = new Set(profiles.map((row) => row.sourceKey));
  const missingProfiles = importedAssignments.filter(
    (record) => !profileKeys.has(record.sourceKey),
  );
  await runBatches(db, missingProfiles, (record, tx) =>
    tx.execute(sql`
    INSERT INTO student_profiles (source_key, student_code, full_name, nationality, hometown, course)
    VALUES (${record.sourceKey}, ${record.student.sourceCode}, ${record.student.fullName}, ${record.student.nationality}, ${record.student.hometown}, ${record.student.course})
    ON CONFLICT DO NOTHING
  `),
  );

  const allProfiles = await db
    .select({ id: studentProfiles.id, sourceKey: studentProfiles.sourceKey })
    .from(studentProfiles);
  const profileIds = new Map(allProfiles.map((row) => [row.sourceKey, row.id]));
  const bedIds = new Map(beds.map((row) => [row.legacyCode, row.id]));
  const assignmentKeys = new Set(assignments.map((row) => row.sourceKey));
  const missingAssignments = importedAssignments.filter(
    (record) =>
      !assignmentKeys.has(record.sourceKey) &&
      profileIds.has(record.sourceKey) &&
      bedIds.has(record.legacyCode),
  );
  await runBatches(db, missingAssignments, (record, tx) =>
    tx.execute(sql`
    INSERT INTO accommodation_assignments
      (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit,
       salesperson, check_in_date, agreement_start_date, agreement_end_date, agreement_duration,
       check_out_date, check_in_meter, remarks, status)
    VALUES (${record.sourceKey}, ${profileIds.get(record.sourceKey)}, ${bedIds.get(record.legacyCode)}, ${record.assignment.monthlyRental}, ${record.assignment.securityDeposit}, ${record.assignment.accessCardDeposit}, ${record.assignment.salesperson}, ${record.assignment.checkInDate}, ${record.assignment.agreementStartDate}, ${record.assignment.agreementEndDate}, ${record.assignment.agreementDuration}, ${record.assignment.checkOutDate}, ${record.assignment.checkInMeter}, ${record.assignment.remarks}, 'active')
    ON CONFLICT DO NOTHING
  `),
  );
}

async function replaceReservationCharges(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  raw: unknown,
) {
  let values: Record<string, unknown> = {};
  if (typeof raw === "string" && raw) {
    try {
      values = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      values = {};
    }
  } else if (raw && typeof raw === "object")
    values = raw as Record<string, unknown>;
  // Only touches the charge types this breakdown form actually edits —
  // charges added by other flows (e.g. reservation-room-change's
  // room-transfer-fee) aren't in chargeTypes and must survive an unrelated
  // edit to this reservation instead of silently vanishing.
  await db
    .delete(reservationCharges)
    .where(
      and(
        eq(reservationCharges.reservationId, reservationId),
        inArray(reservationCharges.chargeType, [...chargeTypes]),
      ),
    );
  const rows = chargeTypes
    .map((type) => ({ type, amount: asNumber(values[type], 0) }))
    .filter((row) => row.amount > 0);
  if (rows.length)
    await runBatches(db, rows, (row, tx) =>
      tx.execute(
        sql`INSERT INTO reservation_charges (reservation_id, charge_type, amount) VALUES (${reservationId}, ${row.type}, ${row.amount})`,
      ),
    );
  const totalRow = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_charges WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  return Number(totalRow?.total || 0);
}


// Records a payment for a specific set of still-unpaid reservation_charges
// rows — the amount is derived from those charges server-side (never
// trusted from the client) and each one gets locked (paid_at/payment_id
// set) so its checkbox in the Manage screen can't be unchecked afterwards.
// Only a room change (which deletes and reinserts the room-tied charges) or
// deleting this payment (payment-delete) can undo the lock.
async function addChargeLinkedReservationPayment(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  chargeIds: number[],
  body: Record<string, unknown>,
) {
  if (!chargeIds.length)
    throw new Error("Select at least one charge to record this payment for");
  const charges = await db
    .select({ id: reservationCharges.id, amount: reservationCharges.amount })
    .from(reservationCharges)
    .where(
      and(
        eq(reservationCharges.reservationId, reservationId),
        inArray(reservationCharges.id, chargeIds),
        isNull(reservationCharges.paidAt),
      ),
    );
  if (charges.length !== chargeIds.length)
    throw new Error(
      "One or more selected charges are already paid or no longer exist",
    );
  const amount = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const inserted = await db
    .insert(reservationPayments)
    .values({
      reservationId,
      amount,
      reference: asText(body.paymentReference),
      paymentMethod: asText(body.paymentMethod, "bank-transfer"),
      paidAt: nowIso(),
      notes: asText(body.paymentNotes),
    })
    .returning({ id: reservationPayments.id });
  const paymentId = inserted[0]?.id;
  await db
    .update(reservationCharges)
    .set({ paidAt: nowIso(), paymentId })
    .where(inArray(reservationCharges.id, chargeIds));
  return { paymentId, amount };
}

// Covers still-unpaid charges out of money already received that isn't
// tied to a charge yet — the leftover a room change creates when it drops
// the old room's charges and inserts the new room's at a different price.
// Charges paid through the normal checkbox flow keep their explicit
// paymentId link and are never touched here; auto-covered ones are marked
// with paymentId NULL so they can be recomputed if a payment is deleted.
// Folds same-type leftovers back into one line per paid/unpaid bucket.
// Without it, repeated room changes and pay/delete cycles keep splitting
// the same charge and leave a trail of fragments behind.
async function consolidateAutoCharges(
  db: ReturnType<typeof getDb>,
  reservationId: number,
) {
  const mergeable = await db
    .select()
    .from(reservationCharges)
    .where(
      and(
        eq(reservationCharges.reservationId, reservationId),
        // Charges settled through the checkbox flow carry a paymentId and
        // are left alone — payment-delete unlocks them by that link, so
        // merging them would break it. Only auto-covered and still-unpaid
        // rows, which no single payment owns, are safe to fold together.
        isNull(reservationCharges.paymentId),
      ),
    )
    .orderBy(asc(reservationCharges.id));
  const groups = new Map<string, typeof mergeable>();
  for (const row of mergeable) {
    const key = `${row.chargeType}:${row.paidAt ? "paid" : "unpaid"}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const merged = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    await db
      .update(reservationCharges)
      .set({
        amount: merged,
        // A merged paid line is just "this charge, settled" — the per-slice
        // top-up/balance notes no longer describe anything once combined.
        notes: rows[0].paidAt ? "" : rows[0].notes,
      })
      .where(eq(reservationCharges.id, rows[0].id));
    await db.delete(reservationCharges).where(
      inArray(
        reservationCharges.id,
        rows.slice(1).map((row) => row.id),
      ),
    );
  }
}

async function autoAllocatePaidCharges(
  db: ReturnType<typeof getDb>,
  reservationId: number,
) {
  await consolidateAutoCharges(db, reservationId);
  const charges = await db
    .select()
    .from(reservationCharges)
    .where(eq(reservationCharges.reservationId, reservationId))
    .orderBy(asc(reservationCharges.id));
  const moneyRow = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  const alreadyCovered = charges
    .filter((charge) => charge.paidAt)
    .reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
  let credit = Number(moneyRow?.total || 0) - alreadyCovered;
  for (const charge of charges) {
    if (charge.paidAt) continue;
    const amount = Number(charge.amount || 0);
    if (amount <= 0 || credit <= 0) continue;
    if (credit >= amount) {
      credit -= amount;
      await db
        .update(reservationCharges)
        .set({ paidAt: nowIso(), paymentId: null })
        .where(eq(reservationCharges.id, charge.id));
      continue;
    }
    // Credit covers only part of this charge. Split it so the money still
    // lands on a real line instead of floating unattached: the covered part
    // becomes a paid row, the rest a separate outstanding row with its own
    // tick box. Keeps "sum of unticked charges" equal to what's still owed.
    const covered = credit;
    credit = 0;
    await db
      .update(reservationCharges)
      .set({ amount: covered, paidAt: nowIso(), paymentId: null })
      .where(eq(reservationCharges.id, charge.id));
    await db.insert(reservationCharges).values({
      reservationId,
      chargeType: charge.chargeType,
      amount: amount - covered,
      notes: CHARGE_BALANCE_NOTE,
    });
  }
  // Splitting above can leave the paid side of a charge in two pieces
  // (the part covered before, plus the slice just covered) — fold them.
  await consolidateAutoCharges(db, reservationId);
}

// The deposit currently on record for a tenancy, read the same way the
// billing run reads rent: the newest effective-dated change wins, and a
// change that left the figure blank falls through to the tenancy itself.
async function currentDepositFor(
  db: ReturnType<typeof getDb>,
  assignmentId: number,
  onDate: string,
) {
  const change = (
    await db.execute<{ security_deposit: number | null }>(sql`
      SELECT security_deposit FROM student_rate_changes
      WHERE assignment_id = ${assignmentId}
        AND effective_date <= ${onDate}
        AND security_deposit IS NOT NULL
      ORDER BY effective_date DESC, id DESC LIMIT 1
    `)
  )[0];
  if (change && change.security_deposit !== null)
    return Number(change.security_deposit);
  const assignment = (
    await db.execute<{ security_deposit: number | null }>(
      sql`SELECT security_deposit FROM accommodation_assignments WHERE id = ${assignmentId}`,
    )
  )[0];
  return assignment?.security_deposit === null ||
    assignment?.security_deposit === undefined
    ? null
    : Number(assignment.security_deposit);
}

// Books the difference between the deposit held and the deposit now required.
// Nothing is written when the figure has not moved, so a rate change that only
// touches rent never raises a phantom zero-value line on the next invoice.
async function recordDepositAdjustment(
  db: ReturnType<typeof getDb>,
  entry: {
    assignmentId: number;
    previousAmount: number;
    newAmount: number;
    effectiveDate: string;
    source: string;
    reason: string;
    createdBy: string;
  },
) {
  const amount =
    Math.round((entry.newAmount - entry.previousAmount) * 100) / 100;
  if (amount === 0) return;
  await db.insert(depositAdjustments).values({
    assignmentId: entry.assignmentId,
    previousAmount: entry.previousAmount,
    newAmount: entry.newAmount,
    amount,
    reason: entry.reason,
    source: entry.source,
    effectiveDate: entry.effectiveDate,
    createdBy: entry.createdBy,
  });
}

// The single source of truth for a reservation's amountPaid/paymentStatus
// once its charges carry per-item paid_at locks: always the sum of the
// currently-paid charges, never a running total tracked separately. Called
// after anything that can change which charges are paid — recording a
// payment, deleting/editing one, or a room change replacing charges.
async function recomputeReservationPaymentStatus(
  db: ReturnType<typeof getDb>,
  reservationId: number,
) {
  const reservation = (
    await db
      .select({ totalPayable: reservations.totalPayable })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
  )[0];
  // Money actually received — never the sum of currently-locked charges.
  // A room change replaces the room-tied charges and drops their locks, but
  // the student's money obviously didn't disappear with them; deriving from
  // the payment records is what keeps it on the reservation as credit or a
  // shortfall instead of silently resetting the reservation to "unpaid".
  const paidRow = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  const amountPaid = Number(paidRow?.total || 0);
  const totalPayable = Number(reservation?.totalPayable || 0);
  const paymentStatus =
    amountPaid <= 0
      ? "unpaid"
      : totalPayable > 0 && amountPaid >= totalPayable
        ? "full"
        : "partial";
  await db
    .update(reservations)
    .set({
      amountPaid,
      paymentStatus,
      inventoryCommitted: paymentStatus !== "unpaid",
      paymentUpdatedAt: nowIso(),
    })
    .where(eq(reservations.id, reservationId));
  return { amountPaid, paymentStatus };
}

// Brings a converted reservation's one-time "move-in costs" invoice back in
// line with the reservation itself: creates it if it's missing, mirrors any
// payment Finance hasn't seen yet, rebuilds the itemised lines from the
// current charges and restates the totals. Everything that can move the
// money (conversion, a payment, a deletion, a room change) calls this, so
// Finance and Hostel Information can't drift apart.
async function syncMoveInInvoice(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  actorName: string,
) {
  const assignment = (
    await db.execute<{ id: number; student_id: number }>(
      sql`SELECT id, student_id FROM accommodation_assignments WHERE source_reservation_id = ${reservationId} AND status = 'active' ORDER BY id DESC LIMIT 1`,
    )
  )[0];
  if (!assignment) return;
  const reservation = (
    await db.select().from(reservations).where(eq(reservations.id, reservationId))
  )[0];
  if (!reservation) return;

  const charges = await db
    .select()
    .from(reservationCharges)
    .where(eq(reservationCharges.reservationId, reservationId))
    .orderBy(asc(reservationCharges.id));
  const billable = charges.filter((charge) => Number(charge.amount) > 0);
  const totalAmount = billable.reduce(
    (sum, charge) => sum + Number(charge.amount),
    0,
  );

  // Look the invoice up by its reservation-derived number, not by the
  // assignment it happens to be attached to. A mid-tenancy room change
  // retires the old assignment and starts a new one, so an assignment_id
  // lookup would miss, fall through to the insert, collide with this unique
  // invoice_no and silently give up — leaving Finance frozen at whatever it
  // last saw. Keying on the number that cannot change makes that impossible,
  // and re-pointing assignment_id below also drags the invoice's room label
  // onto the room the student actually lives in now.
  const invoiceNo = `INV-MI-${reservationId}`;
  let invoice = (
    await db.execute<{ id: number }>(
      sql`SELECT id FROM billing_invoices WHERE invoice_no = ${invoiceNo} LIMIT 1`,
    )
  )[0];
  if (!invoice)
    invoice = (
      await db.execute<{ id: number }>(
        sql`SELECT id FROM billing_invoices WHERE assignment_id = ${assignment.id} AND cycle_id IS NULL ORDER BY id DESC LIMIT 1`,
      )
    )[0];
  if (!invoice) {
    if (!billable.length) return;
    invoice = (
      await db.execute<{ id: number }>(sql`
        INSERT INTO billing_invoices (invoice_no, cycle_id, student_id, assignment_id, due_date, status, total_amount, amount_paid, invoice_frequency)
        VALUES (${invoiceNo}, NULL, ${assignment.student_id}, ${assignment.id}, ${reservation.targetMoveInDate}, 'unpaid', ${totalAmount}, 0, 'one-time')
        ON CONFLICT DO NOTHING
        RETURNING id
      `)
    )[0];
    if (!invoice) return;
  } else {
    await db.execute(
      sql`UPDATE billing_invoices SET assignment_id = ${assignment.id}, student_id = ${assignment.student_id} WHERE id = ${invoice.id}`,
    );
  }

  // Any reservation payment Finance has never been told about — money taken
  // while the booking was still an enquiry, for instance — becomes a
  // verified record now so each payment is individually visible there.
  const unmirrored = await db
    .select()
    .from(reservationPayments)
    .where(
      and(
        eq(reservationPayments.reservationId, reservationId),
        isNull(reservationPayments.linkedInvoicePaymentId),
      ),
    )
    .orderBy(asc(reservationPayments.id));
  for (const payment of unmirrored) {
    const mirrored = (
      await db
        .insert(billingPaymentRecords)
        .values({
          invoiceId: invoice.id,
          amount: Number(payment.amount),
          reference: payment.reference,
          remark: payment.notes,
          status: "verified",
          verifiedAt: nowIso(),
          verifiedBy: actorName,
          verifiedAmount: Number(payment.amount),
          actualReference: payment.reference,
        })
        .returning({ id: billingPaymentRecords.id })
    )[0];
    if (!mirrored) continue;
    await db
      .update(billingPaymentRecords)
      .set({ receiptNo: `RCT-${invoice.id}-${mirrored.id}` })
      .where(eq(billingPaymentRecords.id, mirrored.id));
    await db
      .update(reservationPayments)
      .set({ linkedInvoicePaymentId: mirrored.id })
      .where(eq(reservationPayments.id, payment.id));
  }

  await db
    .delete(billingItemAdjustments)
    .where(
      inArray(
        billingItemAdjustments.billingItemId,
        db
          .select({ id: billingItems.id })
          .from(billingItems)
          .where(eq(billingItems.invoiceId, invoice.id)),
      ),
    );
  await db.delete(billingItems).where(eq(billingItems.invoiceId, invoice.id));
  if (billable.length)
    await db.insert(billingItems).values(
      billable.map((charge) => ({
        invoiceId: invoice!.id,
        // Plain charge type, so a deposit top-up still files under deposit;
        // only the description carries the note explaining the split.
        itemType: charge.chargeType,
        description: `${chargeLabels[charge.chargeType] ?? charge.chargeType}${
          charge.notes ? ` — ${charge.notes}` : ""
        }`,
        quantity: 1,
        rate: Number(charge.amount),
        amount: Number(charge.amount),
      })),
    );

  // Reservation money is the source of truth; verified records that mirror
  // it are already counted, so only invoice-only payments get added on.
  const extraRow = (
    await db.execute<{ total: number }>(sql`
      SELECT COALESCE(SUM(COALESCE(verified_amount, amount)),0) total
      FROM billing_payment_records
      WHERE invoice_id = ${invoice.id} AND status = 'verified'
        AND id NOT IN (
          SELECT linked_invoice_payment_id FROM reservation_payments
          WHERE reservation_id = ${reservationId} AND linked_invoice_payment_id IS NOT NULL
        )
    `)
  )[0];
  const moneyRow = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  const amountPaid =
    Number(moneyRow?.total || 0) + Number(extraRow?.total || 0);
  await db
    .update(billingInvoices)
    .set({
      totalAmount,
      amountPaid,
      status:
        amountPaid <= 0
          ? "unpaid"
          : amountPaid >= totalAmount
            ? "paid"
            : "partial",
    })
    .where(eq(billingInvoices.id, invoice.id));
}

export async function GET(request: Request) {
  try {
    // Deliberately a separate client from the one below: mixing the
    // sequential db.transaction() calls the seed helpers make with the big
    // concurrent Promise.all further down (on the SAME client) reintroduces
    // the Supavisor deadlock Task 15 fixed — confirmed by direct
    // reproduction. Keeping them on separate clients avoids it.
    const seedDb = getDb();
    // getDb() opens a new pool per call and the first query on it pays a
    // ~600ms TCP+TLS handshake to the pooler. When this request is going to
    // take the scoped path we know that up front from the URL, so open that
    // client now and let its handshake run alongside the auth lookup instead
    // of after it. Still one client per request — nothing is cached across
    // requests, which is what db/index.ts's comment rules out.
    const requestedModulesParam = new URL(request.url).searchParams.get(
      "modules",
    );
    const scopedDb = requestedModulesParam ? getDb() : null;
    const scopedWarmup = scopedDb
      ? scopedDb.execute(sql`SELECT 1`).catch(() => undefined)
      : null;
    if (!administrationSeeded) {
      await seedAdministration(seedDb);
      administrationSeeded = true;
    }
    const currentUser = await resolveCurrentUser(request, seedDb);
    if (!currentUser)
      return Response.json({ error: "Not signed in" }, { status: 401 });
    if (!inventorySeeded) {
      await seedInventory(seedDb);
      inventorySeeded = true;
    }
    if (!knownRoomFeaturesSeeded) {
      await seedKnownRoomFeatures(seedDb);
      knownRoomFeaturesSeeded = true;
    }
    if (!studentAssignmentsSeeded) {
      await seedStudentAssignments(seedDb);
      studentAssignmentsSeeded = true;
    }
    // Daily housekeeping — late-payment charges and the month's billing run.
    // Deliberately NOT awaited: both are idempotent and guarded, and blocking
    // on them made the first person to open the app each day wait ~28 seconds
    // at a spinner while they finished. They now run alongside the response
    // and land on the next refresh; a failure is logged, never surfaced as a
    // page error, and the guard is reset so the next request retries.
    const lateChargeDate = todayInKL();
    if (lateChargesAppliedOn !== lateChargeDate) {
      lateChargesAppliedOn = lateChargeDate;
      void applyLatePaymentCharges(seedDb).catch((failure) => {
        lateChargesAppliedOn = "";
        console.error("Late payment charges failed", failure);
      });
    }
    void runScheduledBilling(seedDb).catch((failure) => {
      console.error("Scheduled billing failed", failure);
    });
    // Scoped refresh: after a save() that only touched a few tables, the
    // client asks for just those via ?modules=a,b instead of the full
    // ~30-query load below. Tenants always fall through to the full load
    // since the row-level filtering further down isn't replicated for the
    // scoped path. See loadScopedModules()'s comment for what's covered.
    const requestedModules = requestedModulesParam;
    if (requestedModules && currentUser.roleKey !== "tenant") {
      const scopes = new Set(
        requestedModules
          .split(",")
          .map((key) => key.trim())
          .filter((key): key is ScopedModuleKey =>
            (SCOPED_MODULE_KEYS as readonly string[]).includes(key),
          ),
      );
      if (scopes.size > 0) {
        await scopedWarmup;
        const scopedResult = await loadScopedModules(scopedDb!, scopes);
        return Response.json(scopedResult);
      }
    }
    const db = getDb();
    const [
      rawBeds,
      units,
      cards,
      properties,
      services,
      owners,
      reservationRows,
      paymentRows,
      chargeRows,
      pendingReturnRows,
      studentRows,
      rateRows,
      depositAdjustmentRows,
      pastTenancyRows,
      parkingLotRows,
      parkingRentalRows,
      ticketRows,
      messageRows,
      readingRows,
      cycleRows,
      invoiceRows,
      invoiceItemRows,
      billingPaymentRows,
      announcementRows,
      attachmentRows,
      categoryRows,
      costRows,
      adjustmentRows,
      roleRows,
      userRows,
      permissionRows,
      reminderRows,
      schoolRows,
      courseRows,
      categoryRateRows,
      settingRows,
      salesPersonRows,
    ] = await Promise.all([
      selectRawBeds(db),
      db
        .select({
          id: hostelUnits.id,
          hostelId: hostelProperties.id,
          hostelCode: hostelProperties.code,
          hostelName: hostelProperties.name,
          hostelAddress: hostelProperties.address,
          unitCode: hostelUnits.unitCode,
          address: hostelUnits.address,
          gender: hostelUnits.gender,
          status: hostelUnits.status,
          notes: hostelUnits.notes,
          ownerName: hostelUnits.ownerName,
          leaseEndDate: hostelUnits.leaseEndDate,
          surrenderDate: hostelUnits.surrenderDate,
          surrenderNotes: hostelUnits.surrenderNotes,
        })
        .from(hostelUnits)
        .innerJoin(
          hostelProperties,
          eq(hostelUnits.hostelId, hostelProperties.id),
        )
        .orderBy(asc(hostelProperties.name), asc(hostelUnits.unitCode)),
      db
        .select({
          id: accessCards.id,
          unitId: accessCards.unitId,
          cardCode: accessCards.cardCode,
          depositAmount: accessCards.depositAmount,
          status: accessCards.status,
          notes: accessCards.notes,
          unitCode: hostelUnits.unitCode,
          hostelName: hostelProperties.name,
        })
        .from(accessCards)
        .innerJoin(hostelUnits, eq(accessCards.unitId, hostelUnits.id))
        .innerJoin(
          hostelProperties,
          eq(hostelUnits.hostelId, hostelProperties.id),
        )
        .orderBy(asc(hostelProperties.name), asc(hostelUnits.unitCode)),
      db.select().from(hostelProperties).orderBy(asc(hostelProperties.name)),
      db
        .select({
          id: unitServices.id,
          unitId: unitServices.unitId,
          serviceType: unitServices.serviceType,
          provider: unitServices.provider,
          accountHolderName: unitServices.accountHolderName,
          accountReference: unitServices.accountReference,
          lineType: unitServices.lineType,
          contractEndDate: unitServices.contractEndDate,
          servicePackage: unitServices.servicePackage,
          username: unitServices.username,
          hasPassword: unitServices.password,
          remarks: unitServices.remarks,
          status: unitServices.status,
          surrenderAction: unitServices.surrenderAction,
          notes: unitServices.notes,
        })
        .from(unitServices)
        .orderBy(asc(unitServices.serviceType)),
      db.select().from(unitOwnerDetails),
      db.select().from(reservations).orderBy(desc(reservations.id)),
      db
        .select()
        .from(reservationPayments)
        .orderBy(desc(reservationPayments.id)),
      db.select().from(reservationCharges).orderBy(asc(reservationCharges.id)),
      db
        .select({
          id: accommodationAssignments.id,
          sourceReservationId: accommodationAssignments.sourceReservationId,
          expectedReturnDate: accommodationAssignments.expectedReturnDate,
        })
        .from(accommodationAssignments)
        .where(
          and(
            eq(accommodationAssignments.status, "active"),
            isNotNull(accommodationAssignments.expectedReturnDate),
          ),
        ),
      selectStudents(db),
      db
        .select({
          id: studentRateChanges.id,
          assignmentId: studentRateChanges.assignmentId,
          effectiveDate: studentRateChanges.effectiveDate,
          monthlyRental: studentRateChanges.monthlyRental,
          securityDeposit: studentRateChanges.securityDeposit,
          reason: studentRateChanges.reason,
          studentName: studentProfiles.fullName,
          studentCode: studentProfiles.studentCode,
          // Room, not bed: staff let and bill by room, and the pickers all
          // speak room codes now. The bed is an internal slot.
          roomCode: sql<string>`${hostelUnits.unitCode} || '-' || ${hostelRooms.roomLabel}`,
          hostelName: hostelProperties.name,
        })
        .from(studentRateChanges)
        .leftJoin(
          accommodationAssignments,
          eq(studentRateChanges.assignmentId, accommodationAssignments.id),
        )
        .leftJoin(
          studentProfiles,
          eq(accommodationAssignments.studentId, studentProfiles.id),
        )
        .leftJoin(
          bedSpaces,
          eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
        )
        .leftJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
        .leftJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
        .leftJoin(
          hostelProperties,
          eq(hostelUnits.hostelId, hostelProperties.id),
        )
        .orderBy(desc(studentRateChanges.effectiveDate)),
      // Deposit differences booked against a sitting tenancy, with whichever
      // invoice ended up carrying them. Finance's deposit ledger needs these
      // alongside the move-in charges — the money held is the two together.
      db.execute<{
        id: number;
        assignment_id: number;
        student_id: number | null;
        student_name: string | null;
        room_code: string | null;
        hostel_name: string | null;
        previous_amount: number;
        new_amount: number;
        amount: number;
        reason: string;
        source: string;
        effective_date: string;
        created_at: string;
        billed_cycle_id: number | null;
        invoice_no: string | null;
        invoice_status: string | null;
      }>(sql`
        SELECT d.id, d.assignment_id, a.student_id, s.full_name AS student_name,
               u.unit_code || '-' || r.room_label AS room_code,
               h.name AS hostel_name,
               d.previous_amount, d.new_amount, d.amount, d.reason, d.source,
               d.effective_date, d.created_at, d.billed_cycle_id,
               i.invoice_no, i.status AS invoice_status
        FROM deposit_adjustments d
        LEFT JOIN accommodation_assignments a ON a.id = d.assignment_id
        LEFT JOIN student_profiles s ON s.id = a.student_id
        LEFT JOIN bed_spaces b ON b.id = a.bed_space_id
        LEFT JOIN hostel_rooms r ON r.id = b.room_id
        LEFT JOIN hostel_units u ON u.id = r.unit_id
        LEFT JOIN hostel_properties h ON h.id = u.hostel_id
        LEFT JOIN billing_invoices i
          ON i.cycle_id = d.billed_cycle_id AND i.assignment_id = d.assignment_id
        ORDER BY d.id DESC
      `),
      // Every tenancy a student has held, not just the live one. A room change
      // retires one assignment and opens another, so without the retired rows
      // there is no way to explain why the rent on an invoice changed — only
      // the current room would ever be visible.
      db.execute<{
        id: number;
        student_id: number;
        room_code: string | null;
        hostel_name: string | null;
        monthly_rental: number | null;
        security_deposit: number | null;
        check_in_date: string | null;
        check_out_date: string | null;
        status: string;
        remarks: string;
      }>(sql`
        SELECT a.id, a.student_id,
               u.unit_code || '-' || r.room_label AS room_code,
               h.name AS hostel_name,
               a.monthly_rental, a.security_deposit,
               a.check_in_date, a.check_out_date, a.status, a.remarks
        FROM accommodation_assignments a
        LEFT JOIN bed_spaces b ON b.id = a.bed_space_id
        LEFT JOIN hostel_rooms r ON r.id = b.room_id
        LEFT JOIN hostel_units u ON u.id = r.unit_id
        LEFT JOIN hostel_properties h ON h.id = u.hostel_id
        WHERE a.status <> 'active'
        ORDER BY a.id
      `),
      db
        .select({
          id: parkingLots.id,
          hostelId: parkingLots.hostelId,
          hostelName: hostelProperties.name,
          unitId: parkingLots.unitId,
          unitCode: hostelUnits.unitCode,
          lotNumber: parkingLots.lotNumber,
          status: parkingLots.status,
          notes: parkingLots.notes,
        })
        .from(parkingLots)
        .innerJoin(
          hostelProperties,
          eq(parkingLots.hostelId, hostelProperties.id),
        )
        .leftJoin(hostelUnits, eq(parkingLots.unitId, hostelUnits.id))
        .orderBy(asc(hostelProperties.name), asc(parkingLots.lotNumber)),
      db
        .select({
          id: parkingRentals.id,
          parkingLotId: parkingRentals.parkingLotId,
          studentId: parkingRentals.studentId,
          tenantType: parkingRentals.tenantType,
          tenantName: parkingRentals.tenantName,
          contactNumber: parkingRentals.contactNumber,
          unitNumber: parkingRentals.unitNumber,
          carPlateNumber: parkingRentals.carPlateNumber,
          carModel: parkingRentals.carModel,
          monthlyRental: parkingRentals.monthlyRental,
          depositAmount: parkingRentals.depositAmount,
          startDate: parkingRentals.startDate,
          endDate: parkingRentals.endDate,
          paidUntil: parkingRentals.paidUntil,
          billingFrequency: parkingRentals.billingFrequency,
          packageMonths: parkingRentals.packageMonths,
          nextDueDate: parkingRentals.nextDueDate,
          paymentStatus: parkingRentals.paymentStatus,
          status: parkingRentals.status,
          notes: parkingRentals.notes,
          lotNumber: parkingLots.lotNumber,
          hostelName: hostelProperties.name,
        })
        .from(parkingRentals)
        .innerJoin(parkingLots, eq(parkingRentals.parkingLotId, parkingLots.id))
        .innerJoin(
          hostelProperties,
          eq(parkingLots.hostelId, hostelProperties.id),
        )
        .orderBy(desc(parkingRentals.id)),
      db
        .select({
          id: maintenanceTickets.id,
          ticketNo: maintenanceTickets.ticketNo,
          studentId: maintenanceTickets.studentId,
          studentName: studentProfiles.fullName,
          hostelId: maintenanceTickets.hostelId,
          hostelName: hostelProperties.name,
          unitId: maintenanceTickets.unitId,
          unitCode: hostelUnits.unitCode,
          roomId: maintenanceTickets.roomId,
          roomLabel: hostelRooms.roomLabel,
          category: maintenanceTickets.category,
          subcategory: maintenanceTickets.subcategory,
          subject: maintenanceTickets.subject,
          description: maintenanceTickets.description,
          priority: maintenanceTickets.priority,
          status: maintenanceTickets.status,
          submittedByType: maintenanceTickets.submittedByType,
          assignedTo: maintenanceTickets.assignedTo,
          attendedAt: maintenanceTickets.attendedAt,
          completedAt: maintenanceTickets.completedAt,
          costResponsibility: maintenanceTickets.costResponsibility,
          estimatedCost: maintenanceTickets.estimatedCost,
          actualCost: maintenanceTickets.actualCost,
          studentCharge: maintenanceTickets.studentCharge,
          // Who a student-borne charge actually bills to, and the unit's
          // registered owner — the drawer names both rather than making
          // staff go and look them up elsewhere.
          chargedStudentId: maintenanceTickets.chargedStudentId,
          ownerName: unitOwnerDetails.ownerName,
          ownerEmail: unitOwnerDetails.ownerEmail,
          createdAt: maintenanceTickets.createdAt,
          updatedAt: maintenanceTickets.updatedAt,
        })
        .from(maintenanceTickets)
        .leftJoin(
          studentProfiles,
          eq(maintenanceTickets.studentId, studentProfiles.id),
        )
        .leftJoin(
          unitOwnerDetails,
          eq(maintenanceTickets.unitId, unitOwnerDetails.unitId),
        )
        .leftJoin(
          hostelProperties,
          eq(maintenanceTickets.hostelId, hostelProperties.id),
        )
        .leftJoin(hostelUnits, eq(maintenanceTickets.unitId, hostelUnits.id))
        .leftJoin(hostelRooms, eq(maintenanceTickets.roomId, hostelRooms.id))
        .orderBy(desc(maintenanceTickets.id)),
      db.select().from(ticketMessages).orderBy(asc(ticketMessages.createdAt)),
      db
        .select({
          id: meterReadings.id,
          bedSpaceId: meterReadings.bedSpaceId,
          roomCode: sql<string>`${hostelUnits.unitCode} || '-' || ${hostelRooms.roomLabel}`,
          roomId: hostelRooms.id,
          roomLabel: hostelRooms.roomLabel,
          meterSerial: hostelRooms.meterSerial,
          unitCode: hostelUnits.unitCode,
          hostelId: hostelProperties.id,
          hostelName: hostelProperties.name,
          electricityRate: hostelProperties.electricityRate,
          readingDate: meterReadings.readingDate,
          readingValue: meterReadings.readingValue,
          readingType: meterReadings.readingType,
          replacedMeterFinal: meterReadings.replacedMeterFinal,
          submittedBy: meterReadings.submittedBy,
          notes: meterReadings.notes,
          createdAt: meterReadings.createdAt,
        })
        .from(meterReadings)
        .innerJoin(bedSpaces, eq(meterReadings.bedSpaceId, bedSpaces.id))
        .innerJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
        .innerJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
        .innerJoin(
          hostelProperties,
          eq(hostelUnits.hostelId, hostelProperties.id),
        )
        .orderBy(desc(meterReadings.readingDate)),
      db.select().from(billingCycles).orderBy(desc(billingCycles.id)),
      selectInvoices(db),
      db.select().from(billingItems),
      db
        .select()
        .from(billingPaymentRecords)
        .orderBy(desc(billingPaymentRecords.id)),
      db
        .select({
          id: announcements.id,
          title: announcements.title,
          body: announcements.body,
          audienceType: announcements.audienceType,
          hostelId: announcements.hostelId,
          hostelName: hostelProperties.name,
          blockCode: announcements.blockCode,
          unitId: announcements.unitId,
          unitCode: hostelUnits.unitCode,
          priority: announcements.priority,
          status: announcements.status,
          pinned: announcements.pinned,
          publishAt: announcements.publishAt,
          expiresAt: announcements.expiresAt,
          createdBy: announcements.createdBy,
          createdAt: announcements.createdAt,
        })
        .from(announcements)
        .leftJoin(
          hostelProperties,
          eq(announcements.hostelId, hostelProperties.id),
        )
        .leftJoin(hostelUnits, eq(announcements.unitId, hostelUnits.id))
        .orderBy(desc(announcements.pinned), desc(announcements.id)),
      db.select().from(storedAttachments).orderBy(desc(storedAttachments.id)),
      db
        .select()
        .from(ticketCategories)
        .orderBy(
          asc(ticketCategories.sortOrder),
          asc(ticketCategories.category),
        ),
      db
        .select({
          id: generalCosts.id,
          costDate: generalCosts.costDate,
          hostelId: generalCosts.hostelId,
          hostelName: hostelProperties.name,
          unitId: generalCosts.unitId,
          unitCode: hostelUnits.unitCode,
          ticketId: generalCosts.ticketId,
          costType: generalCosts.costType,
          description: generalCosts.description,
          responsibility: generalCosts.responsibility,
          amount: generalCosts.amount,
          studentCharge: generalCosts.studentCharge,
          notes: generalCosts.notes,
          createdBy: generalCosts.createdBy,
          createdAt: generalCosts.createdAt,
        })
        .from(generalCosts)
        .leftJoin(
          hostelProperties,
          eq(generalCosts.hostelId, hostelProperties.id),
        )
        .leftJoin(hostelUnits, eq(generalCosts.unitId, hostelUnits.id))
        .orderBy(desc(generalCosts.costDate), desc(generalCosts.id)),
      db
        .select()
        .from(billingItemAdjustments)
        .orderBy(desc(billingItemAdjustments.id)),
      db.select().from(appRoles).orderBy(asc(appRoles.id)),
      db
        .select({
          id: appUsers.id,
          email: appUsers.email,
          displayName: appUsers.displayName,
          roleId: appUsers.roleId,
          roleKey: appRoles.roleKey,
          roleName: appRoles.name,
          studentId: appUsers.studentId,
          studentName: studentProfiles.fullName,
          status: appUsers.status,
          lastLoginAt: appUsers.lastLoginAt,
          createdAt: appUsers.createdAt,
        })
        .from(appUsers)
        .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
        .leftJoin(studentProfiles, eq(appUsers.studentId, studentProfiles.id))
        .orderBy(asc(appUsers.displayName)),
      db
        .select()
        .from(rolePermissions)
        .orderBy(asc(rolePermissions.roleId), asc(rolePermissions.moduleKey)),
      db
        .select()
        .from(reminderTemplates)
        .orderBy(asc(reminderTemplates.dayOfMonth)),
      db.select().from(schools).orderBy(asc(schools.name)),
      db.select().from(courses).orderBy(asc(courses.name)),
      db.select().from(hostelCategoryRates),
      db.select().from(systemSettings),
      // Who has actually sold a tenancy, straight from the tenancies. This
      // used to be read off the data/student-assignments.json seed file,
      // which meant the dropdown emptied out to just the fallback the moment
      // that file was cleared — everyone real (Foo, Catherine, Michael…) is
      // recorded here, not there.
      db
        .selectDistinct({ name: accommodationAssignments.salesperson })
        .from(accommodationAssignments)
        .where(
          and(
            isNotNull(accommodationAssignments.salesperson),
            ne(accommodationAssignments.salesperson, ""),
          ),
        ),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const beds = deriveBeds(rawBeds, today);
    const hostels = deriveHostels(properties, units, beds);
    const bedById = new Map(beds.map((bed) => [bed.id, bed]));
    const propertyById = new Map(
      properties.map((property) => [property.id, property]),
    );
    const pendingReturnByReservation = new Map(
      pendingReturnRows.map((row) => [
        row.sourceReservationId,
        { assignmentId: row.id, expectedReturnDate: row.expectedReturnDate },
      ]),
    );
    const reservationList = reservationRows.map((reservation) => ({
      ...reservation,
      preferredHostelName: reservation.preferredHostelId
        ? propertyById.get(reservation.preferredHostelId)?.name || ""
        : "Any hostel",
      provisionalCode: reservation.provisionalBedSpaceId
        ? bedById.get(reservation.provisionalBedSpaceId)?.legacyCode || ""
        : "",
      assignedCode: reservation.assignedBedSpaceId
        ? bedById.get(reservation.assignedBedSpaceId)?.legacyCode || ""
        : "",
      payments: paymentRows.filter(
        (row) => row.reservationId === reservation.id,
      ),
      charges: chargeRows.filter((row) => row.reservationId === reservation.id),
      assignmentId:
        pendingReturnByReservation.get(reservation.id)?.assignmentId || null,
      expectedReturnDate:
        pendingReturnByReservation.get(reservation.id)?.expectedReturnDate ||
        null,
    }));
    const salesPeople = [
      ...new Set([
        ...salesPersonRows.map((row) => row.name).filter(Boolean),
        ...studentRows.map((row) => row.salesperson).filter(Boolean),
        ...reservationRows.map((row) => row.salesPerson).filter(Boolean),
        // Keeps the picker usable on a database with no tenancies yet.
        "Irena",
      ]),
    ].sort();
    const responseData = {
      hostels,
      units: units.map((unit) => ({
        ...unit,
        address: fullUnitAddress(
          unit.unitCode,
          unit.hostelCode,
          unit.hostelAddress,
        ),
      })),
      bedSpaces: beds,
      accessCards: cards,
      services: services.map((service) => ({
        ...service,
        hasPassword: Boolean(service.hasPassword),
      })),
      owners,
      reservations: reservationList,
      students: studentRows,
      studentRateChanges: rateRows,
      pastTenancies: pastTenancyRows.map((row) => ({
        id: Number(row.id),
        studentId: Number(row.student_id),
        roomCode: row.room_code,
        hostelName: row.hostel_name,
        monthlyRental:
          row.monthly_rental === null ? null : Number(row.monthly_rental),
        securityDeposit:
          row.security_deposit === null ? null : Number(row.security_deposit),
        checkInDate: row.check_in_date,
        checkOutDate: row.check_out_date,
        status: row.status,
        remarks: row.remarks,
      })),
      depositAdjustments: depositAdjustmentRows.map((row) => ({
        id: Number(row.id),
        assignmentId: Number(row.assignment_id),
        studentId: row.student_id === null ? null : Number(row.student_id),
        studentName: row.student_name,
        roomCode: row.room_code,
        hostelName: row.hostel_name,
        previousAmount: Number(row.previous_amount),
        newAmount: Number(row.new_amount),
        amount: Number(row.amount),
        reason: row.reason,
        source: row.source,
        effectiveDate: row.effective_date,
        createdAt: row.created_at,
        billedCycleId:
          row.billed_cycle_id === null ? null : Number(row.billed_cycle_id),
        invoiceNo: row.invoice_no,
        invoiceStatus: row.invoice_status,
      })),
      salesPeople,
      parkingLots: parkingLotRows,
      parkingRentals: parkingRentalRows,
      schools: schoolRows,
      courses: courseRows,
      categoryRates: categoryRateRows,
      settings: {
        roomTransferFee: Number(
          settingRows.find((row) => row.settingKey === "room-transfer-fee")
            ?.settingValue ?? 200,
        ),
        // Rent is due every month whether or not anyone remembers to press a
        // button, so the billing month builds itself once the cut-off day
        // arrives. These control when.
        autoBillingEnabled:
          (settingRows.find((row) => row.settingKey === "auto-billing-enabled")
            ?.settingValue ?? "off") === "on",
        autoBillingCutoffDay: Number(
          settingRows.find(
            (row) => row.settingKey === "auto-billing-cutoff-day",
          )?.settingValue ?? 24,
        ),
        autoBillingDueDay: Number(
          settingRows.find((row) => row.settingKey === "auto-billing-due-day")
            ?.settingValue ?? 5,
        ),
      },
      tickets: ticketRows,
      ticketMessages: messageRows,
      meterReadings: readingRows,
      billingCycles: cycleRows,
      invoices: invoiceRows.map((invoice) => ({
        ...invoice,
        items: invoiceItemRows.filter((item) => item.invoiceId === invoice.id),
        payments: billingPaymentRows.filter(
          (payment) => payment.invoiceId === invoice.id,
        ),
      })),
      announcements: announcementRows,
      attachments: attachmentRows,
      ticketCategories: categoryRows,
      generalCosts: costRows,
      billingAdjustments: adjustmentRows,
      roles: roleRows,
      users: userRows,
      rolePermissions: permissionRows,
      reminderTemplates: reminderRows,
      currentUser,
      importProgress: {
        assignments: studentRows.filter((student) => student.assignmentId)
          .length,
        expected: importedAssignments.length,
      },
    };
    if (currentUser?.roleKey === "tenant") {
      const ownStudents = studentRows.filter(
        (student) => student.id === currentUser.studentId,
      );
      const ownUnitIds = new Set(
        ownStudents.map((student) => student.unitId).filter(Boolean),
      );
      const ownHostelIds = new Set(
        ownStudents.map((student) => student.hostelId).filter(Boolean),
      );
      const ownTicketIds = new Set(
        ticketRows
          .filter((ticket) => ticket.studentId === currentUser.studentId)
          .map((ticket) => ticket.id),
      );
      const ownMessageIds = new Set(
        messageRows
          .filter((message) => ownTicketIds.has(message.ticketId))
          .map((message) => message.id),
      );
      const ownInvoiceIds = new Set(
        invoiceRows
          .filter((invoice) => invoice.studentId === currentUser.studentId)
          .map((invoice) => invoice.id),
      );
      const ownPaymentIds = new Set(
        billingPaymentRows
          .filter((payment) => ownInvoiceIds.has(payment.invoiceId))
          .map((payment) => payment.id),
      );
      return Response.json({
        ...responseData,
        hostels: hostels.filter((hostel) => ownHostelIds.has(hostel.id)),
        units: responseData.units.filter((unit) => ownUnitIds.has(unit.id)),
        bedSpaces: beds.filter(
          (bed) => bed.occupantId === currentUser.studentId,
        ),
        accessCards: [],
        owners: [],
        reservations: [],
        students: ownStudents,
        services: responseData.services.filter((service) =>
          ownUnitIds.has(service.unitId),
        ),
        parkingLots: [],
        parkingRentals: parkingRentalRows.filter(
          (rental) => rental.studentId === currentUser.studentId,
        ),
        tickets: ticketRows.filter(
          (ticket) => ticket.studentId === currentUser.studentId,
        ),
        ticketMessages: messageRows.filter((message) =>
          ticketRows.some(
            (ticket) =>
              ticket.id === message.ticketId &&
              ticket.studentId === currentUser.studentId,
          ),
        ),
        meterReadings: [],
        billingCycles: cycleRows,
        // A tenant sees only their own deposit movements, never the house's
        // ledger — the same rule every other row here follows.
        depositAdjustments: responseData.depositAdjustments.filter(
          (row) => row.studentId === currentUser.studentId,
        ),
        pastTenancies: responseData.pastTenancies.filter(
          (row) => row.studentId === currentUser.studentId,
        ),
        invoices: responseData.invoices.filter(
          (invoice) => invoice.studentId === currentUser.studentId,
        ),
        announcements: announcementRows.filter(
          (announcement) =>
            !announcement.hostelId || ownHostelIds.has(announcement.hostelId),
        ),
        attachments: attachmentRows.filter(
          (attachment) =>
            (attachment.contextType === "ticket" &&
              ownTicketIds.has(attachment.recordId)) ||
            (attachment.contextType === "ticket-update" &&
              ownMessageIds.has(attachment.recordId)) ||
            (attachment.contextType === "payment-proof" &&
              ownPaymentIds.has(attachment.recordId)),
        ),
        generalCosts: [],
        billingAdjustments: [],
        roles: [],
        users: [],
        rolePermissions: [],
        reminderTemplates: [],
      });
    }
    return Response.json(responseData);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load hostel records",
      },
      { status: 500 },
    );
  }
}

// Rent falls due every month whether or not anyone remembers to press a
// button, so the billing month reserves itself. There is no scheduler
// process here, so this runs off ordinary traffic: the first request on or
// after the cut-off day creates that month's (empty) draft cycle. It is safe
// to call on every request because billing_cycles.period_label is unique —
// a second attempt at the same month hits the conflict clause and changes
// nothing.
//
// This deliberately stops at reserving the period — it does NOT call
// generateBillingCycle to actually charge anyone. An earlier version did,
// and because it rides on ordinary page traffic rather than a real cron, the
// day it was switched on it silently back-billed every active tenant for
// whatever period the cut-off math decided was overdue (this project's own
// history has that incident on record). A member of staff now has to open
// Finance, preview the cycle this created, and press "Generate invoices"
// themselves before a single ringgit is charged to anyone.
let lastAutoBillingCheck = "";
// Turning the schedule on has to take effect now, not tomorrow — the day
// guard is cleared whenever the settings change.
function resetScheduledBillingGuard() {
  lastAutoBillingCheck = "";
}
async function runScheduledBilling(db: ReturnType<typeof getDb>) {
  const todayKL = todayInKL();
  // One check per day per process; the day itself is the guard, not a timer.
  if (lastAutoBillingCheck === todayKL) return;
  try {
    const settings = await db.select().from(systemSettings);
    const value = (key: string, fallback: string) =>
      settings.find((row) => row.settingKey === key)?.settingValue ?? fallback;
    if (value("auto-billing-enabled", "off") !== "on") return;
    // Only claim the day once the run is actually going ahead, so a disabled
    // schedule does not block the check that follows the moment it is enabled.
    lastAutoBillingCheck = todayKL;

    const cutoffDay = Math.min(28, Math.max(1, Number(value("auto-billing-cutoff-day", "24"))));
    // Rent falls due on a fixed day of the following month — the house rule
    // tenants are told, and the day the payment reminders are keyed to. It
    // is a calendar day, not an offset from the cut-off: "cut-off + 14 days"
    // lands on a different date every month (a short February drifts it by
    // three days), so the reminders and the real due date would disagree.
    const dueDay = Math.min(28, Math.max(1, Number(value("auto-billing-due-day", "5"))));

    // Before the cut-off day the month is not finished, so the period that
    // should exist by now is the previous one.
    const [year, month, day] = todayKL.split("-").map(Number);
    const anchor = new Date(Date.UTC(year, month - 1, 1));
    if (day < cutoffDay) anchor.setUTCMonth(anchor.getUTCMonth() - 1);
    const periodYear = anchor.getUTCFullYear();
    const periodMonth = anchor.getUTCMonth();
    const periodLabel = `${periodYear}-${String(periodMonth + 1).padStart(2, "0")}`;

    const existing = await db
      .select({ id: billingCycles.id })
      .from(billingCycles)
      .where(eq(billingCycles.periodLabel, periodLabel));
    if (existing.length) return;

    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const cutoff = new Date(Date.UTC(periodYear, periodMonth, cutoffDay));
    const due = new Date(Date.UTC(periodYear, periodMonth + 1, dueDay));
    // Only the empty container — see the comment above this function for why
    // this does not go on to bill anyone.
    await ensureBillingCycle(db, {
      periodLabel,
      cutoffDate: iso(cutoff),
      dueDate: iso(due),
    });
  } catch (error) {
    // Never let the scheduled run break the page it rode in on. The next
    // request retries, and Finance shows the month as still missing.
    console.error("Scheduled billing run failed", error);
    lastAutoBillingCheck = "";
  }
}

// Reserves a billing month without charging anyone. Idempotent — calling it
// again for the same period_label only refreshes the cut-off/due dates, so
// it is safe for both the scheduler and a staff member to call more than
// once for the same month.
async function ensureBillingCycle(
  db: ReturnType<typeof getDb>,
  input: { periodLabel: string; cutoffDate: string; dueDate: string },
) {
  const cycle = (
    await db.execute<{ id: number }>(sql`
      INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status)
      VALUES (${input.periodLabel}, ${input.cutoffDate}, ${input.dueDate}, 'draft')
      ON CONFLICT(period_label) DO UPDATE SET cutoff_date=excluded.cutoff_date, due_date=excluded.due_date
      RETURNING id
    `)
  )[0];
  if (!cycle) throw new Error("Unable to create billing cycle");
  return Number(cycle.id);
}

type PendingInvoice = {
  invoiceNo: string;
  studentId: number;
  studentName: string;
  roomCode: string;
  assignmentId: number;
  total: number;
  items: [string, string, number, number, number][];
  depositCarried: number;
};

// Works out what everyone currently owes for a cycle, without writing
// anything. generateBillingCycle() and previewBillingCycle() both call this
// and share every line of the money math between them — the whole point of
// a preview is that it can't drift from what actually gets billed.
async function computeCycleInvoices(
  db: ReturnType<typeof getDb>,
  cycleId: number,
  input: { periodLabel: string; cutoffDate: string; invoiceFrequency?: string },
): Promise<{
  invoicesToInsert: PendingInvoice[];
  maintenanceTicketsByStudent: Map<number, number[]>;
  depositIdsByAssignment: Map<number, number[]>;
  // Occupied rooms that get no electricity line this cycle because nobody
  // took a reading since the last billing run. Reported so a forgotten
  // meter round shows up as a warning before invoices go out, instead of
  // silently producing a month of rent-only bills.
  unreadMeterRooms: { roomCode: string; lastReadingDate: string | null }[];
}> {
  const empty = {
    invoicesToInsert: [] as PendingInvoice[],
    maintenanceTicketsByStudent: new Map<number, number[]>(),
    depositIdsByAssignment: new Map<number, number[]>(),
    unreadMeterRooms: [] as { roomCode: string; lastReadingDate: string | null }[],
  };
  const cutoffDate = input.cutoffDate;
  const invoiceFrequency = input.invoiceFrequency || "on-request";

      const active = await db.execute<{
        assignment_id: number;
        student_id: number;
        student_name: string;
        room_code: string;
        monthly_rental: number | null;
        room_id: number;
        unit_id: number;
        unit_code: string;
        electricity_rate: number;
        electricity_billing: string;
        check_in_date: string | null;
      }>(sql`
        SELECT a.id assignment_id, a.student_id, s.full_name student_name,
               u.unit_code || '-' || r.room_label room_code,
               a.monthly_rental, r.id room_id, u.id unit_id, u.unit_code,
               h.electricity_rate, u.electricity_billing, a.check_in_date
        FROM accommodation_assignments a
        JOIN student_profiles s ON s.id=a.student_id
        JOIN bed_spaces b ON a.bed_space_id=b.id
        JOIN hostel_rooms r ON b.room_id=r.id
        JOIN hostel_units u ON r.unit_id=u.id
        JOIN hostel_properties h ON u.hostel_id=h.id
        WHERE a.status='active'
      `);

      if (active.length) {
        const existingRows = await db.execute<{ student_id: number }>(
          sql`SELECT student_id FROM billing_invoices WHERE cycle_id=${cycleId}`,
        );
        const alreadyBilled = new Set(
          existingRows.map((row) => Number(row.student_id)),
        );
        const pending = active.filter(
          (assignment) => !alreadyBilled.has(Number(assignment.student_id)),
        );

        if (pending.length) {
          const assignmentIds = pending.map((row) =>
            Number(row.assignment_id),
          );
          const studentIds = [
            ...new Set(pending.map((row) => Number(row.student_id))),
          ];
          // ---- Block lets ------------------------------------------------
          // Some units are taken as a whole by one party (CENTEX / Weststar
          // Aviation): one tenancy carries the unit's rent and the students
          // living there are recorded at zero. Their electricity belongs to
          // whoever took the unit, not to each student, so it is worked out
          // per unit rather than per room. Decided here, before the meter
          // readings are fetched, because those have to cover every room of
          // such a unit — including rooms whose occupants are already billed,
          // or which are empty.
          // Units whose electricity does not come from room meters at all —
          // the landlord is invoiced by TNB for the whole unit and charges
          // that on directly. There is nothing to read and nothing for this
          // cycle to compute, so they are held out of the usage maths and out
          // of the "nobody read these meters" warning alike.
          const tnbDirectUnitIds = new Set(
            active
              .filter((row) => row.electricity_billing === "tnb-direct")
              .map((row) => Number(row.unit_id)),
          );
          const unitsWithZeroRent = new Set<number>();
          const payersByUnit = new Map<
            number,
            { assignmentId: number; rent: number }[]
          >();
          for (const row of active) {
            const unitId = Number(row.unit_id);
            const rent = Number(row.monthly_rental ?? 0);
            if (rent > 0) {
              if (!payersByUnit.has(unitId)) payersByUnit.set(unitId, []);
              payersByUnit
                .get(unitId)!
                .push({ assignmentId: Number(row.assignment_id), rent });
            } else unitsWithZeroRent.add(unitId);
          }
          // Only a unit where somebody pays AND somebody pays nothing. A
          // normal shared flat, where each occupant pays their own rent,
          // keeps the per-room split.
          const wholeUnitIds = new Set(
            [...unitsWithZeroRent].filter(
              (unitId) =>
                (payersByUnit.get(unitId) || []).length > 0 &&
                !tnbDirectUnitIds.has(unitId),
            ),
          );
          const blockLetRooms = wholeUnitIds.size
            ? await db.execute<{ room_id: number; unit_id: number; room_code: string }>(sql`
                SELECT r.id room_id, u.id unit_id, u.unit_code || '-' || r.room_label room_code
                FROM hostel_rooms r JOIN hostel_units u ON u.id = r.unit_id
                WHERE u.id IN (${sql.join([...wholeUnitIds].map((id) => sql`${id}`), sql`, `)})
                ORDER BY u.id, r.room_label
              `)
            : [];
          const roomsByUnit = new Map<number, number[]>();
          const roomLabelById = new Map<number, string>();
          for (const row of blockLetRooms) {
            const unitId = Number(row.unit_id);
            if (!roomsByUnit.has(unitId)) roomsByUnit.set(unitId, []);
            roomsByUnit.get(unitId)!.push(Number(row.room_id));
            roomLabelById.set(Number(row.room_id), String(row.room_code));
          }

          const roomIds = [
            ...new Set([
              ...pending.map((row) => Number(row.room_id)),
              ...blockLetRooms.map((row) => Number(row.room_id)),
            ]),
          ];
          const idList = (ids: number[]) =>
            sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            );

          // Latest rate-change override per assignment, effective on/before
          // cut-off — one query for every pending assignment instead of one
          // query per student.
          const rateChangeRows = await db.execute<{
            assignment_id: number;
            monthly_rental: number | null;
          }>(sql`
            SELECT DISTINCT ON (assignment_id) assignment_id, monthly_rental
            FROM student_rate_changes
            WHERE assignment_id IN (${idList(assignmentIds)})
              AND effective_date <= ${cutoffDate}
            ORDER BY assignment_id, effective_date DESC
          `);
          const rateChangeByAssignment = new Map(
            rateChangeRows.map((row) => [
              Number(row.assignment_id),
              row.monthly_rental,
            ]),
          );

          // Electricity: the per-room meter readings and occupant list only
          // depend on the room, not the individual student, so fetch each
          // once per room (rooms are shared by up to five students) instead
          // of redoing the same lookup for every roommate.
          // The cut-off of the cycle billed immediately before this one.
          // Electricity is charged for the movement between two readings, and
          // the newer of those two has to be one nobody has billed yet — if
          // the meter was not read this period the same pair would come back
          // and charge the identical usage a second time. Skipping the line
          // loses nothing: next period the pair simply spans both months and
          // bills the whole movement at once.
          const previousCutoffRow = (
            await db.execute<{ cutoff_date: string }>(sql`
              SELECT cutoff_date FROM billing_cycles
              WHERE cutoff_date < ${cutoffDate} AND id <> ${cycleId}
              ORDER BY cutoff_date DESC LIMIT 1
            `)
          )[0];
          const previousCutoff = previousCutoffRow?.cutoff_date || null;

          const readingRows = roomIds.length
            ? await db.execute<{
                room_id: number;
                reading_value: number;
                reading_date: string;
                replaced_meter_final: number | null;
              }>(sql`
                SELECT room_id, reading_value, reading_date, replaced_meter_final FROM (
                  SELECT
                    COALESCE(mr.room_id, bs.room_id) AS room_id,
                    mr.reading_value,
                    mr.reading_date,
                    mr.replaced_meter_final,
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
              `)
            : [];
          // Rooms whose newest reading predates the last billing run — their
          // usage has already been charged, so they get no electricity line.
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
          const readingsByRoom = new Map<number, number[]>();
          const lastReadingByRoom = new Map<number, string>();
          // Rooms whose newest reading came off a meter that had just been
          // swapped in, keyed to the outgoing meter's final reading.
          const replacedFinalByRoom = new Map<number, number>();
          for (const row of readingRows) {
            const roomId = Number(row.room_id);
            const list = readingsByRoom.get(roomId) || [];
            list.push(Number(row.reading_value));
            readingsByRoom.set(roomId, list);
            if (!lastReadingByRoom.has(roomId)) {
              lastReadingByRoom.set(roomId, String(row.reading_date));
              if (row.replaced_meter_final !== null)
                replacedFinalByRoom.set(roomId, Number(row.replaced_meter_final));
            }
          }

          // How many kWh a room moved between its two newest readings. A
          // swapped meter is the awkward case: the new one starts from zero,
          // so the count appears to go backwards and the month is made of two
          // halves — what the old meter still recorded before it came out,
          // plus everything the new one has counted since.
          const roomMovement = (roomId: number) => {
            if (staleMeterRooms.has(roomId)) return 0;
            const readings = readingsByRoom.get(roomId) || [];
            if (readings.length < 2) return 0;
            const [current, previous] = readings;
            const replacedFinal = replacedFinalByRoom.get(roomId);
            if (replacedFinal !== undefined)
              return Math.max(0, replacedFinal - previous) + Math.max(0, current);
            return current > previous ? current - previous : 0;
          };
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

          type OccupantRow = {
            assignment_id: number;
            room_id: number;
            check_in_meter: number | null;
            check_out_meter: number | null;
          };
          const occupantRows: OccupantRow[] = roomIds.length
            ? await db.execute<OccupantRow>(sql`
                SELECT a.id assignment_id, b.room_id, a.check_in_meter, a.check_out_meter
                FROM accommodation_assignments a
                JOIN bed_spaces b ON a.bed_space_id=b.id
                WHERE b.room_id IN (${idList(roomIds)})
                  AND (a.status='active' OR a.check_out_date>=substr(${cutoffDate},1,7)||'-01')
              `)
            : [];
          const occupantsByRoom = new Map<number, OccupantRow[]>();
          for (const row of occupantRows) {
            const roomId = Number(row.room_id);
            const list = occupantsByRoom.get(roomId) || [];
            list.push(row);
            occupantsByRoom.set(roomId, list);
          }

          // Same usage-splitting algorithm as before — only the data source
          // changed, from a per-assignment query to these per-room caches.
          const electricityShareFromCache = (
            assignmentId: number,
            roomId: number,
            electricityRate: number,
          ) => {
            if (staleMeterRooms.has(roomId)) return { usage: 0, amount: 0 };
            const readings = readingsByRoom.get(roomId) || [];
            if (readings.length < 2) return { usage: 0, amount: 0 };
            const current = readings[0];
            const previous = readings[1];
            const occupants = occupantsByRoom.get(roomId) || [];
            // A swapped meter breaks the interval maths below: a tenant's
            // check-in reading was taken off the old meter, so it cannot be
            // compared with a number from the new one. The month's total is
            // still known — it just cannot be apportioned by when people came
            // and went, so the roommates share it equally.
            if (replacedFinalByRoom.has(roomId)) {
              const movement = roomMovement(roomId);
              if (!movement || !occupants.length) return { usage: 0, amount: 0 };
              const usage = movement / occupants.length;
              return { usage, amount: Math.ceil(usage * electricityRate) };
            }
            if (!(current > previous)) return { usage: 0, amount: 0 };
            const intervals = occupants
              .map((occupant) => ({
                id: Number(occupant.assignment_id),
                start:
                  occupant.check_in_meter !== null &&
                  Number(occupant.check_in_meter) > previous
                    ? Math.min(current, Number(occupant.check_in_meter))
                    : previous,
                end:
                  occupant.check_out_meter !== null &&
                  Number(occupant.check_out_meter) < current
                    ? Math.max(previous, Number(occupant.check_out_meter))
                    : current,
              }))
              .filter((occupant) => occupant.end > occupant.start);
            const points = [
              ...new Set([
                previous,
                current,
                ...intervals.flatMap((occupant) => [
                  occupant.start,
                  occupant.end,
                ]),
              ]),
            ].sort((a, b) => a - b);
            let usage = 0;
            for (let index = 0; index < points.length - 1; index += 1) {
              const start = points[index],
                end = points[index + 1];
              const activeOccupants = intervals.filter(
                (occupant) => occupant.start <= start && occupant.end >= end,
              );
              if (
                activeOccupants.some(
                  (occupant) => occupant.id === assignmentId,
                ) &&
                activeOccupants.length
              )
                usage += (end - start) / activeOccupants.length;
            }
            return { usage, amount: Math.ceil(usage * electricityRate) };
          };

          // The unit's whole electricity bill, kept per room so the payer's
          // statement can show what each room used rather than one opaque
          // figure.
          const unitElectricity = new Map<
            number,
            { rooms: { roomId: number; usage: number; amount: number }[]; usage: number; amount: number }
          >();
          for (const unitId of wholeUnitIds) {
            const rate = Number(
              active.find((row) => Number(row.unit_id) === unitId)
                ?.electricity_rate || 0,
            );
            const rooms: { roomId: number; usage: number; amount: number }[] = [];
            let usage = 0;
            for (const roomId of roomsByUnit.get(unitId) || []) {
              const roomUsage = roomMovement(roomId);
              if (!roomUsage) continue;
              usage += roomUsage;
              rooms.push({
                roomId,
                usage: roomUsage,
                amount: Math.ceil(roomUsage * rate),
              });
            }
            unitElectricity.set(unitId, {
              rooms,
              usage,
              amount: Math.ceil(usage * rate),
            });
          }

          // What one payer owes of their unit's electricity. Normally the
          // only payer takes all of it; where a unit has more than one
          // (SR3 has two separate contracts) it splits in proportion to the
          // rent each carries.
          type RoomUsage = { roomId: number; usage: number; amount: number };
          const noElectricity = {
            usage: 0,
            amount: 0,
            rooms: [] as RoomUsage[],
            unitUsage: 0,
            share: 0,
          };
          const wholeUnitElectricityFor = (unitId: number, assignmentId: number) => {
            const total = unitElectricity.get(unitId);
            if (!total) return noElectricity;
            const payers = payersByUnit.get(unitId) || [];
            const index = payers.findIndex(
              (payer) => payer.assignmentId === assignmentId,
            );
            // A covered student pays nothing — the unit's bill is the
            // payer's, not theirs.
            if (index < 0) return noElectricity;
            if (payers.length === 1)
              return { ...total, unitUsage: total.usage, share: 1 };
            // Rounded on the running total rather than each payer's own
            // share, so the payers' amounts add back up to exactly the
            // unit's bill instead of each rounding up and collecting a
            // ringgit more between them than the unit was charged.
            const rentTotal = payers.reduce((sum, payer) => sum + payer.rent, 0) || 1;
            const upTo = (count: number) =>
              Math.round(
                (total.amount *
                  payers
                    .slice(0, count)
                    .reduce((sum, payer) => sum + payer.rent, 0)) /
                  rentTotal,
              );
            const share = payers[index].rent / rentTotal;
            return {
              usage: total.usage * share,
              amount: upTo(index + 1) - upTo(index),
              rooms: total.rooms,
              unitUsage: total.usage,
              share,
            };
          };

          // A block let is billed one line for the whole unit, so the payer
          // is told which rooms it covers and what each used — otherwise it
          // is an unexplainable lump sum. Where two contracts share a unit
          // the rooms listed are still the whole unit's, so the line says up
          // front what portion of them this payer carries.
          const describeWholeUnitElectricity = (
            unitCode: string,
            detail: { rooms: RoomUsage[]; usage: number; unitUsage: number; share: number },
          ) => {
            const rooms =
              detail.rooms
                .map(
                  (room) =>
                    `${roomLabelById.get(room.roomId) || `Room ${room.roomId}`} ${room.usage.toFixed(2)} kWh`,
                )
                .join(", ") || "no room readings";
            const portion =
              detail.share < 1
                ? `, ${Math.round(detail.share * 100)}% share of the unit's ${detail.unitUsage.toFixed(2)} kWh`
                : "";
            return `Electricity — whole unit ${unitCode} (${detail.usage.toFixed(2)} kWh${portion}): ${rooms}`;
          };

          // Monthly rentals bill every cycle; annual ones only bill the cycle
          // whose month matches the anniversary of their start date.
          const parkingRows = await db.execute<{
            student_id: number;
            amount: number;
          }>(sql`
            SELECT student_id, COALESCE(SUM(monthly_rental),0) amount
            FROM parking_rentals
            WHERE student_id IN (${idList(studentIds)}) AND status='active'
              AND (
                billing_frequency='monthly'
                OR (billing_frequency IN ('annually','package') AND EXTRACT(MONTH FROM start_date::date)=EXTRACT(MONTH FROM ${cutoffDate}::date))
              )
            GROUP BY student_id
          `);
          const parkingByStudent = new Map(
            parkingRows.map((row) => [
              Number(row.student_id),
              Number(row.amount),
            ]),
          );

          // Only tickets no cycle has charged out yet. "Completed with a
          // student charge" stays true forever, so without the billed_cycle_id
          // guard the same repair would be re-billed in every later cycle.
          const maintenanceRows = await db.execute<{
            student_id: number;
            amount: number;
            ticket_ids: number[];
          }>(sql`
            SELECT student_id, COALESCE(SUM(amount),0) amount, ARRAY_AGG(id) ticket_ids
            FROM (
              SELECT id,
                     COALESCE(charged_student_id, student_id) AS student_id,
                     -- A student-borne ticket carries its amount in
                     -- actual_cost now that the separate penalty field is
                     -- gone; student_charge is still read first so tickets
                     -- raised under the old two-figure form bill unchanged.
                     CASE
                       WHEN cost_responsibility = 'student'
                         THEN COALESCE(NULLIF(student_charge, 0), actual_cost, 0)
                       ELSE COALESCE(student_charge, 0)
                     END AS amount
              FROM maintenance_tickets
              WHERE COALESCE(charged_student_id, student_id) IN (${idList(studentIds)})
                AND status IN ('completed','closed')
                AND billed_cycle_id IS NULL
            ) chargeable
            WHERE amount > 0
            GROUP BY student_id
          `);
          const maintenanceByStudent = new Map(
            maintenanceRows.map((row) => [
              Number(row.student_id),
              Number(row.amount),
            ]),
          );
          // Stamped only for the students who actually end up with an
          // invoice below, so a ticket belonging to someone this run skips
          // stays available for the next cycle.
          const maintenanceTicketsByStudent = new Map(
            maintenanceRows.map((row) => [
              Number(row.student_id),
              (row.ticket_ids || []).map(Number),
            ]),
          );

          // Deposit differences booked since the last run, netted per
          // tenancy so a rise and a later fall settle against each other
          // instead of appearing as two opposing lines on one invoice.
          const depositRows = await db.execute<{
            assignment_id: number;
            amount: number;
            adjustment_ids: number[];
          }>(sql`
            SELECT assignment_id, COALESCE(SUM(amount),0) amount,
                   ARRAY_AGG(id) adjustment_ids
            FROM deposit_adjustments
            WHERE assignment_id IN (${idList(assignmentIds)})
              AND effective_date <= ${cutoffDate}
              AND billed_cycle_id IS NULL
            GROUP BY assignment_id
          `);
          const depositByAssignment = new Map(
            depositRows.map((row) => [
              Number(row.assignment_id),
              Number(row.amount),
            ]),
          );
          const depositIdsByAssignment = new Map(
            depositRows.map((row) => [
              Number(row.assignment_id),
              (row.adjustment_ids || []).map(Number),
            ]),
          );

          const invoicesToInsert = pending.map((assignment) => {
            const assignmentId = Number(assignment.assignment_id);
            const studentId = Number(assignment.student_id);
            const roomId = Number(assignment.room_id);
            const electricityRate = Number(assignment.electricity_rate || 0);

            const rateChange = rateChangeByAssignment.get(assignmentId);
            const fullRent = Number(rateChange ?? assignment.monthly_rental ?? 0);

            // A tenant who moved in during the very month this cycle bills
            // already paid a full month's rent at move-in (the one-time
            // "first month advance rental" line on their move-in invoice —
            // see syncMoveInInvoice). Charging the normal full rent again
            // here would double-bill that month. Rather than skip the
            // assignment outright (which would also swallow any electricity,
            // parking or maintenance charge it legitimately owes), only the
            // rent portion is adjusted:
            //   check-in day 1-15  -> the move-in charge already covers this
            //                         month in full; nothing more here.
            //   check-in day 16-28 -> half a month, for the back half they
            //                         actually lived here.
            //   check-in day 29-31 -> too little of the month left to bill;
            //                         nothing here, and next month's cycle
            //                         charges a normal full month as their
            //                         effective first month.
            // A tenant who moved in any earlier month is unaffected — this
            // only fires the one time a fresh move-in's month lines up with
            // the cycle being generated.
            const checkInDate = assignment.check_in_date;
            const movedInThisPeriod =
              checkInDate !== null &&
              checkInDate.slice(0, 7) === input.periodLabel;
            const rent = !movedInThisPeriod
              ? fullRent
              : (() => {
                  const day = Number(checkInDate.slice(8, 10));
                  if (day <= 15) return 0;
                  if (day <= 28) return fullRent / 2;
                  return 0;
                })();

            // In a block let the whole unit's usage lands on the payer and
            // the covered students get nothing; everywhere else it stays the
            // per-room split between the people who actually share the room.
            const unitId = Number(assignment.unit_id);
            const wholeUnit = wholeUnitIds.has(unitId)
              ? wholeUnitElectricityFor(unitId, assignmentId)
              : null;
            // TNB bills this unit directly, so the cycle raises no
            // electricity line at all — the charge is passed on outside it.
            const electricity = tnbDirectUnitIds.has(unitId)
              ? { usage: 0, amount: 0 }
              : (wholeUnit ??
                electricityShareFromCache(assignmentId, roomId, electricityRate));
            const parkingAmount = Number(
              parkingByStudent.get(studentId) || 0,
            );
            const extraAmount = Number(
              maintenanceByStudent.get(studentId) || 0,
            );
            // An overpayment is NOT re-billed as a credit line. The money is
            // already recorded against the invoice that received it, so
            // emitting a matching negative line here would let the same
            // ringgit reduce the student's balance twice — and because that
            // drives an invoice total negative, the next run would read the
            // negative total as a fresh overpayment and compound the error.
            // The student's true position is simply everything billed minus
            // everything received, which is how Student Information's Billing
            // tab and the reservation ledger both already read it.
            //
            // A deposit refund is different: it is a genuine new charge line
            // (a negative one), not a restatement of money already recorded.
            // It can take the bill down to zero but never past it, and
            // whatever the month cannot absorb rolls into the next cycle.
            const rawDeposit = Number(
              depositByAssignment.get(assignmentId) || 0,
            );
            const absorbable = Math.max(
              0,
              rent + electricity.amount + parkingAmount + extraAmount,
            );
            const depositAmount =
              rawDeposit < 0 ? Math.max(rawDeposit, -absorbable) : rawDeposit;
            const depositCarried = rawDeposit - depositAmount;
            const total =
              rent +
              electricity.amount +
              parkingAmount +
              extraAmount +
              depositAmount;

            const items = (
              [
                ["room-rental", "Room rental", 1, rent, rent],
                [
                  "electricity",
                  wholeUnit
                    ? describeWholeUnitElectricity(
                        String(assignment.unit_code),
                        wholeUnit,
                      )
                    : `Electricity usage (${electricity.usage.toFixed(2)} kWh)`,
                  electricity.usage,
                  electricityRate,
                  electricity.amount,
                ],
                ["parking", "Parking rental", 1, parkingAmount, parkingAmount],
                [
                  "maintenance",
                  "Maintenance charges",
                  1,
                  extraAmount,
                  extraAmount,
                ],
                [
                  "deposit-adjustment",
                  depositAmount >= 0
                    ? "Security deposit top-up"
                    : "Security deposit refund",
                  1,
                  depositAmount,
                  depositAmount,
                ],
              ] as [string, string, number, number, number][]
            ).filter((item) => Number(item[4]) !== 0);

            return {
              invoiceNo: `INV-${cycleId}-${studentId}`,
              studentId,
              studentName: assignment.student_name,
              roomCode: assignment.room_code,
              assignmentId,
              total,
              items,
              depositCarried,
            };
          })
            // A tenancy with no rent recorded and nothing else to charge has
            // no bill. Issuing an empty one every month buries the real
            // invoices and gives Finance 139 rows to chase for nothing — the
            // tenancy needs a rent set, which is a data problem, not a bill.
            .filter((invoice) => invoice.items.length > 0);
        return {
          invoicesToInsert,
          maintenanceTicketsByStudent,
          depositIdsByAssignment,
          unreadMeterRooms,
        };
      }
      return empty;
    }
    return empty;
  }

// Builds a billing month and its invoices. Extracted so the scheduled run
// (via ensureBillingCycle only — see runScheduledBilling) and the manual
// "Prepare billing month" -> preview -> "Generate invoices" flow share one
// implementation for the actual money math: two copies of this arithmetic
// would drift, and the money it produces is the point of the whole system.
async function generateBillingCycle(
  db: ReturnType<typeof getDb>,
  input: {
    periodLabel: string;
    cutoffDate: string;
    dueDate: string;
    invoiceFrequency?: string;
    actorName: string;
  },
) {
  const cycleId = await ensureBillingCycle(db, input);
  const cutoffDate = input.cutoffDate;
  const dueDate = input.dueDate;
  const invoiceFrequency = input.invoiceFrequency || "on-request";
  const { invoicesToInsert, maintenanceTicketsByStudent, depositIdsByAssignment } =
    await computeCycleInvoices(db, cycleId, input);

  if (invoicesToInsert.length) {
          for (const batch of chunks(invoicesToInsert, 200)) {
            const invoiceValueRows = batch.map(
              (invoice) =>
                // A month whose charges a refund fully cancels out has
                // nothing left to collect, so it opens settled rather than
                // sitting in Finance as an unpaid bill for RM 0.
                sql`(${invoice.invoiceNo}, ${cycleId}, ${invoice.studentId}, ${invoice.assignmentId}, ${dueDate}, ${invoice.total <= 0 ? "paid" : "unpaid"}, ${invoice.total}, 0, ${invoiceFrequency})`,
            );
            const insertedInvoices = await db.execute<{
              id: number;
              student_id: number;
            }>(sql`
              INSERT INTO billing_invoices (invoice_no, cycle_id, student_id, assignment_id, due_date, status, total_amount, amount_paid, invoice_frequency)
              VALUES ${sql.join(invoiceValueRows, sql`, `)}
              RETURNING id, student_id
            `);
            const invoiceIdByStudent = new Map(
              insertedInvoices.map((row) => [
                Number(row.student_id),
                Number(row.id),
              ]),
            );

            const itemValueRows = batch.flatMap((invoice) => {
              const invoiceId = invoiceIdByStudent.get(invoice.studentId);
              if (!invoiceId) return [];
              return invoice.items.map(
                ([itemType, description, quantity, rate, amount]) =>
                  sql`(${invoiceId}, ${itemType}, ${description}, ${quantity}, ${rate}, ${amount})`,
              );
            });
            if (itemValueRows.length)
              await db.execute(sql`
                INSERT INTO billing_items (invoice_id, item_type, description, quantity, rate, amount)
                VALUES ${sql.join(itemValueRows, sql`, `)}
              `);

            // Mark this batch's maintenance charges as billed. Only tickets
            // whose student got an invoice here are stamped, and only where
            // the charge actually made it onto that invoice.
            const billedTicketIds = batch.flatMap((invoice) =>
              invoiceIdByStudent.has(invoice.studentId) &&
              invoice.items.some(([itemType]) => itemType === "maintenance")
                ? maintenanceTicketsByStudent.get(invoice.studentId) || []
                : [],
            );
            if (billedTicketIds.length)
              await db.execute(sql`
                UPDATE maintenance_tickets SET billed_cycle_id = ${cycleId}
                WHERE id IN ${billedTicketIds}
              `);

            // Same treatment for the deposit differences: stamped only where
            // the line actually reached an invoice, so an adjustment whose
            // student this run skipped stays available for the next cycle.
            const billedDepositIds = batch.flatMap((invoice) =>
              invoiceIdByStudent.has(invoice.studentId) &&
              invoice.items.some(([itemType]) => itemType === "deposit-adjustment")
                ? depositIdsByAssignment.get(invoice.assignmentId) || []
                : [],
            );
            if (billedDepositIds.length)
              await db.execute(sql`
                UPDATE deposit_adjustments SET billed_cycle_id = ${cycleId}
                WHERE id IN ${billedDepositIds}
              `);

            // The part of a refund this month could not absorb is re-booked
            // as a fresh unbilled adjustment, so it reaches the student on a
            // later invoice instead of being written off with the rows that
            // were just marked billed.
            for (const invoice of batch) {
              if (!invoice.depositCarried) continue;
              if (!invoiceIdByStudent.has(invoice.studentId)) continue;
              // Only when the originals were actually consumed. If the month
              // could absorb nothing at all there is no deposit line, those
              // rows were never stamped, and they are still waiting on their
              // own — re-booking here would refund the student twice.
              if (
                !invoice.items.some(
                  ([itemType]) => itemType === "deposit-adjustment",
                )
              )
                continue;
              await db.insert(depositAdjustments).values({
                assignmentId: invoice.assignmentId,
                previousAmount: 0,
                newAmount: 0,
                amount: invoice.depositCarried,
                reason: "Deposit refund carried forward",
                source: "carry-forward",
                effectiveDate: cutoffDate,
                createdBy: input.actorName,
              });
            }
          }
  }
  return cycleId;
}

// The read-only twin of generateBillingCycle(): reserves the period (so two
// staff previewing at once land on the same draft cycle instead of each
// minting their own) and runs the identical computation, but stops short of
// ever touching billing_invoices/billing_items. Recomputed fresh every time
// rather than cached, so a payment or rate change recorded between preview
// and the actual "Generate invoices" click is never missed.
async function previewBillingCycle(
  db: ReturnType<typeof getDb>,
  input: {
    periodLabel: string;
    cutoffDate: string;
    dueDate: string;
    invoiceFrequency?: string;
  },
) {
  const cycleId = await ensureBillingCycle(db, input);
  const { invoicesToInsert, unreadMeterRooms } = await computeCycleInvoices(
    db,
    cycleId,
    input,
  );
  return {
    cycleId,
    periodLabel: input.periodLabel,
    cutoffDate: input.cutoffDate,
    dueDate: input.dueDate,
    rows: invoicesToInsert.map((row) => ({
      studentId: row.studentId,
      studentName: row.studentName,
      roomCode: row.roomCode,
      invoiceNo: row.invoiceNo,
      total: row.total,
      items: row.items.map(([itemType, description, quantity, rate, amount]) => ({
        itemType,
        description,
        quantity,
        rate,
        amount,
      })),
    })),
    invoiceCount: invoicesToInsert.length,
    totalBilled: invoicesToInsert.reduce((sum, row) => sum + row.total, 0),
    electricityBilled: invoicesToInsert.reduce(
      (sum, row) =>
        sum +
        row.items
          .filter(([itemType]) => itemType === "electricity")
          .reduce((lineSum, item) => lineSum + Number(item[4] || 0), 0),
      0,
    ),
    // Occupied rooms billing no electricity this month — almost always a
    // meter round that hasn't been keyed in yet. Capped because the list is
    // a prompt to go and read the meters, not a report.
    unreadMeterRooms: unreadMeterRooms.slice(0, 40),
    unreadMeterRoomCount: unreadMeterRooms.length,
    // A room that has never been read is not the same problem as one that
    // simply wasn't read this round. Electricity is the movement between two
    // readings, so the first one taken in a never-read room is only a
    // baseline and still bills nothing — it takes two rounds before that
    // room ever charges, and until then its usage is not being deferred,
    // it is being lost.
    neverReadRoomCount: unreadMeterRooms.filter((room) => !room.lastReadingDate)
      .length,
  };
}


export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = (await request.json()) as Record<string, unknown>;
    const action = asText(body.action);
    let createdId: number | undefined;
    let linkedPaymentId: number | undefined;
    let billingPreview: Awaited<ReturnType<typeof previewBillingCycle>> | undefined;
    if (!administrationSeeded) {
      await seedAdministration(db);
      administrationSeeded = true;
    }
    const currentUser = await resolveCurrentUser(request, db);
    if (!currentUser || currentUser.status !== "active")
      throw new Error("Your user account is not active");
    const moduleKey = moduleForAction(action);
    if (moduleKey) {
      const permission = currentUser.permissions.find(
        (row) => row.moduleKey === moduleKey,
      );
      const capability = /delete/.test(action)
        ? "canDelete"
        : /verify|approve/.test(action)
          ? "canApprove"
          : /create|add|^reservation$|parking-lot|parking-rental|announcement$|meter-reading|general-cost|billing-payment/.test(
                action,
              )
            ? "canCreate"
            : "canEdit";
      if (!permission?.[capability])
        throw new Error("Your role does not allow this action");
    }

    if (action === "bed-status") {
      const status = asText(body.status);
      if (
        !body.bedId ||
        !["occupied", "vacant", "reserved", "special-use"].includes(status)
      )
        throw new Error("A valid room code and status are required");
      await db
        .update(bedSpaces)
        .set({
          status,
          specialUse:
            status === "special-use"
              ? asText(body.specialUse, "Special use")
              : null,
          updatedAt: nowIso(),
        })
        .where(eq(bedSpaces.id, asNumber(body.bedId)));
    } else if (action === "bed-type") {
      const bedType = asText(body.bedType, "unknown");
      if (
        !body.bedId ||
        ![
          "unknown",
          "single",
          "bunk",
          "bunk-upper",
          "bunk-lower",
          "queen",
          "two-single",
        ].includes(bedType)
      )
        throw new Error("A valid room code and bed type are required");
      await db
        .update(bedSpaces)
        .set({ bedType, updatedAt: nowIso() })
        .where(eq(bedSpaces.id, asNumber(body.bedId)));
    } else if (action === "bed-code") {
      if (!body.bedId || !asText(body.legacyCode))
        throw new Error("Room code is required");
      await db
        .update(bedSpaces)
        .set({
          legacyCode: asText(body.legacyCode),
          updatedAt: nowIso(),
        })
        .where(eq(bedSpaces.id, asNumber(body.bedId)));
    } else if (action === "access-card") {
      const cardCode = asText(body.cardCode);
      if (!body.unitId || !cardCode)
        throw new Error("Unit and card number are required");
      await db.insert(accessCards).values({
        unitId: asNumber(body.unitId),
        cardCode,
        depositAmount: asNumber(body.depositAmount),
        status: asText(body.status, "available"),
        notes: asText(body.notes),
      });
    } else if (action === "access-card-update") {
      if (!body.cardId || !asText(body.cardCode))
        throw new Error("Card number is required");
      await db
        .update(accessCards)
        .set({
          cardCode: asText(body.cardCode),
          status: asText(body.status, "available"),
          notes: asText(body.notes),
        })
        .where(eq(accessCards.id, asNumber(body.cardId)));
    } else if (action === "access-card-delete") {
      if (!body.cardId) throw new Error("Access card is required");
      await db
        .delete(accessCards)
        .where(eq(accessCards.id, asNumber(body.cardId)));
    } else if (action === "hostel-create") {
      if (!asText(body.name) || !asText(body.code))
        throw new Error("Property name and code are required");
      const inserted = await db
        .insert(hostelProperties)
        .values({
          code: asText(body.code).toUpperCase(),
          name: asText(body.name),
          address: asText(body.address),
          status: asText(body.status, "active"),
          electricityRate: asNumber(body.electricityRate, 0),
          monthlyCleaningFee: asNumber(body.monthlyCleaningFee, 0),
          monthlyWaterDispenserFee: asNumber(body.monthlyWaterDispenserFee, 0),
        })
        .returning({ id: hostelProperties.id });
      createdId = inserted[0]?.id;
    } else if (action === "hostel-update") {
      const hostelId = asNumber(body.hostelId);
      if (!hostelId || !asText(body.name) || !asText(body.code))
        throw new Error("Property, name and code are required");
      await db
        .update(hostelProperties)
        .set({
          code: asText(body.code).toUpperCase(),
          name: asText(body.name),
          address: asText(body.address),
          status: asText(body.status, "active"),
          electricityRate: asNumber(body.electricityRate, 0),
          monthlyCleaningFee: asNumber(body.monthlyCleaningFee, 0),
          monthlyWaterDispenserFee: asNumber(body.monthlyWaterDispenserFee, 0),
        })
        .where(eq(hostelProperties.id, hostelId));
    } else if (action === "unit-create") {
      if (!body.hostelId || !asText(body.unitCode))
        throw new Error("Hostel and unit number are required");
      const property = (
        await db
          .select()
          .from(hostelProperties)
          .where(eq(hostelProperties.id, asNumber(body.hostelId)))
      )[0];
      if (!property) throw new Error("Hostel not found");
      const unitCode = asText(body.unitCode);
      const result = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO hostel_units (hostel_id, unit_code, address, gender, status, notes, owner_name, surrender_notes)
          VALUES (${asNumber(body.hostelId)}, ${unitCode}, ${fullUnitAddress(unitCode, property.code, property.address)}, ${asText(body.gender, "unspecified")}, 'active', '', '', '')
          RETURNING id
        `)
      )[0];
      createdId = Number(result?.id);
    } else if (action === "unit-update") {
      const gender = asText(body.gender, "unspecified");
      if (
        !body.unitId ||
        !["male", "female", "mixed", "unspecified"].includes(gender)
      )
        throw new Error("A valid unit and gender are required");
      const status = asText(body.unitStatus, "active");
      const unitId = asNumber(body.unitId);
      // Renaming the unit has to carry its room codes with it: those are
      // stored as "<unitCode>-<bed>", so leaving them behind would strand
      // every room under a code its unit no longer has.
      const existingUnit = (
        await db.select().from(hostelUnits).where(eq(hostelUnits.id, unitId))
      )[0];
      if (!existingUnit) throw new Error("Unit not found");
      const unitCode = asText(body.unitCode, existingUnit.unitCode).trim();
      if (!unitCode) throw new Error("Unit code is required");
      if (unitCode !== existingUnit.unitCode) {
        const clashingUnit = await db
          .select({ id: hostelUnits.id })
          .from(hostelUnits)
          .where(
            and(
              eq(hostelUnits.hostelId, existingUnit.hostelId),
              eq(hostelUnits.unitCode, unitCode),
              ne(hostelUnits.id, unitId),
            ),
          );
        if (clashingUnit.length)
          throw new Error(
            `Another unit in this hostel is already called ${unitCode}`,
          );
        const beds = await db.execute<{ id: number; legacy_code: string }>(sql`
          SELECT b.id, b.legacy_code FROM bed_spaces b
          JOIN hostel_rooms r ON r.id = b.room_id
          WHERE r.unit_id = ${unitId} AND b.legacy_code LIKE ${`${existingUnit.unitCode}-%`}
        `);
        const renames = beds.map((bed) => ({
          id: Number(bed.id),
          next: `${unitCode}${bed.legacy_code.slice(existingUnit.unitCode.length)}`,
        }));
        if (renames.length) {
          const clashingCodes = await db
            .select({ legacyCode: bedSpaces.legacyCode })
            .from(bedSpaces)
            .where(
              and(
                inArray(
                  bedSpaces.legacyCode,
                  renames.map((row) => row.next),
                ),
                notInArray(
                  bedSpaces.id,
                  renames.map((row) => row.id),
                ),
              ),
            );
          if (clashingCodes.length)
            throw new Error(
              `Renaming to ${unitCode} would clash with existing room codes: ${clashingCodes
                .map((row) => row.legacyCode)
                .join(", ")}`,
            );
          for (const row of renames)
            await db
              .update(bedSpaces)
              .set({ legacyCode: row.next })
              .where(eq(bedSpaces.id, row.id));
        }
      }
      await db
        .update(hostelUnits)
        .set({
          unitCode,
          gender,
          surrenderDate: ["return-planned", "surrendered"].includes(status)
            ? asNullableText(body.surrenderDate)
            : null,
          surrenderNotes: asText(body.surrenderNotes),
          status,
          notes: asText(body.notes),
          address: asText(body.address),
        })
        .where(eq(hostelUnits.id, asNumber(body.unitId)));
    } else if (action === "unit-delete") {
      const unitId = asNumber(body.unitId);
      if (!unitId) throw new Error("Unit is required");
      // Deleting is for units created by mistake. Anything that represents
      // real history — a tenancy, a reservation, a ticket, a meter reading,
      // money — blocks it and is named in the error, because surrendering
      // the unit is the right move there, not erasing it.
      const bedIds = sql`(SELECT b.id FROM bed_spaces b JOIN hostel_rooms r ON r.id = b.room_id WHERE r.unit_id = ${unitId})`;
      const counts = (
        await db.execute<Record<string, number>>(sql`
          SELECT
            (SELECT count(*) FROM accommodation_assignments WHERE bed_space_id IN ${bedIds}) AS tenancies,
            (SELECT count(*) FROM reservations WHERE preferred_unit_id = ${unitId}
               OR provisional_bed_space_id IN ${bedIds} OR assigned_bed_space_id IN ${bedIds}) AS reservations,
            (SELECT count(*) FROM maintenance_tickets WHERE unit_id = ${unitId}) AS tickets,
            (SELECT count(*) FROM meter_readings WHERE bed_space_id IN ${bedIds}) AS meter_readings,
            (SELECT count(*) FROM parking_lots WHERE unit_id = ${unitId}) AS parking_lots,
            (SELECT count(*) FROM general_costs WHERE unit_id = ${unitId}) AS costs,
            (SELECT count(*) FROM announcements WHERE unit_id = ${unitId}) AS announcements
        `)
      )[0];
      const blocking = Object.entries(counts || {})
        .filter(([, value]) => Number(value) > 0)
        .map(([key, value]) => `${value} ${key.replace(/_/g, " ")}`);
      if (blocking.length)
        throw new Error(
          `This unit still has ${blocking.join(", ")}. Set its status to surrendered instead of deleting it.`,
        );
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM access_cards WHERE unit_id = ${unitId}`);
        await tx.execute(sql`DELETE FROM unit_services WHERE unit_id = ${unitId}`);
        await tx.execute(
          sql`DELETE FROM unit_owner_details WHERE unit_id = ${unitId}`,
        );
        await tx.execute(
          sql`DELETE FROM bed_spaces WHERE room_id IN (SELECT id FROM hostel_rooms WHERE unit_id = ${unitId})`,
        );
        await tx.execute(sql`DELETE FROM hostel_rooms WHERE unit_id = ${unitId}`);
        await tx.execute(sql`DELETE FROM hostel_units WHERE id = ${unitId}`);
      });
    } else if (action === "unit-owner") {
      if (!body.unitId) throw new Error("A valid unit is required");
      const values = {
        unitId: asNumber(body.unitId),
        ownerName: asText(body.ownerName),
        ownerIdentityNo: asText(body.ownerIdentityNo),
        ownerEmail: asText(body.ownerEmail),
        registeredAddress: asText(body.registeredAddress),
        agreementType: asText(body.agreementType, "rental"),
        primaryContactName: asText(body.primaryContactName),
        primaryContactPhone: asText(body.primaryContactPhone),
        secondaryContactName: asText(body.secondaryContactName),
        secondaryContactPhone: asText(body.secondaryContactPhone),
        bankAccountNumber: asText(body.bankAccountNumber),
        bankAccountHolder: asText(body.bankAccountHolder),
        bankName: asText(body.bankName),
        leaseStartDate: asNullableText(body.leaseStartDate),
        leaseEndDate: asNullableText(body.leaseEndDate),
        monthlyLeaseRental: asNullableNumber(body.monthlyLeaseRental),
        servicePercentage: asNullableNumber(body.servicePercentage),
        securityDeposit: asNullableNumber(body.securityDeposit),
        utilityDeposit: asNullableNumber(body.utilityDeposit),
        commissionAmount: asNullableNumber(body.commissionAmount),
        tnbAccount: asText(body.tnbAccount),
        airSelangorAccount: asText(body.airSelangorAccount),
        indahWaterAccount: asText(body.indahWaterAccount),
        monthlyCleaningFee: asNullableNumber(body.monthlyCleaningFee),
        monthlyWaterDispenserFee: asNullableNumber(
          body.monthlyWaterDispenserFee,
        ),
        notes: asText(body.ownerNotes),
        updatedAt: nowIso(),
      };
      await db
        .insert(unitOwnerDetails)
        .values(values)
        .onConflictDoUpdate({ target: unitOwnerDetails.unitId, set: values });
    } else if (action === "room-details") {
      if (!body.roomId) throw new Error("A valid room is required");
      await db
        .update(hostelRooms)
        .set({
          roomLabel: asText(body.roomLabel),
          roomType: asText(body.roomType, "single"),
          bathroomType: asText(body.bathroomType, "unknown"),
        })
        .where(eq(hostelRooms.id, asNumber(body.roomId)));
      if (asText(body.roomType) === "single") {
        const room = (
          await db.execute<{ room_label: string; unit_code: string }>(sql`
          SELECT r.room_label, u.unit_code FROM hostel_rooms r
          JOIN hostel_units u ON r.unit_id=u.id WHERE r.id=${asNumber(body.roomId)}
        `)
        )[0];
        const roomBeds = await db.execute<{
          id: number;
          legacy_code: string;
          assignments: number;
        }>(sql`
          SELECT b.id, b.legacy_code,
            (SELECT COUNT(*) FROM accommodation_assignments a WHERE a.bed_space_id=b.id) assignments
          FROM bed_spaces b WHERE b.room_id=${asNumber(body.roomId)} ORDER BY b.id
        `);
        if (roomBeds.length > 1) {
          const removable = roomBeds.slice(1);
          if (removable.some((bed) => Number(bed.assignments) > 0))
            throw new Error(
              "This room cannot become single until the extra bed assignment history is cleared",
            );
          await runBatches(db, removable, (bed, tx) =>
            tx.execute(sql`DELETE FROM bed_spaces WHERE id=${bed.id}`),
          );
        }
        const first = roomBeds[0];
        if (first && room)
          await db.execute(
            sql`UPDATE bed_spaces SET bed_label='1', legacy_code=${`${room.unit_code}-${room.room_label}1`} WHERE id=${first.id}`,
          );
      }
    } else if (action === "room-delete") {
      const roomId = asNumber(body.roomId);
      if (!roomId) throw new Error("Room is required");
      const used = (
        await db.execute<{ total: number }>(sql`
        SELECT COUNT(*) total FROM accommodation_assignments
        WHERE bed_space_id IN (SELECT id FROM bed_spaces WHERE room_id=${roomId})
      `)
      )[0];
      if (Number(used?.total || 0) > 0)
        throw new Error("Rooms with assignment history cannot be deleted");
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM bed_spaces WHERE room_id=${roomId}`);
        await tx.execute(sql`DELETE FROM hostel_rooms WHERE id=${roomId}`);
      });
    } else if (action === "bed-delete") {
      const bedId = asNumber(body.bedId);
      if (!bedId) throw new Error("Room code is required");
      const used = (
        await db.execute<{ total: number }>(
          sql`SELECT COUNT(*) total FROM accommodation_assignments WHERE bed_space_id=${bedId}`,
        )
      )[0];
      if (Number(used?.total || 0) > 0)
        throw new Error(
          "A room code with assignment history cannot be deleted",
        );
      await db.delete(bedSpaces).where(eq(bedSpaces.id, bedId));
    } else if (action === "room-add") {
      if (!body.unitId || !asText(body.roomLabel))
        throw new Error("Unit and room category are required");
      const unit = (
        await db.execute<{ unit_code: string; hostel_id: number }>(
          sql`SELECT unit_code, hostel_id FROM hostel_units WHERE id = ${asNumber(body.unitId)}`,
        )
      )[0];
      if (!unit) throw new Error("Unit not found");
      const defaultRate = (
        await db
          .select({ monthlyRate: hostelCategoryRates.monthlyRate })
          .from(hostelCategoryRates)
          .where(
            and(
              eq(hostelCategoryRates.hostelId, Number(unit.hostel_id)),
              eq(hostelCategoryRates.roomCategory, asText(body.roomLabel)),
            ),
          )
      )[0];
      const room = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO hostel_rooms (unit_id, room_label, status, bathroom_type, room_type, sales_rate)
          VALUES (${asNumber(body.unitId)}, ${asText(body.roomLabel)}, 'active', ${asText(body.bathroomType, "unknown")}, ${asText(body.roomType, "single")}, ${defaultRate ? defaultRate.monthlyRate : null})
          RETURNING id
        `)
      )[0];
      if (!room) throw new Error("Unable to create room");
      const bedCount = Math.max(1, Math.min(5, asNumber(body.bedCount, 1)));
      const bedType = asText(body.bedType, "unknown");
      const prefix = asText(
        body.codePrefix,
        `${unit.unit_code}-${asText(body.roomLabel)}`,
      );
      await runBatches(
        db,
        Array.from({ length: bedCount }, (_, index) => ({
          label: String(index + 1),
          code: `${prefix}${bedCount === 1 ? "1" : index + 1}`,
        })),
        (bed, tx) =>
          tx.execute(
            sql`INSERT INTO bed_spaces (room_id, bed_label, legacy_code, status, bed_type) VALUES (${room.id}, ${bed.label}, ${bed.code}, 'vacant', ${bedType})`,
          ),
      );
      createdId = Number(room.id);
    } else if (action === "bulk-room-price") {
      const roomIds = Array.isArray(body.roomIds)
        ? body.roomIds
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (!roomIds.length) throw new Error("Select at least one vacant room");
      const field =
        asText(body.priceType, "standard") === "promotion"
          ? "promotion_rate"
          : "sales_rate";
      const rate = asNullableNumber(body.salesRate);
      if (rate === null || rate < 0)
        throw new Error("Enter a valid sales rate");
      await runBatches(db, roomIds, (roomId, tx) =>
        tx.execute(sql`
          UPDATE hostel_rooms
          SET ${sql.raw(field)} = ${rate},
              promotion_start_date = CASE WHEN ${field} = 'promotion_rate' THEN ${asNullableText(body.promotionStartDate)} ELSE promotion_start_date END,
              promotion_end_date = CASE WHEN ${field} = 'promotion_rate' THEN ${asNullableText(body.promotionEndDate)} ELSE promotion_end_date END
          WHERE id = ${roomId} AND EXISTS (SELECT 1 FROM bed_spaces WHERE room_id = ${roomId} AND status = 'vacant')
        `),
      );
      if (boolValue(body.setAsDefault) && body.hostelId && asText(body.roomCategory)) {
        await db
          .insert(hostelCategoryRates)
          .values({
            hostelId: asNumber(body.hostelId),
            roomCategory: asText(body.roomCategory),
            monthlyRate: rate,
          })
          .onConflictDoUpdate({
            target: [
              hostelCategoryRates.hostelId,
              hostelCategoryRates.roomCategory,
            ],
            set: {
              monthlyRate: rate,
              updatedAt: sql`(CURRENT_TIMESTAMP)::text`,
            },
          });
      }
    } else if (action === "promotion-end") {
      if (!body.hostelId) throw new Error("Hostel is required");
      const endDate = asText(
        body.endDate,
        new Date().toISOString().slice(0, 10),
      );
      const conditions = [
        sql`u.hostel_id = ${asNumber(body.hostelId)}`,
        sql`r2.promotion_rate IS NOT NULL`,
        sql`(r2.promotion_end_date IS NULL OR r2.promotion_end_date > ${endDate})`,
      ];
      if (asText(body.roomCategory, "any") !== "any")
        conditions.push(sql`r2.room_label = ${asText(body.roomCategory)}`);
      if (asText(body.roomType, "any") !== "any")
        conditions.push(sql`r2.room_type = ${asText(body.roomType)}`);
      await db.execute(sql`
        UPDATE hostel_rooms AS r SET promotion_end_date = ${endDate} WHERE r.id IN (
          SELECT r2.id FROM hostel_rooms r2 JOIN hostel_units u ON r2.unit_id=u.id
          WHERE ${sql.join(conditions, sql` AND `)}
        )
      `);
    } else if (action === "system-setting-update") {
      const settingKey = asText(body.settingKey);
      if (!settingKey) throw new Error("Setting key is required");
      const settingValue = asText(body.settingValue);
      await db
        .insert(systemSettings)
        .values({ settingKey, settingValue, updatedAt: nowIso() })
        .onConflictDoUpdate({
          target: systemSettings.settingKey,
          set: { settingValue, updatedAt: nowIso() },
        });
      if (settingKey.startsWith("auto-billing")) resetScheduledBillingGuard();
    } else if (action === "meter-rates") {
      // Property address, owner charges and utility rates all live under
      // Maintenance now — Maintenance owns the meters these rates get
      // billed against, and the address/cleaning fee moved along with them.
      if (!body.hostelId) throw new Error("Hostel is required");
      await db
        .update(hostelProperties)
        .set({
          address: asText(body.address),
          monthlyCleaningFee: asNumber(body.monthlyCleaningFee),
          electricityRate: asNumber(body.electricityRate),
          monthlyWaterDispenserFee: asNumber(body.monthlyWaterDispenserFee),
        })
        .where(eq(hostelProperties.id, asNumber(body.hostelId)));
    } else if (action === "unit-service") {
      if (!body.unitId) throw new Error("Unit is required");
      await db.insert(unitServices).values({
        unitId: asNumber(body.unitId),
        serviceType: "wifi",
        accountHolderName: asText(body.accountHolderName),
        provider: asText(body.provider),
        accountReference: asText(body.accountReference),
        lineType: asText(body.lineType, "main"),
        contractEndDate: asNullableText(body.contractEndDate),
        servicePackage: asText(body.servicePackage),
        username: asText(body.username),
        password: asText(body.password),
        remarks: asText(body.remarks),
        status: asText(body.status, "active"),
        surrenderAction: asText(body.surrenderAction, "review"),
        notes: asText(body.notes),
      });
    } else if (action === "service-update") {
      if (!body.serviceId) throw new Error("Wi-Fi record is required");
      await db
        .update(unitServices)
        .set({
          accountHolderName: asText(body.accountHolderName),
          provider: asText(body.provider),
          accountReference: asText(body.accountReference),
          contractEndDate: asNullableText(body.contractEndDate),
          lineType: asText(body.lineType, "main"),
          servicePackage: asText(body.servicePackage),
          username: asText(body.username),
          surrenderAction: asText(body.surrenderAction, "review"),
          status: asText(body.status, "active"),
          remarks: asText(body.remarks),
          ...(asText(body.password) ? { password: asText(body.password) } : {}),
        })
        .where(eq(unitServices.id, asNumber(body.serviceId)));
    } else if (action === "service-delete") {
      if (!body.serviceId) throw new Error("Wi-Fi record is required");
      await db
        .delete(unitServices)
        .where(eq(unitServices.id, asNumber(body.serviceId)));
    } else if (action === "reservation" || action === "reservation-update") {
      if (!asText(body.studentName) || !body.targetMoveInDate)
        throw new Error(
          "Student / representative name and check-in date are required",
        );
      // paymentStatus / inventoryCommitted / amountPaid are deliberately NOT
      // part of this object either. The reservation form no longer collects
      // payment at all — money is recorded afterwards by ticking charges in
      // Manage — so recomputeReservationPaymentStatus below is the only
      // thing that sets them, derived from money actually received.
      //
      // status is deliberately NOT part of this shared object — status
      // transitions (reserved -> converted/cancelled) only ever happen via
      // the dedicated reservation-convert/reservation-cancel actions. The
      // edit form has no status field, so folding a status default in here
      // would silently flip an already-converted reservation back to
      // "reserved" on every save.
      const values = {
        studentName: asText(body.studentName),
        reservationType: asText(body.reservationType, "individual"),
        representativeType: asText(body.representativeType, "person"),
        salesPerson: asText(body.salesPerson),
        groupSize: Math.max(1, asNumber(body.groupSize, 1)),
        preferredHostelId: asNullableNumber(body.preferredHostelId),
        preferredUnitId: asNullableNumber(body.preferredUnitId),
        preferredGender: asText(body.preferredGender, "unspecified"),
        roomCategory: asText(body.roomCategory, "any"),
        roomType: asText(body.roomType, "any"),
        bathroomType: asText(body.bathroomType, "any"),
        contactNumber: asText(body.contactNumber),
        email: asText(body.email),
        identityNo: asText(body.identityNo),
        dateOfBirth: asNullableText(body.dateOfBirth),
        nationality: asText(body.nationality),
        nationalityOther: asText(body.nationalityOther),
        state: asText(body.state),
        hometown: asText(body.hometown),
        school: asText(body.school),
        course: asText(body.course),
        race: asText(body.race),
        raceOther: asText(body.raceOther),
        religion: asText(body.religion),
        religionOther: asText(body.religionOther),
        targetMoveInDate: asText(body.targetMoveInDate),
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        notes: asText(body.notes),
      };
      let reservationId = asNumber(body.reservationId);
      if (action === "reservation-update") {
        if (!reservationId) throw new Error("Reservation is required");
        await db
          .update(reservations)
          .set(values)
          .where(eq(reservations.id, reservationId));
      } else {
        const inserted = await db
          .insert(reservations)
          .values({
            referenceNo: `RSV-${Date.now().toString().slice(-9)}`,
            ...values,
            status: asText(body.status, "reserved"),
            amountPaid: 0,
            totalPayable: 0,
            paymentReference: "",
          })
          .returning({ id: reservations.id });
        reservationId = inserted[0].id;
        createdId = reservationId;
      }
      const totalPayable = await replaceReservationCharges(
        db,
        reservationId,
        body.chargeBreakdown,
      );
      // Creating or editing a reservation never records money — that only
      // happens by ticking charges in Manage — so amountPaid is simply
      // whatever payments already exist, recomputed just below.
      const amountPaid = Number(
        (
          await db.execute<{ total: number }>(
            sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
          )
        )[0]?.total || 0,
      );
      await db
        .update(reservations)
        .set({
          totalPayable,
          amountPaid,
        })
        .where(eq(reservations.id, reservationId));

      // One-way sync: once a reservation has already converted into a real
      // tenancy, editing the reservation afterwards (e.g. fixing a typo'd
      // IC, or updating the agreed deposit) pushes those corrections onto
      // the live student/assignment record. The reverse never happens —
      // day-to-day edits in Student Information (phone number, room
      // change, ...) do not rewrite this historical booking record.
      if (action === "reservation-update") {
        const linkedAssignment = (
          await db.execute<{ id: number; student_id: number; bed_space_id: number }>(
            sql`SELECT id, student_id, bed_space_id FROM accommodation_assignments WHERE source_reservation_id = ${reservationId} AND status = 'active'`,
          )
        )[0];
        if (linkedAssignment) {
          await db
            .update(studentProfiles)
            .set({
              fullName: values.studentName,
              identityNo: values.identityNo,
              dateOfBirth: values.dateOfBirth,
              gender: values.preferredGender,
              contactNumber: values.contactNumber,
              email: values.email,
              nationality: values.nationality,
              nationalityOther: values.nationalityOther,
              state: values.state,
              hometown: values.hometown,
              school: values.school,
              course: values.course,
              race: values.race,
              raceOther: values.raceOther,
              religion: values.religion,
              religionOther: values.religionOther,
            })
            .where(eq(studentProfiles.id, linkedAssignment.student_id));

          const charges = await db.execute<{
            charge_type: string;
            amount: number;
          }>(
            sql`SELECT charge_type, amount FROM reservation_charges WHERE reservation_id = ${reservationId}`,
          );
          // Sum every row of the type: a charge part-paid before a room
          // change lives as a paid row plus a top-up row, and undefined
          // must still mean "no such charge" so the caller skips it.
          const chargeAmount = (type: string) => {
            const rows = charges.filter((row) => row.charge_type === type);
            return rows.length
              ? rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
              : undefined;
          };
          const firstMonthRental = chargeAmount("first-month-rental");
          const securityDeposit = chargeAmount("deposit");
          const accessCardDeposit = chargeAmount("access-card-deposit");
          const assignmentUpdate: Record<string, number> = {};
          if (firstMonthRental !== undefined && Number(firstMonthRental) > 0)
            assignmentUpdate.monthlyRental = firstMonthRental;
          if (securityDeposit !== undefined)
            assignmentUpdate.securityDeposit = securityDeposit;
          if (accessCardDeposit !== undefined)
            assignmentUpdate.accessCardDeposit = accessCardDeposit;
          if (Object.keys(assignmentUpdate).length)
            await db
              .update(accommodationAssignments)
              .set(assignmentUpdate)
              .where(eq(accommodationAssignments.id, linkedAssignment.id));
        }
      }
      // Creating or editing a reservation rewrites its charge rows, so
      // re-apply whatever money is on record to them and push the result to
      // Finance. Without this an initial payment leaves every charge showing
      // unpaid, and an edit leaves the invoice billing the pre-edit amounts.
      await autoAllocatePaidCharges(db, reservationId);
      await recomputeReservationPaymentStatus(db, reservationId);
      await syncMoveInInvoice(db, reservationId, currentUser.displayName);
    } else if (action === "reservation-payment") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      const chargeIds = (
        Array.isArray(body.chargeIds) ? body.chargeIds : []
      ).map((id) => Number(id));
      const { paymentId, amount } = await addChargeLinkedReservationPayment(
        db,
        reservationId,
        chargeIds,
        body,
      );
      await recomputeReservationPaymentStatus(db, reservationId);
      await db
        .update(reservations)
        .set({ paymentReference: asText(body.paymentReference) })
        .where(eq(reservations.id, reservationId));
      createdId = paymentId;
      // Mirror the money onto the linked move-in invoice (creating it and
      // back-filling any earlier payment Finance never saw) so the invoice,
      // its line items and its paid figure all match the reservation.
      if (amount > 0) await syncMoveInInvoice(db, reservationId, currentUser.displayName);
      linkedPaymentId = (
        await db
          .select({ id: reservationPayments.linkedInvoicePaymentId })
          .from(reservationPayments)
          .where(eq(reservationPayments.id, paymentId!))
      )[0]?.id ?? undefined;
    } else if (action === "reservation-finance-review") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      await db
        .update(reservations)
        .set({ financeReviewedAt: nowIso() })
        .where(eq(reservations.id, reservationId));
    } else if (action === "payment-delete") {
      const reservationId = asNumber(body.reservationId);
      const paymentId = asNumber(body.paymentId);
      if (!reservationId || !paymentId)
        throw new Error("Reservation and payment are required");
      const payment = (
        await db
          .select()
          .from(reservationPayments)
          .where(
            and(
              eq(reservationPayments.id, paymentId),
              eq(reservationPayments.reservationId, reservationId),
            ),
          )
      )[0];
      if (!payment) throw new Error("Payment not found");
      // Deleting the payment is the correction path for a mistaken entry
      // (wrong charges selected, wrong slip) — unlock whatever charges it
      // had locked so they go back to being selectable.
      await db
        .update(reservationCharges)
        .set({ paidAt: null, paymentId: null })
        .where(eq(reservationCharges.paymentId, paymentId));
      // Charges auto-covered from leftover credit (paidAt set, no payment
      // link) have to be released too — the money backing them may be the
      // very payment being deleted. autoAllocatePaidCharges below re-covers
      // whatever the remaining payments still stretch to.
      await db
        .update(reservationCharges)
        .set({ paidAt: null })
        .where(
          and(
            eq(reservationCharges.reservationId, reservationId),
            isNotNull(reservationCharges.paidAt),
            isNull(reservationCharges.paymentId),
          ),
        );
      await db
        .delete(reservationPayments)
        .where(eq(reservationPayments.id, paymentId));
      // Drop the mirrored Finance record too, otherwise it survives as an
      // orphan with nothing linking it back and gets counted twice.
      if (payment.linkedInvoicePaymentId)
        await db
          .delete(billingPaymentRecords)
          .where(eq(billingPaymentRecords.id, payment.linkedInvoicePaymentId));
      await autoAllocatePaidCharges(db, reservationId);
      await recomputeReservationPaymentStatus(db, reservationId);
      await syncMoveInInvoice(db, reservationId, currentUser.displayName);
    } else if (action === "payment-update") {
      const reservationId = asNumber(body.reservationId);
      const paymentId = asNumber(body.paymentId);
      const amount = asNullableNumber(body.amount);
      if (!reservationId || !paymentId || amount === null || amount < 0)
        throw new Error(
          "Reservation, payment and a valid amount are required",
        );
      const payment = (
        await db
          .select()
          .from(reservationPayments)
          .where(
            and(
              eq(reservationPayments.id, paymentId),
              eq(reservationPayments.reservationId, reservationId),
            ),
          )
      )[0];
      if (!payment) throw new Error("Payment not found");
      await db
        .update(reservationPayments)
        .set({ amount })
        .where(eq(reservationPayments.id, paymentId));
      // The correction is to this payment's own recorded amount only — it
      // doesn't change which charges are ticked, but the mirrored Finance
      // record and the invoice totals both have to follow it.
      if (payment.linkedInvoicePaymentId)
        await db
          .update(billingPaymentRecords)
          .set({ amount, verifiedAmount: amount })
          .where(eq(billingPaymentRecords.id, payment.linkedInvoicePaymentId));
      await recomputeReservationPaymentStatus(db, reservationId);
      await syncMoveInInvoice(db, reservationId, currentUser.displayName);
    } else if (action === "reservation-delete") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      // Converting a reservation creates a student, a tenancy, a held room
      // and a move-in invoice. Deleting only the sales-side rows left all of
      // that behind — the room stayed 'reserved' forever with nothing left
      // pointing at it, because source_reservation_id is a plain column with
      // no cascade. Everything the conversion made is undone here too.
      const tenancy = (
        await db.execute<{
          id: number;
          student_id: number;
          bed_space_id: number;
          checked_in_at: string | null;
        }>(sql`
          SELECT id, student_id, bed_space_id, checked_in_at
          FROM accommodation_assignments
          WHERE source_reservation_id = ${reservationId}
        `)
      )[0];

      if (tenancy) {
        // Past this point the record stops being a booking and becomes a
        // resident's history, which a delete must not quietly erase.
        if (tenancy.checked_in_at)
          throw new Error(
            "This student has already checked in — move them out instead of deleting the booking",
          );
        const settled = (
          await db.execute<{ paid: number; payments: number }>(sql`
            SELECT COALESCE(SUM(i.amount_paid), 0) paid,
                   (SELECT COUNT(*)::int FROM billing_payment_records p
                     WHERE p.invoice_id IN (SELECT id FROM billing_invoices WHERE student_id = ${tenancy.student_id})) payments
            FROM billing_invoices i WHERE i.student_id = ${tenancy.student_id}
          `)
        )[0];
        if (Number(settled?.paid || 0) > 0 || Number(settled?.payments || 0) > 0)
          throw new Error(
            "Money has already been collected against this tenancy — cancel it or move the student out instead of deleting",
          );
        const billed = (
          await db.execute<{ count: number }>(sql`
            SELECT COUNT(*)::int count FROM billing_invoices
            WHERE student_id = ${tenancy.student_id} AND cycle_id IS NOT NULL
          `)
        )[0];
        if (Number(billed?.count || 0) > 0)
          throw new Error(
            "This tenancy already appears on a monthly bill — delete that invoice first, or move the student out instead",
          );
      }

      await db.transaction(async (tx) => {
        if (tenancy) {
          const invoiceIds = (
            await tx.execute<{ id: number }>(
              sql`SELECT id FROM billing_invoices WHERE student_id = ${tenancy.student_id}`,
            )
          ).map((row) => Number(row.id));
          if (invoiceIds.length) {
            await tx.execute(
              sql`DELETE FROM billing_items WHERE invoice_id IN (${sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `)})`,
            );
            await tx.execute(
              sql`DELETE FROM billing_invoices WHERE id IN (${sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `)})`,
            );
          }
          await tx.execute(
            sql`DELETE FROM deposit_adjustments WHERE assignment_id = ${tenancy.id}`,
          );
          await tx.execute(
            sql`DELETE FROM student_rate_changes WHERE assignment_id = ${tenancy.id}`,
          );
          await tx.execute(
            sql`DELETE FROM accommodation_assignments WHERE source_reservation_id = ${reservationId}`,
          );
          // The room goes back on sale. 'vacant' rather than whatever it was
          // before: a booking is the only thing that had been holding it.
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'vacant', updated_at = ${nowIso()} WHERE id = ${tenancy.bed_space_id}`,
          );
          // Only a profile this conversion created goes with it — one that
          // existed beforehand, or that has any other tenancy, stays.
          await tx.execute(sql`
            DELETE FROM student_profiles
            WHERE id = ${tenancy.student_id}
              AND source_key = ${`reservation:${reservationId}`}
              AND NOT EXISTS (SELECT 1 FROM accommodation_assignments a WHERE a.student_id = ${tenancy.student_id})
          `);
        }
        // Charges first: reservation_charges.payment_id points AT a payment,
        // so removing the payments first violates that key and the whole
        // delete rolls back. Any reservation with a recorded payment was
        // therefore impossible to delete.
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservations WHERE id = ${reservationId}`,
        );
      });
    } else if (action === "reservation-cancel") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      // Cancelling a booking that had already converted has to give the room
      // back — the confirmation says so, but only the reservation's own
      // status was ever changed, leaving the room held and a tenancy running
      // for a booking that no longer exists. Unlike delete, the reservation
      // and its payment history stay: that is the whole point of cancelling
      // rather than deleting.
      const converted = (
        await db.execute<{
          id: number;
          student_id: number;
          bed_space_id: number;
          checked_in_at: string | null;
        }>(sql`
          SELECT id, student_id, bed_space_id, checked_in_at
          FROM accommodation_assignments
          WHERE source_reservation_id = ${reservationId} AND status = 'active'
        `)
      )[0];
      if (converted?.checked_in_at)
        throw new Error(
          "This student has already checked in — move them out instead of cancelling the booking",
        );
      await db.transaction(async (tx) => {
        if (converted) {
          await tx.execute(sql`
            UPDATE accommodation_assignments
            SET status = 'ended', check_out_date = COALESCE(check_out_date, ${todayInKL()})
            WHERE id = ${converted.id}
          `);
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'vacant', updated_at = ${nowIso()} WHERE id = ${converted.bed_space_id}`,
          );
          // Otherwise the profile sits in Active students with no room —
          // the contradictory state the tenant list has to flag separately.
          await tx.execute(sql`
            UPDATE student_profiles SET status = 'moved-out'
            WHERE id = ${converted.student_id}
              AND source_key = ${`reservation:${reservationId}`}
          `);
        }
        await tx.execute(sql`
          UPDATE reservations
          SET status = 'cancelled', cancelled_at = ${nowIso()}, inventory_committed = false
          WHERE id = ${reservationId}
        `);
      });
    } else if (action === "reservation-convert") {
      const reservationId = asNumber(body.reservationId);
      const reservation = (
        await db
          .select()
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.reservationType === "group") {
        if (!body.unitId) throw new Error("Select the confirmed unit / house");
        await db
          .update(reservations)
          .set({
            preferredUnitId: asNumber(body.unitId),
            status: "converted",
            convertedAt: nowIso(),
          })
          .where(eq(reservations.id, reservationId));
      } else {
        const bedId = asNumber(
          body.bedSpaceId || reservation.provisionalBedSpaceId,
        );
        if (!bedId) throw new Error("Select the actual room code manually");
        // Same promotion-window rule as the Availability picker's
        // effectiveRate(): an active promotion (covering the move-in date)
        // wins over the room's regular sales rate. This is only the
        // fallback — a recorded "first month advance rental" charge below
        // is the actual agreed rate and takes priority when present.
        const roomRate = (
          await db.execute<{
            sales_rate: number | null;
            promotion_rate: number | null;
            promotion_start_date: string | null;
            promotion_end_date: string | null;
            bed_monthly_rental: number | null;
          }>(sql`
            SELECT r.sales_rate, r.promotion_rate, r.promotion_start_date, r.promotion_end_date, b.monthly_rental bed_monthly_rental
            FROM bed_spaces b JOIN hostel_rooms r ON r.id = b.room_id
            WHERE b.id = ${bedId}
          `)
        )[0];
        const promotionActive =
          roomRate?.promotion_rate !== null &&
          roomRate?.promotion_rate !== undefined &&
          (!roomRate.promotion_start_date ||
            roomRate.promotion_start_date <= reservation.targetMoveInDate) &&
          (!roomRate.promotion_end_date ||
            roomRate.promotion_end_date >= reservation.targetMoveInDate);
        const roomDerivedRental = promotionActive
          ? roomRate!.promotion_rate
          : (roomRate?.sales_rate ?? roomRate?.bed_monthly_rental ?? null);
        // The reservation's Payment step already collected specific charges
        // (deposit, access card deposit, first month rental, ...) — carry
        // those actual figures onto the assignment instead of leaving them
        // to be re-entered from scratch.
        const charges = await db.execute<{
          charge_type: string;
          amount: number;
        }>(
          sql`SELECT charge_type, amount FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        const chargeAmount = (type: string) => {
          const rows = charges.filter((row) => row.charge_type === type);
          return rows.length
            ? rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
            : undefined;
        };
        const firstMonthRental = chargeAmount("first-month-rental");
        const monthlyRental =
          firstMonthRental && Number(firstMonthRental) > 0
            ? firstMonthRental
            : roomDerivedRental;
        const securityDeposit = chargeAmount("deposit") ?? null;
        const accessCardDeposit = chargeAmount("access-card-deposit") ?? null;
        const key = `reservation:${reservationId}`;
        await db.execute(sql`
          INSERT INTO student_profiles (source_key, student_code, full_name, identity_no, date_of_birth, gender, contact_number, email, nationality, nationality_other, state, hometown, school, course, race, race_other, religion, religion_other, salesperson, status)
          VALUES (${key}, ${`STU-${reservationId}`}, ${reservation.studentName}, ${reservation.identityNo}, ${reservation.dateOfBirth}, ${reservation.preferredGender}, ${reservation.contactNumber}, ${reservation.email}, ${reservation.nationality}, ${reservation.nationalityOther}, ${reservation.state}, ${reservation.hometown}, ${reservation.school}, ${reservation.course}, ${reservation.race}, ${reservation.raceOther}, ${reservation.religion}, ${reservation.religionOther}, ${reservation.salesPerson}, 'active')
          ON CONFLICT DO NOTHING
        `);
        const student = (
          await db.execute<{ id: number }>(
            sql`SELECT id FROM student_profiles WHERE source_key = ${key}`,
          )
        )[0];
        if (!student) throw new Error("Unable to create student profile");
        await db.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, salesperson, check_in_date, agreement_start_date, status, remarks, source_reservation_id)
          VALUES (${key}, ${student.id}, ${bedId}, ${monthlyRental}, ${securityDeposit}, ${accessCardDeposit}, ${reservation.salesPerson}, ${reservation.targetMoveInDate}, ${reservation.targetMoveInDate}, 'active', ${reservation.notes}, ${reservationId})
          ON CONFLICT DO NOTHING
        `);
        const now = nowIso();
        await db.transaction(async (tx) => {
          // 'reserved', not 'occupied': the booking now holds this bed so
          // nobody else can be sold it, but the student hasn't physically
          // moved in — that's the separate check-in step, which is what
          // flips it to 'occupied'.
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'reserved', updated_at = ${now} WHERE id = ${bedId}`,
          );
          await tx.execute(
            sql`UPDATE reservations SET assigned_bed_space_id = ${bedId}, status = 'converted', converted_at = ${now} WHERE id = ${reservationId}`,
          );
        });
        // Every charge collected during the reservation's Payment step
        // (deposit, access card deposit, admin fee, ...) becomes one
        // itemised line on a one-time "move-in costs" invoice, and any
        // payment taken before conversion is mirrored across so Finance
        // sees each one rather than a single opaque figure.
        await syncMoveInInvoice(db, reservationId, currentUser.displayName);
      }
    } else if (action === "reservation-room-change") {
      // Swaps the actual room on an already-converted reservation (e.g. the
      // student wants a different room after paying and converting, before
      // move-in settles in). Unlike student-room-change (which retires the
      // old assignment and starts a fresh one, for an ongoing tenant moving
      // mid-stay), this updates the existing assignment in place — the
      // source_reservation_id link the Edit-reservation sync depends on
      // must survive the room change. The new room's monthly rental /
      // security deposit / access card deposit replace the old ones in
      // reservation_charges (other charge types — admin fee, stamping fee,
      // etc. — are untouched), and totalPayable/paymentStatus are
      // recomputed so the balance-required / credit figure on the
      // reservation reflects the new room honestly.
      const reservationId = asNumber(body.reservationId);
      const newBedId = asNumber(body.bedSpaceId);
      if (!reservationId || !newBedId)
        throw new Error("Reservation and new room are required");
      const reservation = (
        await db
          .select()
          .from(reservations)
          .where(eq(reservations.id, reservationId))
      )[0];
      if (!reservation) throw new Error("Reservation not found");
      if (reservation.status !== "converted")
        throw new Error("Only converted reservations can change rooms");
      const assignment = (
        await db.execute<{
          id: number;
          bed_space_id: number;
          checked_in_at: string | null;
        }>(
          sql`SELECT id, bed_space_id, checked_in_at FROM accommodation_assignments WHERE source_reservation_id = ${reservationId} AND status = 'active'`,
        )
      )[0];
      if (!assignment)
        throw new Error("No active room assignment found for this reservation");
      const oldBedId = Number(assignment.bed_space_id);
      if (oldBedId === newBedId) throw new Error("Select a different room");
      const newBed = (
        await db.select().from(bedSpaces).where(eq(bedSpaces.id, newBedId))
      )[0];
      if (!newBed) throw new Error("Selected room not found");
      if (newBed.status !== "vacant")
        throw new Error("Selected room is no longer vacant");
      const monthlyRental = asNumber(body.monthlyRental, 0);
      const securityDeposit = asNumber(body.securityDeposit, 0);
      const accessCardDeposit = asNumber(body.accessCardDeposit, 0);
      const roomTransferFee = asNumber(body.roomTransferFee, 0);
      const now = nowIso();
      // What the student has already settled per room-tied charge, so the
      // replacement below can keep that portion paid and only bill the
      // increase instead of resetting the whole line to unpaid.
      const roomTiedTypes = [
        "first-month-rental",
        "deposit",
        "access-card-deposit",
      ];
      const paidByType = new Map<string, number>();
      for (const charge of await db
        .select()
        .from(reservationCharges)
        .where(
          and(
            eq(reservationCharges.reservationId, reservationId),
            inArray(reservationCharges.chargeType, roomTiedTypes),
          ),
        ))
        if (charge.paidAt)
          paidByType.set(
            charge.chargeType,
            (paidByType.get(charge.chargeType) || 0) + Number(charge.amount || 0),
          );
      // Changing room does not move the student in. If they had not arrived
      // yet the new room is still only being held for them, so it takes the
      // same 'reserved' status the old one had — marking it 'occupied' both
      // overstated occupancy and made the Check in action disappear, since
      // that is what a held-but-empty room is recognised by.
      const newBedStatus = assignment.checked_in_at ? "occupied" : "reserved";
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE bed_spaces SET status = 'vacant', updated_at = ${now} WHERE id = ${oldBedId}`,
        );
        await tx.execute(
          sql`UPDATE bed_spaces SET status = ${newBedStatus}, updated_at = ${now} WHERE id = ${newBedId}`,
        );
        await tx.execute(
          sql`UPDATE accommodation_assignments SET bed_space_id = ${newBedId}, monthly_rental = ${monthlyRental}, security_deposit = ${securityDeposit}, access_card_deposit = ${accessCardDeposit}, expected_return_date = ${asNullableText(body.expectedReturnDate)} WHERE id = ${assignment.id}`,
        );
        await tx.execute(
          sql`UPDATE reservations SET assigned_bed_space_id = ${newBedId} WHERE id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId} AND charge_type IN ('first-month-rental', 'deposit', 'access-card-deposit')`,
        );
        const newCharges = [
          { type: "first-month-rental", amount: monthlyRental },
          { type: "deposit", amount: securityDeposit },
          { type: "access-card-deposit", amount: accessCardDeposit },
        ].filter((row) => row.amount > 0);
        for (const row of newCharges) {
          // Never bill more than the new amount, so moving to a cheaper room
          // shrinks the line to the new price and the surplus shows up as
          // overall credit rather than an inflated "paid" figure.
          const alreadyPaid = Math.min(
            paidByType.get(row.type) || 0,
            row.amount,
          );
          if (alreadyPaid > 0)
            await tx.execute(
              sql`INSERT INTO reservation_charges (reservation_id, charge_type, amount, paid_at) VALUES (${reservationId}, ${row.type}, ${alreadyPaid}, ${now})`,
            );
          const topUp = row.amount - alreadyPaid;
          if (topUp > 0)
            await tx.execute(
              sql`INSERT INTO reservation_charges (reservation_id, charge_type, amount, notes) VALUES (${reservationId}, ${row.type}, ${topUp}, ${alreadyPaid > 0 ? CHARGE_TOPUP_NOTE : ""})`,
            );
        }
        // A room-transfer fee is charged (or not) per room change, on top
        // of whatever the reservation already carries — it isn't a
        // replacement like the three above, so it just adds a new row when
        // staff opts to charge it.
        if (roomTransferFee > 0)
          await tx.execute(
            sql`INSERT INTO reservation_charges (reservation_id, charge_type, amount) VALUES (${reservationId}, 'room-transfer-fee', ${roomTransferFee})`,
          );
      });
      const totalPayableRow = (
        await db.execute<{ total: number }>(
          sql`SELECT COALESCE(SUM(amount),0) total FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        )
      )[0];
      const totalPayable = Number(totalPayableRow?.total || 0);
      await db
        .update(reservations)
        .set({ totalPayable })
        .where(eq(reservations.id, reservationId));
      // The room-tied charges were just replaced at the new room's rate, so
      // they came back unpaid — but the student's money is still on record.
      // Re-apply it to the new charges so nothing is lost, leaving only the
      // genuine difference as credit (overpaid) or a shortfall (underpaid).
      await autoAllocatePaidCharges(db, reservationId);
      await recomputeReservationPaymentStatus(db, reservationId);
      // Keep the linked move-in invoice showing the room they're actually
      // in — otherwise Finance keeps billing the old room's rate and the
      // over/under-payment shown there contradicts the reservation.
      await syncMoveInInvoice(db, reservationId, currentUser.displayName);
    } else if (action === "student-update") {
      const studentId = asNumber(body.studentId);
      if (!studentId) throw new Error("Student is required");
      await db
        .update(studentProfiles)
        .set({
          studentCode: asText(body.studentCode),
          fullName: asText(body.fullName),
          identityNo: asText(body.identityNo),
          contactNumber: asText(body.contactNumber),
          email: asText(body.email),
          dateOfBirth: asNullableText(body.dateOfBirth),
          gender: asText(body.gender, "unspecified"),
          race: asText(body.race),
          raceOther: asText(body.raceOther),
          religion: asText(body.religion),
          religionOther: asText(body.religionOther),
          nationality: asText(body.nationality),
          nationalityOther: asText(body.nationalityOther),
          state: asText(body.state),
          hometown: asText(body.hometown),
          course: asText(body.course),
          school: asText(body.school),
          applicationFormNo: asText(body.applicationFormNo),
          receiptNo: asText(body.receiptNo),
          salesperson: asText(body.salesperson),
          agency: asText(body.agency),
          remarks: asText(body.remarks),
          status: asText(body.profileStatus, "active"),
        })
        .where(eq(studentProfiles.id, studentId));
      if (["moved-out", "inactive"].includes(asText(body.profileStatus))) {
        const activeParking = await db
          .select()
          .from(parkingRentals)
          .where(
            and(
              eq(parkingRentals.studentId, studentId),
              eq(parkingRentals.status, "active"),
            ),
          );
        if (activeParking.length) {
          const checkOutDate = asText(
            body.checkOutDate,
            new Date().toISOString().slice(0, 10),
          );
          await runBatches(db, activeParking, (rental, tx) =>
            tx.execute(
              sql`UPDATE parking_rentals SET status='ended', end_date=COALESCE(end_date, ${checkOutDate}) WHERE id=${rental.id}`,
            ),
          );
          await runBatches(db, activeParking, (rental, tx) =>
            tx.execute(
              sql`UPDATE parking_lots SET status='available' WHERE id=${rental.parkingLotId}`,
            ),
          );
        }
      }
      if (body.assignmentId)
        await db
          .update(accommodationAssignments)
          .set({
            monthlyRental: asNullableNumber(body.monthlyRental),
            securityDeposit: asNullableNumber(body.securityDeposit),
            accessCardDeposit: asNullableNumber(body.accessCardDeposit),
            parkingDeposit: asNullableNumber(body.parkingDeposit),
            checkInDate: asNullableText(body.checkInDate),
            checkOutDate: asNullableText(body.checkOutDate),
            agreementStartDate: asNullableText(body.leaseStartDate),
            agreementEndDate: asNullableText(body.leaseEndDate),
          })
          .where(eq(accommodationAssignments.id, asNumber(body.assignmentId)));
    } else if (action === "assignment-renewal-apply") {
      const assignmentId = asNumber(body.assignmentId);
      if (!assignmentId) throw new Error("Assignment is required");
      await db
        .update(accommodationAssignments)
        .set({ renewalAppliedAt: nowIso() })
        .where(eq(accommodationAssignments.id, assignmentId));
    } else if (action === "assignment-clear-return-date") {
      // Resolves a temporary-room-change follow-up as "staying" — the
      // student never moved back, so the current room becomes permanent
      // and the pending-decision badge on the Converted tab stops
      // counting this assignment.
      const assignmentId = asNumber(body.assignmentId);
      if (!assignmentId) throw new Error("Assignment is required");
      await db
        .update(accommodationAssignments)
        .set({ expectedReturnDate: null })
        .where(eq(accommodationAssignments.id, assignmentId));
    } else if (action === "assignment-check-in") {
      // The student has physically arrived and taken the keys. Until now
      // their bed sat at 'reserved' — paid for and unsellable, but empty,
      // so Maintenance could still clean and inspect it. This flips it to
      // 'occupied' and records what actually happened on arrival day.
      const assignmentId = asNumber(body.assignmentId);
      if (!assignmentId) throw new Error("Assignment is required");
      const assignment = (
        await db
          .select()
          .from(accommodationAssignments)
          .where(eq(accommodationAssignments.id, assignmentId))
      )[0];
      if (!assignment) throw new Error("Assignment not found");
      if (assignment.checkedInAt)
        throw new Error("This student has already been checked in");
      if (assignment.status !== "active")
        throw new Error("Only an active tenancy can be checked in");
      // Enforced here, not just in the form: without an opening reading,
      // billing has no baseline and charges this tenant from the room's
      // previous reading — i.e. for the last occupant's usage, before they
      // ever arrived. A check-in that skipped it was the one way to create
      // that charge silently.
      const openingMeter = asNullableNumber(body.checkInMeter);
      if (openingMeter === null)
        throw new Error(
          "An opening meter reading is required — it is the baseline utility billing charges from",
        );
      if (openingMeter < 0)
        throw new Error("The opening meter reading cannot be negative");
      const arrivedOn = asText(
        body.checkInDate,
        new Date().toISOString().slice(0, 10),
      );
      const now = nowIso();
      await db.transaction(async (tx) => {
        // check_in_date until now held the *planned* move-in date carried
        // over from the booking; overwrite it with the real arrival date,
        // which is what billing and the tenancy record should reflect.
        await tx.execute(sql`
          UPDATE accommodation_assignments
          SET checked_in_at = ${now},
              check_in_date = ${arrivedOn},
              check_in_meter = ${openingMeter},
              remarks = CASE WHEN ${asText(body.remarks)} = '' THEN remarks
                             ELSE TRIM(BOTH E'\n' FROM remarks || E'\n' || ${asText(body.remarks)}) END
          WHERE id = ${assignmentId}
        `);
        await tx.execute(
          sql`UPDATE bed_spaces SET status = 'occupied', updated_at = ${now} WHERE id = ${assignment.bedSpaceId}`,
        );
      });
      // The opening reading doubles as this room's own recorded reading, so
      // the meter history and utility billing both see the same number.
      const bedRoom = (
        await db.execute<{ room_id: number }>(
          sql`SELECT room_id FROM bed_spaces WHERE id = ${assignment.bedSpaceId}`,
        )
      )[0];
      if (bedRoom)
        await db.execute(sql`
          INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
          VALUES (${assignment.bedSpaceId}, ${bedRoom.room_id}, ${arrivedOn}, ${openingMeter}, 'check-in', ${currentUser.displayName}, 'Opening reading taken at check-in')
        `);
    } else if (action === "student-create") {
      if (!asText(body.fullName)) throw new Error("Full name is required");
      const result = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO student_profiles (source_key, student_code, full_name, identity_no, contact_number, email, date_of_birth, gender, race, race_other, religion, religion_other, nationality, nationality_other, state, hometown, course, school, application_form_no, receipt_no, salesperson, agency, remarks, status)
          VALUES (${`manual:${Date.now()}`}, ${asText(body.studentCode)}, ${asText(body.fullName)}, ${asText(body.identityNo)}, ${asText(body.contactNumber)}, ${asText(body.email)}, ${asNullableText(body.dateOfBirth)}, ${asText(body.gender, "unspecified")}, ${asText(body.race)}, ${asText(body.raceOther)}, ${asText(body.religion)}, ${asText(body.religionOther)}, ${asText(body.nationality)}, ${asText(body.nationalityOther)}, ${asText(body.state)}, ${asText(body.hometown)}, ${asText(body.course)}, ${asText(body.school)}, ${asText(body.applicationFormNo)}, ${asText(body.receiptNo)}, ${asText(body.salesperson)}, ${asText(body.agency)}, ${asText(body.remarks)}, ${asText(body.profileStatus, "active")})
          RETURNING id
        `)
      )[0];
      const newStudentId = Number(result.id);
      createdId = newStudentId;
      if (body.bedSpaceId) {
        const bedId = asNumber(body.bedSpaceId);
        await db.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, parking_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, status)
          VALUES (${`manual:${newStudentId}:${Date.now()}`}, ${newStudentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asNullableNumber(body.parkingDeposit)}, ${asText(body.salesperson)}, ${asNullableText(body.checkInDate)}, ${asNullableText(body.leaseStartDate)}, ${asNullableText(body.leaseEndDate)}, 'active')
        `);
        await db.execute(
          sql`UPDATE bed_spaces SET status='occupied', updated_at=${nowIso()} WHERE id=${bedId}`,
        );
      }
    } else if (action === "student-assign") {
      const studentId = asNumber(body.studentId);
      const bedId = asNumber(body.bedSpaceId);
      if (!studentId || !bedId)
        throw new Error("Student and room are required");
      const bed = (
        await db.select().from(bedSpaces).where(eq(bedSpaces.id, bedId))
      )[0];
      if (!bed) throw new Error("Room not found");
      if (bed.status !== "vacant")
        throw new Error("Selected room is no longer vacant");
      const key = `assign:${studentId}:${Date.now()}`;
      const now = nowIso();
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, parking_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, status)
          VALUES (${key}, ${studentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asNullableNumber(body.parkingDeposit)}, ${asText(body.salesperson)}, ${asNullableText(body.checkInDate)}, ${asNullableText(body.leaseStartDate)}, ${asNullableText(body.leaseEndDate)}, 'active')
        `);
        await tx.execute(
          sql`UPDATE bed_spaces SET status='occupied', updated_at=${now} WHERE id=${bedId}`,
        );
      });
    } else if (action === "student-move-out") {
      const studentId = asNumber(body.studentId);
      if (!studentId) throw new Error("Student is required");
      const checkOut = asText(
        body.checkOutDate,
        new Date().toISOString().slice(0, 10),
      );
      if (body.assignmentId) {
        const assignment = (
          await db
            .select()
            .from(accommodationAssignments)
            .where(eq(accommodationAssignments.id, asNumber(body.assignmentId)))
        )[0];
        await db.execute(
          sql`UPDATE accommodation_assignments SET status='ended', check_out_date=COALESCE(check_out_date, ${checkOut}), check_out_meter=COALESCE(${asNullableNumber(body.checkOutMeter)}, check_out_meter) WHERE id=${asNumber(body.assignmentId)}`,
        );
        if (assignment?.bedSpaceId)
          await db.execute(
            sql`UPDATE bed_spaces SET status='vacant', updated_at=${nowIso()} WHERE id=${assignment.bedSpaceId}`,
          );
      }
      await db
        .update(studentProfiles)
        .set({ status: asText(body.profileStatus, "moved-out") })
        .where(eq(studentProfiles.id, studentId));
      const activeParking = await db
        .select()
        .from(parkingRentals)
        .where(
          and(
            eq(parkingRentals.studentId, studentId),
            eq(parkingRentals.status, "active"),
          ),
        );
      if (activeParking.length) {
        await runBatches(db, activeParking, (rental, tx) =>
          tx.execute(
            sql`UPDATE parking_rentals SET status='ended', end_date=COALESCE(end_date, ${checkOut}) WHERE id=${rental.id}`,
          ),
        );
        await runBatches(db, activeParking, (rental, tx) =>
          tx.execute(
            sql`UPDATE parking_lots SET status='available' WHERE id=${rental.parkingLotId}`,
          ),
        );
      }
    } else if (action === "school-create") {
      if (!asText(body.name)) throw new Error("School name is required");
      await db
        .insert(schools)
        .values({ name: asText(body.name) })
        .onConflictDoNothing();
    } else if (action === "school-update") {
      if (!body.schoolId || !asText(body.name))
        throw new Error("School and name are required");
      await db
        .update(schools)
        .set({ name: asText(body.name) })
        .where(eq(schools.id, asNumber(body.schoolId)));
    } else if (action === "school-delete") {
      if (!body.schoolId) throw new Error("School is required");
      await db.delete(schools).where(eq(schools.id, asNumber(body.schoolId)));
    } else if (action === "course-create") {
      if (!asText(body.name)) throw new Error("Course name is required");
      await db
        .insert(courses)
        .values({ name: asText(body.name), level: asText(body.level, "other") })
        .onConflictDoNothing();
    } else if (action === "course-update") {
      if (!body.courseId || !asText(body.name))
        throw new Error("Course and name are required");
      await db
        .update(courses)
        .set({ name: asText(body.name), level: asText(body.level, "other") })
        .where(eq(courses.id, asNumber(body.courseId)));
    } else if (action === "course-delete") {
      if (!body.courseId) throw new Error("Course is required");
      await db.delete(courses).where(eq(courses.id, asNumber(body.courseId)));
    } else if (action === "student-rate-change") {
      if (!body.assignmentId || !body.effectiveDate)
        throw new Error("Assignment and effective date are required");
      const assignmentId = asNumber(body.assignmentId);
      const effectiveDate = asText(body.effectiveDate);
      const newDeposit = asNullableNumber(body.securityDeposit);
      // What is on record as held right now — the newest change taking effect
      // on or before this one, falling back to the tenancy. Only the gap
      // between that and the new figure is ever owed; the money already held
      // stays held.
      const heldDeposit = await currentDepositFor(
        db,
        assignmentId,
        effectiveDate,
      );
      await db.insert(studentRateChanges).values({
        assignmentId,
        effectiveDate,
        monthlyRental: asNullableNumber(body.monthlyRental),
        securityDeposit: newDeposit,
        reason: asText(body.reason),
      });
      if (newDeposit !== null && heldDeposit !== null)
        await recordDepositAdjustment(db, {
          assignmentId,
          previousAmount: heldDeposit,
          newAmount: newDeposit,
          effectiveDate,
          source: "rate-change",
          reason: asText(body.reason),
          createdBy: currentUser.displayName,
        });
    } else if (action === "student-rate-change-delete") {
      // Scheduling is the only way to adjust rent, so a typo has to be
      // removable. Only a change that has not taken effect yet can go — once
      // it is live it may already have priced an issued invoice, and deleting
      // it would silently restate that invoice's basis.
      const changeId = asNumber(body.changeId);
      if (!changeId) throw new Error("Rate change is required");
      const change = (
        await db
          .select()
          .from(studentRateChanges)
          .where(eq(studentRateChanges.id, changeId))
      )[0];
      if (!change) throw new Error("Rate change not found");
      if (String(change.effectiveDate) <= todayInKL())
        throw new Error(
          "This rate change has already taken effect and may have priced an invoice. Schedule a new change instead.",
        );
      await db
        .delete(studentRateChanges)
        .where(eq(studentRateChanges.id, changeId));
    } else if (action === "student-room-change") {
      const studentId = asNumber(body.studentId),
        oldAssignmentId = asNumber(body.assignmentId),
        bedId = asNumber(body.bedSpaceId);
      if (!studentId || !oldAssignmentId || !bedId || !body.effectiveDate)
        throw new Error("Student, new room and effective date are required");
      const old = (
        await db
          .select()
          .from(accommodationAssignments)
          .where(eq(accommodationAssignments.id, oldAssignmentId))
      )[0];
      if (!old) throw new Error("Current assignment not found");
      const key = `move:${studentId}:${Date.now()}`;
      const changeNow = nowIso();
      // A move does not itself constitute arriving. Someone who has already
      // checked in stays checked in — the timestamp follows them onto the
      // replacement assignment, so they keep counting as a resident and stay
      // out of the awaiting-arrival list. Someone who had not arrived yet
      // still has not: the new room is held ('reserved'), not occupied, and
      // the Check in action stays available on it.
      const alreadyArrived = Boolean(old.checkedInAt);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE accommodation_assignments SET status='moved', check_out_date=${asText(body.effectiveDate)}, check_out_meter=${asNullableNumber(body.checkOutMeter)} WHERE id=${oldAssignmentId}`,
        );
        await tx.execute(
          sql`UPDATE bed_spaces SET status='vacant', updated_at=${changeNow} WHERE id=${old.bedSpaceId}`,
        );
        await tx.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, check_in_meter, remarks, status, source_reservation_id, checked_in_at)
          VALUES (${key}, ${studentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asText(body.salesperson)}, ${asText(body.effectiveDate)}, ${asText(body.effectiveDate)}, ${asNullableText(body.leaseEndDate)}, ${asNullableNumber(body.checkInMeter)}, ${asText(body.reason)}, 'active', ${old.sourceReservationId}, ${old.checkedInAt})
        `);
        await tx.execute(
          sql`UPDATE bed_spaces SET status=${alreadyArrived ? "occupied" : "reserved"}, updated_at=${changeNow} WHERE id=${bedId}`,
        );
      });
      // The new room's deposit replaces the old one, but the money already
      // held does not move — book only the difference so the next invoice
      // asks for the gap rather than a second full deposit.
      const movedAssignment = (
        await db.execute<{ id: number }>(
          sql`SELECT id FROM accommodation_assignments WHERE source_key = ${key}`,
        )
      )[0];
      const newRoomDeposit = asNullableNumber(body.securityDeposit);
      if (movedAssignment && newRoomDeposit !== null && old.securityDeposit !== null)
        await recordDepositAdjustment(db, {
          assignmentId: Number(movedAssignment.id),
          previousAmount: Number(old.securityDeposit),
          newAmount: newRoomDeposit,
          effectiveDate: asText(body.effectiveDate),
          source: "room-change",
          reason: asText(body.reason) || "Room change",
          createdBy: currentUser.displayName,
        });
      // The move-in invoice was attached to the assignment that just retired.
      // Hand it to the replacement so Finance keeps tracking this tenancy —
      // and so the invoice reports the room the student now lives in.
      if (old.sourceReservationId)
        await syncMoveInInvoice(
          db,
          Number(old.sourceReservationId),
          currentUser.displayName,
        );
    } else if (action === "parking-lot") {
      if (!body.hostelId || !asText(body.lotNumber))
        throw new Error("Hostel and parking lot number are required");
      await db.insert(parkingLots).values({
        hostelId: asNumber(body.hostelId),
        unitId: asNullableNumber(body.unitId),
        lotNumber: asText(body.lotNumber),
        status: asText(body.status, "available"),
        notes: asText(body.notes),
      });
    } else if (action === "parking-rental") {
      const tenantType = asText(body.tenantType, "in-house");
      let tenantName = asText(body.tenantName);
      let contactNumber = asText(body.contactNumber);
      let unitNumber = asText(body.unitNumber);
      if (tenantType === "in-house" && body.studentId) {
        const linked = (
          await db
            .select({
              fullName: studentProfiles.fullName,
              contactNumber: studentProfiles.contactNumber,
              unitCode: hostelUnits.unitCode,
            })
            .from(studentProfiles)
            .leftJoin(
              accommodationAssignments,
              and(
                eq(accommodationAssignments.studentId, studentProfiles.id),
                eq(accommodationAssignments.status, "active"),
              ),
            )
            .leftJoin(
              bedSpaces,
              eq(accommodationAssignments.bedSpaceId, bedSpaces.id),
            )
            .leftJoin(hostelRooms, eq(bedSpaces.roomId, hostelRooms.id))
            .leftJoin(hostelUnits, eq(hostelRooms.unitId, hostelUnits.id))
            .where(eq(studentProfiles.id, asNumber(body.studentId)))
        )[0];
        if (linked) {
          tenantName = linked.fullName;
          contactNumber = linked.contactNumber;
          unitNumber = linked.unitCode || "";
        }
      }
      if (!body.parkingLotId || !tenantName || !body.startDate)
        throw new Error("Parking lot, tenant name and start date are required");
      await db.insert(parkingRentals).values({
        parkingLotId: asNumber(body.parkingLotId),
        studentId: asNullableNumber(body.studentId),
        tenantType,
        tenantName,
        contactNumber,
        unitNumber,
        carPlateNumber: asText(body.carPlateNumber),
        carModel: asText(body.carModel),
        monthlyRental: asNumber(body.monthlyRental),
        depositAmount: asNumber(body.depositAmount),
        startDate: asText(body.startDate),
        endDate: asNullableText(body.endDate),
        paidUntil: asNullableText(body.paidUntil),
        billingFrequency: asText(body.billingFrequency, "monthly"),
        packageMonths: Math.max(1, asNumber(body.packageMonths, 1)),
        nextDueDate: asNullableText(body.nextDueDate),
        paymentStatus:
          tenantType === "in-house"
            ? "included-in-student-bill"
            : asText(body.paymentStatus, "due"),
        status: "active",
        notes: asText(body.notes),
      });
      await db
        .update(parkingLots)
        .set({ status: "rented" })
        .where(eq(parkingLots.id, asNumber(body.parkingLotId)));
    } else if (action === "parking-rental-update") {
      const rentalId = asNumber(body.rentalId);
      if (!rentalId) throw new Error("Rental is required");
      const existing = (
        await db
          .select()
          .from(parkingRentals)
          .where(eq(parkingRentals.id, rentalId))
      )[0];
      if (!existing) throw new Error("Parking rental not found");
      const status = asText(body.status, existing.status || "active");
      await db
        .update(parkingRentals)
        .set({
          tenantName: asText(body.tenantName, existing.tenantName),
          contactNumber: asText(body.contactNumber),
          unitNumber: asText(body.unitNumber),
          carPlateNumber: asText(body.carPlateNumber),
          carModel: asText(body.carModel),
          monthlyRental: asNumber(body.monthlyRental),
          depositAmount: asNumber(body.depositAmount),
          startDate: asText(body.startDate) || existing.startDate,
          endDate: asNullableText(body.endDate),
          paidUntil: asNullableText(body.paidUntil),
          billingFrequency: asText(body.billingFrequency, "monthly"),
          packageMonths: Math.max(1, asNumber(body.packageMonths, 1)),
          nextDueDate: asNullableText(body.nextDueDate),
          paymentStatus: asText(body.paymentStatus, "current"),
          status,
          notes: asText(body.notes),
        })
        .where(eq(parkingRentals.id, rentalId));
      if (existing.parkingLotId)
        await db
          .update(parkingLots)
          .set({ status: status === "active" ? "rented" : "available" })
          .where(eq(parkingLots.id, existing.parkingLotId));
    } else if (action === "parking-rental-delete") {
      const rentalId = asNumber(body.rentalId);
      if (!rentalId) throw new Error("Rental is required");
      const rental = (
        await db
          .select()
          .from(parkingRentals)
          .where(eq(parkingRentals.id, rentalId))
      )[0];
      await db.delete(parkingRentals).where(eq(parkingRentals.id, rentalId));
      if (rental?.parkingLotId && rental.status === "active")
        await db
          .update(parkingLots)
          .set({ status: "available" })
          .where(eq(parkingLots.id, rental.parkingLotId));
    } else if (action === "ticket-create") {
      if (currentUser.roleKey === "tenant") {
        if (!currentUser.studentId)
          throw new Error("Tenant account is not linked to a student profile");
        const localDay = Number(
          new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            timeZone: "Asia/Kuala_Lumpur",
          }).format(new Date()),
        );
        if (localDay > 20) {
          const outstanding = (
            await db.execute<{ amount: number }>(
              sql`SELECT COALESCE(SUM(total_amount - amount_paid),0) amount FROM billing_invoices WHERE student_id=${currentUser.studentId} AND status IN ('unpaid','partial')`,
            )
          )[0];
          if (Number(outstanding?.amount || 0) > 0)
            throw new Error(
              "Maintenance ticket submission is paused because payment remains outstanding after the 20th. Please contact Management for emergency assistance.",
            );
        }
      }
      if (
        !body.hostelId ||
        !body.unitId ||
        !asText(body.category) ||
        !asText(body.subcategory)
      )
        throw new Error("Hostel, unit, category and subcategory are required");
      const inserted = await db
        .insert(maintenanceTickets)
        .values({
          ticketNo: `MT-${Date.now().toString().slice(-8)}`,
          studentId:
            currentUser.roleKey === "tenant"
              ? currentUser.studentId
              : asNullableNumber(body.studentId),
          hostelId: asNumber(body.hostelId),
          unitId: asNumber(body.unitId),
          roomId: asNullableNumber(body.roomId),
          category: asText(body.category),
          subcategory: asText(body.subcategory),
          subject: asText(body.subcategory),
          description: asText(body.description),
          priority: asText(body.priority, "average"),
          status: "submitted",
          submittedByType:
            currentUser.roleKey === "tenant" ? "student" : "staff",
          assignedTo: asText(body.assignedTo),
          costResponsibility: asText(body.costResponsibility, "management"),
          estimatedCost: asNullableNumber(body.estimatedCost),
          // Fixed-price requests (the door-unlocking fee) arrive already
          // priced; everything else is costed later from the ticket drawer.
          actualCost: asNullableNumber(body.actualCost),
          studentCharge: asNullableNumber(body.studentCharge),
        })
        .returning({ id: maintenanceTickets.id });
      createdId = inserted[0].id;
      await db.insert(ticketMessages).values({
        ticketId: createdId,
        authorName: currentUser.displayName,
        authorRole: currentUser.roleKey === "tenant" ? "student" : "staff",
        message: asText(body.description) || asText(body.subcategory),
        statusAfter: "submitted",
      });
    } else if (action === "ticket-message") {
      let chargedStudentUpdate: number | null = null;
      const ticketId = asNumber(body.ticketId);
      if (!ticketId) throw new Error("Ticket is required");
      if (currentUser.roleKey === "tenant") {
        const ownTicket = (
          await db
            .select({ studentId: maintenanceTickets.studentId })
            .from(maintenanceTickets)
            .where(eq(maintenanceTickets.id, ticketId))
        )[0];
        if (!ownTicket || ownTicket.studentId !== currentUser.studentId)
          throw new Error("You can only update your own ticket");
        if (!asText(body.message))
          throw new Error("Enter a message before posting the update");
      }
      const status =
        currentUser.roleKey === "tenant" ? "" : asText(body.statusAfter);
      if (currentUser.roleKey !== "tenant") {
        const responsibility = asText(body.costResponsibility, "management");
        const cost = asNullableNumber(body.actualCost);
        // A management-borne repair is company money going out, so the
        // receipt is the proof it was really spent. Enforced only at the
        // point the ticket is finished — blocking every interim update
        // would stop staff recording progress before the invoice arrives.
        if (
          ["completed", "closed"].includes(status) &&
          responsibility === "management" &&
          cost !== null &&
          cost > 0
        ) {
          const receipts = await db.execute<{ count: number }>(sql`
            SELECT COUNT(*)::int count FROM stored_attachments
            WHERE context_type = 'ticket-receipt' AND record_id = ${ticketId}
          `);
          if (!Number(receipts[0]?.count || 0))
            throw new Error(
              "Attach the receipt before completing a management-paid repair",
            );
        }
        // Only meaningful when the student is the one paying — clearing it
        // otherwise stops a stale nomination quietly billing someone after
        // responsibility moves to the owner or management.
        if (responsibility === "student") {
          const nominated = asNullableNumber(body.chargedStudentId);
          if (nominated !== null) {
            const exists = await db
              .select({ id: studentProfiles.id })
              .from(studentProfiles)
              .where(eq(studentProfiles.id, nominated));
            if (!exists.length) throw new Error("Student not found");
          }
          chargedStudentUpdate = nominated;
        } else {
          chargedStudentUpdate = null;
        }
      }
      const message =
        asText(body.message) ||
        (status
          ? `Status updated to ${status.replace(/-/g, " ")}`
          : "Ticket details updated");
      const insertedMessages = await db
        .insert(ticketMessages)
        .values({
          ticketId,
          authorName: currentUser.displayName,
          authorRole: currentUser.roleKey === "tenant" ? "student" : "staff",
          message,
          statusAfter: status || null,
        })
        .returning({ id: ticketMessages.id });
      createdId = insertedMessages[0]?.id;
      const changes: Record<string, unknown> = { updatedAt: nowIso() };
      if (currentUser.roleKey !== "tenant") {
        changes.assignedTo = asText(body.assignedTo);
        changes.costResponsibility = asText(
          body.costResponsibility,
          "management",
        );
        changes.actualCost = asNullableNumber(body.actualCost);
        // The update form no longer carries a separate penalty figure — a
        // student-borne ticket is charged its actual cost. Only written when
        // the caller actually sends the field, so tickets created under the
        // old two-figure form keep the amount they were given.
        if (body.studentCharge !== undefined)
          changes.studentCharge = asNullableNumber(body.studentCharge);
        changes.chargedStudentId = chargedStudentUpdate;
      }
      if (status) changes.status = status;
      if (["attended", "waiting-parts", "in-progress"].includes(status))
        changes.attendedAt = asNullableText(body.attendedAt) || nowIso();
      if (status === "completed" || status === "closed")
        changes.completedAt = nowIso();
      await db
        .update(maintenanceTickets)
        .set(changes)
        .where(eq(maintenanceTickets.id, ticketId));
    } else if (action === "ticket-delete") {
      const ticketId = asNumber(body.ticketId);
      if (!ticketId) throw new Error("Ticket is required");
      const doomed = (
        await db
          .select()
          .from(maintenanceTickets)
          .where(eq(maintenanceTickets.id, ticketId))
      )[0];
      if (!doomed) throw new Error("Ticket not found");
      // A billed ticket is the justification for a charge already sitting on
      // a student's invoice. Deleting it would leave that money on the bill
      // with nothing behind it, so the invoice has to be dealt with first.
      if (doomed.billedCycleId)
        throw new Error(
          "This ticket has already been billed to a student — delete or adjust that invoice first",
        );
      await db.transaction(async (tx) => {
        // Costs recorded against the ticket are their own financial records
        // and outlive it; only the link is dropped.
        await tx.execute(
          sql`UPDATE general_costs SET ticket_id = NULL WHERE ticket_id = ${ticketId}`,
        );
        await tx.execute(
          sql`DELETE FROM ticket_messages WHERE ticket_id = ${ticketId}`,
        );
        await tx.execute(
          sql`DELETE FROM maintenance_tickets WHERE id = ${ticketId}`,
        );
      });
    } else if (action === "ticket-category-save") {
      if (!asText(body.category) || !asText(body.subcategory))
        throw new Error("Category and subcategory are required");
      const values = {
        category: asText(body.category),
        subcategory: asText(body.subcategory),
        status: asText(body.status, "active"),
        sortOrder: asNumber(body.sortOrder),
      };
      if (body.categoryId)
        await db
          .update(ticketCategories)
          .set(values)
          .where(eq(ticketCategories.id, asNumber(body.categoryId)));
      else await db.insert(ticketCategories).values(values);
    } else if (action === "ticket-category-delete") {
      if (!body.categoryId) throw new Error("Category is required");
      await db
        .delete(ticketCategories)
        .where(eq(ticketCategories.id, asNumber(body.categoryId)));
    } else if (action === "general-cost") {
      if (
        !body.costDate ||
        !asText(body.description) ||
        asNumber(body.amount) < 0
      )
        throw new Error("Date, description and amount are required");
      const inserted = await db
        .insert(generalCosts)
        .values({
          costDate: asText(body.costDate),
          hostelId: asNullableNumber(body.hostelId),
          unitId: asNullableNumber(body.unitId),
          ticketId: asNullableNumber(body.ticketId),
          costType: asText(body.costType, "maintenance"),
          description: asText(body.description),
          responsibility: asText(body.responsibility, "management"),
          amount: asNumber(body.amount),
          studentCharge: asNumber(body.studentCharge),
          notes: asText(body.notes),
          createdBy: currentUser.displayName,
        })
        .returning({ id: generalCosts.id });
      createdId = inserted[0]?.id;
    } else if (action === "meter-reading") {
      const roomId = asNumber(body.roomId);
      if (!roomId || !body.readingDate || body.readingValue === "")
        throw new Error("Room code, date and reading are required");
      const canonicalBed = (
        await db
          .select({ id: bedSpaces.id })
          .from(bedSpaces)
          .where(eq(bedSpaces.roomId, roomId))
          .orderBy(asc(bedSpaces.id))
      )[0];
      if (!canonicalBed) throw new Error("Room has no room code");
      await db
        .update(hostelRooms)
        .set({ meterSerial: asText(body.meterSerial) })
        .where(eq(hostelRooms.id, roomId));
      await db.insert(meterReadings).values({
        bedSpaceId: canonicalBed.id,
        roomId,
        readingDate: asText(body.readingDate),
        readingValue: asNumber(body.readingValue),
        readingType: asText(body.readingType, "monthly"),
        // Only carried when the form's "meter was replaced" switch is on —
        // see the column's comment in db/schema.ts for what it does to the
        // month's usage.
        replacedMeterFinal: asNullableNumber(body.replacedMeterFinal),
        submittedBy: asText(body.submittedBy, "Maintenance Team"),
        notes: asText(body.notes),
      });
    } else if (action === "meter-reading-batch") {
      // The month-entry grid posts one row per room in a single save. Re-saving
      // the same reading date must correct the existing figure rather than
      // stack a second reading on top of it, or the usage difference the
      // billing cycle reads would silently reset to zero.
      const readingDate = asText(body.readingDate);
      const readingType = asText(body.readingType, "monthly");
      const rows = (Array.isArray(body.rows) ? body.rows : []) as Record<
        string,
        unknown
      >[];
      if (!readingDate) throw new Error("A reading date is required");
      const clean = rows.flatMap((row) => {
        const roomId = asNumber(row.roomId);
        if (!roomId || row.readingValue === "" || row.readingValue == null)
          return [];
        return [{ roomId, readingValue: asNumber(row.readingValue) }];
      });
      if (!clean.length) throw new Error("Enter at least one meter reading");

      const roomIds = [...new Set(clean.map((row) => row.roomId))];
      // One bed per room carries the reading, matching the single-entry action.
      const bedRows = await db.execute<{ room_id: number; bed_id: number }>(sql`
        SELECT room_id, MIN(id) AS bed_id FROM bed_spaces
        WHERE room_id IN ${roomIds} GROUP BY room_id
      `);
      const bedByRoom = new Map(
        bedRows.map((row) => [Number(row.room_id), Number(row.bed_id)]),
      );
      const existingRows = await db.execute<{ id: number; room_id: number }>(sql`
        SELECT id, room_id FROM meter_readings
        WHERE room_id IN ${roomIds}
          AND reading_date = ${readingDate}
          AND reading_type = ${readingType}
      `);
      const existingByRoom = new Map(
        existingRows.map((row) => [Number(row.room_id), Number(row.id)]),
      );

      const toInsert: {
        roomId: number;
        bedSpaceId: number;
        readingDate: string;
        readingValue: number;
        readingType: string;
        submittedBy: string;
      }[] = [];
      for (const row of clean) {
        const existingId = existingByRoom.get(row.roomId);
        if (existingId) {
          await db
            .update(meterReadings)
            .set({
              readingValue: row.readingValue,
              submittedBy: currentUser.displayName,
            })
            .where(eq(meterReadings.id, existingId));
          continue;
        }
        const bedId = bedByRoom.get(row.roomId);
        if (!bedId) continue;
        toInsert.push({
          roomId: row.roomId,
          bedSpaceId: bedId,
          readingDate,
          readingValue: row.readingValue,
          readingType,
          submittedBy: currentUser.displayName,
        });
      }
      for (const batch of chunks(toInsert, 200))
        await db.insert(meterReadings).values(batch);
    } else if (action === "meter-reading-bulk") {
      const rows = Array.isArray(body.rows)
        ? (body.rows as Record<string, unknown>[])
        : [];
      if (!rows.length)
        throw new Error("The CSV file does not contain meter readings");

      // Same room-matching rule as before (room code, or any bed's legacy
      // code, lowest room id wins on a tie) — resolved for every distinct
      // roomCode in one query instead of one lookup per CSV row.
      const codes = [
        ...new Set(rows.map((row) => asText(row.roomCode).toLowerCase())),
      ];
      const matchRows = await db.execute<{
        code: string;
        room_id: number;
        bed_id: number;
      }>(sql`
        WITH input_codes AS (
          SELECT * FROM (VALUES ${sql.join(
            codes.map((code) => sql`(${code})`),
            sql`, `,
          )}) AS v(code)
        ),
        all_matches AS (
          SELECT lower(u.unit_code || '-' || r.room_label) AS code, r.id AS room_id
          FROM hostel_rooms r JOIN hostel_units u ON r.unit_id = u.id
          UNION
          SELECT lower(b.legacy_code) AS code, b.room_id AS room_id
          FROM bed_spaces b
          WHERE b.legacy_code IS NOT NULL AND b.legacy_code <> ''
        ),
        ranked AS (
          SELECT ic.code, am.room_id,
            ROW_NUMBER() OVER (PARTITION BY ic.code ORDER BY am.room_id) AS rn
          FROM input_codes ic JOIN all_matches am ON am.code = ic.code
        ),
        chosen AS (
          SELECT code, room_id FROM ranked WHERE rn = 1
        )
        SELECT ch.code, ch.room_id, MIN(b.id) AS bed_id
        FROM chosen ch JOIN bed_spaces b ON b.room_id = ch.room_id
        GROUP BY ch.code, ch.room_id
      `);
      const matchByCode = new Map(
        matchRows.map((row) => [
          row.code,
          { roomId: Number(row.room_id), bedId: Number(row.bed_id) },
        ]),
      );

      const toInsert = rows.flatMap((row) => {
        const code = asText(row.roomCode).toLowerCase();
        const match = matchByCode.get(code);
        if (!match) return [];
        return [
          {
            roomId: match.roomId,
            bedSpaceId: match.bedId,
            readingDate: asText(row.readingDate),
            readingValue: asNumber(row.readingValue),
            readingType: asText(row.readingType, "monthly"),
            submittedBy: currentUser.displayName,
            notes: asText(row.notes),
          },
        ];
      });

      for (const batch of chunks(toInsert, 200))
        await db.insert(meterReadings).values(batch);
    } else if (action === "meter-reading-update") {
      if (!body.readingId || !body.readingDate || body.readingValue === "")
        throw new Error("Reading date and value are required");
      if (body.roomId)
        await db
          .update(hostelRooms)
          .set({ meterSerial: asText(body.meterSerial) })
          .where(eq(hostelRooms.id, asNumber(body.roomId)));
      await db
        .update(meterReadings)
        .set({
          readingDate: asText(body.readingDate),
          readingValue: asNumber(body.readingValue),
          readingType: asText(body.readingType, "monthly"),
          // Cleared when the "meter was replaced" switch is turned back off,
          // so an edit can undo a replacement recorded by mistake.
          replacedMeterFinal: asNullableNumber(body.replacedMeterFinal),
          notes: asText(body.notes),
          submittedBy: currentUser.displayName,
        })
        .where(eq(meterReadings.id, asNumber(body.readingId)));
    } else if (action === "billing-cycle-preview") {
      // Read-only preview of what "billing-cycle" below would actually
      // charge, computed by the exact same function so it cannot drift from
      // what a real run produces. The only write is reserving the period in
      // billing_cycles (see ensureBillingCycle) — no invoice or item is
      // created, and nothing here is visible to a tenant.
      if (!asText(body.periodLabel) || !body.cutoffDate || !body.dueDate)
        throw new Error(
          "Billing month, cut-off date and due date are required",
        );
      billingPreview = await previewBillingCycle(db, {
        periodLabel: asText(body.periodLabel),
        cutoffDate: asText(body.cutoffDate),
        dueDate: asText(body.dueDate),
        invoiceFrequency: asText(body.invoiceFrequency, "on-request"),
      });
    } else if (action === "billing-cycle") {
      if (!asText(body.periodLabel) || !body.cutoffDate || !body.dueDate)
        throw new Error(
          "Billing month, cut-off date and due date are required",
        );
      createdId = await generateBillingCycle(db, {
        periodLabel: asText(body.periodLabel),
        cutoffDate: asText(body.cutoffDate),
        dueDate: asText(body.dueDate),
        invoiceFrequency: asText(body.invoiceFrequency, "on-request"),
        actorName: currentUser.displayName,
      });
    } else if (action === "billing-post") {
      if (!body.cycleId) throw new Error("Billing cycle is required");
      await db
        .update(billingCycles)
        .set({ status: "posted", postedAt: nowIso() })
        .where(eq(billingCycles.id, asNumber(body.cycleId)));
    } else if (action === "billing-payment") {
      if (!body.invoiceId || !body.amount)
        throw new Error("Invoice and payment amount are required");
      const inserted = await db
        .insert(billingPaymentRecords)
        .values({
          invoiceId: asNumber(body.invoiceId),
          amount: asNumber(body.amount),
          reference: "",
          remark: asText(body.remark),
          status: "pending-verification",
        })
        .returning({ id: billingPaymentRecords.id });
      createdId = inserted[0]?.id;
    } else if (action === "billing-verify") {
      const paymentId = asNumber(body.paymentId);
      if (!paymentId) throw new Error("Payment is required");
      const payment = (
        await db
          .select()
          .from(billingPaymentRecords)
          .where(eq(billingPaymentRecords.id, paymentId))
      )[0];
      if (!payment) throw new Error("Payment not found");
      await db
        .update(billingPaymentRecords)
        .set({
          status: "verified",
          verifiedAt: nowIso(),
          verifiedBy: currentUser.displayName,
          verifiedAmount: asNumber(body.verifiedAmount, payment.amount),
          actualReference: asText(body.actualReference),
          receiptNo: `RCT-${payment.invoiceId}-${paymentId}`,
        })
        .where(eq(billingPaymentRecords.id, paymentId));
      const totals = (
        await db.execute<{ total: number }>(
          sql`SELECT COALESCE(SUM(COALESCE(verified_amount, amount)),0) total FROM billing_payment_records WHERE invoice_id=${payment.invoiceId} AND (status='verified' OR id=${paymentId})`,
        )
      )[0];
      const invoice = (
        await db
          .select()
          .from(billingInvoices)
          .where(eq(billingInvoices.id, payment.invoiceId))
      )[0];
      const paid = Number(totals?.total || 0);
      await db
        .update(billingInvoices)
        .set({
          amountPaid: paid,
          status: invoice && paid >= invoice.totalAmount ? "paid" : "partial",
        })
        .where(eq(billingInvoices.id, payment.invoiceId));
    } else if (action === "billing-item-adjust") {
      const itemId = asNumber(body.itemId);
      const item = (
        await db.select().from(billingItems).where(eq(billingItems.id, itemId))
      )[0];
      if (!item || !asText(body.reason))
        throw new Error("Billing item and adjustment reason are required");
      // Electricity fees always carry up to the next whole ringgit.
      const newAmount =
        item.itemType === "electricity"
          ? Math.ceil(asNumber(body.newAmount))
          : asNumber(body.newAmount);
      const inserted = await db
        .insert(billingItemAdjustments)
        .values({
          billingItemId: itemId,
          previousAmount: item.amount,
          newAmount,
          reason: asText(body.reason),
          requestedBy: currentUser.displayName,
          approvalStatus:
            item.itemType === "electricity" ? "pending" : "approved",
          approvedBy:
            item.itemType === "electricity" ? "" : currentUser.displayName,
          approvedAt: item.itemType === "electricity" ? null : nowIso(),
        })
        .returning({ id: billingItemAdjustments.id });
      createdId = inserted[0]?.id;
      if (item.itemType !== "electricity") {
        await db
          .update(billingItems)
          .set({ amount: newAmount, rate: newAmount })
          .where(eq(billingItems.id, itemId));
        await db.execute(
          sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${item.invoiceId}) WHERE id=${item.invoiceId}`,
        );
      }
    } else if (action === "billing-adjust-approve") {
      const adjustmentId = asNumber(body.adjustmentId);
      const adjustment = (
        await db
          .select()
          .from(billingItemAdjustments)
          .where(eq(billingItemAdjustments.id, adjustmentId))
      )[0];
      if (!adjustment) throw new Error("Adjustment request not found");
      const item = (
        await db
          .select()
          .from(billingItems)
          .where(eq(billingItems.id, adjustment.billingItemId))
      )[0];
      if (!item) throw new Error("Billing item not found");
      // Electricity fees always carry up to the next whole ringgit.
      const appliedAmount =
        item.itemType === "electricity"
          ? Math.ceil(adjustment.newAmount)
          : adjustment.newAmount;
      await db
        .update(billingItems)
        .set({ amount: appliedAmount, rate: appliedAmount })
        .where(eq(billingItems.id, item.id));
      await db
        .update(billingItemAdjustments)
        .set({
          approvalStatus: "approved",
          approvedBy: currentUser.displayName,
          approvedAt: nowIso(),
        })
        .where(eq(billingItemAdjustments.id, adjustmentId));
      await db.execute(
        sql`UPDATE billing_invoices SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM billing_items WHERE invoice_id=${item.invoiceId}) WHERE id=${item.invoiceId}`,
      );
    } else if (action === "billing-item-verify") {
      const itemId = asNumber(body.itemId);
      const item = (
        await db.select().from(billingItems).where(eq(billingItems.id, itemId))
      )[0];
      if (!item) throw new Error("Billing item not found");
      await db
        .update(billingItems)
        .set({ verifiedAt: nowIso(), verifiedBy: currentUser.displayName })
        .where(eq(billingItems.id, itemId));
    } else if (action === "billing-invoice-update") {
      const invoiceId = asNumber(body.invoiceId);
      if (!invoiceId) throw new Error("Invoice is required");
      await db
        .update(billingInvoices)
        .set({ dueDate: asText(body.dueDate) })
        .where(eq(billingInvoices.id, invoiceId));
    } else if (action === "billing-invoice-delete") {
      const invoiceId = asNumber(body.invoiceId);
      if (!invoiceId) throw new Error("Invoice is required");
      const itemIds = (
        await db
          .select({ id: billingItems.id })
          .from(billingItems)
          .where(eq(billingItems.invoiceId, invoiceId))
      ).map((row) => row.id);
      if (itemIds.length)
        await db
          .delete(billingItemAdjustments)
          .where(inArray(billingItemAdjustments.billingItemId, itemIds));
      await db
        .delete(billingItems)
        .where(eq(billingItems.invoiceId, invoiceId));
      await db
        .delete(billingPaymentRecords)
        .where(eq(billingPaymentRecords.invoiceId, invoiceId));
      // Hand this student's maintenance charges back to the next cycle —
      // deleting the invoice that carried them would otherwise leave them
      // stamped as billed and they'd never be charged at all.
      await db.execute(sql`
        UPDATE maintenance_tickets SET billed_cycle_id = NULL
        WHERE billed_cycle_id = (SELECT cycle_id FROM billing_invoices WHERE id = ${invoiceId})
          AND student_id = (SELECT student_id FROM billing_invoices WHERE id = ${invoiceId})
      `);
      // Likewise for the deposit difference — otherwise deleting the invoice
      // that carried it would leave it marked billed and never collected.
      await db.execute(sql`
        UPDATE deposit_adjustments SET billed_cycle_id = NULL
        WHERE billed_cycle_id = (SELECT cycle_id FROM billing_invoices WHERE id = ${invoiceId})
          AND assignment_id = (SELECT assignment_id FROM billing_invoices WHERE id = ${invoiceId})
      `);
      await db.delete(billingInvoices).where(eq(billingInvoices.id, invoiceId));
    } else if (action === "announcement") {
      if (!asText(body.title) || !asText(body.body))
        throw new Error("Announcement title and message are required");
      await db.insert(announcements).values({
        title: asText(body.title),
        body: asText(body.body),
        audienceType: asText(body.audienceType, "all"),
        hostelId: asNullableNumber(body.hostelId),
        blockCode: asText(body.blockCode),
        unitId: asNullableNumber(body.unitId),
        priority: asText(body.priority, "normal"),
        status: asText(body.status, "published"),
        pinned: boolValue(body.pinned),
        publishAt: asNullableText(body.publishAt) || nowIso(),
        expiresAt: asNullableText(body.expiresAt),
        createdBy: currentUser.displayName,
      });
    } else if (action === "announcement-pin") {
      const announcementId = asNumber(body.announcementId);
      if (!announcementId) throw new Error("Announcement is required");
      await db
        .update(announcements)
        .set({ pinned: boolValue(body.pinned) })
        .where(eq(announcements.id, announcementId));
    } else if (action === "user-save") {
      if (!asText(body.email) || !body.roleId)
        throw new Error("Email and role are required");
      let roleId = asNumber(body.roleId);
      const linkedStudentId = asNullableNumber(body.studentId);
      if (linkedStudentId) {
        const tenantRole = (
          await db
            .select({ id: appRoles.id })
            .from(appRoles)
            .where(eq(appRoles.roleKey, "tenant"))
        )[0];
        if (tenantRole) roleId = tenantRole.id;
      }
      const values = {
        email: asText(body.email).toLowerCase(),
        displayName: asText(body.displayName, asText(body.email)),
        roleId,
        studentId: linkedStudentId,
        status: asText(body.status, "active"),
      };
      if (body.userId)
        await db
          .update(appUsers)
          .set(values)
          .where(eq(appUsers.id, asNumber(body.userId)));
      else await db.insert(appUsers).values(values);
    } else if (action === "user-set-password") {
      const targetId = asNumber(body.userId);
      const password = String(body.password || "");
      if (!targetId) throw new Error("User is required");
      if (password.length < 8)
        throw new Error("Password must be at least 8 characters");
      await db
        .update(appUsers)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(appUsers.id, targetId));
      // Force a fresh sign-in everywhere with the old password.
      await db.delete(userSessions).where(eq(userSessions.userId, targetId));
    } else if (action === "role-permission") {
      if (!body.roleId || !asText(body.moduleKey))
        throw new Error("Role and module are required");
      const values = {
        roleId: asNumber(body.roleId),
        moduleKey: asText(body.moduleKey),
        canView: boolValue(body.canView),
        canCreate: boolValue(body.canCreate),
        canEdit: boolValue(body.canEdit),
        canDelete: boolValue(body.canDelete),
        canApprove: boolValue(body.canApprove),
      };
      await db
        .insert(rolePermissions)
        .values(values)
        .onConflictDoUpdate({
          target: [rolePermissions.roleId, rolePermissions.moduleKey],
          set: values,
        });
    } else if (action === "role-create") {
      const name = asText(body.name);
      if (!name) throw new Error("Role name is required");
      const roleKey =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || `role-${Date.now()}`;
      const inserted = await db
        .insert(appRoles)
        .values({
          roleKey,
          name,
          description: asText(body.description),
          isSystem: false,
        })
        .returning({ id: appRoles.id });
      const roleId = inserted[0]?.id;
      createdId = roleId;
      if (roleId)
        await db
          .insert(rolePermissions)
          .values(permissionModules.map((moduleKey) => ({ roleId, moduleKey })))
          .onConflictDoNothing();
    } else if (action === "role-update") {
      if (!body.roleId || !asText(body.name))
        throw new Error("Role and name are required");
      await db
        .update(appRoles)
        .set({
          name: asText(body.name),
          description: asText(body.description),
        })
        .where(eq(appRoles.id, asNumber(body.roleId)));
    } else if (action === "role-delete") {
      const roleId = asNumber(body.roleId);
      if (!roleId) throw new Error("Role is required");
      const role = (
        await db.select().from(appRoles).where(eq(appRoles.id, roleId))
      )[0];
      if (!role) throw new Error("Role not found");
      if (role.isSystem) throw new Error("Built-in roles cannot be deleted");
      const inUse = (
        await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.roleId, roleId))
          .limit(1)
      )[0];
      if (inUse)
        throw new Error("Reassign users on this role before deleting it");
      await db
        .delete(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      await db.delete(appRoles).where(eq(appRoles.id, roleId));
    } else if (action === "reminder-template") {
      if (!body.templateId || !asText(body.subject) || !asText(body.message))
        throw new Error("Reminder template is required");
      await db
        .update(reminderTemplates)
        .set({
          dayOfMonth: asNumber(body.dayOfMonth),
          subject: asText(body.subject),
          message: asText(body.message),
          enabled: boolValue(body.enabled),
          updatedAt: nowIso(),
        })
        .where(eq(reminderTemplates.id, asNumber(body.templateId)));
    } else {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }
    return Response.json(
      { ok: true, id: createdId, linkedPaymentId, preview: billingPreview },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save record";
    return Response.json({ error: message }, { status: 400 });
  }
}





