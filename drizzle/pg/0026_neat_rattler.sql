ALTER TABLE "parking_lots" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "parking_lots" ADD COLUMN "deleted_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "parking_rentals" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "parking_rentals" ADD COLUMN "deleted_by" text DEFAULT '' NOT NULL;