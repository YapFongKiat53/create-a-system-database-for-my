CREATE TABLE `app_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_roles_role_key_unique` ON `app_roles` (`role_key`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role_id` integer NOT NULL,
	`student_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `app_roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);--> statement-breakpoint
CREATE TABLE `billing_item_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`billing_item_id` integer NOT NULL,
	`previous_amount` real DEFAULT 0 NOT NULL,
	`new_amount` real DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`requested_by` text NOT NULL,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	FOREIGN KEY (`billing_item_id`) REFERENCES `billing_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `general_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cost_date` text NOT NULL,
	`hostel_id` integer,
	`unit_id` integer,
	`ticket_id` integer,
	`cost_type` text DEFAULT 'maintenance' NOT NULL,
	`description` text NOT NULL,
	`responsibility` text DEFAULT 'management' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`student_charge` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT 'Administrator' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`hostel_id`) REFERENCES `hostel_properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ticket_id`) REFERENCES `maintenance_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reminder_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reminder_key` text NOT NULL,
	`day_of_month` integer NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_templates_reminder_key_unique` ON `reminder_templates` (`reminder_key`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`module_key` text NOT NULL,
	`can_view` integer DEFAULT false NOT NULL,
	`can_create` integer DEFAULT false NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	`can_approve` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `app_roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permission_unique` ON `role_permissions` (`role_id`,`module_key`);--> statement-breakpoint
CREATE TABLE `ticket_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`subcategory` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_category_unique` ON `ticket_categories` (`category`,`subcategory`);--> statement-breakpoint
ALTER TABLE `announcements` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_payment_records` ADD `remark` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_payment_records` ADD `verified_amount` real;--> statement-breakpoint
ALTER TABLE `billing_payment_records` ADD `actual_reference` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_payment_records` ADD `receipt_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hostel_rooms` ADD `meter_serial` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meter_readings` ADD `room_id` integer REFERENCES hostel_rooms(id);--> statement-breakpoint
ALTER TABLE `parking_rentals` ADD `package_months` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `parking_rentals` ADD `next_due_date` text;--> statement-breakpoint
ALTER TABLE `parking_rentals` ADD `payment_status` text DEFAULT 'not-due' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `owner_identity_no` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `owner_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unit_owner_details` ADD `registered_address` text DEFAULT '' NOT NULL;