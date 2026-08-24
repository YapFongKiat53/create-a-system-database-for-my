CREATE TABLE "system_settings" (
	"setting_key" text PRIMARY KEY NOT NULL,
	"setting_value" text NOT NULL,
	"updated_at" text DEFAULT (CURRENT_TIMESTAMP)::text NOT NULL
);
