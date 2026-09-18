import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { getDb } from "../../../db";
import {
  accommodationAssignments,
  appRoles,
  appUsers,
  notifications,
  rolePermissions,
  studentProfiles,
} from "../../../db/schema";

type Db = ReturnType<typeof getDb>;

type NotifyInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
};

export async function notify(
  db: Db,
  input: NotifyInput & { recipientUserIds: number[] },
) {
  if (!input.recipientUserIds.length) return;
  await db.insert(notifications).values(
    input.recipientUserIds.map((recipientUserId) => ({
      recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body || "",
      link: input.link || "",
    })),
  );
}

export async function notifyRole(db: Db, roleKey: string, input: NotifyInput) {
  const recipients = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
    .where(and(eq(appRoles.roleKey, roleKey), eq(appUsers.status, "active")));
  await notify(db, { ...input, recipientUserIds: recipients.map((r) => r.id) });
}

export async function notifyRoleWithApproval(
  db: Db,
  roleKey: string,
  moduleKey: string,
  input: NotifyInput,
) {
  const recipients = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, appRoles.id))
    .where(
      and(
        eq(appRoles.roleKey, roleKey),
        eq(appUsers.status, "active"),
        eq(rolePermissions.moduleKey, moduleKey),
        eq(rolePermissions.canApprove, true),
      ),
    );
  await notify(db, { ...input, recipientUserIds: recipients.map((r) => r.id) });
}

export async function notifyUser(db: Db, userId: number, input: NotifyInput) {
  await notify(db, { ...input, recipientUserIds: [userId] });
}

export async function getNotificationSummary(db: Db, userId: number) {
  const [unread, recent] = await Promise.all([
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt))),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(15),
  ]);
  return { unreadCount: unread.length, recent };
}

export async function markNotificationRead(
  db: Db,
  userId: number,
  notificationId: number,
) {
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, userId),
      ),
    );
}

export async function markAllNotificationsRead(db: Db, userId: number) {
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)),
    );
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Runs fire-and-forget from the request handler (see route.ts), which on
// this app's Workers-flavoured runtime means it gets killed the instant the
// response flushes — there is no waitUntil() keeping it alive past that.
// The original version awaited one dedup SELECT and one role lookup PER
// expiring row in a sequential loop; against ~150 real tenancies that's
// ~300 round trips, easily outliving the response and getting cut off
// mid-scan (confirmed directly: only the first 5 of 146 rows ever got
// notified, across three separate runs). Down to three queries total plus
// one bulk insert fixes both the correctness and the cost.
export async function checkExpiringLeases(db: Db, today: string) {
  const in60Days = addDays(today, 60);
  const [expiring, salesRecipients, existingLinks] = await Promise.all([
    db
      .select({
        id: accommodationAssignments.id,
        studentName: studentProfiles.fullName,
        leaseEndDate: accommodationAssignments.agreementEndDate,
      })
      .from(accommodationAssignments)
      .innerJoin(studentProfiles, eq(studentProfiles.id, accommodationAssignments.studentId))
      .where(
        and(
          eq(accommodationAssignments.status, "active"),
          gte(accommodationAssignments.agreementEndDate, today),
          lte(accommodationAssignments.agreementEndDate, in60Days),
        ),
      ),
    db
      .select({ id: appUsers.id })
      .from(appUsers)
      .innerJoin(appRoles, eq(appRoles.id, appUsers.roleId))
      .where(and(eq(appRoles.roleKey, "sales"), eq(appUsers.status, "active"))),
    db
      .select({ link: notifications.link })
      .from(notifications)
      .where(eq(notifications.type, "lease-expiring")),
  ]);
  const alreadyNotified = new Set(existingLinks.map((row) => row.link));
  const newRows = expiring.filter(
    (row) => !alreadyNotified.has(`/students?tenancy=${row.id}`),
  );
  if (!newRows.length || !salesRecipients.length) return;

  await db.insert(notifications).values(
    newRows.flatMap((row) =>
      salesRecipients.map((recipient) => ({
        recipientUserId: recipient.id,
        type: "lease-expiring",
        // dateLabel() is a frontend-only formatter (app/modules/shared.tsx,
        // a client module) — the backend has no equivalent, so the title
        // carries the raw ISO date rather than reaching across that
        // boundary.
        title: `${row.studentName}'s lease ends ${row.leaseEndDate}`,
        body: "",
        link: `/students?tenancy=${row.id}`,
      })),
    ),
  );
}
