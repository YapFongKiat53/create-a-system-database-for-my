ALTER TABLE "reservations" ADD COLUMN "nationality" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "nationality_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "hometown" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "race" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "race_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "religion" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "religion_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "race_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "religion_other" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "nationality_other" text DEFAULT '' NOT NULL;