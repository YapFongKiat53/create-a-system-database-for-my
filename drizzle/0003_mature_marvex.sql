CREATE TABLE `unit_owner_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`owner_name` text DEFAULT '' NOT NULL,
	`primary_contact_name` text DEFAULT '' NOT NULL,
	`primary_contact_phone` text DEFAULT '' NOT NULL,
	`secondary_contact_name` text DEFAULT '' NOT NULL,
	`secondary_contact_phone` text DEFAULT '' NOT NULL,
	`lease_start_date` text,
	`lease_end_date` text,
	`monthly_lease_rental` real,
	`security_deposit` real,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_owner_unique` ON `unit_owner_details` (`unit_id`);--> statement-breakpoint
ALTER TABLE `bed_spaces` ADD `bed_type` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `sales_rate` real;--> statement-breakpoint
ALTER TABLE `reservations` ADD `room_category` text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `expected_end_date` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_status` text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `amount_paid` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `total_payable` real;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `inventory_committed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `payment_updated_at` text;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `account_holder_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `line_type` text DEFAULT 'not-applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `contract_end_date` text;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `service_package` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `username` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `password` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_services` ADD `remarks` text DEFAULT '' NOT NULL;