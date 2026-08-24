ALTER TABLE "accommodation_assignments" ADD COLUMN "expected_return_date" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "course" text DEFAULT '' NOT NULL;