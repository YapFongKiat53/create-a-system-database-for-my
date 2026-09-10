import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
await sql`ALTER TABLE hostel_units ADD COLUMN IF NOT EXISTS electricity_billing text DEFAULT 'meter' NOT NULL`;
await sql`ALTER TABLE meter_readings ADD COLUMN IF NOT EXISTS replaced_meter_final double precision`;
console.table((await sql`
  SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE (table_name='hostel_units' AND column_name='electricity_billing')
     OR (table_name='meter_readings' AND column_name='replaced_meter_final')`).map(x=>({...x})));
await sql.end();
