CREATE TABLE `owner_parking_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`parking_lot_id` integer,
	`period` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`payment_date` text NOT NULL,
	`method` text DEFAULT 'bank-transfer' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`remarks` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `hostel_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parking_lot_id`) REFERENCES `parking_lots`(`id`) ON UPDATE no action ON DELETE no action
);
