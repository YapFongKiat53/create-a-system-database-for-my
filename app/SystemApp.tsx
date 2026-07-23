"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  FormEvent,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

type Row = Record<string, any>;
type Data = {
  hostels: Row[];
  units: Row[];
  owners: Row[];
  bedSpaces: Row[];
  accessCards: Row[];
  services: Row[];
  reservations: Row[];
  students: Row[];
  studentRateChanges: Row[];
  salesPeople: string[];
  parkingLots: Row[];
  parkingRentals: Row[];
  tickets: Row[];
  ticketMessages: Row[];
  meterReadings: Row[];
  billingCycles: Row[];
  invoices: Row[];
  announcements: Row[];
  attachments: Row[];
  ticketCategories: Row[];
  generalCosts: Row[];
  billingAdjustments: Row[];
  roles: Row[];
  users: Row[];
  rolePermissions: Row[];
  reminderTemplates: Row[];
  currentUser: Row;
  importProgress: { assignments: number; expected: number };
};
type View =
  | "hostels"
  | "units"
  | "students"
  | "parking"
  | "maintenance"
  | "finance"
  | "announcements"
  | "reports"
  | "users";
type HostelTab = "availability" | "reservations" | "pricing" | "occupancy";

const today = new Date().toISOString().slice(0, 10);
const chargeLabels: Record<string, string> = {
  "first-month-rental": "First month advance rental",
  deposit: "Deposit",
  "admin-fee": "Admin fee",
  "access-card-deposit": "Access card deposit",
  "access-card-handling": "Access card handling fee",
  "stamping-fee": "Stamping fee",
  "cleaning-package": "Cleaning package",
  "bedding-set": "Bedding set",
  "advance-rental": "Advance rental",
  "advance-utility": "Advance utility fee",
};
const blankCharges = Object.fromEntries(
  Object.keys(chargeLabels).map((key) => [key, 0]),
) as Record<string, number>;
const money = (value: number | null | undefined, cents = false) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "Not set"
    : new Intl.NumberFormat("en-MY", {
        style: "currency",
        currency: "MYR",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      }).format(Number(value));
const titleCase = (value: string) =>
  String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string | null | undefined, short = false) =>
  value
    ? new Intl.DateTimeFormat(
        "en-GB",
        short
          ? { day: "2-digit", month: "2-digit" }
          : { day: "2-digit", month: "short", year: "numeric" },
      ).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`))
    : "-";
const genderLabel = (value: string) =>
  value === "unspecified"
    ? "To confirm"
    : value === "mixed"
      ? "Special / mixed"
      : titleCase(value);
const bedTypeLabel = (value: string) =>
  value === "unknown"
    ? "Bed type not set"
    : value === "two-single"
      ? "2 single beds"
      : titleCase(value);
const commitsInventory = (row: Row) =>
  row.status === "reserved" && row.inventoryCommitted;
const reservationWeight = (row: Row, data: Data) =>
  row.reservationType === "group"
    ? row.preferredUnitId
      ? Math.max(
          1,
          data.bedSpaces.filter((bed) => bed.unitId === row.preferredUnitId)
            .length,
        )
      : Math.max(1, Number(row.groupSize || 1))
    : 1;
const formValues = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget).entries());
const uploadAttachment = async (
  file: File,
  contextType: string,
  recordId: number,
  uploadedBy = "Administrator",
) => {
  const form = new FormData();
  form.set("file", file);
  form.set("contextType", contextType);
  form.set("recordId", String(recordId));
  form.set("uploadedBy", uploadedBy);
  const response = await fetch("/api/files", { method: "POST", body: form });
  const result = (await response.json()) as { error?: string; id?: number };
  if (!response.ok) throw new Error(result.error || "Unable to upload file");
  return result;
};

export default function SystemApp() {
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("hostels");
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
          <span>IR</span>
          <div>
            <strong>{data?.currentUser?.displayName || "Irena"}</strong>
            <small>{data?.currentUser?.roleName || "Administrator"}</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">
              OPERATIONS / {current.label.toUpperCase()}
            </p>
            <h1>{current.label}</h1>
          </div>
          <div className="source-pill">
            <span />
            <div>
              <small>PRIVATE WORKSPACE</small>
              <strong>Cloud records active</strong>
            </div>
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

function HostelModule({
  data,
  save,
  busy,
  tab,
  setTab,
}: {
  data: Data;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
  busy: boolean;
  tab: HostelTab;
  setTab: (tab: HostelTab) => void;
}) {
  const [query, setQuery] = useState("");
  const [hostelFilter, setHostelFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [bathroomFilter, setBathroomFilter] = useState("all");
  const [bedTypeFilter, setBedTypeFilter] = useState("all");
  const [availableDate, setAvailableDate] = useState(today);
  const [maxRate, setMaxRate] = useState("");
  const [visible, setVisible] = useState(100);
  const [reservationOpen, setReservationOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Row | null>(
    null,
  );
  const [reservationBed, setReservationBed] = useState<Row | null>(null);
  const [convertReservation, setConvertReservation] = useState<Row | null>(
    null,
  );
  const [chargeOpen, setChargeOpen] = useState(false);
  const [charges, setCharges] = useState<Record<string, number>>(blankCharges);
  const [reservationKind, setReservationKind] = useState("individual");
  const [reservationQuery, setReservationQuery] = useState("");
  const [reservationHostelFilter, setReservationHostelFilter] = useState("all");
  const [pricingHostel, setPricingHostel] = useState(
    data.hostels[0]?.code || "all",
  );
  const [pricingCategory, setPricingCategory] = useState("A");
  const [pricingRoomType, setPricingRoomType] = useState("single");
  const [priceType, setPriceType] = useState("standard");
  const [pricingRate, setPricingRate] = useState("");
  const [promotionStart, setPromotionStart] = useState(today);
  const [promotionEnd, setPromotionEnd] = useState("");
  const [selectedRooms, setSelectedRooms] = useState<number[]>([]);
  const [occupancyQuery, setOccupancyQuery] = useState("");
  const [occupancyHostel, setOccupancyHostel] = useState("all");
  const [occupancyContractEnd, setOccupancyContractEnd] = useState("");
  const permissionFor = (moduleKey: string) =>
    data.currentUser?.permissions?.find(
      (permission: Row) => permission.moduleKey === moduleKey,
    )?.canView;
  const canUseSales = Boolean(permissionFor("hostels-sales"));
  const canUseRates = Boolean(permissionFor("hostels-rates"));
  const canUseOccupancy = Boolean(permissionFor("hostels-occupancy"));
  const allowedHostelTabs: HostelTab[] = [
    ...(canUseSales ? (["availability", "reservations"] as HostelTab[]) : []),
    ...(canUseSales || canUseRates ? (["pricing"] as HostelTab[]) : []),
    ...(canUseSales || canUseOccupancy ? (["occupancy"] as HostelTab[]) : []),
  ];
  const currentHostelTab = allowedHostelTabs.includes(tab)
    ? tab
    : allowedHostelTabs[0] || "occupancy";

  const categories = useMemo(
    () =>
      [...new Set(data.bedSpaces.map((bed) => String(bed.roomLabel)))].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      ),
    [data],
  );
  const totals = useMemo(
    () => ({
      beds: data.bedSpaces.length,
      occupied: data.bedSpaces.filter((bed) => bed.status === "occupied")
        .length,
      vacant: data.bedSpaces.filter((bed) => bed.status === "vacant").length,
      special: data.bedSpaces.filter((bed) => bed.status === "special-use")
        .length,
    }),
    [data],
  );

  const reservationMatchesBed = (reservation: Row, bed: Row) =>
    reservation.status === "reserved" &&
    reservation.targetMoveInDate <= availableDate &&
    (!reservation.preferredHostelId ||
      reservation.preferredHostelId === bed.hostelId) &&
    (!reservation.preferredUnitId ||
      reservation.preferredUnitId === bed.unitId) &&
    (["unspecified", "mixed"].includes(reservation.preferredGender) ||
      reservation.preferredGender === bed.gender) &&
    (reservation.roomCategory === "any" ||
      reservation.roomCategory === bed.roomLabel) &&
    (reservation.roomType === "any" || reservation.roomType === bed.roomType) &&
    (reservation.bathroomType === "any" ||
      reservation.bathroomType === bed.bathroomType);
  const effectiveRate = (bed: Row) =>
    bed.promotionRate !== null &&
    (!bed.promotionStartDate || bed.promotionStartDate <= availableDate) &&
    (!bed.promotionEndDate || bed.promotionEndDate >= availableDate)
      ? bed.promotionRate
      : bed.currentRental;
  const availability = data.bedSpaces.filter((bed) => {
    const available =
      bed.availabilityState === "available-now" ||
      (bed.availabilityState === "upcoming" &&
        bed.availableFrom &&
        bed.availableFrom <= availableDate);
    const search = query.toLowerCase().trim();
    const reservations = data.reservations.filter((reservation) =>
      reservationMatchesBed(reservation, bed),
    );
    const searchText =
      `${bed.hostelName} ${bed.unitCode} ${bed.roomLabel} ${bed.legacyCode} ${bed.occupantName || ""} ${reservations.map((row) => `${row.studentName} ${row.salesPerson}`).join(" ")}`.toLowerCase();
    return (
      available &&
      (!bed.unitSurrenderDate || bed.unitSurrenderDate > availableDate) &&
      (hostelFilter === "all" || bed.hostelCode === hostelFilter) &&
      (genderFilter === "all" || bed.gender === genderFilter) &&
      (roomFilter === "all" || bed.roomType === roomFilter) &&
      (categoryFilter === "all" || bed.roomLabel === categoryFilter) &&
      (bathroomFilter === "all" || bed.bathroomType === bathroomFilter) &&
      (bedTypeFilter === "all" || bed.bedType === bedTypeFilter) &&
      (!maxRate ||
        (effectiveRate(bed) !== null &&
          effectiveRate(bed) <= Number(maxRate))) &&
      (!search || searchText.includes(search))
    );
  });
  const committed = data.reservations.filter(
    (row) =>
      commitsInventory(row) &&
      row.targetMoveInDate <= availableDate &&
      (hostelFilter === "all" ||
        row.preferredHostelId ===
          data.hostels.find((h) => h.code === hostelFilter)?.id) &&
      (genderFilter === "all" ||
        row.preferredGender === genderFilter ||
        row.preferredGender === "unspecified"),
  );
  const committedWeight = committed.reduce(
    (sum, row) => sum + reservationWeight(row, data),
    0,
  );
  const sellable = Math.max(0, availability.length - committedWeight);
  const resetFilters = () => {
    setQuery("");
    setHostelFilter("all");
    setGenderFilter("all");
    setRoomFilter("all");
    setCategoryFilter("all");
    setBathroomFilter("all");
    setBedTypeFilter("all");
    setAvailableDate(today);
    setMaxRate("");
    setVisible(100);
  };
  const openReservation = (bed: Row | null = null, edit: Row | null = null) => {
    setReservationBed(bed);
    setEditingReservation(edit);
    setReservationKind(edit?.reservationType || "individual");
    setCharges(
      edit
        ? {
            ...blankCharges,
            ...Object.fromEntries(
              edit.charges.map((item: Row) => [
                item.chargeType,
                Number(item.amount),
              ]),
            ),
          }
        : { ...blankCharges },
    );
    setReservationOpen(true);
  };
  const totalCharges = Object.values(charges).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const filteredReservations = data.reservations.filter((reservation) => {
    const search = reservationQuery.trim().toLowerCase();
    return (
      (reservationHostelFilter === "all" ||
        String(reservation.preferredHostelId || "") ===
          reservationHostelFilter) &&
      (!search ||
        `${reservation.studentName} ${reservation.salesPerson} ${reservation.referenceNo}`
          .toLowerCase()
          .includes(search))
    );
  });

  const rooms = useMemo(() => {
    const map = new Map<number, Row>();
    for (const bed of data.bedSpaces) {
      if (!map.has(bed.roomId))
        map.set(bed.roomId, {
          id: bed.roomId,
          hostelCode: bed.hostelCode,
          hostelId: bed.hostelId,
          hostelName: bed.hostelName,
          unitId: bed.unitId,
          unitCode: bed.unitCode,
          roomLabel: bed.roomLabel,
          roomType: bed.roomType,
          bathroomType: bed.bathroomType,
          salesRate: bed.salesRate,
          promotionRate: bed.promotionRate,
          promotionStartDate: bed.promotionStartDate,
          promotionEndDate: bed.promotionEndDate,
          beds: 0,
          vacant: 0,
        });
      const room = map.get(bed.roomId)!;
      room.beds++;
      if (bed.status === "vacant") room.vacant++;
    }
    return [...map.values()].filter(
      (room) =>
        room.hostelCode === pricingHostel &&
        room.roomLabel === pricingCategory &&
        room.roomType === pricingRoomType &&
        room.vacant > 0,
    );
  }, [data, pricingHostel, pricingCategory, pricingRoomType]);
  const bulkPrice = async () => {
    const ok = await save(
      {
        action: "bulk-room-price",
        roomIds: selectedRooms,
        salesRate: Number(pricingRate),
        priceType,
        promotionStartDate: promotionStart,
        promotionEndDate: promotionEnd,
      },
      "Pricing updated for vacant rooms",
    );
    if (ok) {
      setSelectedRooms([]);
      setPricingRate("");
    }
  };
  const endPromotions = async () => {
    const selectedHostel = data.hostels.find(
      (hostel) => hostel.code === pricingHostel,
    );
    if (!selectedHostel) return;
    await save(
      {
        action: "promotion-end",
        hostelId: selectedHostel.id,
        roomCategory: pricingCategory,
        roomType: pricingRoomType,
        endDate: today,
      },
      `${selectedHostel.name} promotions ended`,
    );
  };
  const occupancyRows = data.bedSpaces
    .filter((bed) => {
      const search = occupancyQuery.trim().toLowerCase();
      const text =
        `${bed.legacyCode} ${bed.hostelName} ${bed.unitCode} ${bed.occupantName || ""}`.toLowerCase();
      return (
        (occupancyHostel === "all" || bed.hostelCode === occupancyHostel) &&
        (!occupancyContractEnd ||
          String(bed.agreementEndDate || "").slice(0, 10) ===
            occupancyContractEnd) &&
        (!search || text.includes(search))
      );
    })
    .sort((left, right) =>
      String(left.legacyCode).localeCompare(
        String(right.legacyCode),
        undefined,
        { numeric: true },
      ),
    );

  return (
    <>
      <div className="sales-overview">
        <section className="intro compact-intro">
          <div>
            <span className="section-kicker">SALES AVAILABILITY</span>
            <h2>Find the right room for the date a student needs it.</h2>
            <p>
              Vacancies, upcoming contract endings and paid commitments are
              calculated together. Reservations remain editable until manual
              room assignment.
            </p>
          </div>
          {canUseSales && (
            <button className="primary" onClick={() => openReservation()}>
              + New reservation
            </button>
          )}
        </section>
        <section className="metrics">
          <Metric
            label="HOSTELS"
            value={String(data.hostels.length)}
            note={`${data.units.length} property units`}
            tone="green"
          />
          <Metric
            label="TOTAL ROOM CODES"
            value={String(totals.beds)}
            note={`${totals.vacant} vacant now`}
            tone="navy"
          />
          <Metric
            label="OCCUPIED"
            value={String(totals.occupied)}
            note={`${totals.occupied} of ${totals.beds} codes`}
            tone="sand"
          />
          <Metric
            label="OCCUPANCY"
            value={`${Math.round((totals.occupied / Math.max(1, totals.occupied + totals.vacant)) * 100)}%`}
            note={`${totals.special} special-use`}
            tone="coral"
          />
        </section>
        <section className="hostel-grid">
          {data.hostels.map((hostel) => {
            const hostelCommitments = data.reservations
              .filter(
                (r) => commitsInventory(r) && r.preferredHostelId === hostel.id,
              )
              .reduce((sum, r) => sum + reservationWeight(r, data), 0);
            const femaleCommit = data.reservations
              .filter(
                (r) =>
                  commitsInventory(r) &&
                  r.preferredHostelId === hostel.id &&
                  r.preferredGender === "female",
              )
              .reduce((sum, r) => sum + reservationWeight(r, data), 0);
            const maleCommit = data.reservations
              .filter(
                (r) =>
                  commitsInventory(r) &&
                  r.preferredHostelId === hostel.id &&
                  r.preferredGender === "male",
              )
              .reduce((sum, r) => sum + reservationWeight(r, data), 0);
            const percent = Math.round(
              (hostel.occupied / Math.max(1, hostel.occupied + hostel.vacant)) *
                100,
            );
            return (
              <button
                key={hostel.id}
                className={
                  hostelFilter === hostel.code
                    ? "hostel-card selected"
                    : "hostel-card"
                }
                onClick={() => {
                  setHostelFilter(
                    hostelFilter === hostel.code ? "all" : hostel.code,
                  );
                  setTab("availability");
                }}
              >
                <div className="hostel-card-top">
                  <span>{hostel.code}</span>
                  <small>
                    <b>{hostel.bedSpaces}</b> total codes
                  </small>
                </div>
                <h3>{hostel.name}</h3>
                <p>{hostel.address}</p>
                <div className="hostel-occupancy">
                  <strong>{percent}% occupied</strong>
                  <span>
                    {Math.max(0, hostel.vacant - hostelCommitments)} sellable
                  </span>
                </div>
                <div className="progress">
                  <i style={{ width: `${percent}%` }} />
                </div>
                <div className="hostel-card-stats">
                  <span>
                    <b>{hostel.units}</b> units
                  </span>
                  <span>
                    <b>{hostel.occupied}</b> occupied
                  </span>
                  <span>
                    <b>{hostel.vacant}</b> vacant
                  </span>
                </div>
                <div className="gender-vacancy">
                  <span>
                    Female sellable{" "}
                    <b>{Math.max(0, hostel.vacantFemale - femaleCommit)}</b>
                  </span>
                  <span>
                    Male sellable{" "}
                    <b>{Math.max(0, hostel.vacantMale - maleCommit)}</b>
                  </span>
                  <span>
                    To confirm <b>{hostel.vacantUnassigned}</b>
                  </span>
                </div>
              </button>
            );
          })}
        </section>
      </div>
      <section className="workspace panel hostel-workspace">
        <div className="workspace-tabs sticky-tabs">
          {canUseSales && (
            <button
              className={currentHostelTab === "availability" ? "active" : ""}
              onClick={() => setTab("availability")}
            >
              Availability search
            </button>
          )}
          {canUseSales && (
            <button
              className={currentHostelTab === "reservations" ? "active" : ""}
              onClick={() => setTab("reservations")}
            >
              Reservations{" "}
              <span>
                {
                  data.reservations.filter((r) => r.status === "reserved")
                    .length
                }
              </span>
            </button>
          )}
          {(canUseSales || canUseRates) && (
            <button
              className={currentHostelTab === "pricing" ? "active" : ""}
              onClick={() => setTab("pricing")}
            >
              {canUseSales ? "Room pricing & rates" : "Operational rates"}
            </button>
          )}
          {(canUseSales || canUseOccupancy) && (
            <button
              className={currentHostelTab === "occupancy" ? "active" : ""}
              onClick={() => setTab("occupancy")}
            >
              Occupant & vacancy register
            </button>
          )}
        </div>
        {currentHostelTab === "availability" && (
          <>
            <div className="section-heading">
              <div>
                <small>DATE-BASED SEARCH</small>
                <h3>Available on {dateLabel(availableDate)}</h3>
                <p>
                  Reservation names and Sales persons are searchable even before
                  actual room assignment.
                </p>
              </div>
              <div className="availability-summary">
                <span>
                  <b>{availability.length}</b> physical options
                </span>
                <span>
                  <b>{committedWeight}</b> paid commitments
                </span>
                <strong>{sellable} sellable</strong>
              </div>
            </div>
            <div className="inventory-rule">
              <div>
                <strong>Paid commitments reduce the Sales balance</strong>
                <span>
                  Unpaid enquiries remain visible but do not reduce
                  availability.
                </span>
              </div>
            </div>
            <div className="filters availability-filters sticky-filters">
              <label className="search">
                <span>Name, unit or room code</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Room, student or Sales person"
                />
              </label>
              <label>
                Needed on
                <input
                  type="date"
                  value={availableDate}
                  onChange={(e) => setAvailableDate(e.target.value)}
                />
              </label>
              <label>
                Hostel
                <select
                  value={hostelFilter}
                  onChange={(e) => setHostelFilter(e.target.value)}
                >
                  <option value="all">All hostels</option>
                  {data.hostels.map((h) => (
                    <option key={h.id} value={h.code}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Student gender
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value)}
                >
                  <option value="all">Any gender</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="mixed">Special / mixed</option>
                </select>
              </label>
              <label>
                Room category
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">Any category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      Room {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Room type
                <select
                  value={roomFilter}
                  onChange={(e) => setRoomFilter(e.target.value)}
                >
                  <option value="all">Single or sharing</option>
                  <option value="single">Single room</option>
                  <option value="sharing">Sharing room</option>
                </select>
              </label>
              <label>
                Bathroom
                <select
                  value={bathroomFilter}
                  onChange={(e) => setBathroomFilter(e.target.value)}
                >
                  <option value="all">Any bathroom</option>
                  <option value="attached">Attached</option>
                  <option value="non-attached">Non-attached</option>
                  <option value="unknown">Not set</option>
                </select>
              </label>
              <label>
                Bed type
                <select
                  value={bedTypeFilter}
                  onChange={(e) => setBedTypeFilter(e.target.value)}
                >
                  <option value="all">Any bed</option>
                  <option value="single">Single bed</option>
                  <option value="queen">Queen bed</option>
                  <option value="two-single">2 single beds</option>
                  <option value="bunk">Bunk bed</option>
                  <option value="unknown">Not set</option>
                </select>
              </label>
              <label>
                Maximum rent
                <input
                  type="number"
                  value={maxRate}
                  onChange={(e) => setMaxRate(e.target.value)}
                  placeholder="No limit"
                />
              </label>
              <button className="secondary reset-button" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
            <div className="table-wrap availability-table desktop-availability">
              <table>
                <thead>
                  <tr>
                    <th>Room code</th>
                    <th>Room details</th>
                    <th>Current occupant</th>
                    <th>Student / unit gender</th>
                    <th>Sales rate</th>
                    <th>Contract ends</th>
                    <th>Available</th>
                    <th>Reservation details</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {availability.slice(0, visible).map((bed) => {
                    const matches = data.reservations.filter((r) =>
                      reservationMatchesBed(r, bed),
                    );
                    return (
                      <tr key={bed.id}>
                        <td>
                          <code>{bed.legacyCode}</code>
                          <small>
                            {bed.hostelName} / {bed.unitCode}
                          </small>
                        </td>
                        <td>
                          <div className="detail-tags">
                            <span>
                              Room {bed.roomLabel} · {titleCase(bed.roomType)}
                            </span>
                            <span className="aqua">
                              {bed.bathroomType === "unknown"
                                ? "Bathroom not set"
                                : `${titleCase(bed.bathroomType)} bathroom`}
                            </span>
                            <span className="bed-tag">
                              {bedTypeLabel(bed.bedType)}
                            </span>
                          </div>
                        </td>
                        <td>
                          {bed.occupantName ? (
                            <>
                              <strong>{bed.occupantName}</strong>
                              <small>
                                {bed.occupantNationality ||
                                  "Nationality not set"}{" "}
                                ·{" "}
                                {bed.occupantSchool ||
                                  bed.occupantCourse ||
                                  "Study details not set"}
                              </small>
                            </>
                          ) : (
                            <em>Vacant</em>
                          )}
                        </td>
                        <td>
                          <span className={`gender-pill ${bed.gender}`}>
                            {genderLabel(bed.gender)}
                          </span>
                        </td>
                        <td>
                          <RateDisplay bed={bed} date={availableDate} />
                        </td>
                        <td>{dateLabel(bed.agreementEndDate)}</td>
                        <td>
                          <span
                            className={
                              bed.availabilityState === "available-now"
                                ? "available-badge now"
                                : "available-badge upcoming"
                            }
                          >
                            {bed.availabilityState === "available-now"
                              ? "Available now"
                              : `From ${dateLabel(bed.availableFrom)}`}
                          </span>
                        </td>
                        <td>
                          {matches.length ? (
                            <div className="reservation-match">
                              {matches.slice(0, 2).map((r) => (
                                <span key={r.id}>
                                  <b>{r.studentName}</b>
                                  <small>
                                    {r.salesPerson || "Sales not set"} ·{" "}
                                    {dateLabel(r.targetMoveInDate, true)} ·{" "}
                                    {r.inventoryCommitted ? "Paid" : "Enquiry"}
                                  </small>
                                </span>
                              ))}
                              {matches.length > 2 && (
                                <small>+{matches.length - 2} more</small>
                              )}
                            </div>
                          ) : (
                            <span className="muted">
                              No matching reservation
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            className="secondary compact"
                            disabled={sellable === 0}
                            onClick={() => openReservation(bed)}
                          >
                            Reserve
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-availability">
              {availability.slice(0, visible).map((bed) => {
                const matches = data.reservations.filter((r) =>
                  reservationMatchesBed(r, bed),
                );
                return (
                  <article className="availability-card" key={bed.id}>
                    <div className="card-title">
                      <div>
                        <code>{bed.legacyCode}</code>
                        <p>
                          {bed.hostelName} · Unit {bed.unitCode}
                        </p>
                      </div>
                      <span className="available-badge now">
                        {bed.availabilityState === "available-now"
                          ? "Available"
                          : "Upcoming"}
                      </span>
                    </div>
                    <div className="detail-tags row-tags">
                      <span>
                        Room {bed.roomLabel} · {titleCase(bed.roomType)}
                      </span>
                      <span className="aqua">
                        {bed.bathroomType === "unknown"
                          ? "Bathroom not set"
                          : `${titleCase(bed.bathroomType)} bathroom`}
                      </span>
                      <span className="bed-tag">
                        {bedTypeLabel(bed.bedType)}
                      </span>
                    </div>
                    <div className="mobile-card-grid">
                      <div>
                        <small>Current occupant</small>
                        <strong>{bed.occupantName || "Vacant"}</strong>
                        <p>
                          {bed.occupantNationality || ""}{" "}
                          {bed.occupantSchool ? `· ${bed.occupantSchool}` : ""}
                        </p>
                      </div>
                      <div>
                        <small>Sales rate</small>
                        <RateDisplay bed={bed} date={availableDate} />
                      </div>
                      <div>
                        <small>Unit gender</small>
                        <span className={`gender-pill ${bed.gender}`}>
                          {genderLabel(bed.gender)}
                        </span>
                      </div>
                      <div>
                        <small>Contract end</small>
                        <strong>{dateLabel(bed.agreementEndDate)}</strong>
                      </div>
                    </div>
                    {matches.length > 0 && (
                      <div className="mobile-reservation">
                        <small>Matching reservations</small>
                        {matches.map((r) => (
                          <p key={r.id}>
                            <b>{r.studentName}</b> ·{" "}
                            {r.salesPerson || "Sales not set"} ·{" "}
                            {dateLabel(r.targetMoveInDate, true)}
                          </p>
                        ))}
                      </div>
                    )}
                    <button
                      className="primary"
                      onClick={() => openReservation(bed)}
                    >
                      Reserve this option
                    </button>
                  </article>
                );
              })}
            </div>
            {!availability.length && (
              <Empty
                title="No matching room codes"
                text="Reset the filters or try another date."
              />
            )}
            {visible < availability.length && (
              <div className="load-more">
                <button onClick={() => setVisible((v) => v + 100)}>
                  Show more
                </button>
                <span>
                  Showing {visible} of {availability.length}
                </span>
              </div>
            )}
          </>
        )}
        {currentHostelTab === "reservations" && (
          <>
            <div className="section-heading">
              <div>
                <small>INDIVIDUAL & GROUP</small>
                <h3>Reservations before manual assignment</h3>
                <p>
                  Edit details, add multiple payments, cancel an enquiry or
                  convert a confirmed booking into an actual room assignment.
                </p>
              </div>
              <button
                className="primary compact"
                onClick={() => openReservation()}
              >
                + New reservation
              </button>
            </div>
            <div className="filters reservation-filters">
              <label className="search">
                <span>Student / reservation</span>
                <input
                  value={reservationQuery}
                  onChange={(event) => setReservationQuery(event.target.value)}
                  placeholder="Student name, sales person or reference"
                />
              </label>
              <label>
                <span>Hostel</span>
                <select
                  value={reservationHostelFilter}
                  onChange={(event) =>
                    setReservationHostelFilter(event.target.value)
                  }
                >
                  <option value="all">All hostels</option>
                  {data.hostels.map((hostel) => (
                    <option key={hostel.id} value={hostel.id}>
                      {hostel.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="reservation-grid expanded-grid">
              {filteredReservations.map((r) => (
                <article
                  key={r.id}
                  className={r.status === "converted" ? "converted" : ""}
                >
                  <div>
                    <code>{r.referenceNo}</code>
                    <span className={`payment-status ${r.paymentStatus}`}>
                      {titleCase(r.paymentStatus)}
                    </span>
                  </div>
                  <h4>{r.studentName}</h4>
                  <p>
                    {titleCase(r.reservationType)} · Check-in{" "}
                    <b>{dateLabel(r.targetMoveInDate)}</b> · Sales:{" "}
                    <b>{r.salesPerson || "Not set"}</b>
                  </p>
                  <ul>
                    <li>{r.preferredHostelName}</li>
                    {r.preferredUnitId && (
                      <li>
                        Unit{" "}
                        {
                          data.units.find((u) => u.id === r.preferredUnitId)
                            ?.unitCode
                        }
                      </li>
                    )}
                    <li>{genderLabel(r.preferredGender)} student</li>
                    <li>
                      {r.roomCategory === "any"
                        ? "Any category"
                        : `Room ${r.roomCategory}`}
                    </li>
                    <li>
                      {r.roomType === "any"
                        ? "Any room type"
                        : titleCase(r.roomType)}
                    </li>
                  </ul>
                  <div
                    className={`commitment-note ${r.inventoryCommitted ? "committed" : ""}`}
                  >
                    <b>
                      {r.status === "converted"
                        ? `Assigned: ${r.assignedCode || "Unit confirmed"}`
                        : r.inventoryCommitted
                          ? "Included in Sales balance"
                          : "Enquiry only"}
                    </b>
                    <span>
                      {r.status === "converted"
                        ? "Reservation converted to actual assignment"
                        : r.inventoryCommitted
                          ? "Reduces sellable availability"
                          : "Does not reduce availability"}
                    </span>
                  </div>
                  <div className="reservation-money">
                    <span>
                      Total payable <b>{money(r.totalPayable)}</b>
                    </span>
                    <span>
                      Total paid <b>{money(r.amountPaid)}</b>
                    </span>
                    <span>
                      Balance required{" "}
                      <b>
                        {money(
                          Number(r.totalPayable || 0) -
                            Number(r.amountPaid || 0),
                        )}
                      </b>
                    </span>
                  </div>
                  <div className="mini-payments">
                    {r.payments.length ? (
                      r.payments.map((p: Row) => (
                        <span key={p.id}>
                          {dateLabel(p.paidAt)} · {money(p.amount)} ·{" "}
                          {p.reference || "No reference"}
                        </span>
                      ))
                    ) : (
                      <span>No payments recorded</span>
                    )}
                  </div>
                  {r.status === "reserved" && (
                    <>
                      <form
                        className="quick-payment"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = e.currentTarget;
                          const ok = await save(
                            {
                              action: "reservation-payment",
                              reservationId: r.id,
                              ...formValues(e),
                            },
                            "Payment added",
                          );
                          if (ok) f.reset();
                        }}
                      >
                        <select name="paymentStatus" defaultValue="partial">
                          <option value="admin-fee">Admin fee paid</option>
                          <option value="partial">Partial payment</option>
                          <option value="full">Full payment</option>
                        </select>
                        <input
                          name="paymentAmount"
                          type="number"
                          min="0"
                          placeholder="Amount"
                          required
                        />
                        <input
                          name="paymentReference"
                          placeholder="Payment reference"
                        />
                        <button className="secondary compact" disabled={busy}>
                          Add payment
                        </button>
                      </form>
                      <div className="card-actions">
                        <button
                          className="secondary compact"
                          onClick={() => openReservation(null, r)}
                        >
                          Edit reservation
                        </button>
                        <button
                          className="secondary compact"
                          onClick={() => setConvertReservation(r)}
                        >
                          Convert to assignment
                        </button>
                        <button
                          className="danger compact"
                          onClick={() =>
                            confirm(`Delete reservation ${r.referenceNo}?`) &&
                            save(
                              {
                                action: "reservation-delete",
                                reservationId: r.id,
                              },
                              "Reservation deleted",
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {currentHostelTab === "pricing" && (
          <>
            {canUseSales && (
              <>
                <div className="section-heading">
                  <div>
                    <small>BULK SALES PRICING</small>
                    <h3>Room category + room type pricing</h3>
                    <p>
                      Only selected rooms with a vacant room code are updated.
                      Existing occupants keep their tenancy rate.
                    </p>
                  </div>
                </div>
                <div className="pricing-controls">
                  <label>
                    Hostel
                    <select
                      value={pricingHostel}
                      onChange={(e) => {
                        setPricingHostel(e.target.value);
                        setSelectedRooms([]);
                      }}
                    >
                      {data.hostels.map((h) => (
                        <option key={h.id} value={h.code}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Room category
                    <select
                      value={pricingCategory}
                      onChange={(e) => {
                        setPricingCategory(e.target.value);
                        setSelectedRooms([]);
                      }}
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          Room {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Room type
                    <select
                      value={pricingRoomType}
                      onChange={(e) => {
                        setPricingRoomType(e.target.value);
                        setSelectedRooms([]);
                      }}
                    >
                      <option value="single">Single room</option>
                      <option value="sharing">Sharing room</option>
                    </select>
                  </label>
                  <label>
                    Price type
                    <select
                      value={priceType}
                      onChange={(e) => setPriceType(e.target.value)}
                    >
                      <option value="standard">
                        Original / standard price
                      </option>
                      <option value="promotion">Promotion price</option>
                    </select>
                  </label>
                  <label>
                    New rate (MYR)
                    <input
                      type="number"
                      min="0"
                      value={pricingRate}
                      onChange={(e) => setPricingRate(e.target.value)}
                      placeholder="e.g. 799"
                    />
                  </label>
                  {priceType === "promotion" ? (
                    <div className="promotion-fields">
                      <label>
                        Promotion starts
                        <input
                          type="date"
                          value={promotionStart}
                          onChange={(e) => setPromotionStart(e.target.value)}
                        />
                      </label>
                      <label>
                        Promotion ends
                        <input
                          type="date"
                          value={promotionEnd}
                          onChange={(e) => setPromotionEnd(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                  <button
                    className="secondary compact"
                    onClick={() => setSelectedRooms(rooms.map((r) => r.id))}
                  >
                    Select all {rooms.length}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !pricingRate || !selectedRooms.length}
                    onClick={bulkPrice}
                  >
                    Confirm {selectedRooms.length}
                  </button>
                  <button
                    className="danger compact"
                    disabled={busy || priceType !== "promotion"}
                    onClick={endPromotions}
                    title="End every active promotion matching this hostel, room category and room type"
                  >
                    End matching promotions today
                  </button>
                </div>
                <div className="pricing-preview">
                  <div className="preview-head">
                    <strong>Vacant-room preview</strong>
                    <span>
                      {rooms.length} matching · {selectedRooms.length} selected
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th />
                          <th>Hostel / unit</th>
                          <th>Room</th>
                          <th>Type</th>
                          <th>Vacant codes</th>
                          <th>Original price</th>
                          <th>Promotion price</th>
                          <th>New price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.map((room) => (
                          <tr key={room.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedRooms.includes(room.id)}
                                onChange={(e) =>
                                  setSelectedRooms((ids) =>
                                    e.target.checked
                                      ? [...new Set([...ids, room.id])]
                                      : ids.filter((id) => id !== room.id),
                                  )
                                }
                              />
                            </td>
                            <td>
                              {room.hostelName} / {room.unitCode}
                            </td>
                            <td>Room {room.roomLabel}</td>
                            <td>{titleCase(room.roomType)}</td>
                            <td>{room.vacant}</td>
                            <td>{money(room.salesRate)}</td>
                            <td>
                              <strong className="promo-price">
                                {room.promotionRate !== null
                                  ? money(room.promotionRate)
                                  : "No promotion"}
                              </strong>
                              <small>
                                {room.promotionRate !== null
                                  ? `${dateLabel(room.promotionStartDate)} – ${dateLabel(room.promotionEndDate)}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <strong>
                                {pricingRate
                                  ? money(Number(pricingRate))
                                  : "Enter above"}
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {canUseRates && <HostelRates data={data} save={save} busy={busy} />}
          </>
        )}
        {currentHostelTab === "occupancy" && (
          <>
            <div className="section-heading">
              <div>
                <small>COMPLETE REGISTER</small>
                <h3>Occupants and vacant room codes</h3>
                <p>
                  Sales can review seniority, intake, country and unit occupancy
                  before offering a room.
                </p>
              </div>
            </div>
            <div className="filters occupancy-filters">
              <label className="search">
                Room code, unit or student
                <input
                  value={occupancyQuery}
                  onChange={(event) => setOccupancyQuery(event.target.value)}
                  placeholder="Type room code, hostel/unit or student name"
                />
              </label>
              <label>
                Hostel
                <select
                  value={occupancyHostel}
                  onChange={(event) => setOccupancyHostel(event.target.value)}
                >
                  <option value="all">All hostels</option>
                  {data.hostels.map((hostel) => (
                    <option key={hostel.id} value={hostel.code}>
                      {hostel.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contract end date
                <input
                  type="date"
                  value={occupancyContractEnd}
                  onChange={(event) =>
                    setOccupancyContractEnd(event.target.value)
                  }
                />
              </label>
              <button
                className="secondary reset-button"
                onClick={() => {
                  setOccupancyQuery("");
                  setOccupancyHostel("all");
                  setOccupancyContractEnd("");
                }}
              >
                Reset filters
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room code</th>
                    <th>Hostel / unit</th>
                    <th>Room</th>
                    <th>Occupant</th>
                    <th>Study / origin</th>
                    <th>Rental</th>
                    <th>Contract end</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {occupancyRows.slice(0, visible).map((b) => (
                    <tr key={b.id}>
                      <td>
                        <code>{b.legacyCode}</code>
                      </td>
                      <td>
                        {b.hostelName} / {b.unitCode}
                      </td>
                      <td>
                        Room {b.roomLabel} · {titleCase(b.roomType)}
                      </td>
                      <td>{b.occupantName || <em>Vacant</em>}</td>
                      <td>
                        {b.occupantName ? (
                          <>
                            {b.occupantNationality || "-"}
                            <small>
                              {b.occupantSchool ||
                                b.occupantCourse ||
                                "Study info not set"}
                            </small>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{money(b.assignmentRental || b.currentRental)}</td>
                      <td>{dateLabel(b.agreementEndDate)}</td>
                      <td>
                        <span className={`unit-status ${b.status}`}>
                          {titleCase(b.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {reservationOpen && (
        <Modal
          title={editingReservation ? "Edit reservation" : "New reservation"}
          kicker="SALES RESERVATION"
          description="Check-in date and student gender drive availability. Room assignment remains manual."
          onClose={() => setReservationOpen(false)}
          wide
        >
          <ReservationEditor
            data={data}
            save={save}
            busy={busy}
            editingReservation={editingReservation}
            reservationBed={reservationBed}
            availableDate={availableDate}
            charges={charges}
            totalCharges={totalCharges}
            effectiveRate={effectiveRate}
            openCharges={() => setChargeOpen(true)}
            cancel={() => setReservationOpen(false)}
            complete={() => {
              setReservationOpen(false);
              setTab("reservations");
            }}
          />
          <form
            hidden
            key={editingReservation?.id || "new"}
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingReservation
                    ? "reservation-update"
                    : "reservation",
                  reservationId: editingReservation?.id,
                  chargeBreakdown: charges,
                  ...formValues(e),
                },
                editingReservation
                  ? "Reservation updated"
                  : "Reservation created",
              );
              if (ok) {
                setReservationOpen(false);
                setTab("reservations");
              }
            }}
          >
            <label>
              Reservation type
              <select
                name="reservationType"
                value={reservationKind}
                onChange={(e) => setReservationKind(e.target.value)}
              >
                <option value="individual">Individual</option>
                <option value="group">Group / whole unit</option>
              </select>
            </label>
            <label>
              {reservationKind === "group"
                ? "Representative / organisation"
                : "Student name"}
              <input
                name="studentName"
                required
                defaultValue={editingReservation?.studentName || ""}
              />
            </label>
            {reservationKind === "group" && (
              <>
                <label>
                  Representative type
                  <select
                    name="representativeType"
                    defaultValue={
                      editingReservation?.representativeType || "person"
                    }
                  >
                    <option value="person">Person</option>
                    <option value="company">Company</option>
                    <option value="institute">Institute</option>
                  </select>
                </label>
                <label>
                  Estimated group size
                  <input
                    name="groupSize"
                    type="number"
                    min="1"
                    max="99"
                    defaultValue={editingReservation?.groupSize || 1}
                  />
                </label>
              </>
            )}
            <label>
              Sales person-in-charge
              <select
                name="salesPerson"
                required
                defaultValue={editingReservation?.salesPerson || ""}
              >
                <option value="">Select Sales Team</option>
                {data.salesPeople.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Student gender
              <select
                name="preferredGender"
                required
                defaultValue={
                  editingReservation?.preferredGender ||
                  reservationBed?.gender ||
                  "female"
                }
              >
                <option value="female">Female student</option>
                <option value="male">Male student</option>
                <option value="mixed">Special case / mixed</option>
              </select>
            </label>
            <label>
              Check-in date
              <input
                name="targetMoveInDate"
                type="date"
                required
                defaultValue={
                  editingReservation?.targetMoveInDate || availableDate
                }
              />
            </label>
            <label>
              Preferred hostel
              <select
                name="preferredHostelId"
                defaultValue={
                  editingReservation?.preferredHostelId ||
                  reservationBed?.hostelId ||
                  ""
                }
              >
                <option value="">Any hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            {reservationKind === "group" && (
              <label className="wide">
                Preferred whole unit / house
                <select
                  name="preferredUnitId"
                  defaultValue={editingReservation?.preferredUnitId || ""}
                >
                  <option value="">Not selected yet</option>
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.hostelName} / {u.unitCode} · {genderLabel(u.gender)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {reservationKind === "individual" && (
              <>
                <label>
                  Room category
                  <select
                    name="roomCategory"
                    defaultValue={
                      editingReservation?.roomCategory ||
                      reservationBed?.roomLabel ||
                      "any"
                    }
                  >
                    <option value="any">Any category</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        Room {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Room type
                  <select
                    name="roomType"
                    defaultValue={
                      editingReservation?.roomType ||
                      reservationBed?.roomType ||
                      "any"
                    }
                  >
                    <option value="any">Any type</option>
                    <option value="single">Single</option>
                    <option value="sharing">Sharing</option>
                  </select>
                </label>
                <label>
                  Bathroom
                  <select
                    name="bathroomType"
                    defaultValue={
                      editingReservation?.bathroomType ||
                      reservationBed?.bathroomType ||
                      "any"
                    }
                  >
                    <option value="any">Any bathroom</option>
                    <option value="attached">Attached</option>
                    <option value="non-attached">Non-attached</option>
                  </select>
                </label>
                <label>
                  Provisional room option
                  <select
                    name="provisionalBedSpaceId"
                    defaultValue={
                      editingReservation?.provisionalBedSpaceId ||
                      reservationBed?.id ||
                      ""
                    }
                  >
                    <option value="">No room selected</option>
                    {availability.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.legacyCode} · {b.hostelName} ·{" "}
                        {money(effectiveRate(b))}
                      </option>
                    ))}
                  </select>
                  <small className="field-note">
                    Reference only; not the actual assignment.
                  </small>
                </label>
              </>
            )}
            <label>
              Payment status
              <select
                name="paymentStatus"
                defaultValue={editingReservation?.paymentStatus || "unpaid"}
              >
                <option value="unpaid">Unpaid enquiry</option>
                <option value="admin-fee">Admin fee paid</option>
                <option value="partial">Partial payment</option>
                <option value="full">Full payment</option>
              </select>
            </label>
            {!editingReservation && (
              <>
                <label>
                  Initial payment amount
                  <input
                    name="paymentAmount"
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                </label>
                <label>
                  Payment reference
                  <input
                    name="paymentReference"
                    placeholder="Receipt / bank reference"
                  />
                </label>
              </>
            )}
            <div className="wide total-payable">
              <div>
                <small>TOTAL PAYABLE</small>
                <strong>{money(totalCharges)}</strong>
                <p>Calculated from the payment breakdown.</p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setChargeOpen(true)}
              >
                Edit payment breakdown
              </button>
            </div>
            <label className="wide">
              Sales notes
              <input
                name="notes"
                defaultValue={editingReservation?.notes || ""}
                placeholder="Preferences, special terms or enquiry notes"
              />
            </label>
            <div className="form-actions wide">
              <button
                type="button"
                className="secondary"
                onClick={() => setReservationOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Save reservation"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {chargeOpen && (
        <Modal
          title="Upfront payment breakdown"
          kicker="TOTAL PAYABLE"
          description="Only fill applicable items. The total is calculated automatically."
          onClose={() => setChargeOpen(false)}
        >
          <div className="charge-grid">
            {Object.entries(chargeLabels).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="0"
                  value={charges[key] || ""}
                  onChange={(e) =>
                    setCharges((current) => ({
                      ...current,
                      [key]: Number(e.target.value || 0),
                    }))
                  }
                  placeholder="0"
                />
              </label>
            ))}
          </div>
          <div className="modal-total">
            <span>Total payable</span>
            <strong>{money(totalCharges)}</strong>
            <button className="primary" onClick={() => setChargeOpen(false)}>
              Apply breakdown
            </button>
          </div>
        </Modal>
      )}
      {convertReservation && (
        <Modal
          title="Convert to actual assignment"
          kicker="MANUAL ASSIGNMENT"
          description={
            convertReservation.reservationType === "group"
              ? "Confirm the whole unit. Tenant names can be added later in Student Information."
              : "Keep the provisional option or manually choose another vacant room code."
          }
          onClose={() => setConvertReservation(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "reservation-convert",
                  reservationId: convertReservation.id,
                  ...formValues(e),
                },
                "Reservation converted to assignment",
              );
              if (ok) setConvertReservation(null);
            }}
          >
            {convertReservation.reservationType === "group" ? (
              <label className="wide">
                Confirmed unit / house
                <SearchSelect
                  name="unitId"
                  required
                  defaultValue={convertReservation.preferredUnitId}
                  options={data.units.map((unit) => ({
                    value: unit.id,
                    label: `${unit.hostelName} / ${unit.unitCode} · ${genderLabel(unit.gender)}`,
                  }))}
                  placeholder="Type unit number or hostel"
                />
                <select
                  hidden
                  disabled
                  name="unitId"
                  required
                  defaultValue={convertReservation.preferredUnitId || ""}
                >
                  <option value="">Select unit</option>
                  {data.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.hostelName} / {u.unitCode} · {genderLabel(u.gender)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="wide">
                Actual room code
                <SearchSelect
                  name="bedSpaceId"
                  required
                  defaultValue={convertReservation.provisionalBedSpaceId}
                  options={data.bedSpaces
                    .filter((bed) => bed.status === "vacant")
                    .map((bed) => ({
                      value: bed.id,
                      label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode} · Room ${bed.roomLabel}`,
                    }))}
                  placeholder="Type room code, unit or hostel"
                />
                <select
                  hidden
                  disabled
                  name="bedSpaceId"
                  required
                  defaultValue={convertReservation.provisionalBedSpaceId || ""}
                >
                  <option value="">Select room code manually</option>
                  {data.bedSpaces
                    .filter((b) => b.status === "vacant")
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.legacyCode} · {b.hostelName} / {b.unitCode} · Room{" "}
                        {b.roomLabel}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="form-actions wide">
              <button
                type="button"
                className="secondary"
                onClick={() => setConvertReservation(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Confirm assignment
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ReservationEditor({
  data,
  save,
  busy,
  editingReservation,
  reservationBed,
  availableDate,
  charges,
  totalCharges,
  effectiveRate,
  openCharges,
  cancel,
  complete,
}: {
  data: Data;
  save: any;
  busy: boolean;
  editingReservation: Row | null;
  reservationBed: Row | null;
  availableDate: string;
  charges: Record<string, number>;
  totalCharges: number;
  effectiveRate: (bed: Row) => number | null;
  openCharges: () => void;
  cancel: () => void;
  complete: () => void;
}) {
  const [kind, setKind] = useState(
    editingReservation?.reservationType || "individual",
  );
  const [hostelId, setHostelId] = useState(
    String(
      editingReservation?.preferredHostelId || reservationBed?.hostelId || "",
    ),
  );
  const [gender, setGender] = useState(
    editingReservation?.preferredGender || reservationBed?.gender || "female",
  );
  const [date, setDate] = useState(
    editingReservation?.targetMoveInDate || availableDate,
  );
  const [roomType, setRoomType] = useState(
    editingReservation?.roomType || reservationBed?.roomType || "any",
  );
  const [category, setCategory] = useState(
    editingReservation?.roomCategory || reservationBed?.roomLabel || "any",
  );
  const [bathroom, setBathroom] = useState(
    editingReservation?.bathroomType || reservationBed?.bathroomType || "any",
  );
  const categories = [
    ...new Set(data.bedSpaces.map((bed) => String(bed.roomLabel))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const options = data.bedSpaces.filter((bed) => {
    const available =
      bed.status === "vacant" ||
      (bed.availableFrom && bed.availableFrom <= date);
    return (
      available &&
      (!hostelId || String(bed.hostelId) === hostelId) &&
      (["mixed", "unspecified"].includes(gender) || bed.gender === gender) &&
      (roomType === "any" || bed.roomType === roomType) &&
      (category === "any" || bed.roomLabel === category) &&
      (bathroom === "any" || bed.bathroomType === bathroom)
    );
  });
  return (
    <form
      className="form-grid reservation-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await save(
          {
            action: editingReservation ? "reservation-update" : "reservation",
            reservationId: editingReservation?.id,
            chargeBreakdown: charges,
            ...formValues(event),
          },
          editingReservation ? "Reservation updated" : "Reservation created",
        );
        if (ok) complete();
      }}
    >
      <label>
        Reservation type
        <select
          name="reservationType"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="individual">Individual</option>
          <option value="group">Group / whole unit</option>
        </select>
      </label>
      <label>
        Sales person-in-charge
        <select
          name="salesPerson"
          required
          defaultValue={editingReservation?.salesPerson || ""}
        >
          <option value="">Select Sales Team</option>
          {data.salesPeople.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        {kind === "group" ? "Representative / organisation" : "Student name"}
        <input
          name="studentName"
          required
          defaultValue={editingReservation?.studentName || ""}
        />
      </label>
      <label>
        Student gender
        <select
          name="preferredGender"
          value={gender}
          onChange={(event) => setGender(event.target.value)}
        >
          <option value="female">Female student</option>
          <option value="male">Male student</option>
          <option value="mixed">Special case / mixed</option>
        </select>
      </label>
      {kind === "group" && (
        <>
          <label>
            Representative type
            <select
              name="representativeType"
              defaultValue={editingReservation?.representativeType || "person"}
            >
              <option value="person">Person</option>
              <option value="company">Company</option>
              <option value="institute">Institute</option>
            </select>
          </label>
          <label>
            Estimated group size
            <input
              name="groupSize"
              type="number"
              min="1"
              max="99"
              defaultValue={editingReservation?.groupSize || 1}
            />
          </label>
        </>
      )}
      <label className="wide">
        Check-in date
        <input
          name="targetMoveInDate"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label>
        Preferred hostel
        <select
          name="preferredHostelId"
          value={hostelId}
          onChange={(event) => setHostelId(event.target.value)}
        >
          <option value="">Any hostel</option>
          {data.hostels.map((hostel) => (
            <option key={hostel.id} value={hostel.id}>
              {hostel.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Room type
        <select
          name="roomType"
          value={roomType}
          onChange={(event) => setRoomType(event.target.value)}
        >
          <option value="any">Any room type</option>
          <option value="single">Single</option>
          <option value="sharing">Sharing</option>
        </select>
      </label>
      {kind === "group" ? (
        <label className="wide">
          Preferred whole unit / house
          <SearchSelect
            name="preferredUnitId"
            defaultValue={editingReservation?.preferredUnitId}
            options={data.units
              .filter(
                (unit) =>
                  (!hostelId || String(unit.hostelId) === hostelId) &&
                  (["mixed", "unspecified"].includes(gender) ||
                    unit.gender === gender),
              )
              .map((unit) => ({
                value: unit.id,
                label: `${unit.hostelName} / ${unit.unitCode} · ${genderLabel(unit.gender)}`,
              }))}
            placeholder="Type unit number or hostel"
          />
        </label>
      ) : (
        <>
          <label>
            Room category
            <select
              name="roomCategory"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="any">Any category</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  Room {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bathroom
            <select
              name="bathroomType"
              value={bathroom}
              onChange={(event) => setBathroom(event.target.value)}
            >
              <option value="any">Any bathroom</option>
              <option value="attached">Attached</option>
              <option value="non-attached">Non-attached</option>
            </select>
          </label>
          <label className="wide">
            Provisional room option
            <SearchSelect
              name="provisionalBedSpaceId"
              defaultValue={
                editingReservation?.provisionalBedSpaceId || reservationBed?.id
              }
              options={options.map((bed) => ({
                value: bed.id,
                label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode} · ${genderLabel(bed.gender)} · ${money(effectiveRate(bed))}`,
              }))}
              placeholder="Type room code, unit or hostel"
            />
            <small className="field-note">
              Reference only; this is not the actual room assignment.
            </small>
          </label>
        </>
      )}
      <div className="wide total-payable">
        <div>
          <small>TOTAL PAYABLE</small>
          <strong>{money(totalCharges)}</strong>
          <p>Calculated from the payment breakdown.</p>
        </div>
        <button type="button" className="secondary" onClick={openCharges}>
          Edit payment breakdown
        </button>
      </div>
      <label>
        Payment status
        <select
          name="paymentStatus"
          defaultValue={editingReservation?.paymentStatus || "unpaid"}
        >
          <option value="unpaid">Unpaid enquiry</option>
          <option value="admin-fee">Admin fee paid</option>
          <option value="partial">Partial payment</option>
          <option value="full">Full payment</option>
        </select>
      </label>
      {!editingReservation && (
        <label>
          Initial payment amount
          <input name="paymentAmount" type="number" min="0" defaultValue="0" />
        </label>
      )}
      <label className="wide">
        Sales notes
        <input
          name="notes"
          defaultValue={editingReservation?.notes || ""}
          placeholder="Preferences, special terms or enquiry notes"
        />
      </label>
      <div className="form-actions wide">
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Saving..." : "Save reservation"}
        </button>
      </div>
    </form>
  );
}

function RateDisplay({ bed, date }: { bed: Row; date: string }) {
  const promo =
    bed.promotionRate !== null &&
    (!bed.promotionStartDate || bed.promotionStartDate <= date) &&
    (!bed.promotionEndDate || bed.promotionEndDate >= date);
  return (
    <div className="rate-display">
      {promo && (
        <small className="original-rate">
          {money(bed.salesRate || bed.currentRental)}
        </small>
      )}
      <strong className={promo ? "promo-price" : ""}>
        {money(promo ? bed.promotionRate : bed.currentRental)}
      </strong>
      <small>
        {promo
          ? "Promotion rate"
          : bed.rateSource === "not-set"
            ? "Pricing required"
            : "Sales rate"}
      </small>
    </div>
  );
}

function HostelRates({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  return (
    <div className="operational-rates">
      <div className="section-heading">
        <div>
          <small>HOSTEL OPERATIONAL RATES</small>
          <h3>Student electricity rates, addresses and owner charges</h3>
          <p>
            Electricity uses three decimal places and the final student charge
            is rounded up to the next Ringgit. Cleaning and water-dispenser fees
            feed the monthly owner P&amp;L.
          </p>
        </div>
      </div>
      <div className="rate-card-grid">
        {data.hostels.map((h) => (
          <form
            key={h.id}
            onSubmit={(e) => {
              e.preventDefault();
              save(
                { action: "hostel-rates", hostelId: h.id, ...formValues(e) },
                `${h.name} rates updated`,
              );
            }}
          >
            <h4>{h.name}</h4>
            <label>
              Student electricity / kWh
              <input
                name="electricityRate"
                type="number"
                min="0"
                step="0.001"
                required
                defaultValue={Number(h.electricityRate || 0).toFixed(3)}
              />
            </label>
            <small className="field-note">
              Example: 33 kWh × {Number(h.electricityRate || 0).toFixed(3)} is
              billed as {money(Math.ceil(33 * Number(h.electricityRate || 0)))}
            </small>
            <label>
              Property address
              <textarea
                name="address"
                required
                defaultValue={h.address || ""}
              />
            </label>
            <label>
              Owner cleaning fee / month
              <input
                name="monthlyCleaningFee"
                type="number"
                min="0"
                defaultValue={h.monthlyCleaningFee}
              />
            </label>
            <label>
              Owner water dispenser / month
              <input
                name="monthlyWaterDispenserFee"
                type="number"
                min="0"
                defaultValue={h.monthlyWaterDispenserFee}
              />
            </label>
            <button className="secondary compact" disabled={busy}>
              Save rates
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

function UnitsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hostel, setHostel] = useState("all");
  const [unit, setUnit] = useState<Row | null>(null);
  const [drawerTab, setDrawerTab] = useState("general");
  const [modal, setModal] = useState("");
  const [editingAsset, setEditingAsset] = useState<Row | null>(null);
  const owner = data.owners.find((o) => o.unitId === unit?.id);
  const cards = data.accessCards.filter((c) => c.unitId === unit?.id);
  const services = data.services.filter((s) => s.unitId === unit?.id);
  const beds = data.bedSpaces.filter((b) => b.unitId === unit?.id);
  const rooms = useMemo(() => {
    const map = new Map<number, Row>();
    for (const b of beds) {
      if (!map.has(b.roomId))
        map.set(b.roomId, {
          id: b.roomId,
          label: b.roomLabel,
          type: b.roomType,
          bathroomType: b.bathroomType,
          beds: [],
        });
      map.get(b.roomId)!.beds.push(b);
    }
    return [...map.values()];
  }, [beds]);
  const filtered = data.units.filter(
    (u) =>
      (hostel === "all" || u.hostelCode === hostel) &&
      `${u.hostelName} ${u.unitCode} ${data.owners.find((o) => o.unitId === u.id)?.ownerName || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const listedCards = data.accessCards.filter((card) => {
    const cardUnit = data.units.find((item) => item.id === card.unitId);
    return hostel === "all" || cardUnit?.hostelCode === hostel;
  });
  const listedServices = data.services.filter((service) => {
    const serviceUnit = data.units.find((item) => item.id === service.unitId);
    return (
      service.serviceType === "wifi" &&
      (hostel === "all" || serviceUnit?.hostelCode === hostel)
    );
  });
  const listedParking = data.parkingLots.filter((lot) => {
    const property = data.hostels.find((item) => item.id === lot.hostelId);
    return hostel === "all" || property?.code === hostel;
  });
  const canViewOwner = data.currentUser?.permissions?.some(
    (permission: Row) =>
      permission.moduleKey === "units-owner" && permission.canView,
  );
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">PROPERTY & OWNER CONTROL</span>
          <h2>One record for every rented or managed unit.</h2>
          <p>
            General operational information is separate from owner agreements,
            banking and P&amp;L charges.
          </p>
        </div>
        <button className="primary" onClick={() => setModal("unit")}>
          + Add unit
        </button>
      </section>
      <section className="module-metrics">
        <Stat value={data.units.length} label="Units" />
        <Stat value={data.accessCards.length} label="Access cards" />
        <Stat value={data.services.length} label="Wi-Fi accounts" />
        <Stat value={data.parkingLots.length} label="Parking lots" />
      </section>
      <section className="panel">
        <div className="filters unit-filters">
          <label className="search">
            <span>Search units</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Unit, owner or address"
            />
          </label>
          <label>
            Hostel
            <select value={hostel} onChange={(e) => setHostel(e.target.value)}>
              <option value="all">All hostels</option>
              {data.hostels.map((h) => (
                <option key={h.id} value={h.code}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Gender</th>
                <th>Agreement / owner</th>
                <th>Access cards</th>
                <th>Wi-Fi</th>
                <th>Surrender</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const o = data.owners.find((x) => x.unitId === u.id);
                return (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.hostelName}</strong>
                      <code>{u.unitCode}</code>
                    </td>
                    <td>
                      <span className={`gender-pill ${u.gender}`}>
                        {genderLabel(u.gender)}
                      </span>
                    </td>
                    <td>
                      {o ? (
                        <>
                          <strong>{titleCase(o.agreementType)}</strong>
                          <small>{o.ownerName || "Owner not set"}</small>
                        </>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                    <td>
                      {data.accessCards.filter((c) => c.unitId === u.id).length}
                    </td>
                    <td>
                      {
                        data.services.filter(
                          (s) => s.unitId === u.id && s.serviceType === "wifi",
                        ).length
                      }
                    </td>
                    <td>{dateLabel(u.surrenderDate)}</td>
                    <td>
                      <span className={`unit-status ${u.status}`}>
                        {titleCase(u.status)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setUnit(u);
                          setDrawerTab("general");
                        }}
                      >
                        Open unit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="split-registers">
        <article className="panel">
          <div className="section-heading">
            <div>
              <small>FULL ACCESS CARD LIST</small>
              <h3>{listedCards.length} registered cards</h3>
            </div>
          </div>
          <div className="compact-list">
            {listedCards.map((c) => (
              <span key={c.id}>
                <code>{c.cardCode}</code>
                <b>
                  {c.hostelName} / {c.unitCode}
                </b>
                <small>{titleCase(c.status)}</small>
              </span>
            ))}
            {!listedCards.length && (
              <p className="empty-copy">No cards registered yet.</p>
            )}
          </div>
        </article>
        <article className="panel">
          <div className="section-heading">
            <div>
              <small>FULL WI-FI LIST</small>
              <h3>{listedServices.length} service accounts</h3>
            </div>
          </div>
          <div className="compact-list">
            {listedServices.map((s) => {
              const u = data.units.find((x) => x.id === s.unitId);
              return (
                <span key={s.id}>
                  <b>
                    {u?.hostelName} / {u?.unitCode}
                  </b>
                  <small>
                    {s.provider || "Provider not set"} ·{" "}
                    {s.accountReference || "No account"} · {titleCase(s.status)}
                  </small>
                </span>
              );
            })}
          </div>
        </article>
        <article className="panel">
          <div className="section-heading">
            <div>
              <small>FULL PARKING LOT LIST</small>
              <h3>{listedParking.length} parking lots</h3>
            </div>
          </div>
          <div className="compact-list">
            {listedParking.map((lot) => {
              const lotUnit = data.units.find((item) => item.id === lot.unitId);
              const rental = data.parkingRentals.find(
                (item) =>
                  item.parkingLotId === lot.id && item.status === "active",
              );
              return (
                <span key={lot.id}>
                  <code>{lot.lotNumber}</code>
                  <b>
                    {lot.hostelName || lotUnit?.hostelName} /{" "}
                    {lotUnit?.unitCode || "No unit"}
                  </b>
                  <small>
                    {rental
                      ? `${rental.tenantName} · Rented`
                      : titleCase(lot.status)}
                  </small>
                </span>
              );
            })}
            {!listedParking.length && (
              <p className="empty-copy">
                No parking lots registered for this hostel.
              </p>
            )}
          </div>
        </article>
      </section>
      {unit && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setUnit(null)}
        >
          <aside className="unit-drawer">
            <div className="drawer-head">
              <div>
                <small>{unit.hostelName}</small>
                <h2>{unit.unitCode}</h2>
                <p>{unit.address}</p>
              </div>
              <button onClick={() => setUnit(null)}>×</button>
            </div>
            <div className="drawer-tabs">
              <button
                className={drawerTab === "general" ? "active" : ""}
                onClick={() => setDrawerTab("general")}
              >
                General information
              </button>
              {canViewOwner && (
                <button
                  className={drawerTab === "owner" ? "active" : ""}
                  onClick={() => setDrawerTab("owner")}
                >
                  Unit & owner agreement
                </button>
              )}
            </div>
            {drawerTab === "general" ? (
              <>
                <form
                  className="drawer-section unit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(
                      {
                        action: "unit-update",
                        unitId: unit.id,
                        ...formValues(e),
                      },
                      "General unit information saved",
                    );
                  }}
                >
                  <div className="section-title">
                    <div>
                      <small>UNIT INFORMATION</small>
                      <h3>Gender, status and surrender</h3>
                    </div>
                    <button className="primary compact" disabled={busy}>
                      Save
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      Unit gender
                      <select name="gender" defaultValue={unit.gender}>
                        <option value="unspecified">Not set</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="mixed">Special / mixed</option>
                      </select>
                    </label>
                    <label>
                      Unit status
                      <select name="unitStatus" defaultValue={unit.status}>
                        <option value="active">Active</option>
                        <option value="return-planned">To surrender</option>
                        <option value="surrendered">Surrendered</option>
                      </select>
                    </label>
                    <label className="wide">
                      Address
                      <input name="address" defaultValue={unit.address} />
                    </label>
                    {unit.status !== "active" && (
                      <label>
                        Surrender date
                        <input
                          name="surrenderDate"
                          type="date"
                          defaultValue={unit.surrenderDate || ""}
                        />
                      </label>
                    )}
                    <label className="wide">
                      Surrender notes
                      <input
                        name="surrenderNotes"
                        defaultValue={unit.surrenderNotes}
                      />
                    </label>
                  </div>
                </form>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>ACCESS CARDS</small>
                      <h3>{cards.length} cards</h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditingAsset(null);
                        setModal("card");
                      }}
                    >
                      + Add card
                    </button>
                  </div>
                  <div className="asset-list">
                    {cards.map((c) => (
                      <article key={c.id}>
                        <span className="asset-icon">AC</span>
                        <div>
                          <strong>{c.cardCode}</strong>
                          <small>
                            {titleCase(c.status)} · {c.notes || "No notes"}
                          </small>
                        </div>
                        <div className="asset-actions">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditingAsset(c);
                              setModal("card");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="danger compact"
                            onClick={() =>
                              save(
                                { action: "access-card-delete", cardId: c.id },
                                "Access card deleted",
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!cards.length && (
                    <p className="empty-copy">No access cards registered.</p>
                  )}
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>PARKING LOTS</small>
                      <h3>
                        {
                          data.parkingLots.filter(
                            (lot) => lot.unitId === unit.id,
                          ).length
                        }{" "}
                        lots under this unit
                      </h3>
                    </div>
                  </div>
                  <div className="compact-list">
                    {data.parkingLots
                      .filter((lot) => lot.unitId === unit.id)
                      .map((lot) => {
                        const rental = data.parkingRentals.find(
                          (item) =>
                            item.parkingLotId === lot.id &&
                            item.status === "active",
                        );
                        return (
                          <span key={lot.id}>
                            <code>{lot.lotNumber}</code>
                            <b>{rental?.tenantName || "Available"}</b>
                            <small>
                              {titleCase(rental ? "rented" : lot.status)}
                            </small>
                          </span>
                        );
                      })}
                  </div>
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>WI-FI SERVICE</small>
                      <h3>{services.length} service records</h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditingAsset(null);
                        setModal("wifi");
                      }}
                    >
                      + Add Wi-Fi
                    </button>
                  </div>
                  <div className="service-list">
                    {services.map((s) => (
                      <article key={s.id}>
                        <span className="asset-icon">WI</span>
                        <div>
                          <strong>
                            {s.provider || "Wi-Fi provider not set"} ·{" "}
                            {titleCase(s.status)}
                          </strong>
                          <small>
                            {s.accountHolderName || "Account holder not set"} ·{" "}
                            {s.accountReference || "No account number"}
                          </small>
                          <small>
                            {titleCase(s.lineType)} ·{" "}
                            {s.servicePackage || "Package not set"} · Contract{" "}
                            {dateLabel(s.contractEndDate)}
                          </small>
                          <small>
                            {s.surrenderAction === "relocate"
                              ? `Relocate · ${s.remarks || "Destination not set"}`
                              : `${titleCase(s.surrenderAction)} · ${s.remarks || "No remarks"}`}
                          </small>
                        </div>
                        <div className="asset-actions">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditingAsset(s);
                              setModal("wifi");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="danger compact"
                            onClick={() =>
                              save(
                                { action: "service-delete", serviceId: s.id },
                                "Wi-Fi record deleted",
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!services.length && (
                    <p className="empty-copy">
                      No Wi-Fi service added. Use Add Wi-Fi to enter details.
                    </p>
                  )}
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>ROOM DETAILS</small>
                      <h3>Configuration and bed types</h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => setModal("room")}
                    >
                      + Add room
                    </button>
                  </div>
                  <div className="room-list">
                    {rooms.map((room) => (
                      <article key={room.id}>
                        <form
                          className="room-row editable-room"
                          onSubmit={(e) => {
                            e.preventDefault();
                            save(
                              {
                                action: "room-details",
                                roomId: room.id,
                                ...formValues(e),
                              },
                              "Room updated",
                            );
                          }}
                        >
                          <input
                            name="roomLabel"
                            defaultValue={room.label}
                            aria-label="Room category"
                          />
                          <select name="roomType" defaultValue={room.type}>
                            <option value="single">Single room</option>
                            <option value="sharing">Sharing room</option>
                          </select>
                          <select
                            name="bathroomType"
                            defaultValue={room.bathroomType}
                          >
                            <option value="unknown">Bathroom not set</option>
                            <option value="attached">Attached</option>
                            <option value="non-attached">Non-attached</option>
                          </select>
                          <button className="secondary compact">
                            Save room
                          </button>
                          <button
                            type="button"
                            className="danger compact"
                            onClick={() =>
                              save(
                                { action: "room-delete", roomId: room.id },
                                "Room deleted",
                              )
                            }
                          >
                            Delete room
                          </button>
                        </form>
                        <div className="bed-config">
                          {room.beds.map((bed: Row) => (
                            <form
                              key={bed.id}
                              onSubmit={(e) => {
                                e.preventDefault();
                                save(
                                  {
                                    action: "bed-code",
                                    bedId: bed.id,
                                    ...formValues(e),
                                  },
                                  "Room code updated",
                                );
                              }}
                            >
                              <input
                                name="legacyCode"
                                defaultValue={bed.legacyCode}
                                aria-label="Room code"
                              />
                              <select
                                value={bed.bedType}
                                onChange={(e) =>
                                  save(
                                    {
                                      action: "bed-type",
                                      bedId: bed.id,
                                      bedType: e.target.value,
                                    },
                                    "Bed type updated",
                                  )
                                }
                              >
                                <option value="unknown">
                                  Bed type not set
                                </option>
                                <option value="single">Single bed</option>
                                <option value="queen">Queen bed</option>
                                <option value="two-single">
                                  2 single beds
                                </option>
                                <option value="bunk">Bunk bed</option>
                              </select>
                              <button className="secondary compact">
                                Save code
                              </button>
                              <button
                                type="button"
                                className="danger compact"
                                onClick={() =>
                                  save(
                                    { action: "bed-delete", bedId: bed.id },
                                    "Room code deleted",
                                  )
                                }
                              >
                                Delete
                              </button>
                            </form>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <OwnerAgreement
                unit={unit}
                owner={owner}
                attachments={data.attachments.filter(
                  (attachment) =>
                    attachment.contextType === "agreement" &&
                    attachment.recordId === unit.id,
                )}
                uploadedBy={data.currentUser?.displayName}
                save={save}
                busy={busy}
              />
            )}
          </aside>
        </div>
      )}
      {modal === "unit" && (
        <Modal
          title="Add unit"
          kicker="UNIT REGISTER"
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "unit-create", ...formValues(e) },
                "Unit added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Hostel
              <select name="hostelId" required>
                <option value="">Select hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit number
              <input name="unitCode" required />
            </label>
            <label>
              Gender
              <select name="gender">
                <option value="unspecified">Not set</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="mixed">Special / mixed</option>
              </select>
            </label>
            <div className="wide auto-address-note">
              <strong>Address is generated automatically</strong>
              <span>
                The unit number is added in front of the selected hostel
                address.
              </span>
            </div>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add unit
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "card" && unit && (
        <Modal
          title={editingAsset ? "Edit access card" : "Add access card"}
          kicker={unit.unitCode}
          onClose={() => {
            setModal("");
            setEditingAsset(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingAsset ? "access-card-update" : "access-card",
                  cardId: editingAsset?.id,
                  unitId: unit.id,
                  ...formValues(e),
                },
                editingAsset ? "Access card updated" : "Access card added",
              );
              if (ok) {
                setModal("");
                setEditingAsset(null);
              }
            }}
          >
            <label>
              Card number
              <input
                name="cardCode"
                required
                defaultValue={editingAsset?.cardCode || ""}
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingAsset?.status || "available"}
              >
                <option value="available">Available</option>
                <option value="issued">Issued</option>
                <option value="lost">Lost</option>
                <option value="replaced">Replaced</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label>
              Notes
              <input name="notes" defaultValue={editingAsset?.notes || ""} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingAsset ? "Update card" : "Save card"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "wifi" && unit && (
        <Modal
          title={editingAsset ? "Edit Wi-Fi service" : "Add Wi-Fi service"}
          kicker={unit.unitCode}
          onClose={() => {
            setModal("");
            setEditingAsset(null);
          }}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingAsset ? "service-update" : "unit-service",
                  serviceId: editingAsset?.id,
                  unitId: unit.id,
                  ...formValues(e),
                },
                editingAsset ? "Wi-Fi service updated" : "Wi-Fi service added",
              );
              if (ok) {
                setModal("");
                setEditingAsset(null);
              }
            }}
          >
            <label>
              Account holder
              <input
                name="accountHolderName"
                defaultValue={editingAsset?.accountHolderName || ""}
              />
            </label>
            <label>
              Account number
              <input
                name="accountReference"
                defaultValue={editingAsset?.accountReference || ""}
              />
            </label>
            <label>
              Provider
              <input
                name="provider"
                defaultValue={editingAsset?.provider || ""}
                placeholder="TIME, Unifi..."
              />
            </label>
            <label>
              Main / sub line
              <select
                name="lineType"
                defaultValue={editingAsset?.lineType || "main"}
              >
                <option value="main">Main line</option>
                <option value="sub">Sub line</option>
              </select>
            </label>
            <label>
              Contract end
              <input
                name="contractEndDate"
                type="date"
                defaultValue={editingAsset?.contractEndDate || ""}
              />
            </label>
            <label>
              Service package
              <input
                name="servicePackage"
                defaultValue={editingAsset?.servicePackage || ""}
              />
            </label>
            <label>
              Username
              <input
                name="username"
                defaultValue={editingAsset?.username || ""}
                autoComplete="off"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingAsset?.status || "active"}
              >
                <option value="active">Active</option>
                <option value="to-surrender">To surrender</option>
                <option value="surrendered">Surrendered</option>
                <option value="relocated">Relocated</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label>
              On surrender
              <select
                name="surrenderAction"
                defaultValue={editingAsset?.surrenderAction || "review"}
              >
                <option value="review">Review</option>
                <option value="terminate">Terminate</option>
                <option value="transfer">Transfer ownership</option>
                <option value="relocate">Relocate to another unit</option>
              </select>
            </label>
            <label className="wide">
              Remarks / relocated to
              <input
                name="remarks"
                defaultValue={editingAsset?.remarks || ""}
                placeholder="Destination unit or termination note"
              />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingAsset ? "Update Wi-Fi" : "Add Wi-Fi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "room" && unit && (
        <Modal
          title="Add room"
          kicker={unit.unitCode}
          description="Sharing rooms can have up to five room codes / occupants."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "room-add", unitId: unit.id, ...formValues(e) },
                "Room added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Room category / label
              <input name="roomLabel" required placeholder="A, B, C..." />
            </label>
            <label>
              Room type
              <select name="roomType">
                <option value="single">Single room</option>
                <option value="sharing">Sharing room</option>
              </select>
            </label>
            <label>
              Bathroom
              <select name="bathroomType">
                <option value="unknown">Not set</option>
                <option value="attached">Attached</option>
                <option value="non-attached">Non-attached</option>
              </select>
            </label>
            <label>
              Number of room codes / beds
              <input
                name="bedCount"
                type="number"
                min="1"
                max="5"
                defaultValue="1"
              />
            </label>
            <label>
              Bed type
              <select name="bedType">
                <option value="unknown">Not set</option>
                <option value="single">Single bed</option>
                <option value="queen">Queen bed</option>
                <option value="two-single">2 single beds</option>
                <option value="bunk">Bunk bed</option>
              </select>
            </label>
            <label>
              Room code prefix
              <input name="codePrefix" placeholder={`${unit.unitCode}-A`} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add room
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function OwnerAgreement({
  unit,
  owner,
  attachments,
  uploadedBy,
  save,
  busy,
}: {
  unit: Row;
  owner: Row | undefined;
  attachments: Row[];
  uploadedBy?: string;
  save: any;
  busy: boolean;
}) {
  const [type, setType] = useState(owner?.agreementType || "rental");
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  return (
    <form
      className="drawer-section owner-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await save(
          { action: "unit-owner", unitId: unit.id, ...formValues(e) },
          "Owner agreement saved",
        );
        if (result && agreementFile) {
          await uploadAttachment(
            agreementFile,
            "agreement",
            unit.id,
            uploadedBy,
          );
          setAgreementFile(null);
        }
      }}
    >
      <div className="section-title">
        <div>
          <small>UNIT & OWNER INFORMATION</small>
          <h3>Agreement, banking and charges</h3>
        </div>
        <button className="primary compact" disabled={busy}>
          Save owner
        </button>
      </div>
      <div className="form-grid">
        <div className="wide form-divider">
          <strong>Owner information</strong>
        </div>
        <label>
          Owner name
          <input name="ownerName" defaultValue={owner?.ownerName || ""} />
        </label>
        <label>
          Owner IC / passport / registration no.
          <input
            name="ownerIdentityNo"
            defaultValue={owner?.ownerIdentityNo || ""}
          />
        </label>
        <label>
          Owner email
          <input
            name="ownerEmail"
            type="email"
            defaultValue={owner?.ownerEmail || ""}
          />
        </label>
        <label className="wide">
          Registered residential address
          <textarea
            name="registeredAddress"
            defaultValue={owner?.registeredAddress || ""}
          />
        </label>
        <label>
          Agreement type
          <select
            name="agreementType"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="rental">Rental basis</option>
            <option value="service">Service agreement</option>
          </select>
        </label>
        <label>
          Primary contact name
          <input
            name="primaryContactName"
            defaultValue={owner?.primaryContactName || ""}
          />
        </label>
        <label>
          Primary contact number
          <input
            name="primaryContactPhone"
            defaultValue={owner?.primaryContactPhone || ""}
          />
        </label>
        <label>
          Secondary contact name
          <input
            name="secondaryContactName"
            defaultValue={owner?.secondaryContactName || ""}
          />
        </label>
        <label>
          Secondary contact number
          <input
            name="secondaryContactPhone"
            defaultValue={owner?.secondaryContactPhone || ""}
          />
        </label>
        <div className="wide form-divider">
          <strong>Designated bank account</strong>
        </div>
        <label>
          Bank account number
          <input
            name="bankAccountNumber"
            defaultValue={owner?.bankAccountNumber || ""}
          />
        </label>
        <label>
          Account holder
          <input
            name="bankAccountHolder"
            defaultValue={owner?.bankAccountHolder || ""}
          />
        </label>
        <label>
          Bank name
          <input name="bankName" defaultValue={owner?.bankName || ""} />
        </label>
        <div className="wide form-divider">
          <strong>Lease information</strong>
        </div>
        <label>
          Lease start
          <input
            name="leaseStartDate"
            type="date"
            defaultValue={owner?.leaseStartDate || ""}
          />
        </label>
        <label>
          Lease end
          <input
            name="leaseEndDate"
            type="date"
            defaultValue={owner?.leaseEndDate || ""}
          />
        </label>
        {type === "rental" ? (
          <>
            <label>
              Monthly owner rental
              <input
                name="monthlyLeaseRental"
                type="number"
                min="0"
                defaultValue={owner?.monthlyLeaseRental ?? ""}
              />
            </label>
            <label>
              Security deposit
              <input
                name="securityDeposit"
                type="number"
                min="0"
                defaultValue={owner?.securityDeposit ?? ""}
              />
            </label>
            <label>
              Utility deposit
              <input
                name="utilityDeposit"
                type="number"
                min="0"
                defaultValue={owner?.utilityDeposit ?? ""}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Monthly service percentage
              <input
                name="servicePercentage"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={owner?.servicePercentage ?? ""}
              />
            </label>
            <label>
              New student commission
              <input
                name="commissionAmount"
                type="number"
                min="0"
                defaultValue={owner?.commissionAmount ?? ""}
              />
            </label>
            <label>
              Monthly cleaning fee
              <input
                name="monthlyCleaningFee"
                type="number"
                min="0"
                defaultValue={owner?.monthlyCleaningFee ?? ""}
              />
            </label>
            <label>
              Monthly water dispenser fee
              <input
                name="monthlyWaterDispenserFee"
                type="number"
                min="0"
                defaultValue={owner?.monthlyWaterDispenserFee ?? ""}
              />
            </label>
          </>
        )}
        <div className="wide form-divider">
          <strong>Utility accounts</strong>
        </div>
        <label>
          TNB account
          <input name="tnbAccount" defaultValue={owner?.tnbAccount || ""} />
        </label>
        <label>
          Air Selangor account
          <input
            name="airSelangorAccount"
            defaultValue={owner?.airSelangorAccount || ""}
          />
        </label>
        <label>
          Indah Water account
          <input
            name="indahWaterAccount"
            defaultValue={owner?.indahWaterAccount || ""}
          />
        </label>
        <label className="wide">
          Agreement notes
          <input name="ownerNotes" defaultValue={owner?.notes || ""} />
        </label>
        <label className="wide">
          Upload signed agreement
          <input
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            onChange={(event) =>
              setAgreementFile(event.target.files?.[0] || null)
            }
          />
        </label>
        {attachments.length > 0 && (
          <div className="wide attachment-list">
            <strong>Stored agreements</strong>
            {attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={`/api/files?id=${attachment.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {attachment.fileName}
              </a>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

function StudentsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [student, setStudent] = useState<Row | null>(null);
  const [modal, setModal] = useState("");
  const [hostelFilter, setHostelFilter] = useState("all");
  const [directoryTab, setDirectoryTab] = useState<
    "active" | "moved-out" | "agency"
  >("active");
  const [sortKey, setSortKey] = useState("roomCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const sortStudents = (key: string) => {
    if (sortKey === key)
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };
  const filtered = data.students
    .filter((student) => {
      const active =
        student.profileStatus === "active" &&
        student.assignmentStatus === "active";
      const statusMatch =
        directoryTab === "agency"
          ? Boolean(student.agency)
          : directoryTab === "active"
            ? active
            : !active;
      const hostelMatch =
        hostelFilter === "all" ||
        String(student.hostelId || "") === hostelFilter;
      const search = query.trim().toLowerCase();
      const text =
        `${student.fullName} ${student.studentCode} ${student.identityNo} ${student.roomCode} ${student.unitCode} ${student.hostelName} ${student.school} ${student.nationality} ${student.agency}`.toLowerCase();
      return statusMatch && hostelMatch && (!search || text.includes(search));
    })
    .sort((left, right) => {
      const a = String(left[sortKey] ?? "");
      const b = String(right[sortKey] ?? "");
      const result = a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">STUDENT & SUB-TENANT DIRECTORY</span>
          <h2>Complete resident information tied to the actual room code.</h2>
          <p>
            Includes individual students and sub-tenants added after a group
            reservation is confirmed.
          </p>
        </div>
      </section>
      <section className="module-metrics">
        <Stat
          value={
            data.students.filter((s) => s.assignmentStatus === "active").length
          }
          label="Current occupants"
        />
        <Stat
          value={
            data.students.filter((s) => s.profileStatus !== "active").length
          }
          label="Moved out / inactive"
        />
        <Stat
          value={data.students.filter((s) => s.agency).length}
          label="Agency-linked"
        />
        <Stat
          value={
            data.students.filter((s) => !s.identityNo || !s.contactNumber)
              .length
          }
          label="Profiles to complete"
        />
      </section>
      <section className="panel">
        <div className="workspace-tabs">
          <button
            className={directoryTab === "active" ? "active" : ""}
            onClick={() => setDirectoryTab("active")}
          >
            Active students
          </button>
          <button
            className={directoryTab === "moved-out" ? "active" : ""}
            onClick={() => setDirectoryTab("moved-out")}
          >
            Moved-out / inactive
          </button>
          <button
            className={directoryTab === "agency" ? "active" : ""}
            onClick={() => setDirectoryTab("agency")}
          >
            Agency-linked
          </button>
        </div>
        <div className="filters">
          <label className="search">
            <span>Search students</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, IC/passport, room, school or country"
            />
          </label>
          <label>
            Hostel
            <select
              value={hostelFilter}
              onChange={(event) => setHostelFilter(event.target.value)}
            >
              <option value="all">All hostels</option>
              {data.hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary reset-button"
            onClick={() => {
              setQuery("");
              setHostelFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("fullName")}
                  >
                    Name{" "}
                    {sortKey === "fullName"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("roomCode")}
                  >
                    Room{" "}
                    {sortKey === "roomCode"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("contactNumber")}
                  >
                    Contact{" "}
                    {sortKey === "contactNumber"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("school")}
                  >
                    School / course{" "}
                    {sortKey === "school"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("monthlyRental")}
                  >
                    Rental{" "}
                    {sortKey === "monthlyRental"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("leaseEndDate")}
                  >
                    Lease end{" "}
                    {sortKey === "leaseEndDate"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>
                  <button
                    className="sort-button"
                    onClick={() => sortStudents("salesperson")}
                  >
                    Sales / agency{" "}
                    {sortKey === "salesperson"
                      ? sortDirection === "asc"
                        ? "↑"
                        : "↓"
                      : ""}
                  </button>
                </th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 250).map((s) => (
                <tr key={`${s.id}-${s.assignmentId || 0}`}>
                  <td>
                    <strong>{s.fullName}</strong>
                    <small>{s.identityNo || "IC / passport not set"}</small>
                  </td>
                  <td>
                    {s.roomCode ? (
                      <>
                        <code>{s.roomCode}</code>
                        <small>
                          {s.hostelName} / {s.unitCode}
                        </small>
                      </>
                    ) : (
                      <span className="muted">Not assigned</span>
                    )}
                  </td>
                  <td>
                    {s.contactNumber || "-"}
                    <small>{s.email || "Email not set"}</small>
                  </td>
                  <td>
                    {s.school || "-"}
                    <small>
                      {s.course || "Course not set"} ·{" "}
                      {s.nationality || "Nationality not set"}
                    </small>
                  </td>
                  <td>{money(s.monthlyRental)}</td>
                  <td>
                    <strong className="lease-end">
                      {dateLabel(s.leaseEndDate)}
                    </strong>
                    <small>Starts {dateLabel(s.leaseStartDate)}</small>
                  </td>
                  <td>
                    {s.salesperson || "-"}
                    <small>{s.agency || "Direct"}</small>
                  </td>
                  <td>
                    <span
                      className={`unit-status ${s.assignmentStatus || s.profileStatus}`}
                    >
                      {titleCase(s.assignmentStatus || s.profileStatus)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => setStudent(s)}
                    >
                      Open profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {student && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setStudent(null)}
        >
          <aside className="unit-drawer student-drawer">
            <div className="drawer-head">
              <div>
                <small>{student.studentCode || "STUDENT PROFILE"}</small>
                <h2>{student.fullName}</h2>
                <p>
                  {student.roomCode
                    ? `${student.hostelName} / ${student.roomCode}`
                    : "Room not assigned"}
                </p>
              </div>
              <button onClick={() => setStudent(null)}>×</button>
            </div>
            <form
              className="drawer-section"
              onSubmit={(e) => {
                e.preventDefault();
                save(
                  {
                    action: "student-update",
                    studentId: student.id,
                    assignmentId: student.assignmentId,
                    ...formValues(e),
                  },
                  "Student profile updated",
                );
              }}
            >
              <div className="section-title">
                <div>
                  <small>PERSONAL & TENANCY</small>
                  <h3>Complete student information</h3>
                </div>
                <button className="primary compact" disabled={busy}>
                  Save profile
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Full name
                  <input name="fullName" defaultValue={student.fullName} />
                </label>
                <label>
                  Student code
                  <input
                    name="studentCode"
                    defaultValue={student.studentCode}
                  />
                </label>
                <label>
                  IC / passport
                  <input name="identityNo" defaultValue={student.identityNo} />
                </label>
                <label>
                  Contact number
                  <input
                    name="contactNumber"
                    defaultValue={student.contactNumber}
                  />
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    defaultValue={student.email}
                  />
                </label>
                <label>
                  Date of birth
                  <input
                    name="dateOfBirth"
                    type="date"
                    defaultValue={student.dateOfBirth || ""}
                  />
                </label>
                <label>
                  Gender
                  <select name="gender" defaultValue={student.gender}>
                    <option value="unspecified">Not set</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label>
                  Nationality
                  <input
                    name="nationality"
                    defaultValue={student.nationality}
                  />
                </label>
                <label>
                  Hometown
                  <input name="hometown" defaultValue={student.hometown} />
                </label>
                <label>
                  Race
                  <input name="race" defaultValue={student.race} />
                </label>
                <label>
                  Religion
                  <input name="religion" defaultValue={student.religion} />
                </label>
                <label>
                  School
                  <select name="school" defaultValue={student.school}>
                    <option value="">Not set</option>
                    {[
                      "HELP",
                      "CENTEX",
                      "WESTSTAR",
                      "APR",
                      "IGlobal",
                      "Other",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Course enrolled
                  <input name="course" defaultValue={student.course} />
                </label>
                <label>
                  Application form no.
                  <input
                    name="applicationFormNo"
                    defaultValue={student.applicationFormNo}
                  />
                </label>
                <label>
                  Receipt serial no.
                  <input name="receiptNo" defaultValue={student.receiptNo} />
                </label>
                <label>
                  Sales person
                  <input
                    name="salesperson"
                    defaultValue={student.salesperson}
                  />
                </label>
                <label>
                  Agency
                  <input name="agency" defaultValue={student.agency} />
                </label>
                <label>
                  Monthly rental
                  <input
                    name="monthlyRental"
                    type="number"
                    defaultValue={student.monthlyRental ?? ""}
                  />
                </label>
                <label>
                  Security deposit
                  <input
                    name="securityDeposit"
                    type="number"
                    defaultValue={student.securityDeposit ?? ""}
                  />
                </label>
                <label>
                  Access card deposit
                  <input
                    name="accessCardDeposit"
                    type="number"
                    defaultValue={student.accessCardDeposit ?? ""}
                  />
                </label>
                <label>
                  Parking deposit
                  <input
                    name="parkingDeposit"
                    type="number"
                    defaultValue={student.parkingDeposit ?? ""}
                  />
                </label>
                <label>
                  Check-in
                  <input
                    name="checkInDate"
                    type="date"
                    defaultValue={student.checkInDate || ""}
                  />
                </label>
                <label>
                  Check-out
                  <input
                    name="checkOutDate"
                    type="date"
                    defaultValue={student.checkOutDate || ""}
                  />
                </label>
                <label>
                  Lease start
                  <input
                    name="leaseStartDate"
                    type="date"
                    defaultValue={student.leaseStartDate || ""}
                  />
                </label>
                <label>
                  Lease end
                  <input
                    name="leaseEndDate"
                    type="date"
                    defaultValue={student.leaseEndDate || ""}
                  />
                </label>
                <label>
                  Status
                  <select
                    name="profileStatus"
                    defaultValue={student.profileStatus}
                  >
                    <option value="active">Active</option>
                    <option value="moved-out">Moved out</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className="wide">
                  Remarks
                  <input name="remarks" defaultValue={student.remarks} />
                </label>
              </div>
            </form>
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>BILLING INFORMATION</small>
                  <h3>Current outstanding and payment breakdown</h3>
                </div>
              </div>
              <div className="compact-list">
                {data.invoices
                  .filter((invoice) => invoice.studentId === student.id)
                  .slice(0, 12)
                  .map((invoice) => (
                    <span key={invoice.id}>
                      <code>{invoice.invoiceNo}</code>
                      <b>
                        {invoice.items
                          .map((item: Row) => item.description)
                          .join(", ") || "No items"}
                      </b>
                      <small>
                        {money(
                          Number(invoice.totalAmount) -
                            Number(invoice.amountPaid),
                          true,
                        )}{" "}
                        outstanding
                      </small>
                    </span>
                  ))}
                {!data.invoices.some(
                  (invoice) => invoice.studentId === student.id,
                ) && (
                  <p className="empty-copy">
                    No billing records for this student yet.
                  </p>
                )}
              </div>
            </section>
            {student.assignmentId && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>RATE & ROOM HISTORY</small>
                    <h3>Effective-dated changes</h3>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary compact"
                      onClick={() => setModal("rate")}
                    >
                      + Rate change
                    </button>
                    <button
                      className="secondary compact"
                      onClick={() => setModal("move")}
                    >
                      Change room
                    </button>
                  </div>
                </div>
                <div className="compact-list">
                  {data.studentRateChanges
                    .filter((r) => r.assignmentId === student.assignmentId)
                    .map((r) => (
                      <span key={r.id}>
                        <b>Effective {dateLabel(r.effectiveDate)}</b>
                        <small>
                          Rental {money(r.monthlyRental)} · Deposit{" "}
                          {money(r.securityDeposit)} · {r.reason}
                        </small>
                      </span>
                    ))}
                  {!data.studentRateChanges.some(
                    (r) => r.assignmentId === student.assignmentId,
                  ) && <p className="empty-copy">No scheduled rate changes.</p>}
                </div>
              </section>
            )}
          </aside>
        </div>
      )}
      {modal === "rate" && student && (
        <Modal
          title="Effective-dated rate change"
          kicker={student.fullName}
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-rate-change",
                  assignmentId: student.assignmentId,
                  ...formValues(e),
                },
                "Rate change scheduled",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Effective date
              <input name="effectiveDate" type="date" required />
            </label>
            <label>
              Monthly rental
              <input name="monthlyRental" type="number" min="0" />
            </label>
            <label>
              Security deposit
              <input name="securityDeposit" type="number" min="0" />
            </label>
            <label className="wide">
              Reason
              <input
                name="reason"
                placeholder="Short-term renewal, promotion ended..."
              />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Schedule change
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "move" && student && (
        <Modal
          title="Manual room change"
          kicker={student.fullName}
          description="The old room becomes vacant and the selected room becomes occupied from the effective date."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-room-change",
                  studentId: student.id,
                  assignmentId: student.assignmentId,
                  salesperson: student.salesperson,
                  ...formValues(e),
                },
                "Student moved to new room",
              );
              if (ok) {
                setModal("");
                setStudent(null);
              }
            }}
          >
            <label className="wide">
              New room code
              <SearchSelect
                name="bedSpaceId"
                required
                options={data.bedSpaces
                  .filter((bed) => bed.status === "vacant")
                  .map((bed) => ({
                    value: bed.id,
                    label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode}`,
                  }))}
                placeholder="Type room code, unit or hostel"
              />
            </label>
            <label>
              Effective date
              <input name="effectiveDate" type="date" required />
            </label>
            <label>
              New monthly rental
              <input name="monthlyRental" type="number" min="0" />
            </label>
            <label>
              New security deposit
              <input name="securityDeposit" type="number" min="0" />
            </label>
            <label>
              Access card deposit
              <input name="accessCardDeposit" type="number" min="0" />
            </label>
            <label>
              Old room check-out meter
              <input name="checkOutMeter" type="number" step="0.01" />
            </label>
            <label>
              New room check-in meter
              <input name="checkInMeter" type="number" step="0.01" />
            </label>
            <label>
              New lease end
              <input name="leaseEndDate" type="date" />
            </label>
            <label className="wide">
              Reason / remarks
              <input name="reason" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Confirm room change
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ParkingModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [modal, setModal] = useState("");
  const [hostelFilter, setHostelFilter] = useState("all");
  const [tenantType, setTenantType] = useState("in-house");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [billingFrequency, setBillingFrequency] = useState("monthly");
  const [selectedLotId, setSelectedLotId] = useState("");
  const selectedStudent = data.students.find(
    (student) => String(student.id) === selectedStudentId,
  );
  const filteredLots = data.parkingLots.filter(
    (lot) => hostelFilter === "all" || String(lot.hostelId) === hostelFilter,
  );
  const filteredRentals = data.parkingRentals.filter(
    (rental) =>
      hostelFilter === "all" ||
      String(
        data.parkingLots.find((lot) => lot.id === rental.parkingLotId)
          ?.hostelId || "",
      ) === hostelFilter,
  );
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">PARKING REGISTER</span>
          <h2>Track every lot, car and payment period.</h2>
          <p>
            In-house parking flows into monthly student billing. Outside tenants
            can be tracked by paid-until date or package.
          </p>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={() => setModal("lot")}>
            + Add parking lot
          </button>
          <button
            className="primary"
            onClick={() => {
              setSelectedLotId("");
              setModal("rental");
            }}
          >
            + New rental
          </button>
        </div>
      </section>
      <section className="module-metrics">
        <Stat value={data.parkingLots.length} label="Total lots" />
        <Stat
          value={
            data.parkingLots.filter((l) => l.status === "available").length
          }
          label="Available"
        />
        <Stat
          value={
            data.parkingRentals.filter(
              (r) => r.status === "active" && r.tenantType === "in-house",
            ).length
          }
          label="In-house"
        />
        <Stat
          value={
            data.parkingRentals.filter(
              (r) => r.status === "active" && r.tenantType === "outside",
            ).length
          }
          label="Outside tenants"
        />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>ACTIVE & HISTORICAL RENTALS</small>
            <h3>Parking assignments</h3>
          </div>
        </div>
        <div className="filters">
          <label>
            Hostel
            <select
              value={hostelFilter}
              onChange={(event) => setHostelFilter(event.target.value)}
            >
              <option value="all">All hostels</option>
              {data.hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Belongs to</th>
                <th>Tenant</th>
                <th>Car</th>
                <th>Rental / deposit</th>
                <th>Billing</th>
                <th>Paid until</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRentals.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.lotNumber}</code>
                    <small>{r.hostelName}</small>
                  </td>
                  <td>
                    {data.parkingLots.find((l) => l.id === r.parkingLotId)
                      ?.unitCode || "Common / hostel"}
                  </td>
                  <td>
                    <strong>{r.tenantName}</strong>
                    <small>
                      {titleCase(r.tenantType)} ·{" "}
                      {r.contactNumber || "No contact"}
                    </small>
                  </td>
                  <td>
                    {r.carPlateNumber || "-"}
                    <small>{r.carModel || "Model not set"}</small>
                  </td>
                  <td>
                    {money(r.monthlyRental)}
                    <small>{money(r.depositAmount)} deposit</small>
                  </td>
                  <td>
                    {r.billingFrequency === "package"
                      ? `${r.packageMonths || 2}-month package`
                      : "Monthly"}
                    <small>
                      {r.tenantType === "outside"
                        ? titleCase(r.paymentStatus || "current")
                        : "Included in student billing"}
                    </small>
                  </td>
                  <td>
                    {dateLabel(r.paidUntil)}
                    {r.nextDueDate && (
                      <small>Next due {dateLabel(r.nextDueDate)}</small>
                    )}
                  </td>
                  <td>
                    <span className={`unit-status ${r.status}`}>
                      {titleCase(r.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>FULL LOT LIST</small>
            <h3>Lots by hostel and unit</h3>
          </div>
        </div>
        <div className="lot-grid">
          {filteredLots.map((l) => (
            <article key={l.id}>
              <code>{l.lotNumber}</code>
              <strong>{l.hostelName}</strong>
              <small>
                {l.unitCode
                  ? `Belongs to unit ${l.unitCode}`
                  : "Common / hostel lot"}
              </small>
              <span className={`unit-status ${l.status}`}>
                {titleCase(l.status)}
              </span>
              {l.status === "available" && (
                <button
                  className="secondary compact"
                  onClick={() => {
                    setSelectedLotId(String(l.id));
                    setModal("rental");
                  }}
                >
                  Reserve / rent this lot
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      {modal === "lot" && (
        <Modal
          title="Add parking lot"
          kicker="PARKING INVENTORY"
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "parking-lot", ...formValues(e) },
                "Parking lot added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Hostel
              <select name="hostelId" required>
                <option value="">Select hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lot number
              <input name="lotNumber" required />
            </label>
            <label>
              Belongs to unit
              <select name="unitId">
                <option value="">Common / hostel lot</option>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.hostelName}/{u.unitCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status">
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="wide">
              Notes
              <input name="notes" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add lot
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "rental" && (
        <Modal
          title="New parking rental"
          kicker="IN-HOUSE OR OUTSIDE"
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "parking-rental", ...formValues(e) },
                "Parking rental created",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Parking lot
              <SearchSelect
                name="parkingLotId"
                required
                defaultValue={selectedLotId}
                options={data.parkingLots
                  .filter((lot) => lot.status === "available")
                  .map((lot) => ({
                    value: lot.id,
                    label: `${lot.hostelName} · ${lot.lotNumber} · ${lot.unitCode || "Common"}`,
                  }))}
                placeholder="Type hostel, lot or unit"
              />
            </label>
            <label>
              Tenant type
              <select
                name="tenantType"
                value={tenantType}
                onChange={(event) => {
                  setTenantType(event.target.value);
                  setSelectedStudentId("");
                  setBillingFrequency("monthly");
                }}
              >
                <option value="in-house">In-house student</option>
                <option value="outside">Outside tenant</option>
              </select>
            </label>
            {tenantType === "in-house" && (
              <label className="wide">
                Link student
                <SearchSelect
                  name="studentId"
                  required
                  options={data.students
                    .filter((student) => student.assignmentStatus === "active")
                    .map((student) => ({
                      value: student.id,
                      label: `${student.fullName} · ${student.roomCode} · ${student.hostelName}/${student.unitCode}`,
                    }))}
                  onValueChange={setSelectedStudentId}
                  placeholder="Type student name or room code"
                />
              </label>
            )}
            <label>
              Tenant name
              <input
                name="tenantName"
                required
                value={
                  tenantType === "in-house"
                    ? selectedStudent?.fullName || ""
                    : undefined
                }
                readOnly={tenantType === "in-house"}
              />
            </label>
            <label>
              Contact number
              <input
                name="contactNumber"
                value={
                  tenantType === "in-house"
                    ? selectedStudent?.contactNumber || ""
                    : undefined
                }
                readOnly={tenantType === "in-house"}
              />
            </label>
            <label>
              Unit number
              <input
                name="unitNumber"
                value={
                  tenantType === "in-house"
                    ? selectedStudent?.unitCode || ""
                    : undefined
                }
                readOnly={tenantType === "in-house"}
              />
            </label>
            <label>
              Car plate
              <input name="carPlateNumber" required />
            </label>
            <label>
              Car model
              <input name="carModel" />
            </label>
            <label>
              Monthly rental
              <input name="monthlyRental" type="number" min="0" required />
            </label>
            <label>
              Deposit
              <input name="depositAmount" type="number" min="0" />
            </label>
            <label>
              Start date
              <input name="startDate" type="date" required />
            </label>
            <label>
              End date
              <input name="endDate" type="date" />
            </label>
            {tenantType === "outside" && (
              <>
                <label>
                  Paid until
                  <input name="paidUntil" type="date" />
                </label>
                <label>
                  Billing frequency
                  <select
                    name="billingFrequency"
                    value={billingFrequency}
                    onChange={(event) =>
                      setBillingFrequency(event.target.value)
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="package">Package / several months</option>
                  </select>
                </label>
                {billingFrequency === "package" && (
                  <label>
                    Package length (months)
                    <input
                      name="packageMonths"
                      type="number"
                      min="2"
                      max="24"
                      defaultValue="2"
                    />
                  </label>
                )}
                <label>
                  Next payment due
                  <input name="nextDueDate" type="date" />
                </label>
                <label>
                  Payment status
                  <select name="paymentStatus">
                    <option value="current">Current</option>
                    <option value="due">Due</option>
                    <option value="advance">Paid in advance</option>
                  </select>
                </label>
              </>
            )}
            <label className="wide">
              Remarks
              <input name="notes" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Create rental
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function MaintenanceModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [tab, setTab] = useState("tickets");
  const [modal, setModal] = useState("");
  const [ticket, setTicket] = useState<Row | null>(null);
  const [ticketStatusFilter, setTicketStatusFilter] = useState("all");
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketHostel, setTicketHostel] = useState("all");
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketHostelId, setTicketHostelId] = useState("");
  const [ticketUnitId, setTicketUnitId] = useState("");
  const [meterQuery, setMeterQuery] = useState("");
  const [costFrom, setCostFrom] = useState("");
  const [costTo, setCostTo] = useState("");
  const [editingMeter, setEditingMeter] = useState<Row | null>(null);
  const [meterRoomId, setMeterRoomId] = useState("");
  const openStatuses = [
    "submitted",
    "attended",
    "waiting-parts",
    "in-progress",
  ];
  const closedStatuses = ["completed", "closed"];
  const filteredTickets = data.tickets.filter((item) => {
    const search = ticketQuery.trim().toLowerCase();
    const text =
      `${item.ticketNo} ${item.hostelName} ${item.unitCode} ${item.roomLabel} ${item.studentName} ${item.category} ${item.subcategory} ${item.description}`.toLowerCase();
    const statusMatch =
      ticketStatusFilter === "open"
        ? openStatuses.includes(item.status)
        : ticketStatusFilter === "completed"
          ? closedStatuses.includes(item.status)
          : true;
    return (
      statusMatch &&
      (ticketHostel === "all" ||
        String(item.hostelId || "") === ticketHostel) &&
      (!search || text.includes(search))
    );
  });
  const filteredReadings = data.meterReadings.filter((reading) =>
    `${reading.roomCode} ${reading.unitCode} ${reading.hostelName}`
      .toLowerCase()
      .includes(meterQuery.toLowerCase()),
  );
  const filteredCosts = [
    ...data.tickets
      .filter(
        (item) =>
          Number(item.actualCost || 0) || Number(item.studentCharge || 0),
      )
      .map((item) => ({
        id: `ticket-${item.id}`,
        date: String(
          item.completedAt || item.updatedAt || item.createdAt,
        ).slice(0, 10),
        reference: item.ticketNo,
        description: item.subject,
        responsibility: item.costResponsibility,
        cost: Number(item.actualCost || 0),
        penalty: Number(item.studentCharge || 0),
      })),
    ...data.generalCosts.map((item) => ({
      id: `general-${item.id}`,
      date: item.costDate,
      reference: "GENERAL",
      description: item.description,
      responsibility: item.responsibility,
      cost: Number(item.amount || 0),
      penalty: 0,
    })),
  ].filter(
    (item) =>
      (!costFrom || item.date >= costFrom) && (!costTo || item.date <= costTo),
  );
  const meterRooms = [
    ...new Map(data.bedSpaces.map((bed) => [bed.roomId, bed])).values(),
  ];
  const downloadMeterTemplate = () => {
    const csv = [
      "roomCode,readingDate,readingValue,readingType,notes",
      ...meterRooms.map(
        (room) => `${room.unitCode}-${room.roomLabel},${today},,monthly,`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `meter-reading-template-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importMeterCsv = async (file?: File) => {
    if (!file) return;
    const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
    const headers =
      lines
        .shift()
        ?.split(",")
        .map((value) => value.trim()) || [];
    const rows = lines.map((line) =>
      Object.fromEntries(
        line.split(",").map((value, index) => [headers[index], value.trim()]),
      ),
    );
    await save(
      { action: "meter-reading-bulk", rows },
      `${rows.length} meter rows imported`,
    );
  };
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MAINTENANCE & RESIDENT SUPPORT</span>
          <h2>
            Tickets behave like a conversation, not a static complaint form.
          </h2>
          <p>
            Track attendance, waiting parts, completion, responsibility, student
            charges and monthly costs.
          </p>
        </div>
        <div className="button-row">
          {data.currentUser?.roleKey === "tenant" && (
            <button className="secondary" onClick={() => setModal("unlock")}>
              Door unlock request
            </button>
          )}
          {data.currentUser?.roleKey !== "tenant" && (
            <button
              className="secondary"
              onClick={() => setModal("categories")}
            >
              Manage categories
            </button>
          )}
          <button className="primary" onClick={() => setModal("ticket")}>
            + Submit ticket
          </button>
        </div>
      </section>
      <div className="workspace-tabs module-tabs">
        <button
          className={tab === "tickets" ? "active" : ""}
          onClick={() => setTab("tickets")}
        >
          Tickets
        </button>
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "meters" ? "active" : ""}
            onClick={() => setTab("meters")}
          >
            Meter readings
          </button>
        )}
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "costs" ? "active" : ""}
            onClick={() => setTab("costs")}
          >
            Costing & penalties
          </button>
        )}
      </div>
      {tab === "tickets" && (
        <>
          <section className="module-metrics">
            <button
              className={
                ticketStatusFilter === "all"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("all")}
            >
              <strong>{data.tickets.length}</strong>
              <small>Reported</small>
            </button>
            <button
              className={
                ticketStatusFilter === "open"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("open")}
            >
              <strong>
                {
                  data.tickets.filter((item) =>
                    openStatuses.includes(item.status),
                  ).length
                }
              </strong>
              <small>Open / pending / in progress</small>
            </button>
            <button
              className={
                ticketStatusFilter === "completed"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("completed")}
            >
              <strong>
                {
                  data.tickets.filter((item) =>
                    closedStatuses.includes(item.status),
                  ).length
                }
              </strong>
              <small>Completed / closed</small>
            </button>
            {data.currentUser?.roleKey !== "tenant" && (
              <button className="stat-filter" onClick={() => setTab("costs")}>
                <strong>
                  {money(
                    data.tickets.reduce(
                      (sum, item) => sum + Number(item.actualCost || 0),
                      0,
                    ),
                  )}
                </strong>
                <small>Recorded cost</small>
              </button>
            )}
          </section>
          <section className="panel">
            <div className="filters">
              <label className="search">
                Hostel, room, student or issue
                <input
                  value={ticketQuery}
                  onChange={(event) => setTicketQuery(event.target.value)}
                  placeholder="Search hostel/room code, student, category or issue"
                />
              </label>
              <label>
                Hostel
                <select
                  value={ticketHostel}
                  onChange={(event) => setTicketHostel(event.target.value)}
                >
                  <option value="all">All hostels</option>
                  {data.hostels.map((hostel) => (
                    <option key={hostel.id} value={hostel.id}>
                      {hostel.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary reset-button"
                onClick={() => {
                  setTicketQuery("");
                  setTicketHostel("all");
                  setTicketStatusFilter("all");
                }}
              >
                Reset filters
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Location</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Status / priority</th>
                    <th>Created</th>
                    <th>Attended</th>
                    <th>Completed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <code>{t.ticketNo}</code>
                        <small>
                          {t.studentName || titleCase(t.submittedByType)}
                        </small>
                      </td>
                      <td>
                        {t.hostelName || "-"}
                        <small>
                          {t.unitCode || "-"}{" "}
                          {t.roomLabel ? `/ Room ${t.roomLabel}` : ""}
                        </small>
                      </td>
                      <td>
                        {titleCase(t.category)}
                        <small>{titleCase(t.subcategory)}</small>
                      </td>
                      <td>
                        <strong>{t.subject}</strong>
                        <small>{t.description}</small>
                      </td>
                      <td>
                        <span className={`ticket-status ${t.status}`}>
                          {titleCase(t.status)}
                        </span>
                        <small>{titleCase(t.priority)}</small>
                      </td>
                      <td>{dateLabel(t.createdAt)}</td>
                      <td>{dateLabel(t.attendedAt)}</td>
                      <td>{dateLabel(t.completedAt)}</td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => setTicket(t)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filteredTickets.length && (
              <Empty
                title="No maintenance tickets"
                text="Submit the first staff or student ticket."
              />
            )}
          </section>
        </>
      )}
      {tab === "meters" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>MONTHLY / CHECK-IN / CHECK-OUT</small>
              <h3>Electricity meter readings</h3>
              <p>
                Sharing-room calculations can use check-in, check-out or special
                semester-break readings.
              </p>
            </div>
            <div className="button-row">
              <button
                className="secondary compact"
                onClick={downloadMeterTemplate}
              >
                Download CSV template
              </button>
              <label className="secondary compact file-button">
                Upload updated CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => importMeterCsv(event.target.files?.[0])}
                />
              </label>
              <button
                className="primary compact"
                onClick={() => {
                  setEditingMeter(null);
                  setMeterRoomId("");
                  setModal("meter");
                }}
              >
                + Add reading
              </button>
            </div>
          </div>
          <div className="filters">
            <label className="search">
              Unit / room code
              <input
                value={meterQuery}
                onChange={(event) => setMeterQuery(event.target.value)}
                placeholder="Type unit or room code"
              />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room code</th>
                  <th>Hostel / unit</th>
                  <th>Date</th>
                  <th>Reading</th>
                  <th>Type</th>
                  <th>Submitted by</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredReadings.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.roomCode}</code>
                    </td>
                    <td>
                      {r.hostelName} / {r.unitCode}
                    </td>
                    <td>{dateLabel(r.readingDate)}</td>
                    <td>
                      <strong>{r.readingValue}</strong>
                    </td>
                    <td>{titleCase(r.readingType)}</td>
                    <td>{r.submittedBy}</td>
                    <td>{r.notes || "-"}</td>
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setEditingMeter(r);
                          setMeterRoomId(String(r.roomId));
                          setModal("meter");
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "costs" && (
        <>
          <section className="report-grid">
            <ReportCard
              title="Maintenance costing"
              value={money(
                data.tickets.reduce(
                  (sum, t) => sum + Number(t.actualCost || 0),
                  0,
                ),
              )}
              note="Management, owner and student responsibility"
            />
            <ReportCard
              title="Student penalties"
              value={money(
                data.tickets.reduce(
                  (sum, t) => sum + Number(t.studentCharge || 0),
                  0,
                ),
              )}
              note="Includes door unlocking and additional requests"
            />
            <ReportCard
              title="Owner responsibility"
              value={String(
                data.tickets.filter((t) => t.costResponsibility === "owner")
                  .length,
              )}
              note="Tickets assigned to house owner"
            />
            <article className="panel fee-reference">
              <h3>Door unlocking fee</h3>
              <p>
                <b>{money(50)}</b> during office hours
              </p>
              <p>
                <b>{money(100)}</b> outside office hours
              </p>
            </article>
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <small>DETAILED COST & PENALTY REGISTER</small>
                <h3>
                  {money(
                    filteredCosts.reduce(
                      (sum, item) => sum + item.cost + item.penalty,
                      0,
                    ),
                    true,
                  )}{" "}
                  in selected period
                </h3>
              </div>
              <button
                className="primary compact"
                onClick={() => setModal("general-cost")}
              >
                + Add general costing
              </button>
            </div>
            <div className="filters">
              <label>
                From
                <input
                  type="date"
                  value={costFrom}
                  onChange={(event) => setCostFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={costTo}
                  onChange={(event) => setCostTo(event.target.value)}
                />
              </label>
              <button
                className="secondary reset-button"
                onClick={() => {
                  setCostFrom("");
                  setCostTo("");
                }}
              >
                Reset dates
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Responsibility</th>
                    <th>Cost</th>
                    <th>Student penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCosts
                    .sort((left, right) => right.date.localeCompare(left.date))
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{dateLabel(item.date)}</td>
                        <td>
                          <code>{item.reference}</code>
                        </td>
                        <td>{item.description}</td>
                        <td>{titleCase(item.responsibility)}</td>
                        <td>{money(item.cost, true)}</td>
                        <td>{money(item.penalty, true)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {ticket && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setTicket(null)}
        >
          <aside className="unit-drawer ticket-drawer">
            <div className="drawer-head">
              <div>
                <small>{ticket.ticketNo}</small>
                <h2>{ticket.subject}</h2>
                <p>
                  {ticket.hostelName} / {ticket.unitCode} ·{" "}
                  {titleCase(ticket.status)}
                </p>
              </div>
              <button onClick={() => setTicket(null)}>×</button>
            </div>
            <section className="drawer-section ticket-summary">
              <div>
                <span>Assigned to</span>
                <b>{ticket.assignedTo || "Not assigned"}</b>
              </div>
              <div>
                <span>Responsibility</span>
                <b>{titleCase(ticket.costResponsibility)}</b>
              </div>
              <div>
                <span>Actual cost</span>
                <b>{money(ticket.actualCost)}</b>
              </div>
              <div>
                <span>Student charge</span>
                <b>{money(ticket.studentCharge)}</b>
              </div>
            </section>
            {data.attachments.some(
              (attachment) =>
                attachment.contextType === "ticket" &&
                attachment.recordId === ticket.id,
            ) && (
              <section className="drawer-section attachment-list">
                <strong>Ticket pictures / videos</strong>
                {data.attachments
                  .filter(
                    (attachment) =>
                      attachment.contextType === "ticket" &&
                      attachment.recordId === ticket.id,
                  )
                  .map((attachment) => (
                    <a
                      key={attachment.id}
                      href={`/api/files?id=${attachment.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {attachment.fileName}
                    </a>
                  ))}
              </section>
            )}
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>CONVERSATION</small>
                  <h3>Ticket updates</h3>
                </div>
              </div>
              <div className="conversation">
                {data.ticketMessages
                  .filter((m) => m.ticketId === ticket.id)
                  .map((m) => (
                    <article
                      key={m.id}
                      className={
                        m.authorRole === "student"
                          ? "student-message"
                          : "staff-message"
                      }
                    >
                      <div>
                        <b>{m.authorName}</b>
                        <small>
                          {titleCase(m.authorRole)} · {dateLabel(m.createdAt)}
                        </small>
                      </div>
                      <p>{m.message}</p>
                      {m.statusAfter && (
                        <span>Status: {titleCase(m.statusAfter)}</span>
                      )}
                      {data.attachments
                        .filter(
                          (attachment) =>
                            attachment.contextType === "ticket-update" &&
                            attachment.recordId === m.id,
                        )
                        .map((attachment) => (
                          <a
                            key={attachment.id}
                            href={`/api/files?id=${attachment.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View attachment: {attachment.fileName}
                          </a>
                        ))}
                    </article>
                  ))}
              </div>
              <form
                className="ticket-reply"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = e.currentTarget;
                  const result = await save(
                    {
                      action: "ticket-message",
                      ticketId: ticket.id,
                      ...formValues(e),
                    },
                    "Ticket update posted",
                  );
                  const file = (
                    f.elements.namedItem("updateAttachment") as HTMLInputElement
                  ).files?.[0];
                  if (result?.id && file)
                    await uploadAttachment(
                      file,
                      "ticket-update",
                      result.id,
                      data.currentUser?.displayName,
                    );
                  if (result) {
                    f.reset();
                    setTicket(null);
                  }
                }}
              >
                <label>
                  Update message
                  <textarea
                    name="message"
                    required={data.currentUser?.roleKey === "tenant"}
                    placeholder="Inspection result, parts required, appointment or completion note"
                  />
                </label>
                <div className="form-grid">
                  {data.currentUser?.roleKey !== "tenant" && (
                    <>
                      <label>
                        New status
                        <select name="statusAfter">
                          <option value="">Keep current</option>
                          <option value="attended">Attended</option>
                          <option value="waiting-parts">
                            Waiting for parts
                          </option>
                          <option value="in-progress">In progress</option>
                          <option value="completed">Completed</option>
                          <option value="closed">Closed</option>
                        </select>
                      </label>
                      <label>
                        Assigned to
                        <input
                          name="assignedTo"
                          defaultValue={ticket.assignedTo}
                        />
                      </label>
                      <label>
                        Cost responsibility
                        <select
                          name="costResponsibility"
                          defaultValue={ticket.costResponsibility}
                        >
                          <option value="management">Management</option>
                          <option value="owner">House owner</option>
                          <option value="student">Student</option>
                        </select>
                      </label>
                      <label>
                        Actual cost
                        <input
                          name="actualCost"
                          type="number"
                          min="0"
                          defaultValue={ticket.actualCost ?? ""}
                        />
                      </label>
                      <label>
                        Student charge / penalty
                        <input
                          name="studentCharge"
                          type="number"
                          min="0"
                          defaultValue={ticket.studentCharge ?? ""}
                        />
                      </label>
                    </>
                  )}
                  <label className="wide">
                    Update photo (optional)
                    <input
                      name="updateAttachment"
                      type="file"
                      accept="image/*"
                    />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  Post update
                </button>
              </form>
            </section>
          </aside>
        </div>
      )}
      {modal === "categories" && (
        <Modal
          title="Maintenance categories"
          kicker="EDITABLE TICKET LIST"
          description="These categories and subcategories appear in the staff and tenant ticket forms."
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid compact-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                { action: "ticket-category-save", ...formValues(event) },
                "Ticket category added",
              );
              if (ok) event.currentTarget.reset();
            }}
          >
            <label>
              Category
              <input name="category" required placeholder="e.g. Electrical" />
            </label>
            <label>
              Subcategory
              <input name="subcategory" required placeholder="e.g. Light" />
            </label>
            <label>
              Sort order
              <input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={data.ticketCategories.length}
              />
            </label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                Add category
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Subcategory</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.ticketCategories.map((item) => (
                  <tr key={item.id}>
                    <td>{item.category}</td>
                    <td>{item.subcategory}</td>
                    <td>{titleCase(item.status)}</td>
                    <td>{item.sortOrder}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="secondary compact"
                          onClick={() => {
                            const category = window.prompt(
                              "Category",
                              item.category,
                            );
                            if (category === null) return;
                            const subcategory = window.prompt(
                              "Subcategory",
                              item.subcategory,
                            );
                            if (subcategory === null) return;
                            save(
                              {
                                action: "ticket-category-save",
                                categoryId: item.id,
                                category,
                                subcategory,
                                status: item.status,
                                sortOrder: item.sortOrder,
                              },
                              "Ticket category updated",
                            );
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="danger compact"
                          onClick={() =>
                            save(
                              {
                                action: "ticket-category-delete",
                                categoryId: item.id,
                              },
                              "Ticket category deleted",
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {modal === "general-cost" && (
        <Modal
          title="Add general maintenance costing"
          kicker="MONTHLY COST REGISTER"
          description="Use this for costs that are not tied to a maintenance ticket."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                { action: "general-cost", ...formValues(event) },
                "General cost added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Date
              <input
                name="costDate"
                type="date"
                required
                defaultValue={today}
              />
            </label>
            <label>
              Hostel
              <select name="hostelId">
                <option value="">General / all hostels</option>
                {data.hostels.map((hostel) => (
                  <option key={hostel.id} value={hostel.id}>
                    {hostel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cost type
              <select name="costType">
                <option value="maintenance">Maintenance</option>
                <option value="supplies">Supplies</option>
                <option value="service">Service</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Responsibility
              <select name="responsibility">
                <option value="management">Management</option>
                <option value="owner">House owner</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="wide">
              Description
              <input name="description" required />
            </label>
            <label>
              Amount
              <input name="amount" type="number" min="0" step="0.01" required />
            </label>
            <label>
              Student charge (if any)
              <input name="studentCharge" type="number" min="0" step="0.01" />
            </label>
            <label className="wide">
              Notes
              <input name="notes" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add costing
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "ticket" && (
        <Modal
          title="Submit maintenance ticket"
          kicker="TICKET DETAILS"
          description="Students must attach a picture or video. Staff attachments are optional."
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = formValues(e);
              const files = Array.from(
                (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files || [],
              );
              const imageCount = files.filter((file) =>
                file.type.startsWith("image/"),
              ).length;
              const videoCount = files.filter((file) =>
                file.type.startsWith("video/"),
              ).length;
              if (imageCount > 3 || videoCount > 1) {
                window.alert(
                  "Attach a maximum of 3 pictures and 1 video per ticket.",
                );
                return;
              }
              const result = await save(
                { action: "ticket-create", ...values },
                "Ticket submitted",
              );
              if (result?.id)
                for (const file of files)
                  await uploadAttachment(
                    file,
                    "ticket",
                    result.id,
                    data.currentUser?.displayName,
                  );
              if (result) setModal("");
            }}
          >
            <label>
              Submitted by
              <input
                value={`${data.currentUser?.displayName} · ${data.currentUser?.roleName}`}
                readOnly
              />
              <input
                type="hidden"
                name="submittedByType"
                value={
                  data.currentUser?.roleKey === "tenant" ? "student" : "staff"
                }
              />
            </label>
            {data.currentUser?.roleKey !== "tenant" && (
              <label>
                Student
                <SearchSelect
                  name="studentId"
                  options={data.students
                    .filter((student) => student.assignmentStatus === "active")
                    .map((student) => ({
                      value: student.id,
                      label: `${student.fullName} · ${student.roomCode}`,
                    }))}
                  placeholder="Type student name or room code"
                />
              </label>
            )}
            <label>
              Category
              <select
                name="category"
                required
                value={ticketCategory}
                onChange={(event) => setTicketCategory(event.target.value)}
              >
                <option value="">Select category</option>
                {[
                  ...new Set(
                    data.ticketCategories
                      .filter((item) => item.status === "active")
                      .map((item) => item.category),
                  ),
                ].map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subcategory
              <select name="subcategory" required>
                <option value="">Select subcategory</option>
                {data.ticketCategories
                  .filter(
                    (item) =>
                      item.status === "active" &&
                      item.category === ticketCategory,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.subcategory}>
                      {item.subcategory}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Hostel
              <select
                name="hostelId"
                required
                value={ticketHostelId}
                onChange={(event) => {
                  setTicketHostelId(event.target.value);
                  setTicketUnitId("");
                }}
              >
                <option value="">Select hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit
              <select
                name="unitId"
                required
                value={ticketUnitId}
                onChange={(event) => setTicketUnitId(event.target.value)}
              >
                <option value="">Select unit</option>
                {data.units
                  .filter(
                    (unit) =>
                      !ticketHostelId ||
                      String(unit.hostelId) === ticketHostelId,
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.hostelName}/{u.unitCode}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Room
              <select name="roomId">
                <option value="">Common area / common toilet</option>
                {[...new Map(data.bedSpaces.map((b) => [b.roomId, b])).values()]
                  .filter(
                    (room) =>
                      !ticketUnitId || String(room.unitId) === ticketUnitId,
                  )
                  .map((b) => (
                    <option key={b.roomId} value={b.roomId}>
                      {b.hostelName}/{b.unitCode} · Room {b.roomLabel}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="average">P2 · Average</option>
                <option value="high">P1 · High</option>
                <option value="low">P3 · Low</option>
              </select>
            </label>
            <label className="wide">
              Description
              <textarea name="description" required />
            </label>
            <label>
              Estimated cost
              <input name="estimatedCost" type="number" min="0" />
            </label>
            <label>
              Responsibility
              <select name="costResponsibility">
                <option value="management">Management</option>
                <option value="owner">House owner</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="wide">
              Picture / video
              <input
                name="attachment"
                type="file"
                accept="image/*,video/*"
                multiple
                required={data.currentUser?.roleKey === "tenant"}
              />
              <small className="field-note">
                Maximum 3 pictures and 1 video. Required for tenant submissions.
              </small>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit ticket
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "unlock" && (
        <Modal
          title="Door unlocking request"
          kicker="QUICK REQUEST"
          description="The applicable charge is added to the student billing record."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const values = formValues(e);
              const charge = values.subcategory === "office-hours" ? 50 : 100;
              const ok = await save(
                {
                  action: "ticket-create",
                  category: "access-card-key",
                  subject: "Door unlocking request",
                  description: `Unlock request (${titleCase(String(values.subcategory))})`,
                  studentCharge: charge,
                  costResponsibility: "student",
                  ...values,
                },
                "Unlock request submitted",
              );
              if (ok) setModal("");
            }}
          >
            <input
              type="hidden"
              name="studentId"
              value={data.currentUser?.studentId || ""}
            />
            <label>
              Hostel
              <select name="hostelId" required>
                <option value="">Select hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit
              <select name="unitId" required>
                <option value="">Select unit</option>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.hostelName}/{u.unitCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Time
              <select name="subcategory">
                <option value="office-hours">Office hours · RM50</option>
                <option value="non-office-hours">
                  Outside office hours · RM100
                </option>
              </select>
            </label>
            <label>
              Submitted by
              <input
                value={data.currentUser?.displayName || "Tenant"}
                readOnly
              />
            </label>
            <input type="hidden" name="submittedByType" value="student" />
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit unlock request
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "meter" && (
        <Modal
          title={
            editingMeter
              ? "Edit electricity meter reading"
              : "Add electricity meter reading"
          }
          kicker="MONTHLY BILLING INPUT"
          onClose={() => {
            setModal("");
            setEditingMeter(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingMeter
                    ? "meter-reading-update"
                    : "meter-reading",
                  readingId: editingMeter?.id,
                  ...formValues(e),
                },
                editingMeter ? "Meter reading updated" : "Meter reading added",
              );
              if (ok) {
                setModal("");
                setEditingMeter(null);
              }
            }}
          >
            <label className="wide">
              Room code
              <SearchSelect
                name="roomId"
                required={!editingMeter}
                defaultValue={editingMeter?.roomId}
                options={meterRooms.map((room) => ({
                  value: room.roomId,
                  label: `${room.unitCode}-${room.roomLabel} · ${room.hostelName}/${room.unitCode}`,
                }))}
                placeholder="Type room code, unit or hostel"
                onValueChange={setMeterRoomId}
              />
            </label>
            <label className="wide">
              Room meter serial
              <input
                key={meterRoomId || editingMeter?.roomId || "new"}
                name="meterSerial"
                defaultValue={
                  meterRooms.find(
                    (room) =>
                      String(room.roomId) ===
                      (meterRoomId || String(editingMeter?.roomId || "")),
                  )?.meterSerial ||
                  editingMeter?.meterSerial ||
                  ""
                }
                placeholder="One meter serial per room"
              />
            </label>
            <label>
              Reading date
              <input
                name="readingDate"
                type="date"
                required
                defaultValue={editingMeter?.readingDate || today}
              />
            </label>
            <label>
              Reading value
              <input
                name="readingValue"
                type="number"
                step="0.01"
                required
                defaultValue={editingMeter?.readingValue ?? ""}
              />
            </label>
            <label>
              Reading type
              <select
                name="readingType"
                defaultValue={editingMeter?.readingType || "monthly"}
              >
                <option value="monthly">Monthly</option>
                <option value="check-in">Check-in</option>
                <option value="check-out">Check-out</option>
                <option value="semester-break">
                  Semester break / special split
                </option>
              </select>
            </label>
            <label>
              Submitted by
              <input
                name="submittedBy"
                defaultValue={
                  editingMeter?.submittedBy ||
                  data.currentUser?.displayName ||
                  "Maintenance Team"
                }
              />
            </label>
            <label className="wide">
              Notes
              <input name="notes" defaultValue={editingMeter?.notes || ""} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingMeter ? "Update reading" : "Save reading"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function FinanceModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [modal, setModal] = useState("");
  const latest = data.billingCycles[0];
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("all");
  const filteredInvoices = data.invoices.filter((invoice) => {
    const balance =
      Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0);
    const statusMatch =
      paymentStatusFilter === "all" ||
      (paymentStatusFilter === "paid" && balance === 0) ||
      (paymentStatusFilter === "outstanding" && balance > 0) ||
      (paymentStatusFilter === "credit" && balance < 0) ||
      (paymentStatusFilter === "pending" &&
        invoice.payments.some(
          (payment: Row) => payment.status === "pending-verification",
        ));
    const search = invoiceQuery.trim().toLowerCase();
    const searchMatch =
      !search ||
      `${invoice.studentName} ${invoice.roomCode} ${invoice.unitCode} ${invoice.invoiceNo}`
        .toLowerCase()
        .includes(search);
    return (
      statusMatch &&
      searchMatch &&
      (cycleFilter === "all" || String(invoice.cycleId) === cycleFilter)
    );
  });
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MONTHLY BILLING</span>
          <h2>Cut off on the 24th, then post bills for resident review.</h2>
          <p>
            Room rental, electricity, parking and verified additional charges
            are combined. Students can submit payment proof for Accounts
            verification.
          </p>
        </div>
        {data.currentUser?.roleKey !== "tenant" && (
          <button className="primary" onClick={() => setModal("cycle")}>
            + Prepare billing month
          </button>
        )}
      </section>
      <section className="module-metrics">
        <Stat value={data.billingCycles.length} label="Billing cycles" />
        <Stat value={data.invoices.length} label="Invoices" />
        <Stat
          value={money(
            data.invoices.reduce(
              (sum, i) => sum + Number(i.totalAmount || 0),
              0,
            ),
            true,
          )}
          label="Total billed"
        />
        <Stat
          value={money(
            data.invoices.reduce(
              (sum, i) =>
                sum + Number(i.totalAmount || 0) - Number(i.amountPaid || 0),
              0,
            ),
            true,
          )}
          label="Outstanding"
        />
      </section>
      {latest && (
        <section className="cycle-banner">
          <div>
            <small>LATEST BILLING CYCLE</small>
            <h3>{latest.periodLabel}</h3>
            <p>
              Cut-off {dateLabel(latest.cutoffDate)} · Due{" "}
              {dateLabel(latest.dueDate)} · {titleCase(latest.status)}
            </p>
          </div>
          {latest.status === "draft" &&
            data.currentUser?.roleKey !== "tenant" && (
              <button
                className="primary"
                onClick={() =>
                  save(
                    { action: "billing-post", cycleId: latest.id },
                    "Billing cycle posted",
                  )
                }
              >
                Post monthly billing
              </button>
            )}
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>STUDENT BILLS</small>
            <h3>Invoices, payments and receipts</h3>
            <p>
              Use Print / download for a student statement. Verified payments
              update the outstanding balance.
            </p>
          </div>
        </div>
        <div className="filters finance-filters">
          <label className="search">
            Student name or room code
            <input
              value={invoiceQuery}
              onChange={(event) => setInvoiceQuery(event.target.value)}
              placeholder="Type student, room, unit or invoice"
            />
          </label>
          <label>
            Payment status
            <select
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="outstanding">Outstanding</option>
              <option value="paid">Fully paid</option>
              <option value="credit">Excess / credit</option>
              <option value="pending">Pending verification</option>
            </select>
          </label>
          <label>
            Billing month
            <select
              value={cycleFilter}
              onChange={(event) => setCycleFilter(event.target.value)}
            >
              <option value="all">All months</option>
              {data.billingCycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.periodLabel}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary reset-button"
            onClick={() => {
              setInvoiceQuery("");
              setPaymentStatusFilter("all");
              setCycleFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Student</th>
                <th>Room</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <code>{i.invoiceNo}</code>
                    <small>{titleCase(i.invoiceFrequency)}</small>
                  </td>
                  <td>
                    <strong>{i.studentName}</strong>
                  </td>
                  <td>
                    <code>{i.roomCode || "-"}</code>
                    <small>{i.hostelName || ""}</small>
                  </td>
                  <td>
                    {i.items.map((x: Row) => (
                      <small key={x.id}>
                        {x.description}: {money(x.amount, true)}
                      </small>
                    ))}
                  </td>
                  <td>
                    <strong>{money(i.totalAmount, true)}</strong>
                  </td>
                  <td>{money(i.amountPaid, true)}</td>
                  <td>
                    <strong>{money(i.totalAmount - i.amountPaid, true)}</strong>
                  </td>
                  <td>{dateLabel(i.dueDate)}</td>
                  <td>
                    <span className={`payment-status ${i.status}`}>
                      {titleCase(i.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setModal(`invoice:${i.id}`);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.invoices.length && (
          <Empty
            title="No monthly bills generated"
            text="Prepare the first billing month. Active students will receive draft bills."
          />
        )}
      </section>
      {data.billingAdjustments.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>CONTROLLED BILLING CHANGES</small>
              <h3>Adjustment and electricity approval register</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Item</th>
                  <th>Previous</th>
                  <th>New</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.billingAdjustments.map((adjustment) => {
                  const invoice = data.invoices.find((entry) =>
                    entry.items.some(
                      (item: Row) => item.id === adjustment.billingItemId,
                    ),
                  );
                  const item = invoice?.items.find(
                    (entry: Row) => entry.id === adjustment.billingItemId,
                  );
                  return (
                    <tr key={adjustment.id}>
                      <td>
                        {dateLabel(adjustment.createdAt)}
                        <small>{adjustment.requestedBy}</small>
                      </td>
                      <td>
                        {item?.description ||
                          `Item ${adjustment.billingItemId}`}
                        <small>{invoice?.studentName}</small>
                      </td>
                      <td>{money(adjustment.previousAmount, true)}</td>
                      <td>{money(adjustment.newAmount, true)}</td>
                      <td>{adjustment.reason}</td>
                      <td>{titleCase(adjustment.approvalStatus)}</td>
                      <td>
                        {adjustment.approvalStatus === "pending" &&
                          data.currentUser?.permissions?.some(
                            (permission: Row) =>
                              permission.moduleKey === "finance" &&
                              permission.canApprove,
                          ) && (
                            <button
                              className="primary compact"
                              onClick={() =>
                                save(
                                  {
                                    action: "billing-adjust-approve",
                                    adjustmentId: adjustment.id,
                                  },
                                  "Adjustment approved",
                                )
                              }
                            >
                              Approve
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {modal === "cycle" && (
        <Modal
          title="Prepare billing month"
          kicker="CUT-OFF CONTROL"
          description="The 24th is the normal cut-off. Review draft calculations before posting."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "billing-cycle", ...formValues(e) },
                "Draft billing cycle prepared",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Billing month
              <input name="periodLabel" type="month" required />
            </label>
            <label>
              Cut-off date
              <input name="cutoffDate" type="date" required />
            </label>
            <label>
              Payment due date
              <input name="dueDate" type="date" required />
            </label>
            <label>
              Invoice frequency
              <select name="invoiceFrequency">
                <option value="on-request">Invoice on request</option>
                <option value="monthly">Generate invoice monthly</option>
                <option value="one-time">One-time invoice</option>
              </select>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Generate draft bills
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal.startsWith("invoice:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title={invoice.invoiceNo}
              kicker="STUDENT BILL"
              description={`${invoice.studentName} · Due ${dateLabel(invoice.dueDate)}`}
              onClose={() => setModal("")}
            >
              <div className="invoice-sheet">
                <div>
                  {invoice.items.map((x: Row) => (
                    <p key={x.id}>
                      <span>{x.description}</span>
                      <b>{money(x.amount, true)}</b>
                      {data.currentUser?.roleKey !== "tenant" && (
                        <button
                          className="secondary compact"
                          onClick={() => setModal(`edit-item:${x.id}`)}
                        >
                          Edit
                        </button>
                      )}
                    </p>
                  ))}
                </div>
                <footer>
                  <span>Total</span>
                  <strong>{money(invoice.totalAmount, true)}</strong>
                </footer>
                <footer>
                  <span>Outstanding</span>
                  <strong>
                    {money(invoice.totalAmount - invoice.amountPaid, true)}
                  </strong>
                </footer>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => window.print()}>
                  Print / download PDF
                </button>
                <button
                  className="primary"
                  onClick={() => setModal(`payment:${invoice.id}`)}
                >
                  Submit payment
                </button>
              </div>
              {invoice.payments.length > 0 && (
                <div className="payment-review">
                  <h4>Payment submissions</h4>
                  {invoice.payments.map((p: Row) => (
                    <div key={p.id}>
                      <span>
                        {money(p.verifiedAmount ?? p.amount, true)} ·{" "}
                        {p.remark || "No remark"} · {titleCase(p.status)}
                      </span>
                      {data.attachments
                        .filter(
                          (attachment) =>
                            attachment.contextType === "payment-proof" &&
                            attachment.recordId === p.id,
                        )
                        .map((attachment) => (
                          <a
                            key={attachment.id}
                            className="secondary compact"
                            href={`/api/files?id=${attachment.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View payment slip
                          </a>
                        ))}
                      {p.status !== "verified" && (
                        <button
                          className="secondary compact"
                          onClick={() => setModal(`verify:${p.id}`)}
                        >
                          Verify & issue receipt
                        </button>
                      )}
                      {p.status === "verified" && (
                        <button
                          className="secondary compact"
                          onClick={() => window.print()}
                        >
                          Receipt {p.receiptNo}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          );
        })()}
      {modal.startsWith("payment:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title="Submit payment proof"
              kicker={invoice.invoiceNo}
              onClose={() => setModal("")}
            >
              <form
                className="form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const result = await save(
                    {
                      action: "billing-payment",
                      invoiceId: invoice.id,
                      ...formValues(e),
                    },
                    "Payment submitted for verification",
                  );
                  if (result) {
                    const file = (
                      form.elements.namedItem("proof") as HTMLInputElement
                    ).files?.[0];
                    if (file && result.id)
                      await uploadAttachment(
                        file,
                        "payment-proof",
                        result.id,
                        data.currentUser?.displayName,
                      );
                    setModal("");
                  }
                }}
              >
                <label>
                  Amount
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Remark (optional)
                  <input name="remark" placeholder="Payment note" />
                </label>
                <label className="wide">
                  Payment slip
                  <input
                    name="proof"
                    type="file"
                    accept="image/*,.pdf"
                    required
                  />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Submit proof
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      {modal.startsWith("verify:") &&
        (() => {
          const paymentId = Number(modal.split(":")[1]);
          const invoice = data.invoices.find((item) =>
            item.payments.some((payment: Row) => payment.id === paymentId),
          );
          const payment = invoice?.payments.find(
            (item: Row) => item.id === paymentId,
          );
          if (!invoice || !payment) return null;
          const slips = data.attachments.filter(
            (attachment) =>
              attachment.contextType === "payment-proof" &&
              attachment.recordId === payment.id,
          );
          return (
            <Modal
              title="Verify payment received"
              kicker={invoice.invoiceNo}
              description="Review the submitted slip, then record the actual bank amount and reference."
              onClose={() => setModal(`invoice:${invoice.id}`)}
            >
              <div className="payment-slip-preview">
                <strong>Submitted amount: {money(payment.amount, true)}</strong>
                <span>{payment.remark || "No remark submitted"}</span>
                {slips.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/files?id=${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open payment slip: {attachment.fileName}
                  </a>
                ))}
              </div>
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    {
                      action: "billing-verify",
                      paymentId: payment.id,
                      ...formValues(event),
                    },
                    "Payment verified and receipt issued",
                  );
                  if (ok) setModal(`invoice:${invoice.id}`);
                }}
              >
                <label>
                  Actual amount received
                  <input
                    name="verifiedAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={payment.amount}
                  />
                </label>
                <label>
                  Bank / receipt reference
                  <input name="actualReference" required />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Verify & issue receipt
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      {modal.startsWith("edit-item:") &&
        (() => {
          const itemId = Number(modal.split(":")[1]);
          const invoice = data.invoices.find((entry) =>
            entry.items.some((item: Row) => item.id === itemId),
          );
          const item = invoice?.items.find((entry: Row) => entry.id === itemId);
          if (!invoice || !item) return null;
          return (
            <Modal
              title="Edit billing breakdown"
              kicker={invoice.invoiceNo}
              description={
                item.itemType === "electricity"
                  ? "Electricity changes require Manager or Director approval and remain in the adjustment report."
                  : "This change is recorded in the billing adjustment history."
              }
              onClose={() => setModal(`invoice:${invoice.id}`)}
            >
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    {
                      action: "billing-item-adjust",
                      itemId: item.id,
                      ...formValues(event),
                    },
                    item.itemType === "electricity"
                      ? "Electricity adjustment sent for approval"
                      : "Billing item updated",
                  );
                  if (ok) setModal(`invoice:${invoice.id}`);
                }}
              >
                <label className="wide">
                  Item
                  <input value={item.description} readOnly />
                </label>
                <label>
                  Current amount
                  <input value={item.amount} readOnly />
                </label>
                <label>
                  New amount
                  <input
                    name="newAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={item.amount}
                  />
                </label>
                <label className="wide">
                  Reason / remark
                  <input name="reason" required />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Submit change
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
    </>
  );
}

function AnnouncementsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [modal, setModal] = useState(false);
  const [announcementHostel, setAnnouncementHostel] = useState("");
  const [announcementBlock, setAnnouncementBlock] = useState("");
  const [announcementUnit, setAnnouncementUnit] = useState("");
  const selectedAnnouncementHostel = data.hostels.find(
    (hostel) => String(hostel.id) === announcementHostel,
  );
  const blocksByHostel: Record<string, string[]> = {
    ATR: ["Atria"],
    DAM: ["D1", "D2", "D3"],
    NDY: ["NB", "NC", "NE"],
    SHP: [],
    SR: [],
  };
  const blocks = blocksByHostel[selectedAnnouncementHostel?.code] || [];
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">RESIDENT COMMUNICATIONS</span>
          <h2>Send one notice to exactly the right residents.</h2>
          <p>
            Target all hostels, one hostel, a block such as D1, or one unit.
            Urgent and pinned notices remain prominent.
          </p>
        </div>
        {data.currentUser?.permissions?.some(
          (permission: Row) =>
            permission.moduleKey === "announcements" && permission.canCreate,
        ) && (
          <button className="primary" onClick={() => setModal(true)}>
            + New announcement
          </button>
        )}
      </section>
      <section className="announcement-list">
        {data.announcements.map((a) => (
          <article
            key={a.id}
            className={`${a.priority} ${a.pinned ? "pinned" : ""}`}
          >
            <div>
              <span className="announcement-priority">
                {a.pinned ? "PINNED · " : ""}
                {titleCase(a.priority)}
              </span>
              <small>{dateLabel(a.publishAt)}</small>
            </div>
            <span className={`unit-status ${a.status}`}>
              {titleCase(a.status)}
            </span>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
            <footer>
              Audience:{" "}
              <b>
                {a.audienceType === "all"
                  ? "All hostels"
                  : a.audienceType === "hostel"
                    ? a.hostelName
                    : a.audienceType === "block"
                      ? `${a.hostelName} · Block ${a.blockCode}`
                      : `${a.hostelName} · Unit ${a.unitCode}`}
              </b>
              {a.expiresAt && <> · Expires {dateLabel(a.expiresAt)}</>}
            </footer>
          </article>
        ))}
        {!data.announcements.length && (
          <Empty
            title="No announcements"
            text="Create a normal, urgent or pinned resident notice."
          />
        )}
      </section>
      {modal && (
        <Modal
          title="New announcement"
          kicker="AUDIENCE & PRIORITY"
          onClose={() => setModal(false)}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const values = formValues(e);
              const audienceType = values.unitId
                ? "unit"
                : values.blockCode
                  ? "block"
                  : values.hostelId
                    ? "hostel"
                    : "all";
              const ok = await save(
                { action: "announcement", audienceType, ...values },
                values.status === "draft"
                  ? "Announcement saved as draft"
                  : "Announcement published",
              );
              if (ok) setModal(false);
            }}
          >
            <label>
              Hostel
              <select
                name="hostelId"
                value={announcementHostel}
                onChange={(event) => {
                  setAnnouncementHostel(event.target.value);
                  setAnnouncementBlock("");
                  setAnnouncementUnit("");
                }}
              >
                <option value="">All hostels</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            {announcementHostel && blocks.length > 0 && (
              <label>
                Block
                <select
                  name="blockCode"
                  value={announcementBlock}
                  onChange={(event) => {
                    setAnnouncementBlock(event.target.value);
                    setAnnouncementUnit("");
                  }}
                >
                  <option value="">All blocks in hostel</option>
                  {blocks.map((block) => (
                    <option key={block} value={block}>
                      {block}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Unit
              <select
                name="unitId"
                value={announcementUnit}
                onChange={(event) => setAnnouncementUnit(event.target.value)}
              >
                <option value="">All units in selected hostel / block</option>
                {data.units
                  .filter(
                    (unit) =>
                      !announcementHostel ||
                      String(unit.hostelId) === announcementHostel,
                  )
                  .filter(
                    (unit) =>
                      !announcementBlock ||
                      String(unit.unitCode)
                        .toUpperCase()
                        .startsWith(announcementBlock),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.hostelName}/{u.unitCode}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <label>
              Status
              <select name="status">
                <option value="published">Publish</option>
                <option value="draft">Save as draft</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input name="pinned" type="checkbox" /> Pin announcement
            </label>
            <label>
              Publish date
              <input name="publishAt" type="datetime-local" />
            </label>
            <label>
              Expiry date
              <input name="expiresAt" type="date" />
            </label>
            <label className="wide">
              Title
              <input name="title" required />
            </label>
            <label className="wide">
              Message
              <textarea name="body" required />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Publish announcement
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function UserManagementModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"users" | "roles" | "reminders">("users");
  const [selectedRoleId, setSelectedRoleId] = useState<number>(
    Number(data.roles[0]?.id || 0),
  );
  const [editingUser, setEditingUser] = useState<Row | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const moduleLabels: Record<string, string> = {
    hostels: "Hostel information",
    "hostels-sales": "Hostel sales availability, reservations & pricing",
    "hostels-rates": "Hostel electricity and operating rates",
    "hostels-occupancy": "Occupant & vacancy register",
    "units-general": "Unit general information",
    "units-owner": "Unit & owner agreements",
    students: "Student information",
    parking: "Parking",
    maintenance: "Maintenance & meter readings",
    finance: "Finance",
    announcements: "Announcements",
    reports: "Reports",
    users: "User management",
  };
  const selectedRole =
    data.roles.find((role) => Number(role.id) === selectedRoleId) ||
    data.roles[0];
  const rolePermissions = data.rolePermissions.filter(
    (permission) => Number(permission.roleId) === Number(selectedRole?.id),
  );

  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">IDENTITY & ACCESS CONTROL</span>
          <h2>Give every staff member and tenant only the access they need.</h2>
          <p>
            Accounts use the signed-in email address. Manager and Director roles
            can change module-level view, create, edit, delete and approval
            permissions.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditingUser(null);
            setUserOpen(true);
          }}
        >
          + Add user
        </button>
      </section>

      <section className="module-metrics">
        <Stat value={data.users.length} label="User accounts" />
        <Stat value={data.roles.length} label="Roles" />
        <Stat
          value={data.users.filter((user) => user.status === "active").length}
          label="Active users"
        />
        <Stat
          value={data.users.filter((user) => user.studentId).length}
          label="Tenant accounts"
        />
      </section>

      <section className="workspace panel">
        <div className="workspace-tabs">
          <button
            className={tab === "users" ? "active" : ""}
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            className={tab === "roles" ? "active" : ""}
            onClick={() => setTab("roles")}
          >
            Role permissions
          </button>
          <button
            className={tab === "reminders" ? "active" : ""}
            onClick={() => setTab("reminders")}
          >
            Reminder messages
          </button>
        </div>

        {tab === "users" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email / login</th>
                  <th>Role</th>
                  <th>Linked tenant</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => {
                  const role = data.roles.find(
                    (item) => item.id === user.roleId,
                  );
                  const student = data.students.find(
                    (item) => item.id === user.studentId,
                  );
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.displayName}</strong>
                      </td>
                      <td>{user.email}</td>
                      <td>{role?.name || "Not assigned"}</td>
                      <td>
                        {student
                          ? `${student.fullName} · ${student.roomCode || "No room"}`
                          : "-"}
                      </td>
                      <td>
                        <span className={`status-pill ${user.status}`}>
                          {titleCase(user.status)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            setEditingUser(user);
                            setUserOpen(true);
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "roles" && (
          <div className="permission-workspace">
            <div className="filters">
              <label>
                Role
                <select
                  value={selectedRole?.id || ""}
                  onChange={(event) =>
                    setSelectedRoleId(Number(event.target.value))
                  }
                >
                  {data.roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filter-explanation">
                <strong>{selectedRole?.name}</strong>
                <span>{selectedRole?.description}</span>
              </div>
            </div>
            <div className="table-wrap permission-table">
              <table>
                <thead>
                  <tr>
                    <th>Module / information category</th>
                    <th>View</th>
                    <th>Create</th>
                    <th>Edit</th>
                    <th>Delete</th>
                    <th>Approve</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rolePermissions.map((permission) => (
                    <tr key={permission.id}>
                      <td>
                        <strong>
                          {moduleLabels[permission.moduleKey] ||
                            titleCase(permission.moduleKey)}
                        </strong>
                      </td>
                      {(
                        [
                          "canView",
                          "canCreate",
                          "canEdit",
                          "canDelete",
                          "canApprove",
                        ] as const
                      ).map((field) => (
                        <td key={field}>
                          <input
                            form={`permission-${permission.id}`}
                            type="checkbox"
                            name={field}
                            defaultChecked={Boolean(permission[field])}
                          />
                        </td>
                      ))}
                      <td>
                        <form
                          id={`permission-${permission.id}`}
                          onSubmit={async (event) => {
                            event.preventDefault();
                            await save(
                              {
                                action: "role-permission",
                                roleId: selectedRole.id,
                                moduleKey: permission.moduleKey,
                                ...formValues(event),
                              },
                              `${selectedRole.name} permission updated`,
                            );
                          }}
                        >
                          <button className="secondary compact" disabled={busy}>
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "reminders" && (
          <div className="settings-grid">
            {data.reminderTemplates.map((template) => (
              <form
                className="settings-card"
                key={template.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  await save(
                    {
                      action: "reminder-template",
                      templateId: template.id,
                      ...formValues(event),
                    },
                    "Reminder message updated",
                  );
                }}
              >
                <div className="card-title">
                  <div>
                    <small>{template.templateKey}</small>
                    <h3>Day {template.dayOfMonth}</h3>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={template.enabled}
                    />{" "}
                    Enabled
                  </label>
                </div>
                <label>
                  Day of month
                  <input
                    name="dayOfMonth"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={template.dayOfMonth}
                  />
                </label>
                <label>
                  Email subject
                  <input
                    name="subject"
                    required
                    defaultValue={template.subject}
                  />
                </label>
                <label>
                  Message
                  <textarea
                    name="message"
                    required
                    defaultValue={template.message}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save template
                </button>
              </form>
            ))}
            <div className="settings-note">
              <strong>Reminder schedule</strong>
              <p>
                The system prepares reminders on the 5th, 8th, 15th, 18th and
                21st until payment is received. Sending email requires the
                company email provider to be connected during production setup.
              </p>
            </div>
          </div>
        )}
      </section>

      {userOpen && (
        <Modal
          title={editingUser ? "Edit user account" : "Add user account"}
          kicker="USER MANAGEMENT"
          description="The login email must match the email used to sign in. Tenant accounts can be linked to one student profile."
          onClose={() => setUserOpen(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                {
                  action: "user-save",
                  userId: editingUser?.id,
                  ...formValues(event),
                },
                editingUser ? "User updated" : "User created",
              );
              if (ok) setUserOpen(false);
            }}
          >
            <label>
              Display name
              <input
                name="displayName"
                required
                defaultValue={editingUser?.displayName || ""}
              />
            </label>
            <label>
              Login email
              <input
                name="email"
                type="email"
                required
                defaultValue={editingUser?.email || ""}
              />
            </label>
            <label>
              Role
              <select
                name="roleId"
                required
                defaultValue={editingUser?.roleId || ""}
              >
                <option value="">Select role</option>
                {data.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingUser?.status || "active"}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="wide">
              Linked tenant (tenant role only)
              <SearchSelect
                name="studentId"
                defaultValue={editingUser?.studentId}
                options={data.students
                  .filter((student) => student.profileStatus === "active")
                  .map((student) => ({
                    value: student.id,
                    label: `${student.fullName} · ${student.roomCode || "No room"} · ${student.email || "No email"}`,
                  }))}
                placeholder="Type student name, email or room code"
              />
            </label>
            <div className="form-actions wide">
              <button
                type="button"
                className="secondary"
                onClick={() => setUserOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Save user"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function ReportsModule({ data }: { data: Data }) {
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [reportQuery, setReportQuery] = useState("");
  const [reportHostel, setReportHostel] = useState("all");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportStatus, setReportStatus] = useState("all");
  const ticketCost = data.tickets.reduce(
    (sum, t) => sum + Number(t.actualCost || 0),
    0,
  );
  const outstanding = data.invoices.reduce(
    (sum, i) => sum + Number(i.totalAmount) - Number(i.amountPaid),
    0,
  );
  const reports = [
    {
      key: "tickets",
      name: "Ticketing report",
      value: `${data.tickets.length} cases`,
      note: `${data.tickets.filter((t) => ["completed", "closed"].includes(t.status)).length} completed · ${money(ticketCost)} cost`,
    },
    {
      key: "meters",
      name: "Meter reading",
      value: `${data.meterReadings.length} readings`,
      note: "Monthly, check-in, check-out and special split",
    },
    {
      key: "cards",
      name: "Access card list",
      value: `${data.accessCards.length} cards`,
      note: `${data.accessCards.filter((c) => ["lost", "replaced"].includes(c.status)).length} lost / replaced`,
    },
    {
      key: "wifi",
      name: "Wi-Fi list",
      value: `${data.services.filter((s) => s.serviceType === "wifi").length} accounts`,
      note: `${data.services.filter((s) => s.status === "relocated").length} relocated`,
    },
    {
      key: "parking",
      name: "Parking history",
      value: `${data.parkingRentals.length} rentals`,
      note: `${data.parkingRentals.filter((r) => r.status !== "active").length} previous tenants`,
    },
    {
      key: "students",
      name: "Student information",
      value: `${data.students.length} profiles`,
      note: `${data.students.filter((s) => s.profileStatus !== "active").length} moved out / inactive`,
    },
    {
      key: "outstanding",
      name: "Outstanding payment",
      value: money(outstanding, true),
      note: `Across ${data.invoices.filter((i) => i.status !== "paid").length} unpaid / partial bills`,
    },
    {
      key: "costing",
      name: "Costing report",
      value: money(
        data.generalCosts.reduce(
          (sum, item) => sum + Number(item.amount || 0),
          ticketCost,
        ),
        true,
      ),
      note: "Detailed maintenance and general costs by month",
    },
  ];
  const reportRows = (index: number | null): Row[] => {
    if (index === null) return [];
    if (index === 0) return data.tickets;
    if (index === 1) {
      const grouped = new Map<string, Row[]>();
      for (const reading of data.meterReadings)
        grouped.set(reading.roomCode, [
          ...(grouped.get(reading.roomCode) || []),
          reading,
        ]);
      return [...grouped.values()].flatMap((rows) =>
        rows
          .sort((left, right) =>
            String(right.readingDate).localeCompare(String(left.readingDate)),
          )
          .slice(0, 8),
      );
    }
    if (index === 2) return data.accessCards;
    if (index === 3)
      return data.services
        .filter((service) => service.serviceType === "wifi")
        .map((service) => ({
          ...service,
          ...data.units.find((unit) => unit.id === service.unitId),
        }));
    if (index === 4) return data.parkingRentals;
    if (index === 5) return data.students;
    if (index === 6)
      return data.invoices.map((invoice) => ({
        ...invoice,
        outstanding: Number(invoice.totalAmount) - Number(invoice.amountPaid),
      }));
    return [
      ...data.generalCosts,
      ...data.tickets
        .filter((ticket) => Number(ticket.actualCost || 0) > 0)
        .map((ticket) => ({
          id: `ticket-${ticket.id}`,
          costDate: String(
            ticket.completedAt || ticket.updatedAt || ticket.createdAt,
          ).slice(0, 10),
          hostelName: ticket.hostelName,
          unitCode: ticket.unitCode,
          description: ticket.subject,
          responsibility: ticket.costResponsibility,
          amount: ticket.actualCost,
          reference: ticket.ticketNo,
        })),
    ] as Row[];
  };
  const detailRows = reportRows(selectedReport).filter((row) => {
    const search = reportQuery.trim().toLowerCase();
    const text =
      `${row.studentName || row.fullName || row.tenantName || ""} ${row.hostelName || ""} ${row.roomCode || row.unitCode || ""} ${row.description || row.subject || ""}`.toLowerCase();
    const hostelMatch =
      reportHostel === "all" ||
      String(row.hostelId || "") === reportHostel ||
      row.hostelName ===
        data.hostels.find((hostel) => String(hostel.id) === reportHostel)?.name;
    const date = String(
      row.createdAt ||
        row.readingDate ||
        row.startDate ||
        row.leaseEndDate ||
        row.dueDate ||
        row.costDate ||
        "",
    ).slice(0, 10);
    const statusMatch =
      reportStatus === "all" ||
      row.status === reportStatus ||
      row.profileStatus === reportStatus ||
      row.assignmentStatus === reportStatus;
    return (
      (!search || text.includes(search)) &&
      hostelMatch &&
      (!reportFrom || date >= reportFrom) &&
      (!reportTo || date <= reportTo) &&
      statusMatch
    );
  });
  const download = (name: string, rows: Row[]) => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]).filter(
      (k) => !["payments", "items", "charges"].includes(k),
    );
    const csv = [
      keys.join(","),
      ...rows.map((r) =>
        keys
          .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MANAGEMENT REPORTS</span>
          <h2>Operational lists and monthly statistics in one place.</h2>
          <p>
            Export the detailed registers for checking, reconciliation or
            management review.
          </p>
        </div>
      </section>
      <section className="report-list">
        {reports.map((r, index) => (
          <article className="panel" key={r.name}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>REPORT</small>
              <h3>{r.name}</h3>
              <strong>{r.value}</strong>
              <p>{r.note}</p>
            </div>
            <div className="button-row">
              <button
                className="primary compact"
                onClick={() => {
                  setSelectedReport(index);
                  setReportQuery("");
                  setReportHostel("all");
                  setReportFrom("");
                  setReportTo("");
                  setReportStatus("all");
                }}
              >
                View report
              </button>
              <button
                className="secondary compact"
                onClick={() =>
                  download(
                    r.name.toLowerCase().replace(/ /g, "-"),
                    reportRows(index),
                  )
                }
              >
                Export CSV
              </button>
            </div>
          </article>
        ))}
      </section>
      {selectedReport !== null && (
        <Modal
          title={reports[selectedReport].name}
          kicker="DETAILED REPORT"
          description="Filter the detailed register, then export exactly the visible rows."
          onClose={() => setSelectedReport(null)}
          wide
        >
          {selectedReport === 5 && (
            <section className="module-metrics report-modal-metrics">
              <Stat
                value={`${Math.round((data.bedSpaces.filter((bed) => bed.status === "occupied").length / Math.max(1, data.bedSpaces.filter((bed) => bed.status !== "special-use").length)) * 100)}%`}
                label="Occupancy"
              />
              <Stat
                value={data.reservations.filter(commitsInventory).length}
                label="Paid reservations"
              />
            </section>
          )}
          <div className="filters report-filters">
            <label className="search">
              Student, room or description
              <input
                value={reportQuery}
                onChange={(event) => setReportQuery(event.target.value)}
                placeholder="Search visible report"
              />
            </label>
            <label>
              Hostel
              <select
                value={reportHostel}
                onChange={(event) => setReportHostel(event.target.value)}
              >
                <option value="all">All hostels</option>
                {data.hostels.map((hostel) => (
                  <option key={hostel.id} value={hostel.id}>
                    {hostel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
              />
            </label>
            {(selectedReport === 0 ||
              selectedReport === 5 ||
              selectedReport === 6) && (
              <label>
                Status
                <select
                  value={reportStatus}
                  onChange={(event) => setReportStatus(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="moved-out">Moved out</option>
                  <option value="submitted">Submitted</option>
                  <option value="in-progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="closed">Closed</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </label>
            )}
            <button
              className="primary compact"
              onClick={() => download(reports[selectedReport].key, detailRows)}
            >
              Export visible CSV
            </button>
          </div>
          <div className="table-wrap report-detail-table">
            <table>
              <thead>
                <tr>
                  {detailRows.length > 0 &&
                    Object.keys(detailRows[0])
                      .filter(
                        (key) =>
                          !["payments", "items", "charges"].includes(key),
                      )
                      .slice(0, 9)
                      .map((key) => <th key={key}>{titleCase(key)}</th>)}
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row, index) => (
                  <tr key={`${row.id || "row"}-${index}`}>
                    {Object.keys(detailRows[0] || {})
                      .filter(
                        (key) =>
                          !["payments", "items", "charges"].includes(key),
                      )
                      .slice(0, 9)
                      .map((key) => (
                        <td key={key}>{String(row[key] ?? "-")}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!detailRows.length && (
              <Empty
                title="No rows match"
                text="Change the report filters to view records."
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function Modal({
  title,
  kicker,
  description,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  kicker: string;
  description?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`modal ${wide ? "wide-modal" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <small>{kicker}</small>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchSelect({
  name,
  options,
  defaultValue,
  placeholder = "Type to search...",
  required = false,
  onValueChange,
}: {
  name: string;
  options: { value: string | number; label: string }[];
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  onValueChange?: (
    value: string,
    option?: { value: string | number; label: string },
  ) => void;
}) {
  const listId = useId();
  const labelFor = (value: string | number | null | undefined) =>
    options.find((option) => String(option.value) === String(value ?? ""))
      ?.label || "";
  const [text, setText] = useState(() => labelFor(defaultValue));
  const selected = options.find(
    (option) => option.label === text || String(option.value) === text,
  );
  return (
    <>
      <input
        list={listId}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const option = options.find(
            (item) =>
              item.label === nextText || String(item.value) === nextText,
          );
          onValueChange?.(option ? String(option.value) : "", option);
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      <input
        type="hidden"
        name={name}
        value={selected ? String(selected.value) : ""}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={String(option.value)} value={option.label} />
        ))}
      </datalist>
    </>
  );
}
function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <article className={`metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}
function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <article>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}
function ReportCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="panel report-card">
      <small>{title}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>HO</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
