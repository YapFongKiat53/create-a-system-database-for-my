import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSessionUser,
  readSessionCookie,
  sessionCookieHeader,
  verifyPassword,
} from "../../../db/auth";
import { appRoles, appUsers } from "../../../db/schema";

/** Where a role lands after signing in. */
function landingFor(roleKey: string) {
  return roleKey === "tenant" ? "/student" : "/";
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ user: null }, { status: 200 });
  return Response.json({
    user: {
      email: user.email,
      displayName: user.displayName,
      roleKey: user.roleKey,
      roleName: user.roleName,
      studentId: user.studentId,
    },
    landing: landingFor(user.roleKey),
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = String(body.action || "login");

  if (action === "logout") {
    await destroySession(readSessionCookie(request));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  }

  if (action !== "login")
    return Response.json({ error: "Unsupported action" }, { status: 400 });

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !password)
    return Response.json(
      { error: "Email and password are required" },
      { status: 400 },
    );

  const row = await getDb()
    .select({
      id: appUsers.id,
      status: appUsers.status,
      passwordHash: appUsers.passwordHash,
      roleKey: appRoles.roleKey,
    })
    .from(appUsers)
    .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
    .where(eq(appUsers.email, email))
    .get();

  // Same message whether the account is missing, disabled or the password is
  // wrong, so the form can't be used to discover which emails exist.
  const rejection = Response.json(
    { error: "Incorrect email or password" },
    { status: 401 },
  );
  if (!row || row.status !== "active" || !row.passwordHash) return rejection;
  if (!(await verifyPassword(password, row.passwordHash))) return rejection;

  const { token } = await createSession(row.id);
  await getDb()
    .update(appUsers)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(appUsers.id, row.id));

  return new Response(
    JSON.stringify({ ok: true, landing: landingFor(row.roleKey) }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": sessionCookieHeader(token, request),
      },
    },
  );
}
