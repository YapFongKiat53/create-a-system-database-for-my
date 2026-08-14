"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SystemProvider, useSystem } from "../SystemContext";
import type { Row } from "../modules/shared";

const allNavigation: {
  href: string;
  label: string;
  mark: string;
  note: string;
  permission: string;
}[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    mark: "D",
    note: "Today at a glance",
    permission: "",
  },
  {
    href: "/hostels",
    label: "Hostel Information",
    mark: "H",
    note: "Sales & rooms",
    permission: "hostels",
  },
  {
    href: "/units",
    label: "Unit Information",
    mark: "U",
    note: "Owners & assets",
    permission: "units-general",
  },
  {
    href: "/students",
    label: "Student Information",
    mark: "S",
    note: "Tenancy lifecycle",
    permission: "students",
  },
  {
    href: "/parking",
    label: "Parking",
    mark: "P",
    note: "Lots & rentals",
    permission: "parking",
  },
  {
    href: "/maintenance",
    label: "Maintenance",
    mark: "M",
    note: "Tickets & meters",
    permission: "maintenance",
  },
  {
    href: "/finance",
    label: "Finance",
    mark: "F",
    note: "Billing & receipts",
    permission: "finance",
  },
  {
    href: "/announcements",
    label: "Announcements",
    mark: "A",
    note: "Resident notices",
    permission: "announcements",
  },
  {
    href: "/reports",
    label: "Reports",
    mark: "R",
    note: "Operational review",
    permission: "reports",
  },
  {
    href: "/users",
    label: "User Management",
    mark: "UM",
    note: "Roles & access",
    permission: "users",
  },
];

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
          <span className="brand-mark">HO</span>
          <div>
            <strong>Hostel Operations</strong>
            <small>Internal management system</small>
          </div>
        </div>
        <p className="nav-label">MODULES</p>
        <nav>
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              <span className="nav-mark">{item.mark}</span>
              <span className="nav-copy">
                <b>{item.label}</b>
                <small>{item.note}</small>
              </span>
            </Link>
          ))}
        </nav>
        <div className="phase-card">
          <small>SYSTEM SCOPE</small>
          <strong>9 connected modules</strong>
          <div>
            <i style={{ width: "82%" }} />
          </div>
          <p>Room assignment stays manual; billing uses operational records.</p>
        </div>
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
        </div>
        <button
          className="sidebar-signout"
          onClick={async () => {
            await fetch("/api/auth", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "logout" }),
            });
            window.location.replace("/login");
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">
              OPERATIONS / {(current?.label || "").toUpperCase()}
            </p>
            <h1>{current?.label}</h1>
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
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json() as Promise<{
        user?: { roleKey: string } | null;
      }>)
      .then((result) => {
        if (cancelled) return;
        if (!result.user) window.location.replace("/login");
        else if (result.user.roleKey === "tenant")
          window.location.replace("/student");
        else setAllowed(true);
      })
      .catch(() => !cancelled && window.location.replace("/login"));
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
