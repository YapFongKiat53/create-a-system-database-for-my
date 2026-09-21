ALTER TABLE "billing_invoices" ADD COLUMN "late_charge_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "late_charge_exempt_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "late_charge_exempt_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD COLUMN "late_charge_exempt_at" text;