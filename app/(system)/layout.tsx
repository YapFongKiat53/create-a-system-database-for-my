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
} from "./NavIcons";

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

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 650);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
    <div className="app-shell">
      <div className="sidebar-trigger" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BrandIcon />
          </span>
          <div>
            <strong>Hostel Operations</strong>
            <small>Management console</small>
          </div>
        </div>
        <nav className="nav-groups">
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
            onClick={async () => {
              await fetch(`${BASE_PATH}/api/auth`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              window.location.replace(`${BASE_PATH}/login`);
            }}
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
