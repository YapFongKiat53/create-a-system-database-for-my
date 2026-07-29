#!/usr/bin/env node
/**
 * Set (or reset) the login password for a user in the LOCAL D1 database.
 *
 *   node scripts/set-password.mjs <email> <password>
 *
 * Uses the same PBKDF2 scheme as the app, so the hash it writes is accepted by
 * the sign-in endpoint. Only the hash is stored — never the password itself.
 */
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ITERATIONS = 120_000;
const D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node scripts/set-password.mjs <email> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

function findDatabase() {
  const files = readdirSync(D1_DIR).filter(
    (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
  );
  if (!files.length) {
    console.error(`No local D1 database found in ${D1_DIR}. Run the app once first.`);
    process.exit(1);
  }
  return join(D1_DIR, files[0]);
}

const sql = (db, statement) =>
  execFileSync("sqlite3", [db, statement], { encoding: "utf8" }).trim();

const toBase64 = (bytes) => Buffer.from(bytes).toString("base64");

async function hashPassword(plain) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

const db = findDatabase();
const target = email.trim().toLowerCase().replace(/'/g, "''");

const found = sql(db, `SELECT id FROM app_users WHERE email='${target}';`);
if (!found) {
  console.error(`No user with email ${email}.`);
  console.error("Existing accounts:");
  console.error(sql(db, "SELECT email FROM app_users ORDER BY email;") || "  (none)");
  process.exit(1);
}

const hash = await hashPassword(password);
sql(db, `UPDATE app_users SET password_hash='${hash}' WHERE email='${target}';`);
// Any existing sessions for this account are invalidated.
sql(db, `DELETE FROM user_sessions WHERE user_id=${found};`);

console.log(`Password set for ${email}. You can now sign in at /login.`);
