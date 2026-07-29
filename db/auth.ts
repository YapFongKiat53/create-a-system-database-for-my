import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from ".";
import { appRoles, appUsers, rolePermissions, userSessions } from "./schema";

export const SESSION_COOKIE = "hostel_session";
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 120_000;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Compare without leaking timing information. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (!stored) return false;
  const [scheme, iterationText, saltText, hashText] = stored.split("$");
  if (scheme !== "pbkdf2" || !saltText || !hashText) return false;
  const iterations = Number(iterationText);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const expected = fromBase64(hashText);
  const actual = await derive(password, fromBase64(saltText), iterations);
  return timingSafeEqual(actual, expected);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64(new Uint8Array(digest));
}

/** Creates a session row and returns the raw cookie token (stored only as a hash). */
export async function createSession(userId: number) {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const db = getDb();
  await db
    .delete(userSessions)
    .where(lt(userSessions.expiresAt, new Date().toISOString()));
  await db
    .insert(userSessions)
    .values({ tokenHash: await sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  if (!token) return;
  await getDb()
    .delete(userSessions)
    .where(eq(userSessions.tokenHash, await sha256(token)));
}

export function readSessionCookie(request: Request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookieHeader(
  token: string,
  request: Request,
  maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60,
) {
  const secure = new URL(request.url).protocol === "https:";
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  status: string;
  studentId: number | null;
  roleId: number;
  roleKey: string;
  roleName: string;
};

/** Resolves the signed-in user from the session cookie, or null. */
export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const db = getDb();
  const row = await db
    .select({
      id: appUsers.id,
      email: appUsers.email,
      displayName: appUsers.displayName,
      status: appUsers.status,
      studentId: appUsers.studentId,
      roleId: appRoles.id,
      roleKey: appRoles.roleKey,
      roleName: appRoles.name,
    })
    .from(userSessions)
    .innerJoin(appUsers, eq(userSessions.userId, appUsers.id))
    .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
    .where(
      and(
        eq(userSessions.tokenHash, await sha256(token)),
        gt(userSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .get();
  if (!row || row.status !== "active") return null;
  return row;
}

export async function permissionsForRole(roleId: number) {
  return getDb()
    .select()
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
}
