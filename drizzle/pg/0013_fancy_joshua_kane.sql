ALTER TABLE "billing_invoices" ALTER COLUMN "cycle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN "verified_at" text;--> statement-breakpoint
ALTER TABLE "billing_items" ADD COLUMN "verified_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "date_of_birth" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "school" text DEFAULT '' NOT NULL;