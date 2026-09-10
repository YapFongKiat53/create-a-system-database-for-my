const fs = require("fs");
const postgres = require("postgres");

const ONLY_HOSTEL = process.env.ONLY_HOSTEL || null; // e.g. "ATR" for a dry run
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  await sql`SET search_path TO public`;
  const data = JSON.parse(
    fs.readFileSync(
      "/Users/yapfongkiat/create-a-system-database-for-my/.claude-scratch/import-data.json",
      "utf8",
    ),
  );
  const hostels = ONLY_HOSTEL ? data.filter((h) => h.code === ONLY_HOSTEL) : data;

  const stats = { hostels: 0, units: 0, rooms: 0, beds: 0, students: 0, assignments: 0 };
  const categoryRentals = new Map(); // `${hostelId}:${roomLabel}` -> [rentals]

  for (const h of hostels) {
    const existing = await sql`SELECT id FROM hostel_properties WHERE code = ${h.code}`;
    let hostelId;
    if (existing.length) {
      hostelId = existing[0].id;
    } else {
      const inserted = await sql`
        INSERT INTO hostel_properties (code, name, address, electricity_rate)
        VALUES (${h.code}, ${h.name}, ${h.address}, ${h.electricity_rate})
        RETURNING id
      `;
      hostelId = inserted[0].id;
      stats.hostels++;
    }

    for (const u of h.units) {
      const existingUnit = await sql`
        SELECT id FROM hostel_units WHERE hostel_id = ${hostelId} AND unit_code = ${u.unit_code}
      `;
      let unitId;
      if (existingUnit.length) {
        unitId = existingUnit[0].id;
      } else {
        const insertedUnit = await sql`
          INSERT INTO hostel_units (hostel_id, unit_code, address, gender)
          VALUES (${hostelId}, ${u.unit_code}, '', ${u.gender})
          RETURNING id
        `;
        unitId = insertedUnit[0].id;
        stats.units++;
      }

      for (const r of u.rooms) {
        const roomType = r.beds.length > 1 ? "sharing" : "single";
        const existingRoom = await sql`
          SELECT id FROM hostel_rooms WHERE unit_id = ${unitId} AND room_label = ${r.room_label}
        `;
        let roomId;
        if (existingRoom.length) {
          roomId = existingRoom[0].id;
        } else {
          const insertedRoom = await sql`
            INSERT INTO hostel_rooms (unit_id, room_label, room_type)
            VALUES (${unitId}, ${r.room_label}, ${roomType})
            RETURNING id
          `;
          roomId = insertedRoom[0].id;
          stats.rooms++;
        }

        for (const b of r.beds) {
          const bedStatus = b.special_use
            ? "blocked"
            : b.assignment && b.assignment.status === "active"
              ? "occupied"
              : "vacant";
          const existingBed = await sql`SELECT id FROM bed_spaces WHERE legacy_code = ${b.legacy_code}`;
          let bedId;
          if (existingBed.length) {
            bedId = existingBed[0].id;
          } else {
            const insertedBed = await sql`
              INSERT INTO bed_spaces
                (room_id, bed_label, legacy_code, status, special_use, monthly_rental, legacy_access_card_deposit)
              VALUES
                (${roomId}, ${b.bed_label}, ${b.legacy_code}, ${bedStatus}, ${b.special_use}, ${b.monthly_rental}, ${b.access_card_deposit})
              RETURNING id
            `;
            bedId = insertedBed[0].id;
            stats.beds++;
          }

          if (b.assignment) {
            const a = b.assignment;
            const sourceKey = `${h.code}:${b.legacy_code}`;
            const existingProfile = await sql`SELECT id FROM student_profiles WHERE source_key = ${sourceKey}`;
            let studentId;
            if (existingProfile.length) {
              studentId = existingProfile[0].id;
            } else {
              const studentGender = u.gender === "mixed" ? "unspecified" : u.gender;
              const insertedProfile = await sql`
                INSERT INTO student_profiles
                  (source_key, student_code, full_name, nationality, hometown, course, contact_number, identity_no, gender)
                VALUES
                  (${sourceKey}, ${a.student.source_code}, ${a.student.full_name},
                   ${a.student.nationality || ""}, ${a.student.hometown || ""}, ${a.student.course || ""},
                   ${a.student.contact || ""}, ${a.student.ic_passport || ""}, ${studentGender})
                RETURNING id
              `;
              studentId = insertedProfile[0].id;
              stats.students++;
            }

            const existingAssignment = await sql`
              SELECT id FROM accommodation_assignments WHERE source_key = ${sourceKey}
            `;
            if (!existingAssignment.length) {
              await sql`
                INSERT INTO accommodation_assignments
                  (source_key, student_id, bed_space_id, monthly_rental, security_deposit, access_card_deposit,
                   salesperson, check_in_date, agreement_start_date, agreement_end_date, agreement_duration,
                   check_out_date, check_in_meter, remarks, status)
                VALUES
                  (${sourceKey}, ${studentId}, ${bedId}, ${a.monthly_rental}, ${a.security_deposit}, ${a.access_card_deposit},
                   ${a.salesperson}, ${a.check_in_date}, ${a.agreement_start_date}, ${a.agreement_end_date}, ${a.agreement_duration},
                   ${a.check_out_date}, ${a.check_in_meter}, ${a.remarks}, ${a.status})
              `;
              stats.assignments++;
            }

            if (a.status === "active" && a.monthly_rental) {
              const key = `${hostelId}:${r.room_label}`;
              if (!categoryRentals.has(key)) categoryRentals.set(key, []);
              categoryRentals.get(key).push(a.monthly_rental);
            }
          }
        }
      }
    }
    console.log(`done ${h.code} (${h.name})`);
  }

  // hostel_category_rates: median of active rentals per hostel+room-category —
  // also backfills hostel_rooms.sales_rate directly, since that (not the
  // category table) is what the pricing UI and reservation flow actually
  // read for a specific room; the category row only seeds *future* new rooms.
  let rateCount = 0;
  let roomsPriced = 0;
  for (const [key, rentals] of categoryRentals) {
    const [hostelId, roomCategory] = key.split(":");
    const sorted = [...rentals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    await sql`
      INSERT INTO hostel_category_rates (hostel_id, room_category, monthly_rate)
      VALUES (${Number(hostelId)}, ${roomCategory}, ${median})
      ON CONFLICT (hostel_id, room_category) DO UPDATE SET monthly_rate = excluded.monthly_rate
    `;
    rateCount++;
    const updated = await sql`
      UPDATE hostel_rooms
      SET sales_rate = ${median}
      WHERE room_label = ${roomCategory}
        AND sales_rate IS NULL
        AND unit_id IN (SELECT id FROM hostel_units WHERE hostel_id = ${Number(hostelId)})
    `;
    roomsPriced += updated.count;
  }
  stats.categoryRates = rateCount;
  stats.roomsPriced = roomsPriced;

  console.log(JSON.stringify(stats, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
