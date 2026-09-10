const fs = require("fs");
const postgres = require("postgres");

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const SHEETS = ["ATRIA", "DAMAI 1", "NADAYU", "SR, SHOPLOT"]; // DAMAI excluded — bad match rate

function parseCode(sheet, code) {
  if (sheet === "NADAYU") {
    const m = code.match(/^([A-Z]+)-(\d{4})-([A-Za-z])$/);
    if (m) return { unit: `${m[1]}-${m[2]}`, room: m[3] };
  }
  if (sheet === "DAMAI 1") {
    const m = code.match(/^(D\d)-(\d+)-(\d+)([A-Za-z])$/);
    if (m) return { unit: `${m[1]}-${m[2]}${m[3]}`, room: m[4] };
  }
  if (sheet === "SR, SHOPLOT") {
    let m = code.match(/^(\d+)-(\d+)-([A-Za-z])$/);
    if (m) return { unit: `${m[1]}-${m[2]}`, room: m[3] };
    m = code.match(/^([A-Za-z0-9]+)-([A-Za-z])$/);
    if (m) return { unit: m[1], room: m[2] };
  }
  if (sheet === "ATRIA" || sheet === "DAMAI") {
    const m = code.match(/^(\d{4})([A-Za-z])$/);
    if (m) return { unit: m[1], room: m[2] };
  }
  return null;
}

async function findRoomAndBed(sheet, unit, room) {
  let rows;
  if (sheet === "ATRIA" || sheet === "DAMAI") {
    rows = await sql`
      SELECT hr.id AS room_id, hu.hostel_id
      FROM hostel_rooms hr JOIN hostel_units hu ON hu.id = hr.unit_id
      WHERE hu.unit_code LIKE ${"%-" + unit} AND hr.room_label = ${room}
    `;
    if (!rows.length)
      rows = await sql`
        SELECT hr.id AS room_id, hu.hostel_id
        FROM hostel_rooms hr JOIN hostel_units hu ON hu.id = hr.unit_id
        WHERE hu.unit_code = ${unit} AND hr.room_label = ${room}
      `;
  } else {
    rows = await sql`
      SELECT hr.id AS room_id, hu.hostel_id
      FROM hostel_rooms hr JOIN hostel_units hu ON hu.id = hr.unit_id
      WHERE hu.unit_code = ${unit} AND hr.room_label = ${room}
    `;
  }
  if (!rows.length) return null;
  const roomId = rows[0].room_id;
  const beds = await sql`
    SELECT id FROM bed_spaces WHERE room_id = ${roomId} ORDER BY bed_label ASC LIMIT 1
  `;
  if (!beds.length) return null;
  return { roomId, bedId: beds[0].id };
}

async function main() {
  await sql`SET search_path TO public`;
  const raw = JSON.parse(
    fs.readFileSync(
      "/Users/yapfongkiat/create-a-system-database-for-my/.claude-scratch/meter-readings-raw.json",
      "utf8",
    ),
  );

  const stats = { inserted: 0, skippedNoRoom: 0, skippedDuplicate: 0, codesResolved: 0, codesUnresolved: 0 };
  const roomCache = new Map(); // "sheet:code" -> {roomId,bedId} | null

  for (const sheet of SHEETS) {
    const readings = raw[sheet] || [];
    for (const r of readings) {
      const cacheKey = `${sheet}:${r.code}`;
      let resolved = roomCache.get(cacheKey);
      if (resolved === undefined) {
        const parsed = parseCode(sheet, r.code);
        resolved = parsed ? await findRoomAndBed(sheet, parsed.unit, parsed.room) : null;
        roomCache.set(cacheKey, resolved);
        if (resolved) stats.codesResolved++;
        else stats.codesUnresolved++;
      }
      if (!resolved) {
        stats.skippedNoRoom++;
        continue;
      }
      const existing = await sql`
        SELECT id FROM meter_readings
        WHERE bed_space_id = ${resolved.bedId} AND reading_date = ${r.date}
      `;
      if (existing.length) {
        stats.skippedDuplicate++;
        continue;
      }
      await sql`
        INSERT INTO meter_readings (bed_space_id, room_id, reading_date, reading_value, reading_type, submitted_by, notes)
        VALUES (${resolved.bedId}, ${resolved.roomId}, ${r.date}, ${r.value}, 'monthly', 'Historical Import',
                ${`Imported from Meter Reading 2026.xlsx, sheet "${sheet}", original code "${r.code}"`})
      `;
      stats.inserted++;
    }
    console.log(`done ${sheet}`, JSON.stringify(stats));
  }

  console.log("FINAL", JSON.stringify(stats, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
