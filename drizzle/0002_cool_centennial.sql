CREATE TABLE `accommodation_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`student_id` integer NOT NULL,
	`bed_space_id` integer NOT NULL,
	`monthly_rental` real,
	`security_deposit` real,
	`access_card_deposit` real,
	`salesperson` text DEFAULT '' NOT NULL,
	`check_in_date` text,
	`agreement_start_date` text,
	`agreement_end_date` text,
	`agreement_duration` text DEFAULT '' NOT NULL,
	`check_out_date` text,
	`check_in_meter` real,
	`remarks` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bed_space_id`) REFERENCES `bed_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accommodation_assignments_source_key_unique` ON `accommodation_assignments` (`source_key`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference_no` text NOT NULL,
	`student_name` text NOT NULL,
	`preferred_hostel_id` integer,
	`preferred_gender` text DEFAULT 'unspecified' NOT NULL,
	`room_type` text DEFAULT 'any' NOT NULL,
	`bathroom_type` text DEFAULT 'any' NOT NULL,
	`target_move_in_date` text NOT NULL,
	`budget_max` real,
	`provisional_bed_space_id` integer,
	`hold_expires_at` text,
	`status` text DEFAULT 'reserved' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`preferred_hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provisional_bed_space_id`) REFERENCES `bed_spaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_reference_no_unique` ON `reservations` (`reference_no`);--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`student_code` text DEFAULT '' NOT NULL,
	`full_name` text NOT NULL,
	`nationality` text DEFAULT '' NOT NULL,
	`hometown` text DEFAULT '' NOT NULL,
	`course` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_profiles_source_key_unique` ON `student_profiles` (`source_key`);--> statement-breakpoint
CREATE TABLE `unit_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`service_type` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`account_reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`surrender_action` text DEFAULT 'review' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `bathroom_type` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_units` ADD `owner_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_units` ADD `lease_end_date` text;--> statement-breakpoint
ALTER TABLE `hostel_units` ADD `surrender_date` text;--> statement-breakpoint
ALTER TABLE `hostel_units` ADD `surrender_notes` text DEFAULT '' NOT NULL;