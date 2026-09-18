"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SystemProvider, useSystem } from "../SystemContext";
import type { Row } from "../modules/shared";
import { BASE_PATH } from "../basePath";

import {
  DashboardIcon,
  RoomsIcon,
  TenantsIcon,
  BillingIcon,
  MaintenanceIcon,
  ParkingIcon,
  PropertiesIcon,
  ReportsIcon,
  AnnouncementsIcon,
  AccessIcon,
  BrandIcon,
  SignOutIcon,
  CollapseIcon,
  BellIcon,
} from "./NavIcons";

// Desktop only — the phone rail already collapses behind its own Menu
// button (see menuOpen/nav-toggle below), and this key is separate from
// that so the two never fight over the same piece of state. Read on mount
// rather than as the initial useState value: SSR has no localStorage, so
// starting from it would either throw or make the first server-rendered
// frame guess wrong and flash once the client corrects it.
const SIDEBAR_COLLAPSED_KEY = "hostel-sidebar-collapsed";

type NavItem = {
  href: string;
  label: string;
  note: string;
  permission: string;
  Icon: (props: { className?: string }) => React.ReactElement;
};

/**
 * Grouped by the job being done rather than by database table, so the rail
 * answers "where do I go to do X". Labels stay close to what the modules were
 * called; only the grouping and the one-line hints are new.
 *
 * `permission` still drives visibility exactly as before — an empty string
 * means every signed-in role sees it.
 */
const navGroups: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        note: "Today at a glance",
        permission: "",
        Icon: DashboardIcon,
      },
    ],
  },
  {
    label: "LETTING",
    items: [
      {
        href: "/hostels",
        label: "Rooms & reservations",
        note: "Availability, rates, bookings",
        permission: "hostels",
        Icon: RoomsIcon,
      },
      {
        href: "/students",
        label: "Tenants",
        note: "Contracts, room changes, move-out",
        permission: "students",
        Icon: TenantsIcon,
      },
    ],
  },
  {
    label: "MONEY",
    items: [
      {
        href: "/finance",
        label: "Billing",
        note: "Invoices, payments, deposits",
        permission: "finance",
        Icon: BillingIcon,
      },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      {
        href: "/maintenance",
        label: "Maintenance",
        note: "Tickets and meter readings",
        permission: "maintenance",
        Icon: MaintenanceIcon,
      },
      {
        href: "/parking",
        label: "Parking",
        note: "Lots and vehicle records",
        permission: "parking",
        Icon: ParkingIcon,
      },
    ],
  },
  {
    label: "ADMIN",
    items: [
      {
        href: "/units",
        label: "Properties & units",
        note: "Owners, agreements, assets",
        permission: "units-general",
        Icon: PropertiesIcon,
      },
      {
        href: "/reports",
        label: "Reports",
        note: "Registers and monthly figures",
        permission: "reports",
        Icon: ReportsIcon,
      },
      {
        href: "/announcements",
        label: "Announcements",
        note: "Notices to residents",
        permission: "announcements",
        Icon: AnnouncementsIcon,
      },
      {
        href: "/users",
        label: "People & access",
        note: "Roles and permissions",
        permission: "users",
        Icon: AccessIcon,
      },
    ],
  },
];

const allNavigation: NavItem[] = navGroups.flatMap((group) => group.items);

function Chrome({ children }: { children: ReactNode }) {
  const { data, error, notice, load } = useSystem();
  const pathname = usePathname();
  const router = useRouter();
  const [showTop, setShowTop] = useState(false);
  // Phone-only: the nav rail collapses behind a Menu button. Ignored on a
  // wide screen, where the rail is always a column.
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop-only: the rail narrows to an icon strip. Starts false on every
  // render (including the server's) and is corrected from localStorage just
  // after mount, so a saved preference survives a reload without a
  // hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 650);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    try {
      // Syncing from localStorage, which doesn't exist during SSR, so it
      // can only be read after mount (see SIDEBAR_COLLAPSED_KEY above).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // Private browsing can throw on localStorage access — the rail just
      // stays expanded for that session instead of erroring out.
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Same as above — collapsing still works this session even if it
        // can't be remembered for next time.
      }
      return next;
    });
  };

  // Shared by the two sign-out buttons below — the desktop icon in
  // .sidebar-foot and the phone one at the bottom of the nav list — so
  // logging out works the same way regardless of which screen size put it
  // where.
  const signOut = async () => {
    await fetch(`${BASE_PATH}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    window.location.replace(`${BASE_PATH}/login`);
  };

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
  const [notifOpen, setNotifOpen] = useState(false);

  const loadNotifications = async () => {
    try {
      const response = await fetch(
        `${BASE_PATH}/api/system?modules=notifications`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        notifications?: typeof notifState;
      };
      if (result.notifications) setNotifState(result.notifications);
    } catch {
      // A missed poll just means a stale badge for 60s — not worth surfacing
      // as an error banner.
    }
  };

  useEffect(() => {
    // Fires the first poll immediately on mount, then every 60s — the
    // resulting setState is what keeps the bell's badge in sync with the
    // server, not a derived-state anti-pattern this rule usually guards
    // against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications();
    const interval = window.setInterval(loadNotifications, 60000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markNotificationRead = async (notificationId: number) => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "notification-mark-read",
        notificationId,
      }),
    });
    loadNotifications();
  };

  const markAllNotificationsRead = async () => {
    await fetch(`${BASE_PATH}/api/system`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "notification-mark-all-read" }),
    });
    loadNotifications();
  };

  const navigation = allNavigation.filter(
    (item) =>
      // An empty permission means the module is open to every signed-in role.
      item.permission === "" ||
      !data ||
      data.currentUser?.permissions?.some(
        (permission: Row) =>
          permission.moduleKey === item.permission && permission.canView,
      ),
  );
  const current =
    navigation.find((item) => item.href === pathname) || navigation[0];

  // Bounce off a page the current role can no longer see (permission
  // changed, stale bookmark, direct URL entry) once we know who's signed in.
  useEffect(() => {
    if (!data) return;
    if (!navigation.some((item) => item.href === pathname)) {
      router.replace(navigation[0]?.href || "/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pathname]);

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-trigger" aria-hidden="true" />
      <aside className={`sidebar${menuOpen ? " menu-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <BrandIcon />
          </span>
          <div>
            <strong>Hostel Operations</strong>
            <small>Management console</small>
          </div>
          {/* Desktop only — see .nav-toggle below for the phone equivalent.
              A normal flex child of .brand rather than positioned off the
              rail's edge: .sidebar clips its own overflow, so anything
              hanging outside its box (as this first tried to do) is cut
              off — only ever visible as a sliver. */}
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-expanded={!collapsed}
            aria-controls="primary-nav"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
          >
            <CollapseIcon />
          </button>
        </div>
        {/* Phone only. The rail is a permanent column on a wide screen, but
            on a phone ten links across the top pushed the actual page below
            the fold — so there it collapses behind this. */}
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          <span className="nav-toggle-text">Menu</span>
        </button>
        <nav className="nav-groups" id="primary-nav">
          {navGroups.map((group, index) => {
            const items = group.items.filter((item) =>
              navigation.some((allowed) => allowed.href === item.href),
            );
            if (items.length === 0) return null;
            return (
              <div className="nav-group" key={group.label ?? `g${index}`}>
                {group.label && <p className="nav-label">{group.label}</p>}
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={pathname === item.href ? "active" : ""}
                    // Only reaches the browser's native tooltip, which is
                    // exactly what's needed when collapsed hides .nav-copy
                    // — the label the icon alone can no longer show.
                    title={collapsed ? item.label : undefined}
                    /* Navigating does not unmount the rail, so the phone
                       menu would otherwise stay open over the page the tap
                       just asked for. */
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="nav-icon">
                      <item.Icon />
                    </span>
                    <span className="nav-copy">
                      <b>{item.label}</b>
                      <small>{item.note}</small>
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
          {/* Phone only (see .nav-signout-mobile) — on a wide screen sign-out
              stays the icon button in .sidebar-foot below. Squeezed into the
              header next to Menu, it was competing with the wordmark for the
              same few pixels; here it's just the last row of the list
              that's already open. */}
          <button
            type="button"
            className="nav-signout-mobile"
            onClick={signOut}
          >
            <span className="nav-icon">
              <SignOutIcon />
            </span>
            <span className="nav-copy">
              <b>Sign out</b>
            </span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span>
            {String(data?.currentUser?.displayName || "IR")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <div>
            <strong>{data?.currentUser?.displayName || "Irena"}</strong>
            <small>{data?.currentUser?.roleName || "Administrator"}</small>
          </div>
          <button
            className="sidebar-signout"
            title="Sign out"
            aria-label="Sign out"
            onClick={signOut}
          >
            <SignOutIcon />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h1>{current?.label}</h1>
            <p className="topbar-note">{current?.note}</p>
          </div>
          <div className="notif-bell-wrap">
            <button
              type="button"
              className="notif-bell"
              aria-label="Notifications"
              onClick={() => setNotifOpen((open) => !open)}
            >
              <BellIcon />
              {notifState.unreadCount > 0 && (
                <span className="notif-badge">
                  {notifState.unreadCount > 9 ? "9+" : notifState.unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div
                className="notif-dropdown-backdrop"
                onMouseDown={(e) =>
                  e.target === e.currentTarget && setNotifOpen(false)
                }
              >
                <div className="notif-dropdown">
                  <div className="notif-dropdown-head">
                    <strong>Notifications</strong>
                    {notifState.unreadCount > 0 && (
                      <button type="button" onClick={markAllNotificationsRead}>
                        Mark all as read
                      </button>
                    )}
                  </div>
                  {notifState.recent.length === 0 && (
                    <p className="notif-empty">Nothing yet.</p>
                  )}
                  {notifState.recent.map((item) => (
                    <Link
                      key={item.id}
                      href={item.link || "#"}
                      className={`notif-item${item.readAt ? "" : " is-unread"}`}
                      onClick={() => {
                        setNotifOpen(false);
                        if (!item.readAt) markNotificationRead(item.id);
                      }}
                    >
                      <strong>{item.title}</strong>
                      {item.body && <small>{item.body}</small>}
                    </Link>
                  ))}
                  <Link
                    href={`${BASE_PATH}/notifications`}
                    className="notif-view-all"
                    onClick={() => setNotifOpen(false)}
                  >
                    View all →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </header>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => load()}>Try again</button>
          </div>
        )}
        {notice && <div className="notice-banner">{notice}</div>}
        {!data ? (
          <div className="loading">
            <span />
            <p>Loading rooms, residents and operational records...</p>
          </div>
        ) : (
          <div className="content module-content">{children}</div>
        )}
      </main>
      {showTop && (
        <button
          className="top-button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑ Top
        </button>
      )}
    </div>
  );
}

export default function SystemLayout({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_PATH}/api/auth`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        user?: { roleKey: string } | null;
      }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) window.location.replace(`${BASE_PATH}/login`);
        else if (result.user.roleKey === "tenant")
          window.location.replace(`${BASE_PATH}/student`);
        else setAllowed(true);
      })
      .catch(() => !cancelled && window.location.replace(`${BASE_PATH}/login`));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!allowed)
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-checking">Checking your session...</p>
        </div>
      </div>
    );

  return (
    <SystemProvider>
      <Chrome>{children}</Chrome>
    </SystemProvider>
  );
}
