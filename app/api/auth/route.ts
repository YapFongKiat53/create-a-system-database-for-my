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
import { BASE_PATH } from "../../basePath";

/** Where a role lands after signing in. */
function landingFor(roleKey: string) {
  return `${BASE_PATH}${roleKey === "tenant" ? "/student" : "/"}`;
}

export async function GET(request: Request) {
  // Same reasoning as POST: an uncaught throw here is a bodiless 500, and the
  // layout that calls this on every page load has nothing to show for it.
  let user: Awaited<ReturnType<typeof getSessionUser>>;
  try {
    user = await getSessionUser(request);
  } catch (error) {
    return Response.json(
      {
        user: null,
        error:
          error instanceof Error ? error.message : "Unable to read the session",
      },
      { status: 500 },
    );
  }
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
  // Everything below is wrapped, because anything that throws out of a route
  // handler becomes a 500 with no body at all — and the sign-in form calls
  // .json() on the reply, so the person trying to log in is told
  // "Failed to execute 'json' on 'Response'" instead of what actually went
  // wrong. A missing DATABASE_URL on a fresh deployment looks exactly like
  // that. The real message is worth far more than the stack trace.
  try {
    return await handleAuth(request);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to sign in",
      },
      { status: 500 },
    );
  }
}

async function handleAuth(request: Request) {
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

  const row = (
    await getDb()
      .select({
        id: appUsers.id,
        status: appUsers.status,
        passwordHash: appUsers.passwordHash,
        roleKey: appRoles.roleKey,
      })
      .from(appUsers)
      .innerJoin(appRoles, eq(appUsers.roleId, appRoles.id))
      .where(eq(appUsers.email, email))
  )[0];

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
