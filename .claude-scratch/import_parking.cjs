const fs = require("fs");
const postgres = require("postgres");

const ONLY_HOSTEL = process.env.ONLY_HOSTEL || null;
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// "C-1907-C1" -> true (unit-room-bed format, a specific bed => in-house);
// "C-19-07" or "D2-0707" -> false (last segment is plain digits, just a
// building/unit address with no room letter => outside), matching the
// user's rule: classify by whether the code names a specific room+bed, not
// by whether that bed happens to exist in what we've imported so far.
function looksLikeRoomCode(houseUnit) {
  if (!houseUnit) return false;
  const parts = houseUnit.trim().split("-");
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1];
  return /^[A-Za-z]+\d+$/.test(last);
}

async function main() {
  await sql`SET search_path TO public`;
  const data = JSON.parse(
    fs.readFileSync(
      "/Users/yapfongkiat/create-a-system-database-for-my/.claude-scratch/parking-data.json",
      "utf8",
    ),
  );
  const rows = ONLY_HOSTEL ? data.filter((r) => r.hostel_code === ONLY_HOSTEL) : data;

  const stats = { lots: 0, rentals: 0, linkedToStudent: 0, outsideTenant: 0, unmatchedHouseUnit: [] };
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rows) {
    const hostelRow = await sql`SELECT id FROM hostel_properties WHERE code = ${r.hostel_code}`;
    if (!hostelRow.length) {
      console.log("SKIP: hostel not found for", r.hostel_code);
      continue;
    }
    const hostelId = hostelRow[0].id;

    const existingLot = await sql`
      SELECT id FROM parking_lots WHERE hostel_id = ${hostelId} AND lot_number = ${r.lot_number}
    `;
    let lotId;
    if (existingLot.length) {
      lotId = existingLot[0].id;
    } else {
      const lotNotes = r.lot_unit ? `Lot block/location: ${r.lot_unit}` : "";
      const inserted = await sql`
        INSERT INTO parking_lots (hostel_id, lot_number, status, notes)
        VALUES (${hostelId}, ${r.lot_number}, ${r.tenant_name ? "rented" : "available"}, ${lotNotes})
        RETURNING id
      `;
      lotId = inserted[0].id;
      stats.lots++;
    }

    if (!r.tenant_name) continue; // vacant lot, nothing more to record

    // tenant_type is decided by the shape of house_unit (does it name a
    // specific room+bed, e.g. "C-1907-C1", vs. a bare address like
    // "C-19-07"/"D2-0707") — not by whether that bed happens to match a
    // student we already have on file. A format match that fails to find
    // an actual bed/tenant still counts as in-house, just unlinked, so
    // staff can reconcile it manually instead of it silently becoming
    // "outside".
    let studentId = null;
    let tenantType = looksLikeRoomCode(r.house_unit) ? "in-house" : "outside";
    let startDate = today;
    let unitNumberForRow = r.house_unit || "";
    if (tenantType === "in-house") {
      const bed = await sql`SELECT id FROM bed_spaces WHERE legacy_code = ${r.house_unit}`;
      if (bed.length) {
        const assignment = await sql`
          SELECT student_id, check_in_date FROM accommodation_assignments
          WHERE bed_space_id = ${bed[0].id} AND status = 'active'
        `;
        if (assignment.length) {
          studentId = assignment[0].student_id;
          startDate = assignment[0].check_in_date || today;
          stats.linkedToStudent++;
        } else {
          stats.unmatchedHouseUnit.push(r.house_unit);
        }
      } else {
        stats.unmatchedHouseUnit.push(r.house_unit);
      }
    } else {
      stats.outsideTenant++;
    }

    const noteParts = [];
    if (r.remark && r.remark !== "-") noteParts.push(r.remark);
    if (tenantType === "in-house" && !studentId)
      noteParts.push(`Room code "${r.house_unit}" not matched to a current tenant — check manually.`);
    noteParts.push("Imported from S2 Parking.xlsx — start date unknown, set to import date.");
    const notes = noteParts.join(" | ");

    const existingRental = await sql`
      SELECT id FROM parking_rentals WHERE parking_lot_id = ${lotId}
    `;
    if (existingRental.length) continue; // already recorded for this lot

    await sql`
      INSERT INTO parking_rentals
        (parking_lot_id, student_id, tenant_type, tenant_name, contact_number, unit_number,
         car_plate_number, car_model, monthly_rental, deposit_amount, start_date,
         end_date, status, notes)
      VALUES
        (${lotId}, ${studentId}, ${tenantType}, ${r.tenant_name}, ${r.contact || ""}, ${unitNumberForRow},
         ${r.car_plate || ""}, ${r.car_model || ""}, ${r.monthly_rental || 0}, ${r.deposit || 0}, ${startDate},
         ${fmtDate(r.returning_date)}, ${r.returning_date ? "ended" : "active"}, ${notes})
    `;
    stats.rentals++;
  }

  console.log(JSON.stringify(stats, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
