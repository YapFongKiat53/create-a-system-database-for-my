ALTER TABLE "accommodation_assignments" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "whole_unit_monthly_rent" double precision;