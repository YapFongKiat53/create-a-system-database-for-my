const fs = require("fs");
const postgres = require("postgres");

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const DRY = process.env.DRY_RUN === "1";

// A row whose provider reads "SHARE D1-02-10" has no line of its own — it is
// piggy-backing on another unit's connection. Keeping that in the provider
// field would make it look like a telco, so it moves to the remarks and the
// provider is left blank.
function splitProvider(provider) {
  const m = String(provider || "").match(/^SHARED?\s+(.+)$/i);
  if (m) return { provider: "", sharedWith: m[1].trim() };
  return { provider: provider || "", sharedWith: null };
}

function titleProvider(p) {
  const map = { MAXIS: "Maxis", UNIFI: "Unifi", FRESHTEL: "Freshtel", CELCOMDIGI: "CelcomDigi", OWNER: "Owner-provided" };
  return map[String(p).toUpperCase()] || p;
}

async function main() {
  await sql`SET search_path TO public`;
  const rows = JSON.parse(
    fs.readFileSync(
      "/Users/yapfongkiat/create-a-system-database-for-my/.claude-scratch/internet-details.json",
      "utf8",
    ),
  );

  const stats = { inserted: 0, skippedExisting: 0, shared: 0, noContractDate: 0 };
  for (const r of rows) {
    const existing = await sql`
      SELECT id FROM unit_services WHERE unit_id = ${r.unitId} AND service_type = 'wifi'
    `;
    if (existing.length) { stats.skippedExisting++; continue; }

    const { provider, sharedWith } = splitProvider(r.provider);
    if (sharedWith) stats.shared++;
    if (!r.contractEnd) stats.noContractDate++;

    const notes = [
      r.phone ? `Service phone: ${r.phone}` : "",
      sharedWith ? `Shares the line at ${sharedWith}` : "",
      r.status ? `Sheet note: ${r.status}` : "",
      r.contractEndRaw && !r.contractEnd ? `Contract end on file: ${r.contractEndRaw}` : "",
      `Imported from "Internet Details" — sheet "${r.sourceSheet}" (updated ${r.sheetUpdated}), listed as "${r.sourceUnit}".`,
    ].filter(Boolean).join(" | ");

    if (DRY) { stats.inserted++; continue; }
    await sql`
      INSERT INTO unit_services
        (unit_id, service_type, account_holder_name, provider, account_reference,
         line_type, contract_end_date, service_package, username, password, remarks, status, notes)
      VALUES
        (${r.unitId}, 'wifi', ${r.name}, ${titleProvider(provider)}, ${r.acc},
         ${sharedWith ? "shared" : "dedicated"}, ${r.contractEnd}, ${r.package},
         ${r.username}, ${r.password}, ${sharedWith ? `Shared line — ${sharedWith}` : ""}, 'active', ${notes})
    `;
    stats.inserted++;
  }

  console.log(DRY ? "DRY RUN — nothing written" : "IMPORTED");
  console.log(JSON.stringify(stats, null, 2));
  await sql.end();
}

main().catch((e) => { console.error("ERR", e); process.exit(1); });
