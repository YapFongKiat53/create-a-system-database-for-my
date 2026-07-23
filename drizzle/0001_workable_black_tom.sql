CREATE TABLE `access_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`card_code` text NOT NULL,
	`deposit_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_cards_card_code_unique` ON `access_cards` (`card_code`);--> statement-breakpoint
CREATE TABLE `bed_spaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`bed_label` text NOT NULL,
	`legacy_code` text NOT NULL,
	`status` text DEFAULT 'vacant' NOT NULL,
	`special_use` text,
	`monthly_rental` real,
	`legacy_access_card_deposit` real,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `hostel_rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bed_spaces_legacy_code_unique` ON `bed_spaces` (`legacy_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_bed_unique` ON `bed_spaces` (`room_id`,`bed_label`);--> statement-breakpoint
CREATE TABLE `hostel_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hostel_properties_code_unique` ON `hostel_properties` (`code`);--> statement-breakpoint
CREATE TABLE `hostel_rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`room_label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hostel_room_unique` ON `hostel_rooms` (`unit_id`,`room_label`);--> statement-breakpoint
CREATE TABLE `hostel_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostel_id` integer NOT NULL,
	`unit_code` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`gender` text DEFAULT 'mixed' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hostel_unit_unique` ON `hostel_units` (`hostel_id`,`unit_code`);