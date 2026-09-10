ALTER TABLE "hostel_units" ADD COLUMN "electricity_billing" text DEFAULT 'meter' NOT NULL;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD COLUMN "replaced_meter_final" double precision;