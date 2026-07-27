import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const hostelProperties = sqliteTable("hostel_properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"),
  electricityRate: real("electricity_rate").notNull().default(0),
  monthlyCleaningFee: real("monthly_cleaning_fee").notNull().default(0),
  monthlyWaterDispenserFee: real("monthly_water_dispenser_fee")
    .notNull()
    .default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const hostelUnits = sqliteTable(
  "hostel_units",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostelId: integer("hostel_id")
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

export const hostelRooms = sqliteTable(
  "hostel_rooms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => hostelUnits.id),
    roomLabel: text("room_label").notNull(),
    status: text("status").notNull().default("active"),
    bathroomType: text("bathroom_type").notNull().default("unknown"),
    roomType: text("room_type").notNull().default("auto"),
    salesRate: real("sales_rate"),
    promotionRate: real("promotion_rate"),
    promotionStartDate: text("promotion_start_date"),
    promotionEndDate: text("promotion_end_date"),
    meterSerial: text("meter_serial").notNull().default(""),
  },
  (table) => [
    uniqueIndex("hostel_room_unique").on(table.unitId, table.roomLabel),
  ],
);

export const bedSpaces = sqliteTable(
  "bed_spaces",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => hostelRooms.id),
    bedLabel: text("bed_label").notNull(),
    legacyCode: text("legacy_code").notNull().unique(),
    status: text("status").notNull().default("vacant"),
    specialUse: text("special_use"),
    bedType: text("bed_type").notNull().default("unknown"),
    meterSerial: text("meter_serial").notNull().default(""),
    monthlyRental: real("monthly_rental"),
    legacyAccessCardDeposit: real("legacy_access_card_deposit"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("room_bed_unique").on(table.roomId, table.bedLabel)],
);

export const accessCards = sqliteTable("access_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => hostelUnits.id),
  cardCode: text("card_code").notNull().unique(),
  depositAmount: real("deposit_amount").notNull().default(0),
  status: text("status").notNull().default("available"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const studentProfiles = sqliteTable("student_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull().unique(),
  studentCode: text("student_code").notNull().default(""),
  fullName: text("full_name").notNull(),
  identityNo: text("identity_no").notNull().default(""),
  contactNumber: text("contact_number").notNull().default(""),
  email: text("email").notNull().default(""),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender").notNull().default("unspecified"),
  race: text("race").notNull().default(""),
  religion: text("religion").notNull().default(""),
  nationality: text("nationality").notNull().default(""),
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
    .default(sql`CURRENT_TIMESTAMP`),
});

export const accommodationAssignments = sqliteTable(
  "accommodation_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull().unique(),
    studentId: integer("student_id")
      .notNull()
      .references(() => studentProfiles.id),
    bedSpaceId: integer("bed_space_id")
      .notNull()
      .references(() => bedSpaces.id),
    monthlyRental: real("monthly_rental"),
    securityDeposit: real("security_deposit"),
    accessCardDeposit: real("access_card_deposit"),
    parkingDeposit: real("parking_deposit"),
    salesperson: text("salesperson").notNull().default(""),
    checkInDate: text("check_in_date"),
    agreementStartDate: text("agreement_start_date"),
    agreementEndDate: text("agreement_end_date"),
    agreementDuration: text("agreement_duration").notNull().default(""),
    checkOutDate: text("check_out_date"),
    checkInMeter: real("check_in_meter"),
    checkOutMeter: real("check_out_meter"),
    sourceReservationId: integer("source_reservation_id"),
    remarks: text("remarks").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);

export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  referenceNo: text("reference_no").notNull().unique(),
  studentName: text("student_name").notNull(),
  reservationType: text("reservation_type").notNull().default("individual"),
  representativeType: text("representative_type").notNull().default("person"),
  salesPerson: text("sales_person").notNull().default(""),
  groupSize: integer("group_size").notNull().default(1),
  preferredHostelId: integer("preferred_hostel_id").references(
    () => hostelProperties.id,
  ),
  preferredUnitId: integer("preferred_unit_id").references(
    () => hostelUnits.id,
  ),
  preferredGender: text("preferred_gender").notNull().default("unspecified"),
  roomCategory: text("room_category").notNull().default("any"),
  roomType: text("room_type").notNull().default("any"),
  bathroomType: text("bathroom_type").notNull().default("any"),
  targetMoveInDate: text("target_move_in_date").notNull(),
  expectedEndDate: text("expected_end_date"),
  budgetMax: real("budget_max"),
  provisionalBedSpaceId: integer("provisional_bed_space_id").references(
    () => bedSpaces.id,
  ),
  assignedBedSpaceId: integer("assigned_bed_space_id").references(
    () => bedSpaces.id,
  ),
  holdExpiresAt: text("hold_expires_at"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  amountPaid: real("amount_paid").notNull().default(0),
  totalPayable: real("total_payable"),
  paymentReference: text("payment_reference").notNull().default(""),
  inventoryCommitted: integer("inventory_committed", { mode: "boolean" })
    .notNull()
    .default(false),
  paymentUpdatedAt: text("payment_updated_at"),
  status: text("status").notNull().default("reserved"),
  convertedAt: text("converted_at"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const unitServices = sqliteTable("unit_services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  unitId: integer("unit_id")
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
    .default(sql`CURRENT_TIMESTAMP`),
});

export const unitOwnerDetails = sqliteTable(
  "unit_owner_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    unitId: integer("unit_id")
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
    monthlyLeaseRental: real("monthly_lease_rental"),
    servicePercentage: real("service_percentage"),
    securityDeposit: real("security_deposit"),
    utilityDeposit: real("utility_deposit"),
    commissionAmount: real("commission_amount"),
    tnbAccount: text("tnb_account").notNull().default(""),
    airSelangorAccount: text("air_selangor_account").notNull().default(""),
    indahWaterAccount: text("indah_water_account").notNull().default(""),
    monthlyCleaningFee: real("monthly_cleaning_fee"),
    monthlyWaterDispenserFee: real("monthly_water_dispenser_fee"),
    notes: text("notes").notNull().default(""),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("unit_owner_unique").on(table.unitId)],
);

export const reservationPayments = sqliteTable("reservation_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reservationId: integer("reservation_id")
    .notNull()
    .references(() => reservations.id),
  amount: real("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("bank-transfer"),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes").notNull().default(""),
});

export const reservationCharges = sqliteTable("reservation_charges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reservationId: integer("reservation_id")
    .notNull()
    .references(() => reservations.id),
  chargeType: text("charge_type").notNull(),
  amount: real("amount").notNull().default(0),
  notes: text("notes").notNull().default(""),
});

export const studentRateChanges = sqliteTable("student_rate_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assignmentId: integer("assignment_id")
    .notNull()
    .references(() => accommodationAssignments.id),
  effectiveDate: text("effective_date").notNull(),
  monthlyRental: real("monthly_rental"),
  securityDeposit: real("security_deposit"),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const parkingLots = sqliteTable(
  "parking_lots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    hostelId: integer("hostel_id")
      .notNull()
      .references(() => hostelProperties.id),
    unitId: integer("unit_id").references(() => hostelUnits.id),
    lotNumber: text("lot_number").notNull(),
    status: text("status").notNull().default("available"),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    uniqueIndex("parking_lot_unique").on(table.hostelId, table.lotNumber),
  ],
);

export const parkingRentals = sqliteTable("parking_rentals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parkingLotId: integer("parking_lot_id")
    .notNull()
    .references(() => parkingLots.id),
  studentId: integer("student_id").references(() => studentProfiles.id),
  tenantType: text("tenant_type").notNull().default("in-house"),
  tenantName: text("tenant_name").notNull(),
  contactNumber: text("contact_number").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  carPlateNumber: text("car_plate_number").notNull().default(""),
  carModel: text("car_model").notNull().default(""),
  monthlyRental: real("monthly_rental").notNull().default(0),
  depositAmount: real("deposit_amount").notNull().default(0),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  paidUntil: text("paid_until"),
  billingFrequency: text("billing_frequency").notNull().default("monthly"),
  packageMonths: integer("package_months").notNull().default(1),
  nextDueDate: text("next_due_date"),
  paymentStatus: text("payment_status").notNull().default("not-due"),
  status: text("status").notNull().default("active"),
  notes: text("notes").notNull().default(""),
});

export const ownerParkingPayments = sqliteTable("owner_parking_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  unitId: integer("unit_id")
    .notNull()
    .references(() => hostelUnits.id),
  parkingLotId: integer("parking_lot_id").references(() => parkingLots.id),
  period: text("period").notNull().default(""),
  amount: real("amount").notNull().default(0),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull().default("bank-transfer"),
  reference: text("reference").notNull().default(""),
  status: text("status").notNull().default("paid"),
  remarks: text("remarks").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const schools = sqliteTable("schools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const maintenanceTickets = sqliteTable("maintenance_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: integer("student_id").references(() => studentProfiles.id),
  hostelId: integer("hostel_id").references(() => hostelProperties.id),
  unitId: integer("unit_id").references(() => hostelUnits.id),
  roomId: integer("room_id").references(() => hostelRooms.id),
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
  estimatedCost: real("estimated_cost"),
  actualCost: real("actual_cost"),
  studentCharge: real("student_charge"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const ticketMessages = sqliteTable("ticket_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => maintenanceTickets.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull().default("staff"),
  message: text("message").notNull(),
  statusAfter: text("status_after"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const ticketCategories = sqliteTable(
  "ticket_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    status: text("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("ticket_category_unique").on(table.category, table.subcategory),
  ],
);

export const generalCosts = sqliteTable("general_costs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  costDate: text("cost_date").notNull(),
  hostelId: integer("hostel_id").references(() => hostelProperties.id),
  unitId: integer("unit_id").references(() => hostelUnits.id),
  ticketId: integer("ticket_id").references(() => maintenanceTickets.id),
  costType: text("cost_type").notNull().default("maintenance"),
  description: text("description").notNull(),
  responsibility: text("responsibility").notNull().default("management"),
  amount: real("amount").notNull().default(0),
  studentCharge: real("student_charge").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const storedAttachments = sqliteTable("stored_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contextType: text("context_type").notNull(),
  recordId: integer("record_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type")
    .notNull()
    .default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  uploadedBy: text("uploaded_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const meterReadings = sqliteTable("meter_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bedSpaceId: integer("bed_space_id")
    .notNull()
    .references(() => bedSpaces.id),
  roomId: integer("room_id").references(() => hostelRooms.id),
  readingDate: text("reading_date").notNull(),
  readingValue: real("reading_value").notNull(),
  readingType: text("reading_type").notNull().default("monthly"),
  submittedBy: text("submitted_by").notNull().default("Maintenance Team"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const billingCycles = sqliteTable("billing_cycles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodLabel: text("period_label").notNull().unique(),
  cutoffDate: text("cutoff_date").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("draft"),
  postedAt: text("posted_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const billingInvoices = sqliteTable("billing_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNo: text("invoice_no").notNull().unique(),
  cycleId: integer("cycle_id")
    .notNull()
    .references(() => billingCycles.id),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentProfiles.id),
  assignmentId: integer("assignment_id").references(
    () => accommodationAssignments.id,
  ),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  totalAmount: real("total_amount").notNull().default(0),
  amountPaid: real("amount_paid").notNull().default(0),
  invoiceFrequency: text("invoice_frequency").notNull().default("on-request"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const billingItems = sqliteTable("billing_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => billingInvoices.id),
  itemType: text("item_type").notNull(),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  rate: real("rate").notNull().default(0),
  amount: real("amount").notNull().default(0),
});

export const billingPaymentRecords = sqliteTable("billing_payment_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => billingInvoices.id),
  amount: real("amount").notNull().default(0),
  reference: text("reference").notNull().default(""),
  remark: text("remark").notNull().default(""),
  status: text("status").notNull().default("pending-verification"),
  proofAttachmentId: integer("proof_attachment_id").references(
    () => storedAttachments.id,
  ),
  submittedAt: text("submitted_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  verifiedAt: text("verified_at"),
  verifiedBy: text("verified_by").notNull().default(""),
  verifiedAmount: real("verified_amount"),
  actualReference: text("actual_reference").notNull().default(""),
  receiptNo: text("receipt_no").notNull().default(""),
});

export const billingItemAdjustments = sqliteTable("billing_item_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  billingItemId: integer("billing_item_id")
    .notNull()
    .references(() => billingItems.id),
  previousAmount: real("previous_amount").notNull().default(0),
  newAmount: real("new_amount").notNull().default(0),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedBy: text("approved_by").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  approvedAt: text("approved_at"),
});

export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audienceType: text("audience_type").notNull().default("all"),
  hostelId: integer("hostel_id").references(() => hostelProperties.id),
  blockCode: text("block_code").notNull().default(""),
  unitId: integer("unit_id").references(() => hostelUnits.id),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("published"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  publishAt: text("publish_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at"),
  createdBy: text("created_by").notNull().default("Administrator"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const appRoles = sqliteTable("app_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roleKey: text("role_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  roleId: integer("role_id")
    .notNull()
    .references(() => appRoles.id),
  studentId: integer("student_id").references(() => studentProfiles.id),
  status: text("status").notNull().default("active"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roleId: integer("role_id")
      .notNull()
      .references(() => appRoles.id),
    moduleKey: text("module_key").notNull(),
    canView: integer("can_view", { mode: "boolean" }).notNull().default(false),
    canCreate: integer("can_create", { mode: "boolean" })
      .notNull()
      .default(false),
    canEdit: integer("can_edit", { mode: "boolean" }).notNull().default(false),
    canDelete: integer("can_delete", { mode: "boolean" })
      .notNull()
      .default(false),
    canApprove: integer("can_approve", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("role_permission_unique").on(table.roleId, table.moduleKey),
  ],
);

export const reminderTemplates = sqliteTable("reminder_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reminderKey: text("reminder_key").notNull().unique(),
  dayOfMonth: integer("day_of_month").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// The original prototype tables remain declared so the hosted migration can add
// the rebuilt module without risking destructive changes. The application no
// longer reads or writes these tables.
export const legacyHostels = sqliteTable("hostels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  wardenName: text("warden_name").notNull().default(""),
});
export const legacyRooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hostelId: integer("hostel_id")
    .notNull()
    .references(() => legacyHostels.id),
  roomNumber: text("room_number").notNull(),
  floor: integer("floor").notNull().default(1),
  capacity: integer("capacity").notNull().default(2),
  monthlyRate: real("monthly_rate").notNull().default(0),
  status: text("status").notNull().default("available"),
});
export const legacyStudents = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentNo: text("student_no").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  course: text("course").notNull().default(""),
  intake: text("intake").notNull().default(""),
  emergencyContact: text("emergency_contact").notNull().default(""),
  roomId: integer("room_id").references(() => legacyRooms.id),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const legacyComplaints = sqliteTable("complaints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketNo: text("ticket_no").notNull().unique(),
  studentId: integer("student_id")
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
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const legacyInvoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNo: text("invoice_no").notNull().unique(),
  studentId: integer("student_id")
    .notNull()
    .references(() => legacyStudents.id),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("unpaid"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const legacyPayments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => legacyInvoices.id),
  amount: real("amount").notNull(),
  method: text("method").notNull().default("bank transfer"),
  reference: text("reference").notNull().default(""),
  paidAt: text("paid_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
