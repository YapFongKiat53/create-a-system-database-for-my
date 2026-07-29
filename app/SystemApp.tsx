"use client";

import { useEffect, useState } from "react";
import type { Data, HostelTab, Row, View } from "./modules/shared";
import { DashboardModule } from "./modules/Dashboard";
import { HostelModule } from "./modules/HostelInformation";
import { UnitsModule } from "./modules/UnitInformation";
import { StudentsModule } from "./modules/StudentInformation";
import { ParkingModule } from "./modules/Parking";
import { MaintenanceModule } from "./modules/Maintenance";
import { FinanceModule } from "./modules/Finance";
import { AnnouncementsModule } from "./modules/Announcements";
import { ReportsModule } from "./modules/Reports";
import { UserManagementModule } from "./modules/UserManagement";

export default function SystemApp() {
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [tab, setTab] = useState<HostelTab>("availability");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showTop, setShowTop] = useState(false);

  const load = async () => {
    setError("");
    try {
      const response = await fetch("/api/system", { cache: "no-store" });
      const result = (await response.json()) as {
        error?: string;
      } & Partial<Data>;
      if (!response.ok)
        throw new Error(result.error || "Unable to load records");
      setData(result as Data);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to load records",
      );
    }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 650);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const save = async (payload: Record<string, unknown>, success = "Saved") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/system", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        ok?: boolean;
        id?: number;
      };
      if (!response.ok)
        throw new Error(result.error || "Unable to save record");
      await load();
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3000);
      return result as { ok: boolean; id?: number };
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save record",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const allNavigation: {
    id: View;
    label: string;
    mark: string;
    note: string;
    permission: string;
  }[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      mark: "D",
      note: "Today at a glance",
      permission: "",
    },
    {
      id: "hostels",
      label: "Hostel Information",
      mark: "H",
      note: "Sales & rooms",
      permission: "hostels",
    },
    {
      id: "units",
      label: "Unit Information",
      mark: "U",
      note: "Owners & assets",
      permission: "units-general",
    },
    {
      id: "students",
      label: "Student Information",
      mark: "S",
      note: "Tenancy lifecycle",
      permission: "students",
    },
    {
      id: "parking",
      label: "Parking",
      mark: "P",
      note: "Lots & rentals",
      permission: "parking",
    },
    {
      id: "maintenance",
      label: "Maintenance",
      mark: "M",
      note: "Tickets & meters",
      permission: "maintenance",
    },
    {
      id: "finance",
      label: "Finance",
      mark: "F",
      note: "Billing & receipts",
      permission: "finance",
    },
    {
      id: "announcements",
      label: "Announcements",
      mark: "A",
      note: "Resident notices",
      permission: "announcements",
    },
    {
      id: "reports",
      label: "Reports",
      mark: "R",
      note: "Operational review",
      permission: "reports",
    },
    {
      id: "users",
      label: "User Management",
      mark: "UM",
      note: "Roles & access",
      permission: "users",
    },
  ];
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
  const activeView = navigation.some((item) => item.id === view)
    ? view
    : navigation[0]?.id || "announcements";
  const current =
    navigation.find((item) => item.id === activeView) || allNavigation[0];

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
            <button
              key={item.id}
              className={activeView === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <span className="nav-mark">{item.mark}</span>
              <span className="nav-copy">
                <b>{item.label}</b>
                <small>{item.note}</small>
              </span>
            </button>
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
              OPERATIONS / {current.label.toUpperCase()}
            </p>
            <h1>{current.label}</h1>
          </div>
        </header>
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={load}>Try again</button>
          </div>
        )}
        {notice && <div className="notice-banner">{notice}</div>}
        {!data ? (
          <div className="loading">
            <span />
            <p>Loading rooms, residents and operational records...</p>
          </div>
        ) : (
          <div className="content module-content">
            {activeView === "dashboard" && (
              <DashboardModule
                data={data}
                onOpenModule={(next) => setView(next as View)}
              />
            )}
            {activeView === "hostels" && (
              <HostelModule
                data={data}
                save={save}
                busy={busy}
                tab={tab}
                setTab={setTab}
              />
            )}
            {activeView === "units" && (
              <UnitsModule data={data} save={save} busy={busy} />
            )}
            {activeView === "students" && (
              <StudentsModule data={data} save={save} busy={busy} />
            )}
            {activeView === "parking" && (
              <ParkingModule data={data} save={save} busy={busy} />
            )}
            {activeView === "maintenance" && (
              <MaintenanceModule data={data} save={save} busy={busy} />
            )}
            {activeView === "finance" && (
              <FinanceModule data={data} save={save} busy={busy} />
            )}
            {activeView === "announcements" && (
              <AnnouncementsModule data={data} save={save} busy={busy} />
            )}
            {activeView === "reports" && <ReportsModule data={data} />}
            {activeView === "users" && (
              <UserManagementModule data={data} save={save} busy={busy} />
            )}
          </div>
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
