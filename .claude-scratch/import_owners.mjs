import fs from "node:fs";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql`SET search_path TO public`;
const APPLY = process.argv[2] === "apply";
const records = JSON.parse(fs.readFileSync(".claude-scratch/owner-matched.json", "utf8"));

const rows = records.map((rec) => {
  const notes = [];
  if (rec.agreementNotes) notes.push(rec.agreementNotes);
  // One agreement row can cover more than one unit (the shop lot is let as
  // "16-2 / 16-3"). The rental is the figure for all of them together, so it
  // is copied to each with that said plainly rather than read as per-unit.
  if (rec.excelUnit.includes("/"))
    notes.push(
      `One agreement covers ${rec.excelUnit} together — the rental shown is for both units, not per unit.`,
    );
  if (rec.nameConflict)
    notes.push(
      `Name differs between sheets — owner register says "${rec.ownerName}", the agreement sheet says "${rec.nameConflict}". Register used; please confirm.`,
    );
  notes.push(`Imported from "UNIT copy.xlsx" (${rec.sources.join(", ")}), unit row ${rec.excelUnit}.`);
  return {
    unitId: rec.unitId,
    unitCode: rec.unitCode,
    ownerName: rec.ownerName || "",
    // The NRIC column occasionally repeats the name; a name is not an
    // identity number, so it is left blank rather than stored as one.
    ownerIdentityNo:
      rec.ownerIdentityNo && rec.ownerIdentityNo !== rec.ownerName ? rec.ownerIdentityNo : "",
    primaryContactPhone: /^n\/?a$/i.test(rec.contact) ? "" : rec.contact || "",
    registeredAddress: rec.address || "",
    agreementType: rec.agreementType || "rental",
    monthlyLeaseRental: rec.monthlyLeaseRental ?? null,
    servicePercentage: rec.servicePercentage ?? null,
    leaseStartDate: rec.leaseStartDate || null,
    leaseEndDate: rec.leaseEndDate || null,
    notes: notes.join(" "),
  };
});

console.log(`准备写入 ${rows.length} 笔`);
console.table(rows.slice(0, 8).map((r) => ({
  unit: r.unitCode, owner: r.ownerName.slice(0, 30), nric: r.ownerIdentityNo,
  phone: r.primaryContactPhone, type: r.agreementType,
  rent: r.monthlyLeaseRental, pct: r.servicePercentage,
  lease: r.leaseStartDate ? `${r.leaseStartDate} → ${r.leaseEndDate}` : "-",
})));
console.log("… 共", rows.length, "笔");

if (!APPLY) {
  console.log("\n(dry run — 加 apply 才会真的写入)");
  await sql.end(); process.exit(0);
}

const before = (await sql`SELECT count(*)::int n FROM unit_owner_details`)[0].n;
await sql.begin(async (tx) => {
  await tx`SET search_path TO public`;
  for (const r of rows) {
    await tx`
      INSERT INTO unit_owner_details
        (unit_id, owner_name, owner_identity_no, primary_contact_phone, registered_address,
         agreement_type, monthly_lease_rental, service_percentage, lease_start_date, lease_end_date, notes)
      VALUES
        (${r.unitId}, ${r.ownerName}, ${r.ownerIdentityNo}, ${r.primaryContactPhone}, ${r.registeredAddress},
         ${r.agreementType}, ${r.monthlyLeaseRental}, ${r.servicePercentage}, ${r.leaseStartDate}, ${r.leaseEndDate}, ${r.notes})
      ON CONFLICT (unit_id) DO UPDATE SET
        owner_name = excluded.owner_name,
        owner_identity_no = excluded.owner_identity_no,
        primary_contact_phone = excluded.primary_contact_phone,
        registered_address = excluded.registered_address,
        agreement_type = excluded.agreement_type,
        monthly_lease_rental = excluded.monthly_lease_rental,
        service_percentage = excluded.service_percentage,
        lease_start_date = excluded.lease_start_date,
        lease_end_date = excluded.lease_end_date,
        notes = excluded.notes,
        updated_at = ${new Date().toISOString()}
    `;
  }
});
const after = (await sql`SELECT count(*)::int n FROM unit_owner_details`)[0].n;
console.log(`\nunit_owner_details: ${before} → ${after} 笔`);
console.table((await sql`
  SELECT u.unit_code, o.owner_name, o.owner_identity_no nric, o.primary_contact_phone phone,
         o.agreement_type, o.monthly_lease_rental rent, o.service_percentage pct,
         o.lease_start_date, o.lease_end_date
  FROM unit_owner_details o JOIN hostel_units u ON u.id=o.unit_id ORDER BY u.unit_code`).map(x=>({...x})));
await sql.end();
