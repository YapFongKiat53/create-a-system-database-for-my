import { and, desc, eq, isNull } from "drizzle-orm";
import type { getDb } from "../../../db";
import { appRoles, appUsers, notifications, rolePermissions } from "../../../db/schema";

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
