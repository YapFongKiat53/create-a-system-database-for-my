CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience_type` text DEFAULT 'all' NOT NULL,
	`hostel_id` integer,
	`block_code` text DEFAULT '' NOT NULL,
	`unit_id` integer,
	`priority` text DEFAULT 'normal' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`publish_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`created_by` text DEFAULT 'Administrator' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `billing_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_label` text NOT NULL,
	`cutoff_date` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`posted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_cycles_period_label_unique` ON `billing_cycles` (`period_label`);--> statement-breakpoint
CREATE TABLE `billing_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_no` text NOT NULL,
	`cycle_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`assignment_id` integer,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`invoice_frequency` text DEFAULT 'on-request' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `billing_cycles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `accommodation_assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_invoices_invoice_no_unique` ON `billing_invoices` (`invoice_no`);--> statement-breakpoint
CREATE TABLE `billing_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`item_type` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `billing_payment_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending-verification' NOT NULL,
	`proof_attachment_id` integer,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`verified_at` text,
	`verified_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proof_attachment_id`) REFERENCES `stored_attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `maintenance_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_no` text NOT NULL,
	`student_id` integer,
	`hostel_id` integer,
	`unit_id` integer,
	`room_id` integer,
	`category` text NOT NULL,
	`subcategory` text DEFAULT '' NOT NULL,
	`subject` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'average' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_by_type` text DEFAULT 'staff' NOT NULL,
	`assigned_to` text DEFAULT '' NOT NULL,
	`attended_at` text,
	`completed_at` text,
	`cost_responsibility` text DEFAULT 'management' NOT NULL,
	`estimated_cost` real,
	`actual_cost` real,
	`student_charge` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `maintenance_tickets_ticket_no_unique` ON `maintenance_tickets` (`ticket_no`);--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bed_space_id` integer NOT NULL,
	`reading_date` text NOT NULL,
	`reading_value` real NOT NULL,
	`reading_type` text DEFAULT 'monthly' NOT NULL,
	`submitted_by` text DEFAULT 'Maintenance Team' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bed_space_id`) REFERENCES `bed_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `parking_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostel_id` integer NOT NULL,
	`unit_id` integer,
	`lot_number` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parking_lot_unique` ON `parking_lots` (`hostel_id`,`lot_number`);--> statement-breakpoint
CREATE TABLE `parking_rentals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parking_lot_id` integer NOT NULL,
	`student_id` integer,
	`tenant_type` text DEFAULT 'in-house' NOT NULL,
	`tenant_name` text NOT NULL,
	`contact_number` text DEFAULT '' NOT NULL,
	`unit_number` text DEFAULT '' NOT NULL,
	`car_plate_number` text DEFAULT '' NOT NULL,
	`car_model` text DEFAULT '' NOT NULL,
	`monthly_rental` real DEFAULT 0 NOT NULL,
	`deposit_amount` real DEFAULT 0 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`paid_until` text,
	`billing_frequency` text DEFAULT 'monthly' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`parking_lot_id`) REFERENCES `parking_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reservation_charges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` integer NOT NULL,
	`charge_type` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reservation_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reservation_id` integer NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`payment_method` text DEFAULT 'bank-transfer' NOT NULL,
	`paid_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stored_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`context_type` text NOT NULL,
	`record_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stored_attachments_object_key_unique` ON `stored_attachments` (`object_key`);--> statement-breakpoint
CREATE TABLE `student_rate_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`effective_date` text NOT NULL,
	`monthly_rental` real,
	`security_deposit` real,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `accommodation_assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`author_name` text NOT NULL,
	`author_role` text DEFAULT 'staff' NOT NULL,
	`message` text NOT NULL,
	`status_after` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `maintenance_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `accommodation_assignments` ADD `parking_deposit` real;--> statement-breakpoint
ALTER TABLE `accommodation_assignments` ADD `check_out_meter` real;--> statement-breakpoint
ALTER TABLE `accommodation_assignments` ADD `source_reservation_id` integer;--> statement-breakpoint
ALTER TABLE `bed_spaces` ADD `meter_serial` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_properties` ADD `electricity_rate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_properties` ADD `monthly_cleaning_fee` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_properties` ADD `monthly_water_dispenser_fee` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `room_type` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `promotion_rate` real;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `promotion_start_date` text;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `promotion_end_date` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `reservation_type` text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `representative_type` text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `sales_person` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `group_size` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `preferred_unit_id` integer REFERENCES hostel_units(id);--> statement-breakpoint
ALTER TABLE `reservations` ADD `assigned_bed_space_id` integer REFERENCES bed_spaces(id);--> statement-breakpoint
ALTER TABLE `reservations` ADD `converted_at` text;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `identity_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `contact_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `date_of_birth` text;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `gender` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `race` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `religion` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `school` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `application_form_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `receipt_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `salesperson` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `agency` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD `remarks` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `agreement_type` text DEFAULT 'rental' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `bank_account_number` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `bank_account_holder` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `bank_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `service_percentage` real;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `utility_deposit` real;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `commission_amount` real;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `tnb_account` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `air_selangor_account` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `indah_water_account` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `monthly_cleaning_fee` real;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `monthly_water_dispenser_fee` real;