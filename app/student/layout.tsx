"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SystemProvider } from "../SystemContext";
import { PortalTabBar } from "../modules/shared";
import { BASE_PATH } from "../basePath";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [checked, setChecked] = useState(false);
  const pathname = usePathname();
  // The resident sign-in page lives under /student but must render without
  // the signed-in guard, tab bar and providers. endsWith tolerates a
  // basePath prefix on the reported pathname.
  const isLoginPage = pathname?.endsWith("/student/login") ?? false;

  useEffect(() => {
    if (isLoginPage) return;
    let cancelled = false;
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ user?: { roleKey: string } | null }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) {
          window.location.replace(`${BASE_PATH}/student/login`);
          return;
        }
        if (result.user.roleKey !== "tenant") {
          window.location.replace(BASE_PATH || "/");
          return;
        }
        setChecked(true);
      })
      .catch(
        () =>
          !cancelled &&
          window.location.replace(`${BASE_PATH}/student/login`),
      );
    return () => {
      cancelled = true;
    };
  }, [isLoginPage]);

  type NotificationRow = {
    id: number;
    type: string;
    title: string;
    body: string;
    link: string;
    readAt: string | null;
    createdAt: string;
  };
  const [notifState, setNotifState] = useState<{
    unreadCount: number;
    recent: NotificationRow[];
  }>({ unreadCount: 0, recent: [] });

  const loadNotifications = async () => {
    try {
      const response = await fetch(`${BASE_PATH}/api/system?modules=notifications`, {
        cache: "no-store",
      });
      const result = (await response.json()) as { notifications?: typeof notifState };
      if (result.notifications) setNotifState(result.notifications);
    } catch {
      // A missed poll just means a stale dot for 60s.
    }
  };

  useEffect(() => {
    if (!checked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const markRead = async (notificationId: number) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notification-mark-read", notificationId }),
    });
  };

  const unreadByTab = {
    billing: notifState.recent.some((n) => !n.readAt && n.link.startsWith("/student/billing")),
    maintenance: notifState.recent.some(
      (n) => !n.readAt && n.link.startsWith("/student/maintenance"),
    ),
  };

  useEffect(() => {
    if (!checked) return;
    const prefix = pathname?.startsWith("/student/billing")
      ? "/student/billing"
      : pathname?.startsWith("/student/maintenance")
        ? "/student/maintenance"
        : null;
    if (!prefix) return;
    const toMark = notifState.recent.filter((n) => !n.readAt && n.link.startsWith(prefix));
    if (!toMark.length) return;
    Promise.all(toMark.map((n) => markRead(n.id))).then(loadNotifications);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, checked, notifState.recent]);

  if (isLoginPage) return <>{children}</>;

  if (!checked)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Loading your portal...</p>
        </div>
      </div>
    );

  return (
    <SystemProvider>
      <div className="portal-shell">
        <main className="portal-body">{children}</main>
        <PortalTabBar unread={unreadByTab} />
      </div>
    </SystemProvider>
  );
}
