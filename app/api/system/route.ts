import { and, asc, desc, eq, sql } from "drizzle-orm";
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
const SCOPED_MODULE_KEYS = [
  "parking",
  "maintenance-tickets",
  "announcements",
  "users",
  "schools-courses",
  "attachments",
] as const;
type ScopedModuleKey = (typeof SCOPED_MODULE_KEYS)[number];

async function loadScopedModules(
  db: ReturnType<typeof getDb>,
  scopes: Set<ScopedModuleKey>,
) {
  const result: Record<string, unknown> = {};
  const tasks: Promise<void>[] = [];

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
  if (/^(reservation|bulk-room-price|promotion-end)/.test(action))
    return "hostels-sales";
  if (action === "hostel-rates") return "hostels-rates";
  if (/^bed-/.test(action)) return "units-general";
  if (/^(unit-|access-card|room-|service-)/.test(action))
    return action === "unit-owner" ? "units-owner" : "units-general";
  if (/^(student-|school-|course-)/.test(action)) return "students";
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
  const sessionUser = await getSessionUser(request);
  if (sessionUser)
    return {
      ...sessionUser,
      permissions: await permissionsForRole(sessionUser.roleId),
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
  await db.execute(
    sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
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
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function addReservationPayment(
  db: ReturnType<typeof getDb>,
  reservationId: number,
  body: Record<string, unknown>,
) {
  const amount = asNumber(body.paymentAmount ?? body.amountPaid, 0);
  let paymentId: number | undefined;
  if (amount > 0 || asText(body.paymentReference)) {
    const inserted = await db
      .insert(reservationPayments)
      .values({
        reservationId,
        amount,
        reference: asText(body.paymentReference),
        paymentMethod: asText(body.paymentMethod, "bank-transfer"),
        paidAt: asNullableText(body.paidAt) || nowIso(),
        notes: asText(body.paymentNotes),
      })
      .returning({ id: reservationPayments.id });
    paymentId = inserted[0]?.id;
  }
  const total = (
    await db.execute<{ total: number }>(
      sql`SELECT COALESCE(SUM(amount), 0) AS total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
    )
  )[0];
  return { amountPaid: Number(total?.total || 0), paymentId };
}

export async function GET(request: Request) {
  try {
    // Deliberately a separate client from the one below: mixing the
    // sequential db.transaction() calls the seed helpers make with the big
    // concurrent Promise.all further down (on the SAME client) reintroduces
    // the Supavisor deadlock Task 15 fixed — confirmed by direct
    // reproduction. Keeping them on separate clients avoids it.
    const seedDb = getDb();
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
    const lateChargeDate = todayInKL();
    if (lateChargesAppliedOn !== lateChargeDate) {
      await applyLatePaymentCharges(seedDb);
      lateChargesAppliedOn = lateChargeDate;
    }
    // Scoped refresh: after a save() that only touched a few tables, the
    // client asks for just those via ?modules=a,b instead of the full
    // ~30-query load below. Tenants always fall through to the full load
    // since the row-level filtering further down isn't replicated for the
    // scoped path. See loadScopedModules()'s comment for what's covered.
    const requestedModules = new URL(request.url).searchParams.get("modules");
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
        const scopedDb = getDb();
        const scopedResult = await loadScopedModules(scopedDb, scopes);
        return Response.json(scopedResult);
      }
    }
    const db = getDb({ max: 20 });
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
      studentRows,
      rateRows,
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
    ] = await Promise.all([
      db
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
        ),
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
          roomCode: bedSpaces.legacyCode,
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
        .orderBy(asc(studentProfiles.fullName)),
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
          roomCode: bedSpaces.legacyCode,
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
          hostelName: hostelProperties.name,
          electricityRate: hostelProperties.electricityRate,
          readingDate: meterReadings.readingDate,
          readingValue: meterReadings.readingValue,
          readingType: meterReadings.readingType,
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
      db
        .select({
          id: billingInvoices.id,
          invoiceNo: billingInvoices.invoiceNo,
          cycleId: billingInvoices.cycleId,
          studentId: billingInvoices.studentId,
          studentName: studentProfiles.fullName,
          assignmentId: billingInvoices.assignmentId,
          roomCode: bedSpaces.legacyCode,
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
        .orderBy(desc(billingInvoices.id)),
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
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const roomCounts = new Map<number, number>();
    for (const bed of rawBeds)
      roomCounts.set(bed.roomId, (roomCounts.get(bed.roomId) || 0) + 1);
    const beds = rawBeds.map((bed) => {
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
          bed.status === "vacant" || agreementEnded
            ? "available-now"
            : bed.status === "occupied" && bed.agreementEndDate
              ? "upcoming"
              : "unavailable",
      };
    });
    const hostels = properties.map((property) => {
      const rows = beds.filter((bed) => bed.hostelId === property.id);
      return {
        ...property,
        units: units.filter((unit) => unit.hostelId === property.id).length,
        bedSpaces: rows.length,
        occupied: rows.filter((bed) => bed.status === "occupied").length,
        vacant: rows.filter((bed) => bed.status === "vacant").length,
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
    const bedById = new Map(beds.map((bed) => [bed.id, bed]));
    const propertyById = new Map(
      properties.map((property) => [property.id, property]),
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
    }));
    const salesPeople = [
      ...new Set([
        ...importedAssignments
          .map((record) => record.assignment.salesperson)
          .filter(Boolean),
        ...reservationRows.map((row) => row.salesPerson).filter(Boolean),
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
      salesPeople,
      parkingLots: parkingLotRows,
      parkingRentals: parkingRentalRows,
      schools: schoolRows,
      courses: courseRows,
      categoryRates: categoryRateRows,
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

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = (await request.json()) as Record<string, unknown>;
    const action = asText(body.action);
    let createdId: number | undefined;
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
        !["occupied", "vacant", "special-use"].includes(status)
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
      await db
        .update(hostelUnits)
        .set({
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
    } else if (action === "hostel-rates") {
      if (!body.hostelId) throw new Error("Hostel is required");
      await db
        .update(hostelProperties)
        .set({
          electricityRate: asNumber(body.electricityRate),
          address: asText(body.address),
          monthlyCleaningFee: asNumber(body.monthlyCleaningFee),
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
      const paymentStatus = asText(body.paymentStatus, "unpaid");
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
        nationality: asText(body.nationality),
        nationalityOther: asText(body.nationalityOther),
        state: asText(body.state),
        hometown: asText(body.hometown),
        race: asText(body.race),
        raceOther: asText(body.raceOther),
        religion: asText(body.religion),
        religionOther: asText(body.religionOther),
        targetMoveInDate: asText(body.targetMoveInDate),
        provisionalBedSpaceId: asNullableNumber(body.provisionalBedSpaceId),
        paymentStatus,
        inventoryCommitted: paymentStatus !== "unpaid",
        paymentUpdatedAt: nowIso(),
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
      const amountPaid =
        action === "reservation"
          ? (await addReservationPayment(db, reservationId, body)).amountPaid
          : Number(
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
          paymentReference: asText(body.paymentReference),
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
              gender: values.preferredGender,
              contactNumber: values.contactNumber,
              email: values.email,
              nationality: values.nationality,
              nationalityOther: values.nationalityOther,
              state: values.state,
              hometown: values.hometown,
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
          const chargeAmount = (type: string) =>
            charges.find((row) => row.charge_type === type)?.amount;
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
    } else if (action === "reservation-payment") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      const { amountPaid, paymentId } = await addReservationPayment(
        db,
        reservationId,
        body,
      );
      const paymentStatus = asText(
        body.paymentStatus,
        amountPaid > 0 ? "partial" : "unpaid",
      );
      await db
        .update(reservations)
        .set({
          paymentStatus,
          amountPaid,
          paymentReference: asText(body.paymentReference),
          inventoryCommitted: paymentStatus !== "unpaid",
          paymentUpdatedAt: nowIso(),
        })
        .where(eq(reservations.id, reservationId));
      createdId = paymentId;
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
      await db
        .delete(reservationPayments)
        .where(
          and(
            eq(reservationPayments.id, paymentId),
            eq(reservationPayments.reservationId, reservationId),
          ),
        );
      const remaining = (
        await db.execute<{ total: number }>(
          sql`SELECT COALESCE(SUM(amount), 0) AS total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        )
      )[0];
      const amountPaid = Number(remaining?.total || 0);
      const paymentStatus = amountPaid > 0 ? "partial" : "unpaid";
      await db
        .update(reservations)
        .set({
          paymentStatus,
          amountPaid,
          inventoryCommitted: paymentStatus !== "unpaid",
          paymentUpdatedAt: nowIso(),
        })
        .where(eq(reservations.id, reservationId));
    } else if (action === "payment-update") {
      const reservationId = asNumber(body.reservationId);
      const paymentId = asNumber(body.paymentId);
      const amount = asNullableNumber(body.amount);
      if (!reservationId || !paymentId || amount === null || amount < 0)
        throw new Error(
          "Reservation, payment and a valid amount are required",
        );
      await db
        .update(reservationPayments)
        .set({ amount })
        .where(
          and(
            eq(reservationPayments.id, paymentId),
            eq(reservationPayments.reservationId, reservationId),
          ),
        );
      const remaining = (
        await db.execute<{ total: number }>(
          sql`SELECT COALESCE(SUM(amount), 0) AS total FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        )
      )[0];
      const amountPaid = Number(remaining?.total || 0);
      const paymentStatus = amountPaid > 0 ? "partial" : "unpaid";
      await db
        .update(reservations)
        .set({
          paymentStatus,
          amountPaid,
          inventoryCommitted: paymentStatus !== "unpaid",
          paymentUpdatedAt: nowIso(),
        })
        .where(eq(reservations.id, reservationId));
    } else if (action === "reservation-delete") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`DELETE FROM reservation_payments WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservation_charges WHERE reservation_id = ${reservationId}`,
        );
        await tx.execute(
          sql`DELETE FROM reservations WHERE id = ${reservationId}`,
        );
      });
    } else if (action === "reservation-cancel") {
      const reservationId = asNumber(body.reservationId);
      if (!reservationId) throw new Error("Reservation is required");
      await db
        .update(reservations)
        .set({
          status: "cancelled",
          cancelledAt: nowIso(),
          inventoryCommitted: false,
        })
        .where(eq(reservations.id, reservationId));
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
        const chargeAmount = (type: string) =>
          charges.find((row) => row.charge_type === type)?.amount;
        const firstMonthRental = chargeAmount("first-month-rental");
        const monthlyRental =
          firstMonthRental && Number(firstMonthRental) > 0
            ? firstMonthRental
            : roomDerivedRental;
        const securityDeposit = chargeAmount("deposit") ?? null;
        const accessCardDeposit = chargeAmount("access-card-deposit") ?? null;
        const key = `reservation:${reservationId}`;
        await db.execute(sql`
          INSERT INTO student_profiles (source_key, student_code, full_name, identity_no, gender, contact_number, email, nationality, nationality_other, state, hometown, race, race_other, religion, religion_other, salesperson, status)
          VALUES (${key}, ${`STU-${reservationId}`}, ${reservation.studentName}, ${reservation.identityNo}, ${reservation.preferredGender}, ${reservation.contactNumber}, ${reservation.email}, ${reservation.nationality}, ${reservation.nationalityOther}, ${reservation.state}, ${reservation.hometown}, ${reservation.race}, ${reservation.raceOther}, ${reservation.religion}, ${reservation.religionOther}, ${reservation.salesPerson}, 'active')
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
          await tx.execute(
            sql`UPDATE bed_spaces SET status = 'occupied', updated_at = ${now} WHERE id = ${bedId}`,
          );
          await tx.execute(
            sql`UPDATE reservations SET assigned_bed_space_id = ${bedId}, status = 'converted', converted_at = ${now} WHERE id = ${reservationId}`,
          );
        });
      }
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
      await db.insert(studentRateChanges).values({
        assignmentId: asNumber(body.assignmentId),
        effectiveDate: asText(body.effectiveDate),
        monthlyRental: asNullableNumber(body.monthlyRental),
        securityDeposit: asNullableNumber(body.securityDeposit),
        reason: asText(body.reason),
      });
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
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE accommodation_assignments SET status='moved', check_out_date=${asText(body.effectiveDate)}, check_out_meter=${asNullableNumber(body.checkOutMeter)} WHERE id=${oldAssignmentId}`,
        );
        await tx.execute(
          sql`UPDATE bed_spaces SET status='vacant', updated_at=${changeNow} WHERE id=${old.bedSpaceId}`,
        );
        await tx.execute(sql`
          INSERT INTO accommodation_assignments (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit, salesperson, check_in_date, agreement_start_date, agreement_end_date, check_in_meter, remarks, status)
          VALUES (${key}, ${studentId}, ${bedId}, ${asNullableNumber(body.monthlyRental)}, ${asNullableNumber(body.securityDeposit)}, ${asNullableNumber(body.accessCardDeposit)}, ${asText(body.salesperson)}, ${asText(body.effectiveDate)}, ${asText(body.effectiveDate)}, ${asNullableText(body.leaseEndDate)}, ${asNullableNumber(body.checkInMeter)}, ${asText(body.reason)}, 'active')
        `);
        await tx.execute(
          sql`UPDATE bed_spaces SET status='occupied', updated_at=${changeNow} WHERE id=${bedId}`,
        );
      });
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
        changes.studentCharge = asNullableNumber(body.studentCharge);
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
        submittedBy: asText(body.submittedBy, "Maintenance Team"),
        notes: asText(body.notes),
      });
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
          notes: asText(body.notes),
          submittedBy: currentUser.displayName,
        })
        .where(eq(meterReadings.id, asNumber(body.readingId)));
    } else if (action === "billing-cycle") {
      if (!asText(body.periodLabel) || !body.cutoffDate || !body.dueDate)
        throw new Error(
          "Billing month, cut-off date and due date are required",
        );
      const cycle = (
        await db.execute<{ id: number }>(sql`
          INSERT INTO billing_cycles (period_label, cutoff_date, due_date, status)
          VALUES (${asText(body.periodLabel)}, ${asText(body.cutoffDate)}, ${asText(body.dueDate)}, 'draft')
          ON CONFLICT(period_label) DO UPDATE SET cutoff_date=excluded.cutoff_date, due_date=excluded.due_date
          RETURNING id
        `)
      )[0];
      if (!cycle) throw new Error("Unable to create billing cycle");
      createdId = Number(cycle.id);
      const cycleId = Number(cycle.id);
      const cutoffDate = asText(body.cutoffDate);
      const dueDate = asText(body.dueDate);
      const invoiceFrequency = asText(body.invoiceFrequency, "on-request");

      const active = await db.execute<{
        assignment_id: number;
        student_id: number;
        monthly_rental: number | null;
        room_id: number;
        electricity_rate: number;
      }>(sql`
        SELECT a.id assignment_id, a.student_id, a.monthly_rental, r.id room_id, h.electricity_rate
        FROM accommodation_assignments a
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
          const roomIds = [
            ...new Set(pending.map((row) => Number(row.room_id))),
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
          const readingRows = roomIds.length
            ? await db.execute<{
                room_id: number;
                reading_value: number;
              }>(sql`
                SELECT room_id, reading_value FROM (
                  SELECT
                    COALESCE(mr.room_id, bs.room_id) AS room_id,
                    mr.reading_value,
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
          const readingsByRoom = new Map<number, number[]>();
          for (const row of readingRows) {
            const roomId = Number(row.room_id);
            const list = readingsByRoom.get(roomId) || [];
            list.push(Number(row.reading_value));
            readingsByRoom.set(roomId, list);
          }

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
            const readings = readingsByRoom.get(roomId) || [];
            if (readings.length < 2) return { usage: 0, amount: 0 };
            const current = readings[0];
            const previous = readings[1];
            if (!(current > previous)) return { usage: 0, amount: 0 };
            const occupants = occupantsByRoom.get(roomId) || [];
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

          const maintenanceRows = await db.execute<{
            student_id: number;
            amount: number;
          }>(sql`
            SELECT student_id, COALESCE(SUM(student_charge),0) amount
            FROM maintenance_tickets
            WHERE student_id IN (${idList(studentIds)}) AND student_charge>0
              AND status IN ('completed','closed')
            GROUP BY student_id
          `);
          const maintenanceByStudent = new Map(
            maintenanceRows.map((row) => [
              Number(row.student_id),
              Number(row.amount),
            ]),
          );

          const previousInvoiceRows = await db.execute<{
            student_id: number;
            total_amount: number;
            amount_paid: number;
          }>(sql`
            SELECT DISTINCT ON (student_id) student_id, total_amount, amount_paid
            FROM billing_invoices
            WHERE student_id IN (${idList(studentIds)})
            ORDER BY student_id, id DESC
          `);
          const previousInvoiceByStudent = new Map(
            previousInvoiceRows.map((row) => [
              Number(row.student_id),
              {
                totalAmount: Number(row.total_amount || 0),
                amountPaid: Number(row.amount_paid || 0),
              },
            ]),
          );

          const invoicesToInsert = pending.map((assignment) => {
            const assignmentId = Number(assignment.assignment_id);
            const studentId = Number(assignment.student_id);
            const roomId = Number(assignment.room_id);
            const electricityRate = Number(assignment.electricity_rate || 0);

            const rateChange = rateChangeByAssignment.get(assignmentId);
            const rent = Number(rateChange ?? assignment.monthly_rental ?? 0);

            const electricity = electricityShareFromCache(
              assignmentId,
              roomId,
              electricityRate,
            );
            const parkingAmount = Number(
              parkingByStudent.get(studentId) || 0,
            );
            const extraAmount = Number(
              maintenanceByStudent.get(studentId) || 0,
            );
            const previousInvoice = previousInvoiceByStudent.get(studentId);
            const carryForward = previousInvoice
              ? Math.min(
                  0,
                  previousInvoice.totalAmount - previousInvoice.amountPaid,
                )
              : 0;
            const total =
              rent + electricity.amount + parkingAmount + extraAmount + carryForward;

            const items = (
              [
                ["room-rental", "Room rental", 1, rent, rent],
                [
                  "electricity",
                  `Electricity usage (${electricity.usage.toFixed(2)} kWh)`,
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
                  "carry-forward",
                  "Previous excess payment carried forward",
                  1,
                  carryForward,
                  carryForward,
                ],
              ] as [string, string, number, number, number][]
            ).filter((item) => Number(item[4]) !== 0);

            return {
              invoiceNo: `INV-${cycleId}-${studentId}`,
              studentId,
              assignmentId,
              total,
              items,
            };
          });

          for (const batch of chunks(invoicesToInsert, 200)) {
            const invoiceValueRows = batch.map(
              (invoice) =>
                sql`(${invoice.invoiceNo}, ${cycleId}, ${invoice.studentId}, ${invoice.assignmentId}, ${dueDate}, 'unpaid', ${invoice.total}, 0, ${invoiceFrequency})`,
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
          }
        }
      }
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
    return Response.json({ ok: true, id: createdId }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save record";
    return Response.json({ error: message }, { status: 400 });
  }
}
