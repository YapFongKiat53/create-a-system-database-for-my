import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const hostelProperties = pgTable("hostel_properties", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  electricityRate: doublePrecision("electricity_rate").notNull().default(0),
  monthlyCleaningFee: doublePrecision("monthly_cleaning_fee").notNull().default(0),
  monthlyWaterDispenserFee: doublePrecision("monthly_water_dispenser_fee")
    .notNull()
    .default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const hostelUnits = pgTable(
  "hostel_units",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    hostelId: bigint("hostel_id", { mode: "number" })
      .notNull()
      .references(() => hostelProperties.id),
    unitCode: text("unit_code").notNull(),
    address: text("address").notNull().default(""),
    gender: text("gender").notNull().default("mixed"),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    ownerName: text("owner_name").notNull().default(""),
    leaseEndDate: text("lease_end_date"),
    surrenderDate: text("surrender_date"),
    surrenderNotes: text("surrender_notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("hostel_unit_unique").on(table.hostelId, table.unitCode),
  ],
);

export const hostelRooms = pgTable(
  "hostel_rooms",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => hostelUnits.id),
    roomLabel: text("room_label").notNull(),
    status: text("status").notNull().default("active"),
    bathroomType: text("bathroom_type").notNull().default("unknown"),
    roomType: text("room_type").notNull().default("auto"),
    salesRate: doublePrecision("sales_rate"),
    promotionRate: doublePrecision("promotion_rate"),
    promotionStartDate: text("promotion_start_date"),
    promotionEndDate: text("promotion_end_date"),
    meterSerial: text("meter_serial").notNull().default(""),
  },
  (table) => [
    uniqueIndex("hostel_room_unique").on(table.unitId, table.roomLabel),
  ],
);

// The standard monthly rate for a room category (A/B/C/D) at a hostel —
// e.g. Damai Room A is always RM750 unless a specific room's own
// sales_rate overrides it. Newly created rooms in a category with a row
// here inherit this rate instead of starting unpriced; the reservation
// payment breakdown reads the same row rather than a hardcoded constant.
export const hostelCategoryRates = pgTable(
  "hostel_category_rates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    hostelId: bigint("hostel_id", { mode: "number" })
      .notNull()
      .references(() => hostelProperties.id),
    roomCategory: text("room_category").notNull(),
    monthlyRate: doublePrecision("monthly_rate").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [
    uniqueIndex("hostel_category_rate_unique").on(
      table.hostelId,
      table.roomCategory,
    ),
  ],
);

export const bedSpaces = pgTable(
  "bed_spaces",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    roomId: bigint("room_id", { mode: "number" })
      .notNull()
      .references(() => hostelRooms.id),
    bedLabel: text("bed_label").notNull(),
    legacyCode: text("legacy_code").notNull().unique(),
    status: text("status").notNull().default("vacant"),
    specialUse: text("special_use"),
    bedType: text("bed_type").notNull().default("unknown"),
    meterSerial: text("meter_serial").notNull().default(""),
    monthlyRental: doublePrecision("monthly_rental"),
    legacyAccessCardDeposit: doublePrecision("legacy_access_card_deposit"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [uniqueIndex("room_bed_unique").on(table.roomId, table.bedLabel)],
);

export const accessCards = pgTable("access_cards", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  unitId: bigint("unit_id", { mode: "number" })
    .notNull()
    .references(() => hostelUnits.id),
  cardCode: text("card_code").notNull().unique(),
  depositAmount: doublePrecision("deposit_amount").notNull().default(0),
  status: text("status").notNull().default("available"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const studentProfiles = pgTable("student_profiles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  sourceKey: text("source_key").notNull().unique(),
  studentCode: text("student_code").notNull().default(""),
  fullName: text("full_name").notNull(),
  identityNo: text("identity_no").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  email: text("email").notNull().default(""),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender").notNull().default("unspecified"),
  race: text("race").notNull().default(""),
  raceOther: text("race_other").notNull().default(""),
  religion: text("religion").notNull().default(""),
  religionOther: text("religion_other").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
  nationalityOther: text("nationality_other").notNull().default(""),
  state: text("state").notNull().default(""),
  hometown: text("hometown").notNull().default(""),
  course: text("course").notNull().default(""),
  school: text("school").notNull().default(""),
  applicationFormNo: text("application_form_no").notNull().default(""),
  receiptNo: text("receipt_no").notNull().default(""),
  salesperson: text("salesperson").notNull().default(""),
  agency: text("agency").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const accommodationAssignments = pgTable("accommodation_assignments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  sourceKey: text("source_key").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => studentProfiles.id),
  bedSpaceId: bigint("bed_space_id", { mode: "number" })
    .notNull()
    .references(() => bedSpaces.id),
  monthlyRental: doublePrecision("monthly_rental"),
  securityDeposit: doublePrecision("security_deposit"),
  accessCardDeposit: doublePrecision("access_card_deposit"),
  parkingDeposit: doublePrecision("parking_deposit"),
  salesperson: text("salesperson").notNull().default(""),
  checkInDate: text("check_in_date"),
  agreementStartDate: text("agreement_start_date"),
  agreementEndDate: text("agreement_end_date"),
  agreementDuration: text("agreement_duration").notNull().default(""),
  checkOutDate: text("check_out_date"),
  checkInMeter: doublePrecision("check_in_meter"),
  checkOutMeter: doublePrecision("check_out_meter"),
  sourceReservationId: bigint("source_reservation_id", { mode: "number" }),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  // Set once staff mark that the student has applied to renew this
  // tenancy — clears the "ending soon, no renewal" flag on the room even
  // though the agreement end date itself hasn't moved yet.
  renewalAppliedAt: text("renewal_applied_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const reservations = pgTable("reservations", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  referenceNo: text("reference_no").notNull().unique(),
  studentName: text("student_name").notNull(),
  reservationType: text("reservation_type").notNull().default("individual"),
  representativeType: text("representative_type").notNull().default("person"),
  salesPerson: text("sales_person").notNull().default(""),
  groupSize: bigint("group_size", { mode: "number" }).notNull().default(1),
  preferredHostelId: bigint("preferred_hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  preferredUnitId: bigint("preferred_unit_id", { mode: "number" }).references(
    () => hostelUnits.id,
  ),
  preferredGender: text("preferred_gender").notNull().default("unspecified"),
  roomCategory: text("room_category").notNull().default("any"),
  roomType: text("room_type").notNull().default("any"),
  bathroomType: text("bathroom_type").notNull().default("any"),
  contactNumber: text("contact_number").notNull().default(""),
  email: text("email").notNull().default(""),
  identityNo: text("identity_no").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
  nationalityOther: text("nationality_other").notNull().default(""),
  state: text("state").notNull().default(""),
  hometown: text("hometown").notNull().default(""),
  race: text("race").notNull().default(""),
  raceOther: text("race_other").notNull().default(""),
  religion: text("religion").notNull().default(""),
  religionOther: text("religion_other").notNull().default(""),
  targetMoveInDate: text("target_move_in_date").notNull(),
  expectedEndDate: text("expected_end_date"),
  budgetMax: doublePrecision("budget_max"),
  provisionalBedSpaceId: bigint("provisional_bed_space_id", {
    mode: "number",
  }).references(() => bedSpaces.id),
  assignedBedSpaceId: bigint("assigned_bed_space_id", {
    mode: "number",
  }).references(() => bedSpaces.id),
  holdExpiresAt: text("hold_expires_at"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  totalPayable: doublePrecision("total_payable"),
  paymentReference: text("payment_reference").notNull().default(""),
  inventoryCommitted: boolean("inventory_committed").notNull().default(false),
  paymentUpdatedAt: text("payment_updated_at"),
  // Set when Finance marks this reservation's payment as reviewed/recorded.
  // Null, or older than paymentUpdatedAt, means Finance hasn't seen the
  // latest payment yet — that's what drives the pending-review badge.
  financeReviewedAt: text("finance_reviewed_at"),
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
  // Soft-cancel: status becomes "cancelled" and this is stamped, but the
  // row (and its payments/charges) stays — unlike reservation-delete, which
  // hard-deletes everything. Kept for accounting history and audit trail.
  cancelledAt: text("cancelled_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const unitServices = pgTable("unit_services", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  unitId: bigint("unit_id", { mode: "number" })
    .notNull()
    .references(() => hostelUnits.id),
  serviceType: text("service_type").notNull(),
  accountHolderName: text("account_holder_name").notNull().default(""),
  provider: text("provider").notNull().default(""),
  accountReference: text("account_reference").notNull().default(""),
  lineType: text("line_type").notNull().default("not-applicable"),
  contractEndDate: text("contract_end_date"),
  servicePackage: text("service_package").notNull().default(""),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  status: text("status").notNull().default("active"),
  surrenderAction: text("surrender_action").notNull().default("review"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const unitOwnerDetails = pgTable(
  "unit_owner_details",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    unitId: bigint("unit_id", { mode: "number" })
      .notNull()
      .references(() => hostelUnits.id),
    ownerName: text("owner_name").notNull().default(""),
    ownerIdentityNo: text("owner_identity_no").notNull().default(""),
    ownerEmail: text("owner_email").notNull().default(""),
    registeredAddress: text("registered_address").notNull().default(""),
    agreementType: text("agreement_type").notNull().default("rental"),
    primaryContactName: text("primary_contact_name").notNull().default(""),
    primaryContactPhone: text("primary_contact_phone").notNull().default(""),
    secondaryContactName: text("secondary_contact_name").notNull().default(""),
    secondaryContactPhone: text("secondary_contact_phone")
      .notNull()
      .default(""),
    bankAccountNumber: text("bank_account_number").notNull().default(""),
    bankAccountHolder: text("bank_account_holder").notNull().default(""),
    bankName: text("bank_name").notNull().default(""),
    leaseStartDate: text("lease_start_date"),
    leaseEndDate: text("lease_end_date"),
    monthlyLeaseRental: doublePrecision("monthly_lease_rental"),
    servicePercentage: doublePrecision("service_percentage"),
    securityDeposit: doublePrecision("security_deposit"),
    utilityDeposit: doublePrecision("utility_deposit"),
    commissionAmount: doublePrecision("commission_amount"),
    tnbAccount: text("tnb_account").notNull().default(""),
    airSelangorAccount: text("air_selangor_account").notNull().default(""),
    indahWaterAccount: text("indah_water_account").notNull().default(""),
    monthlyCleaningFee: doublePrecision("monthly_cleaning_fee"),
    monthlyWaterDispenserFee: doublePrecision("monthly_water_dispenser_fee"),
    notes: text("notes").notNull().default(""),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)::text`),
  },
  (table) => [uniqueIndex("unit_owner_unique").on(table.unitId)],
);

export const reservationPayments = pgTable("reservation_payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  amount: doublePrecision("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("bank-transfer"),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  notes: text("notes").notNull().default(""),
});

export const reservationCharges = pgTable("reservation_charges", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reservationId: bigint("reservation_id", { mode: "number" })
    .notNull()
    .references(() => reservations.id),
  chargeType: text("charge_type").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  notes: text("notes").notNull().default(""),
});

export const studentRateChanges = pgTable("student_rate_changes", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  assignmentId: bigint("assignment_id", { mode: "number" })
    .notNull()
    .references(() => accommodationAssignments.id),
  effectiveDate: text("effective_date").notNull(),
  monthlyRental: doublePrecision("monthly_rental"),
  securityDeposit: doublePrecision("security_deposit"),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const parkingLots = pgTable(
  "parking_lots",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    hostelId: bigint("hostel_id", { mode: "number" })
      .notNull()
      .references(() => hostelProperties.id),
    unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
    lotNumber: text("lot_number").notNull(),
    status: text("status").notNull().default("available"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("parking_lot_unique").on(table.hostelId, table.lotNumber),
  ],
);

export const parkingRentals = pgTable("parking_rentals", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  parkingLotId: bigint("parking_lot_id", { mode: "number" })
    .notNull()
    .references(() => parkingLots.id),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  tenantType: text("tenant_type").notNull().default("in-house"),
  tenantName: text("tenant_name").notNull(),
  contactNumber: text("contact_number").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  carPlateNumber: text("car_plate_number").notNull().default(""),
  carModel: text("car_model").notNull().default(""),
  monthlyRental: doublePrecision("monthly_rental").notNull().default(0),
  depositAmount: doublePrecision("deposit_amount").notNull().default(0),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  paidUntil: text("paid_until"),
  billingFrequency: text("billing_frequency").notNull().default("monthly"),
  packageMonths: bigint("package_months", { mode: "number" }).notNull().default(1),
  nextDueDate: text("next_due_date"),
  paymentStatus: text("payment_status").notNull().default("not-due"),
  status: text("status").notNull().default("active"),
  notes: text("notes").notNull().default(""),
});

export const schools = pgTable("schools", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

// `level` is one of: diploma | degree | foundation | other — grouping the
// course picker so staff can find a course by programme level instead of
// typing the full name from memory.
export const courses = pgTable("courses", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  level: text("level").notNull().default("other"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const maintenanceTickets = pgTable("maintenance_tickets", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  roomId: bigint("room_id", { mode: "number" }).references(() => hostelRooms.id),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull().default(""),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("average"),
  status: text("status").notNull().default("submitted"),
  submittedByType: text("submitted_by_type").notNull().default("staff"),
  assignedTo: text("assigned_to").notNull().default(""),
  attendedAt: text("attended_at"),
  completedAt: text("completed_at"),
  costResponsibility: text("cost_responsibility")
    .notNull()
    .default("management"),
  estimatedCost: doublePrecision("estimated_cost"),
  actualCost: doublePrecision("actual_cost"),
  studentCharge: doublePrecision("student_charge"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketId: bigint("ticket_id", { mode: "number" })
    .notNull()
    .references(() => maintenanceTickets.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull().default("staff"),
  message: text("message").notNull(),
  statusAfter: text("status_after"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const ticketCategories = pgTable(
  "ticket_categories",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    status: text("status").notNull().default("active"),
    sortOrder: bigint("sort_order", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    uniqueIndex("ticket_category_unique").on(table.category, table.subcategory),
  ],
);

export const generalCosts = pgTable("general_costs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  costDate: text("cost_date").notNull(),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  ticketId: bigint("ticket_id", { mode: "number" }).references(
    () => maintenanceTickets.id,
  ),
  costType: text("cost_type").notNull().default("maintenance"),
  description: text("description").notNull(),
  responsibility: text("responsibility").notNull().default("management"),
  amount: doublePrecision("amount").notNull().default(0),
  studentCharge: doublePrecision("student_charge").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const storedAttachments = pgTable("stored_attachments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  contextType: text("context_type").notNull(),
  recordId: bigint("record_id", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type")
    .notNull()
    .default("application/octet-stream"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  uploadedBy: text("uploaded_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const meterReadings = pgTable("meter_readings", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  bedSpaceId: bigint("bed_space_id", { mode: "number" })
    .notNull()
    .references(() => bedSpaces.id),
  roomId: bigint("room_id", { mode: "number" }).references(() => hostelRooms.id),
  readingDate: text("reading_date").notNull(),
  readingValue: doublePrecision("reading_value").notNull(),
  readingType: text("reading_type").notNull().default("monthly"),
  submittedBy: text("submitted_by").notNull().default("Maintenance Team"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingCycles = pgTable("billing_cycles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  periodLabel: text("period_label").notNull().unique(),
  cutoffDate: text("cutoff_date").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("draft"),
  postedAt: text("posted_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingInvoices = pgTable("billing_invoices", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceNo: text("invoice_no").notNull().unique(),
  cycleId: bigint("cycle_id", { mode: "number" })
    .notNull()
    .references(() => billingCycles.id),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => studentProfiles.id),
  assignmentId: bigint("assignment_id", { mode: "number" }).references(
    () => accommodationAssignments.id,
  ),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  totalAmount: doublePrecision("total_amount").notNull().default(0),
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  invoiceFrequency: text("invoice_frequency").notNull().default("on-request"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const billingItems = pgTable(
  "billing_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => billingInvoices.id),
    itemType: text("item_type").notNull(),
    description: text("description").notNull(),
    quantity: doublePrecision("quantity").notNull().default(1),
    rate: doublePrecision("rate").notNull().default(0),
    amount: doublePrecision("amount").notNull().default(0),
  },
  (table) => [
    // Each invoice can only carry one late-payment-charge line item — this
    // is what lets applyLatePaymentCharges use a single atomic upsert
    // instead of a select-then-branch that two concurrent runs could both
    // pass, each inserting their own duplicate row.
    uniqueIndex("billing_item_late_charge_unique")
      .on(table.invoiceId)
      .where(sql`item_type = 'late-payment-charge'`),
  ],
);

export const billingPaymentRecords = pgTable("billing_payment_records", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceId: bigint("invoice_id", { mode: "number" })
    .notNull()
    .references(() => billingInvoices.id),
  amount: doublePrecision("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  remark: text("remark").notNull().default(""),
  status: text("status").notNull().default("pending-verification"),
  proofAttachmentId: bigint("proof_attachment_id", { mode: "number" }).references(
    () => storedAttachments.id,
  ),
  submittedAt: text("submitted_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  verifiedAt: text("verified_at"),
  verifiedBy: text("verified_by").notNull().default(""),
  verifiedAmount: doublePrecision("verified_amount"),
  actualReference: text("actual_reference").notNull().default(""),
  receiptNo: text("receipt_no").notNull().default(""),
});

export const billingItemAdjustments = pgTable("billing_item_adjustments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  billingItemId: bigint("billing_item_id", { mode: "number" })
    .notNull()
    .references(() => billingItems.id),
  previousAmount: doublePrecision("previous_amount").notNull().default(0),
  newAmount: doublePrecision("new_amount").notNull().default(0),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: text("approved_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  approvedAt: text("approved_at"),
});

export const announcements = pgTable("announcements", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audienceType: text("audience_type").notNull().default("all"),
  hostelId: bigint("hostel_id", { mode: "number" }).references(
    () => hostelProperties.id,
  ),
  blockCode: text("block_code").notNull().default(""),
  unitId: bigint("unit_id", { mode: "number" }).references(() => hostelUnits.id),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("published"),
  pinned: boolean("pinned").notNull().default(false),
  publishAt: text("publish_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  expiresAt: text("expires_at"),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const appRoles = pgTable("app_roles", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  roleKey: text("role_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const appUsers = pgTable("app_users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  roleId: bigint("role_id", { mode: "number" })
    .notNull()
    .references(() => appRoles.id),
  studentId: bigint("student_id", { mode: "number" }).references(
    () => studentProfiles.id,
  ),
  status: text("status").notNull().default("active"),
  // PBKDF2 digest: pbkdf2$<iterations>$<saltB64>$<hashB64>. Empty = no password set.
  passwordHash: text("password_hash").notNull().default(""),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const userSessions = pgTable("user_sessions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  // SHA-256 of the cookie token; the raw token is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => appUsers.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => appRoles.id),
    moduleKey: text("module_key").notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    canApprove: boolean("can_approve").notNull().default(false),
  },
  (table) => [
    uniqueIndex("role_permission_unique").on(table.roleId, table.moduleKey),
  ],
);

export const reminderTemplates = pgTable("reminder_templates", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  reminderKey: text("reminder_key").notNull().unique(),
  dayOfMonth: bigint("day_of_month", { mode: "number" }).notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});

// The original prototype tables remain declared so schema tooling doesn't
// flag them as unexpected drift against the live database (they exist there
// too, as empty unused duplicates). The application never reads or writes
// these tables — do not add real logic against them.
export const legacyHostels = pgTable("hostels", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  wardenName: text("warden_name").notNull().default(""),
});
export const legacyRooms = pgTable("rooms", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  hostelId: bigint("hostel_id", { mode: "number" })
    .notNull()
    .references(() => legacyHostels.id),
  roomNumber: text("room_number").notNull(),
  floor: bigint("floor", { mode: "number" }).notNull().default(1),
  capacity: bigint("capacity", { mode: "number" }).notNull().default(2),
  monthlyRate: doublePrecision("monthly_rate").notNull().default(0),
  status: text("status").notNull().default("available"),
});
export const legacyStudents = pgTable("students", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  studentNo: text("student_no").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  course: text("course").notNull().default(""),
  intake: text("intake").notNull().default(""),
  emergencyContact: text("emergency_contact").notNull().default(""),
  roomId: bigint("room_id", { mode: "number" }).references(() => legacyRooms.id),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyComplaints = pgTable("complaints", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => legacyStudents.id),
  category: text("category").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to").notNull().default("Facilities Team"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyInvoices = pgTable("invoices", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceNo: text("invoice_no").notNull().unique(),
  studentId: bigint("student_id", { mode: "number" })
    .notNull()
    .references(() => legacyStudents.id),
  description: text("description").notNull(),
  amount: doublePrecision("amount").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
export const legacyPayments = pgTable("payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  invoiceId: bigint("invoice_id", { mode: "number" })
    .notNull()
    .references(() => legacyInvoices.id),
  amount: doublePrecision("amount").notNull(),
  method: text("method").notNull().default("bank transfer"),
  reference: text("reference").notNull().default(""),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)::text`),
});
