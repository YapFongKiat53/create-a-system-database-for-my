ALTER TABLE "reservations" ADD COLUMN "contact_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "state" text DEFAULT '' NOT NULL;