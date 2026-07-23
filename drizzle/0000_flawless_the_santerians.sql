CREATE TABLE `complaints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_no` text NOT NULL,
	`student_id` integer NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_to` text DEFAULT 'Facilities Team' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `complaints_ticket_no_unique` ON `complaints` (`ticket_no`);--> statement-breakpoint
CREATE TABLE `hostels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`warden_name` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_no` text NOT NULL,
	`student_id` integer NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_no_unique` ON `invoices` (`invoice_no`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount` real NOT NULL,
	`method` text DEFAULT 'bank transfer' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`paid_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hostel_id` integer NOT NULL,
	`room_number` text NOT NULL,
	`floor` integer DEFAULT 1 NOT NULL,
	`capacity` integer DEFAULT 2 NOT NULL,
	`monthly_rate` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_no` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`course` text DEFAULT '' NOT NULL,
	`intake` text DEFAULT '' NOT NULL,
	`emergency_contact` text DEFAULT '' NOT NULL,
	`room_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_student_no_unique` ON `students` (`student_no`);