ALTER TABLE "reservation_charges" ADD COLUMN "paid_at" text;--> statement-breakpoint
ALTER TABLE "reservation_charges" ADD COLUMN "payment_id" bigint;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD COLUMN "linked_invoice_payment_id" bigint;--> statement-breakpoint
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_payment_id_reservation_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."reservation_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_payments" ADD CONSTRAINT "reservation_payments_linked_invoice_payment_id_billing_payment_records_id_fk" FOREIGN KEY ("linked_invoice_payment_id") REFERENCES "public"."billing_payment_records"("id") ON DELETE no action ON UPDATE no action;