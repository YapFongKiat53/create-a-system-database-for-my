"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  Empty,
  MALAYSIAN_STATES,
  Modal,
  NATIONALITIES,
  RACES,
  RELIGIONS,
  SearchSelect,
  bedTypeLabel,
  blankCharges,
  blockOf,
  chargeLabels,
  commitsInventory,
  dateLabel,
  formatIC,
  formValues,
  genderLabel,
  money,
  reservationWeight,
  titleCase,
  today,
  uploadAttachment,
} from "./shared";
import type { Data, HostelTab, Row } from "./shared";
import React from "react";

// Access card price differs by hostel; the card admin/handling fee is flat.
const STANDARD_CARD_PRICE: Record<string, number> = { DAM: 100, NDY: 150 };
const STANDARD_CARD_HANDLING_FEE = 20;
const STANDARD_ADMIN_FEE: Record<string, number> = {
  Malaysian: 250,
  International: 500,
};

// Defined at module scope: creating components during render remounts them.
const getIcon = (tone: string) => {
  switch (tone) {
    case 'green':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18M5 21V7l8-4v18M13 21V9l8 4v8M9 11v2M9 15v2M17 15v2" />
        </svg>
      );
    case 'navy':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
          <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
        </svg>
      );
    case 'sand':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />
          <circle cx="9" cy="11" r="2" />
        </svg>
      );
    case 'coral':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
          <path d="M19 9h-4M19 9v4" />
        </svg>
      );
    default:
      return null;
  }
};

const Metric = ({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  tone: string;
}) => {
  return (
    <div className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{getIcon(tone)}</div>
      <div className="metric-content">
        <span className="metric-label">{label}</span>
        <span className="metric-value">{value}</span>
        <span className="metric-note">{note}</span>
      </div>
    </div>
  );
};

// Room-level availability, shared by the collapsed unit summary and the
// expanded room list so the two always agree.
const isRoomAvailable = (bed: Row) =>
  bed.status === "vacant" || bed.availabilityState === "available-now";

const roomStatus = (bed: Row): "available" | "occupied" | "unavailable" => {
  if (isRoomAvailable(bed)) return "available";
  if (bed.status === "occupied") return "occupied";
  return "unavailable";
};


export function HostelModule({
  data,
  save,
  busy,
  tab,
  setTab,
  load,
}: {
  data: Data;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
  busy: boolean;
  tab: HostelTab;
  setTab: (tab: HostelTab) => void;
  load: (modules?: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [hostelFilter, setHostelFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [roomCodeFilter, setRoomCodeFilter] = useState("all");
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
  const [reservationStatusTab, setReservationStatusTab] = useState<
    "reserved" | "converted" | "cancelled"
  >("reserved");
  // Converted reservations still collect balance payments, so staff need to
  // slice them by payment progress the same way Finance does for invoices.
  const [reservationPaymentFilter, setReservationPaymentFilter] = useState<
    "all" | "partial" | "unpaid" | "admin-fee" | "full"
  >("all");
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
  const [setAsDefault, setSetAsDefault] = useState(false);
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
  // Cascade: units belong to the chosen hostel, rooms belong to the chosen unit.
  const unitOptions = useMemo(
    () =>
      [
        ...new Map(
          data.bedSpaces
            .filter((bed) => hostelFilter === "all" || bed.hostelCode === hostelFilter)
            .map((bed) => [String(bed.unitId), String(bed.unitCode)]),
        ).entries(),
      ].sort((a, b) =>
        a[1].localeCompare(b[1], undefined, { numeric: true }),
      ),
    [data, hostelFilter],
  );
  const roomOptions = useMemo(
    () =>
      unitFilter === "all"
        ? []
        : [
          ...new Set(
            data.bedSpaces
              .filter((bed) => String(bed.unitId) === unitFilter)
              .map((bed) => String(bed.roomLabel)),
          ),
        ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [data, unitFilter],
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
      (unitFilter === "all" || String(bed.unitId) === unitFilter) &&
      (roomCodeFilter === "all" || String(bed.roomLabel) === roomCodeFilter) &&
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

  const baseAvailability = useMemo(() => {
    return data.bedSpaces.filter((bed) => {
      const available =
        bed.availabilityState === "available-now" ||
        (bed.availabilityState === "upcoming" && bed.availableFrom && bed.availableFrom <= availableDate);

      return (
        available &&
        (!bed.unitSurrenderDate || bed.unitSurrenderDate > availableDate) &&
        (hostelFilter === "all" || bed.hostelCode === hostelFilter) &&
        (unitFilter === "all" || String(bed.unitId) === unitFilter) &&
        (roomCodeFilter === "all" || String(bed.roomLabel) === roomCodeFilter) &&
        (genderFilter === "all" || bed.gender === genderFilter) &&
        (roomFilter === "all" || bed.roomType === roomFilter) &&
        (categoryFilter === "all" || bed.roomLabel === categoryFilter) &&
        (bathroomFilter === "all" || bed.bathroomType === bathroomFilter) &&
        (bedTypeFilter === "all" || bed.bedType === bedTypeFilter) &&
        (!maxRate || (effectiveRate(bed) !== null && effectiveRate(bed) <= Number(maxRate)))
      );
    });
  }, [data.bedSpaces, availableDate, hostelFilter, unitFilter, roomCodeFilter, genderFilter, roomFilter, categoryFilter, bathroomFilter, bedTypeFilter, maxRate]);


  const sellable = Math.max(0, baseAvailability.length - committedWeight);
  const resetFilters = () => {
    setQuery("");
    setHostelFilter("all");
    setUnitFilter("all");
    setRoomCodeFilter("all");
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
  // Converted/cancelled reservations no longer need action — keeping them
  // out of the default "Reserved" view is what the status tabs are for.
  const reservationCounts = {
    reserved: data.reservations.filter((r) => r.status === "reserved")
      .length,
    converted: data.reservations.filter((r) => r.status === "converted")
      .length,
    cancelled: data.reservations.filter((r) => r.status === "cancelled")
      .length,
  };
  const convertedReservations = data.reservations.filter(
    (r) => r.status === "converted",
  );
  const convertedPaymentCounts = {
    all: convertedReservations.length,
    partial: convertedReservations.filter(
      (r) => (r.paymentStatus || "unpaid") === "partial",
    ).length,
    unpaid: convertedReservations.filter(
      (r) => (r.paymentStatus || "unpaid") === "unpaid",
    ).length,
    "admin-fee": convertedReservations.filter(
      (r) => r.paymentStatus === "admin-fee",
    ).length,
    full: convertedReservations.filter((r) => r.paymentStatus === "full")
      .length,
  };
  const filteredReservations = data.reservations.filter((reservation) => {
    const search = reservationQuery.trim().toLowerCase();
    const matchesPayment =
      reservationStatusTab !== "converted" ||
      reservationPaymentFilter === "all" ||
      (reservation.paymentStatus || "unpaid") === reservationPaymentFilter;
    return (
      reservation.status === reservationStatusTab &&
      matchesPayment &&
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
  // Default rates are only settable for Damai/Nadayu, which have fixed,
  // predictable room categories — other hostels keep purely manual pricing.
  const canSetDefaultRate =
    pricingHostel === "DAM" || pricingHostel === "NDY";
  const pricingHostelId = data.hostels.find(
    (hostel) => hostel.code === pricingHostel,
  )?.id;
  const currentDefaultRate = data.categoryRates.find(
    (rate) =>
      String(rate.hostelId) === String(pricingHostelId) &&
      rate.roomCategory === pricingCategory,
  )?.monthlyRate as number | undefined;
  const bulkPrice = async () => {
    const ok = await save(
      {
        action: "bulk-room-price",
        roomIds: selectedRooms,
        salesRate: Number(pricingRate),
        priceType,
        promotionStartDate: promotionStart,
        promotionEndDate: promotionEnd,
        setAsDefault: canSetDefaultRate && priceType === "standard" && setAsDefault,
        hostelId: pricingHostelId,
        roomCategory: pricingCategory,
      },
      setAsDefault
        ? "Pricing updated and set as default rate"
        : "Pricing updated for vacant rooms",
    );
    if (ok) {
      setSelectedRooms([]);
      setPricingRate("");
      setSetAsDefault(false);
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



  const [activeAvailabilityHostel, setActiveAvailabilityHostel] = useState<
    string | null
  >(null);
  const [roomSearchQuery, setRoomSearchQuery] = useState("");
  const [roomStatusFilter, setRoomStatusFilter] = useState("all"); // 'all' | 'available' | 'occupied' | 'unavailable'
  const [roomGenderFilter, setRoomGenderFilter] = useState("all");
  const [hostelModalOpen, setHostelModalOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<Row | null>(null);

  const allMatchingRoomsSelected =
    rooms.length > 0 &&
    rooms.every((room) => selectedRooms.includes(room.id));

  // Unit-level occupancy for the directory header — distinct from the
  // bed-level totals already tracked above (a unit counts as occupied if
  // any of its beds is not vacant).
  const occupiedUnitsCount = data.units.filter((unit) =>
    data.bedSpaces.some(
      (bed) => bed.unitId === unit.id && bed.status !== "vacant",
    ),
  ).length;
  const unitOccupancyRate =
    data.units.length > 0
      ? Math.round((occupiedUnitsCount / data.units.length) * 1000) / 10
      : 0;

  // One tab per hostel, in the order hostels were created — a new hostel
  // automatically gets its own tab without any code change.
  const bedsByHostel = useMemo(() => {
    const query = roomSearchQuery.toLowerCase().trim();
    return data.hostels.map((hostel) => ({
      hostel,
      beds: data.bedSpaces.filter((bed) => {
        if (bed.hostelCode !== hostel.code) return false;
        const status = roomStatus(bed);
        const matchesQuery =
          !query ||
          `${bed.unitCode} ${bed.roomLabel} ${bed.legacyCode} ${bed.occupantName || ""}`
            .toLowerCase()
            .includes(query);
        const matchesGender =
          roomGenderFilter === "all" || bed.gender === roomGenderFilter;
        const matchesStatus =
          roomStatusFilter === "all" || status === roomStatusFilter;
        return matchesQuery && matchesGender && matchesStatus;
      }),
    }));
  }, [
    data.hostels,
    data.bedSpaces,
    roomSearchQuery,
    roomGenderFilter,
    roomStatusFilter,
  ]);

  const activeAvailabilityGroup = bedsByHostel.find(
    (group) => group.hostel.code === activeAvailabilityHostel,
  );

  // Rooms grouped by unit so the table shows one row per unit — each
  // room becomes a colored chip instead of its own row.
  const unitsInActiveGroup = useMemo(() => {
    if (!activeAvailabilityGroup) return [];
    const map = new Map<number, { unit: Row; beds: Row[] }>();
    for (const bed of activeAvailabilityGroup.beds) {
      const unit = data.units.find((u) => u.id === bed.unitId);
      if (!unit) continue;
      if (!map.has(unit.id)) map.set(unit.id, { unit, beds: [] });
      map.get(unit.id)!.beds.push(bed);
    }
    return [...map.values()].sort((a, b) =>
      a.unit.unitCode.localeCompare(b.unit.unitCode, undefined, {
        numeric: true,
      }),
    );
  }, [activeAvailabilityGroup, data.units]);

  // Quick per-category vacancy count for the selected hostel — how many
  // Room A/B/C/D are still available right now, split by gender so staff
  // can see male vs female availability at a glance.
  const categoryAvailability = useMemo(() => {
    if (!activeAvailabilityGroup) return [];
    const counts = new Map<
      string,
      { total: number; male: number; female: number; other: number }
    >();
    for (const bed of activeAvailabilityGroup.beds) {
      if (!isRoomAvailable(bed)) continue;
      const label = bed.roomLabel || "Other";
      const entry = counts.get(label) || {
        total: 0,
        male: 0,
        female: 0,
        other: 0,
      };
      entry.total += 1;
      if (bed.gender === "male") entry.male += 1;
      else if (bed.gender === "female") entry.female += 1;
      else entry.other += 1;
      counts.set(label, entry);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [activeAvailabilityGroup]);

  const [blockedNotice, setBlockedNotice] = useState("");
  const showBlockedNotice = (bed: Row) => {
    setBlockedNotice(
      `${bed.legacyCode || `Room ${bed.roomLabel}`} is not available to reserve`,
    );
    window.setTimeout(() => setBlockedNotice(""), 3000);
  };

  return (
    <>
      <div className="sales-overview">

        <section className="directory-header">
          <div>
            <h1>Hostel Directory</h1>
            <p>All properties and their unit overview at a glance.</p>
          </div>
          <div className="directory-header-actions">
            {canUseSales && (
              <button className="primary" onClick={() => openReservation()}>
                + New reservation
              </button>
            )}
            {canUseSales && (
              <button
                className="primary"
                onClick={() => {
                  setEditingHostel(null);
                  setHostelModalOpen(true);
                }}
              >
                + Add property
              </button>
            )}
          </div>
        </section>

        <section className="metrics-container">
          <Metric
            label="TOTAL PROPERTIES"
            value={String(data.hostels.length)}
            note="Active properties"
            tone="green"
          />
          <Metric
            label="TOTAL UNITS"
            value={String(data.units.length)}
            note={`${totals.beds} room codes total`}
            tone="navy"
          />
          <Metric
            label="TOTAL OCCUPIED"
            value={String(occupiedUnitsCount)}
            note={`${totals.occupied} of ${totals.beds} beds occupied`}
            tone="sand"
          />
          <Metric
            label="OVERALL OCCUPANCY"
            value={`${unitOccupancyRate}%`}
            note={`${totals.vacant} beds vacant now`}
            tone="coral"
          />
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
          {/* {(canUseSales || canUseOccupancy) && (
            <button
              className={currentHostelTab === "occupancy" ? "active" : ""}
              onClick={() => setTab("occupancy")}
            >
              Occupant & vacancy register
            </button>
          )} */}
        </div>
        {currentHostelTab === "availability" && (
          <>
            {blockedNotice && (
              <div className="notice-banner blocked">{blockedNotice}</div>
            )}
            <section className="directory-filters">
              <div className="workspace-tabs">
                {bedsByHostel.map(({ hostel, beds: hostelBeds }) => (
                  <button
                    key={hostel.id}
                    className={
                      activeAvailabilityHostel === hostel.code ? "active" : ""
                    }
                    onClick={() => setActiveAvailabilityHostel(hostel.code)}
                  >
                    {hostel.name} ({hostelBeds.length})
                  </button>
                ))}
                {!bedsByHostel.length && <em>No hostels added yet.</em>}
              </div>
              <div className="inline-filters">
                <div className="search-input-wrapper">
                  <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search room code, unit or occupant..."
                    value={roomSearchQuery}
                    onChange={(e) => setRoomSearchQuery(e.target.value)}
                  />
                </div>
                <select
                  value={roomGenderFilter}
                  onChange={(e) => setRoomGenderFilter(e.target.value)}
                >
                  <option value="all">All Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="mixed">Mixed</option>
                </select>
                <select
                  value={roomStatusFilter}
                  onChange={(e) => setRoomStatusFilter(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="available">Available (reservable)</option>
                  <option value="occupied">Occupied</option>
                  <option value="unavailable">Unavailable</option>
                </select>
                <button
                  type="button"
                  className="secondary reset-button"
                  onClick={() => {
                    setRoomSearchQuery("");
                    setRoomGenderFilter("all");
                    setRoomStatusFilter("all");
                  }}
                >
                  Reset filters
                </button>
              </div>
            </section>

            {activeAvailabilityGroup && (
              <section className="directory-table-container">
                <div className="section-heading">
                  <div>
                    <small>HOSTEL</small>
                    <h3>{activeAvailabilityGroup.hostel.name}</h3>
                    <p>{activeAvailabilityGroup.hostel.address}</p>
                  </div>
                  <span>
                    {activeAvailabilityGroup.beds.length} room
                    {activeAvailabilityGroup.beds.length === 1 ? "" : "s"}
                  </span>
                </div>
                {categoryAvailability.length > 0 && (
                  <div
                    className="category-availability-row"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '10px',
                      marginBottom: '18px',
                    }}
                  >
                    {categoryAvailability.map(([label, breakdown]) => (
                      <div
                        key={label}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '10px 18px',
                          borderRadius: '10px',
                          border: '1px solid #e5e7eb',
                          background: '#f9fafb',
                          minWidth: '96px',
                        }}
                      >
                        <strong style={{ fontSize: '20px', color: '#111827', lineHeight: 1.2 }}>
                          {breakdown.total}
                        </strong>
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#6b7280',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Room {label} available
                        </span>
                        <span
                          style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ color: '#2563eb' }}>
                            ♂ {breakdown.male}
                          </span>
                          <span style={{ color: '#db2777' }}>
                            ♀ {breakdown.female}
                          </span>
                          {breakdown.other > 0 && (
                            <span style={{ color: '#6b7280' }}>
                              Mixed {breakdown.other}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Unit</th>
                        <th>Gender</th>
                        <th>Rooms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitsInActiveGroup.map(({ unit, beds: unitBeds }) => (
                        <tr key={unit.id}>
                          <td>
                            <strong>{unit.unitCode}</strong>
                            <small>
                              {unitBeds.length} room
                              {unitBeds.length === 1 ? "" : "s"}
                            </small>
                          </td>
                          <td>{genderLabel(unit.gender)}</td>
                          <td>
                            <div className="room-chip-row">
                              {unitBeds.map((bed) => {
                                const available = isRoomAvailable(bed);
                                const dueSoon = !available && bed.renewalDueSoon;
                                const chipState = available
                                  ? "available"
                                  : dueSoon
                                    ? "ending-soon"
                                    : "unavailable";
                                return (
                                  <button
                                    key={bed.id}
                                    type="button"
                                    className={`room-chip ${chipState}`}
                                    title={
                                      dueSoon
                                        ? "Tenancy ends within 2 weeks — no renewal applied. Room can be pre-reserved."
                                        : undefined
                                    }
                                    onClick={() =>
                                      available || dueSoon
                                        ? openReservation(bed)
                                        : showBlockedNotice(bed)
                                    }
                                  >
                                    {bed.legacyCode || `Room ${bed.roomLabel}`}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!unitsInActiveGroup.length && (
                        <tr>
                          <td colSpan={3}>
                            <em>No rooms match this view.</em>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {!activeAvailabilityGroup && bedsByHostel.length > 0 && (
              <section className="directory-table-container">
                <em>Select a hostel above to view its rooms.</em>
              </section>
            )}
          </>
        )}
        {currentHostelTab === "reservations" && (
          <section className="reservation-page">
            {/* Page heading */}
            <header className="reservation-hero">
              <div className="reservation-hero-copy">
                <div className="reservation-eyebrow-row">
                  <span className="reservation-eyebrow">INDIVIDUAL & GROUP</span>

                  <span className="reservation-result-count">
                    {filteredReservations.length}{" "}
                    {filteredReservations.length === 1
                      ? "reservation"
                      : "reservations"}
                  </span>
                </div>

                <h3>Reservations before manual assignment</h3>

                <p>
                  Edit reservation details, record multiple payments, cancel an enquiry
                  or convert a confirmed booking into an actual room assignment.
                </p>
              </div>

              <div className="reservation-hero-side">
                <div className="reservation-illustration" aria-hidden="true">
                  <div className="illustration-calendar">
                    <div className="illustration-calendar-hooks">
                      <i />
                      <i />
                      <i />
                    </div>

                    <div className="illustration-calendar-grid">
                      {Array.from({ length: 12 }).map((_, index) => (
                        <i key={index} />
                      ))}
                    </div>
                  </div>

                  <div className="illustration-checklist">
                    <div className="illustration-clip" />

                    <div>
                      <span>✓</span>
                      <i />
                    </div>

                    <div>
                      <span>✓</span>
                      <i />
                    </div>

                    <div>
                      <span>✓</span>
                      <i />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="reservation-btn reservation-btn-primary"
                  onClick={() => openReservation()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="reservation-button-icon"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>

                  New reservation
                </button>
              </div>
            </header>

            <div className="workspace-tabs">
              <button
                type="button"
                className={reservationStatusTab === "reserved" ? "active" : ""}
                onClick={() => setReservationStatusTab("reserved")}
              >
                Reserved ({reservationCounts.reserved})
              </button>
              <button
                type="button"
                className={
                  reservationStatusTab === "converted" ? "active" : ""
                }
                onClick={() => setReservationStatusTab("converted")}
              >
                Converted ({reservationCounts.converted})
              </button>
              <button
                type="button"
                className={
                  reservationStatusTab === "cancelled" ? "active" : ""
                }
                onClick={() => setReservationStatusTab("cancelled")}
              >
                Cancelled ({reservationCounts.cancelled})
              </button>
            </div>

            {reservationStatusTab === "converted" && (
              <div className="workspace-tabs workspace-tabs-secondary">
                <button
                  type="button"
                  className={reservationPaymentFilter === "all" ? "active" : ""}
                  onClick={() => setReservationPaymentFilter("all")}
                >
                  All ({convertedPaymentCounts.all})
                </button>
                <button
                  type="button"
                  className={
                    reservationPaymentFilter === "partial" ? "active" : ""
                  }
                  onClick={() => setReservationPaymentFilter("partial")}
                >
                  Partial ({convertedPaymentCounts.partial})
                </button>
                <button
                  type="button"
                  className={
                    reservationPaymentFilter === "unpaid" ? "active" : ""
                  }
                  onClick={() => setReservationPaymentFilter("unpaid")}
                >
                  Unpaid ({convertedPaymentCounts.unpaid})
                </button>
                <button
                  type="button"
                  className={
                    reservationPaymentFilter === "admin-fee" ? "active" : ""
                  }
                  onClick={() => setReservationPaymentFilter("admin-fee")}
                >
                  Admin Fee ({convertedPaymentCounts["admin-fee"]})
                </button>
                <button
                  type="button"
                  className={
                    reservationPaymentFilter === "full" ? "active" : ""
                  }
                  onClick={() => setReservationPaymentFilter("full")}
                >
                  Full Payment ({convertedPaymentCounts.full})
                </button>
              </div>
            )}

            {/* Filters */}
            <section
              className="reservation-filter-panel"
              aria-label="Reservation filters"
            >
              <label className="reservation-field reservation-search-field">
                <span>Student / reservation</span>

                <div className="reservation-input-control has-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m16.5 16.5 4 4" />
                  </svg>

                  <input
                    value={reservationQuery}
                    onChange={(event) => setReservationQuery(event.target.value)}
                    placeholder="Search by student, sales person or reference..."
                  />
                </div>
              </label>

              <label className="reservation-field">
                <span>Hostel</span>

                <div className="reservation-input-control">
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
                </div>
              </label>
            </section>

            {/* Reservation cards */}
            {filteredReservations.length > 0 ? (
              <>
                <div className="reservation-card-grid">
                  {filteredReservations.map((r) => {
                    const isConverted = r.status === "converted";
                    const isCancelled = r.status === "cancelled";

                    const totalPayable = Number(r.totalPayable || 0);
                    const totalPaid = Number(r.amountPaid || 0);

                    // Prevent negative "Balance required"
                    const balanceRequired = Math.max(
                      totalPayable - totalPaid,
                      0,
                    );

                    const preferredUnitCode = r.preferredUnitId
                      ? data.units.find((unit) => unit.id === r.preferredUnitId)
                        ?.unitCode
                      : null;

                    const paymentStatusClass = String(
                      r.paymentStatus || "unpaid",
                    )
                      .toLowerCase()
                      .replace(/\s+/g, "-");

                    const paymentStatusLabel =
                      r.paymentStatus === "admin-fee"
                        ? "Admin fee"
                        : titleCase(r.paymentStatus || "unpaid");

                    const commitmentClass = isCancelled
                      ? "cancelled"
                      : isConverted
                        ? "assigned"
                        : r.inventoryCommitted
                          ? "committed"
                          : "enquiry";

                    const commitmentTitle = isCancelled
                      ? "Cancelled"
                      : isConverted
                        ? `Assigned: ${r.assignedCode || "Unit confirmed"}`
                        : r.inventoryCommitted
                          ? "Included in sales balance"
                          : "Enquiry only";

                    const commitmentDescription = isCancelled
                      ? `Cancelled ${dateLabel(r.cancelledAt)} — no longer holds a room`
                      : isConverted
                        ? "Reservation converted to an actual room assignment"
                        : r.inventoryCommitted
                          ? "This reservation reduces sellable availability"
                          : "This enquiry does not reduce room availability";

                    return (
                      <article
                        key={r.id}
                        className={`reservation-card ${isConverted ? "is-converted" : ""}`}
                        // 1. 核心调整：让最外层大卡片的内边距变小，并统一缩减内部区块的垂直间距
                        style={{
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px'
                        }}
                      >
                        {/* Card header */}
                        <header className="reservation-card-header" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div className="reservation-badges">
                            <code className="reservation-reference">
                              {r.referenceNo}
                            </code>

                            <span
                              className={`reservation-payment-status ${paymentStatusClass}`}
                            >
                              {paymentStatusLabel}
                            </span>
                          </div>

                          <div className="reservation-card-title" style={{ margin: '4px 0' }}>
                            {/* 2. 稍微调小一点学生名字的字号和上下边距 */}
                            <h4 style={{ margin: 0, fontSize: '1.25rem' }}>{r.studentName}</h4>

                            {isConverted && (
                              <span className="reservation-converted-label">
                                Converted
                              </span>
                            )}
                          </div>

                          <p className="reservation-main-meta" style={{ margin: 0 }}>
                            <span>{titleCase(r.reservationType)}</span>
                            <i />
                            <span>
                              Check-in{" "}
                              <strong>{dateLabel(r.targetMoveInDate)}</strong>
                            </span>
                            <i />
                            <span>
                              Sales:{" "}
                              <strong>{r.salesPerson || "Not assigned"}</strong>
                            </span>
                          </p>
                        </header>

                        {/* Preferences */}
                        <div className="reservation-preferences" style={{ gap: '6px' }}>
                          <span className="reservation-chip">
                            {r.preferredHostelName || "Hostel not selected"}
                          </span>

                          {preferredUnitCode && (
                            <span className="reservation-chip">
                              Unit {preferredUnitCode}
                            </span>
                          )}

                          <span className="reservation-chip">
                            {genderLabel(r.preferredGender)} student
                          </span>

                          <span className="reservation-chip">
                            {r.roomCategory === "any"
                              ? "Any category"
                              : `Room ${r.roomCategory}`}
                          </span>

                          <span className="reservation-chip">
                            {r.roomType === "any"
                              ? "Any room type"
                              : titleCase(r.roomType)}
                          </span>
                        </div>

                        {/* Reservation state */}
                        <div
                          className={`reservation-commitment ${commitmentClass}`}
                          // 3. 缩小状态框（绿框/灰框）的内部留白
                          style={{ padding: '12px 16px', gap: '12px' }}
                        >
                          <div className="reservation-commitment-icon">
                            {isConverted || r.inventoryCommitted ? (
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m6.5 12.5 3.5 3.5 7.5-8" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 10v6M12 7h.01" />
                              </svg>
                            )}
                          </div>

                          <div>
                            <strong style={{ fontSize: '14px' }}>{commitmentTitle}</strong>
                            <span style={{ fontSize: '13px' }}>{commitmentDescription}</span>
                          </div>
                        </div>

                        {/* Payment summary */}
                        <div
                          className="reservation-money-summary"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                            gap: '4px',
                            textAlign: 'center'
                          }}
                        >
                          <div style={{ padding: '8px 4px', overflow: 'hidden' }}>
                            <span style={{ fontSize: '10px', display: 'block', whiteSpace: 'nowrap' }}>Total payable</span>
                            <strong style={{ fontSize: '13px', display: 'block', wordBreak: 'break-all' }}>{money(totalPayable)}</strong>
                          </div>

                          <div style={{ padding: '8px 4px', overflow: 'hidden' }}>
                            <span style={{ fontSize: '10px', display: 'block', whiteSpace: 'nowrap' }}>Total paid</span>
                            <strong className="paid" style={{ fontSize: '13px', display: 'block', wordBreak: 'break-all' }}>{money(totalPaid)}</strong>
                          </div>

                          <div style={{ padding: '8px 4px', overflow: 'hidden' }}>
                            <span style={{ fontSize: '10px', display: 'block', whiteSpace: 'nowrap' }}>Balance required</span>
                            <strong
                              style={{ fontSize: '13px', display: 'block', wordBreak: 'break-all' }}
                              className={
                                balanceRequired > 0 ? "outstanding" : "settled"
                              }
                            >
                              {money(balanceRequired)}
                            </strong>
                          </div>
                        </div>

                        {/* Payment history */}
                        <section className="reservation-payment-history">
                          <div className="reservation-subheading" style={{ marginBottom: '8px' }}>
                            <span>Payment history</span>

                            <span>
                              {(r.payments || []).length}{" "}
                              {(r.payments || []).length === 1
                                ? "payment"
                                : "payments"}
                            </span>
                          </div>

                          {(r.payments || []).length > 0 ? (
                            <div
                              className="reservation-payment-list"
                              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                            >
                              {(r.payments || []).map((payment: Row) => (
                                <div
                                  key={payment.id}
                                  className="reservation-payment-item"
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid #e5e7eb',
                                    backgroundColor: '#fafafa'
                                  }}
                                >
                                  {/* 上半部分：付款详情 */}
                                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    <div className="reservation-payment-date-icon">
                                      <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <rect x="4" y="5" width="16" height="15" rx="2" />
                                        <path d="M8 3v4M16 3v4M4 10h16" />
                                      </svg>
                                    </div>

                                    <span style={{ whiteSpace: 'nowrap', fontSize: '13px' }}>{dateLabel(payment.paidAt)}</span>
                                    <i />
                                    <strong style={{ whiteSpace: 'nowrap', fontSize: '13px' }}>{money(payment.amount)}</strong>

                                    {payment.reference && (
                                      <>
                                        <i />
                                        <span style={{ color: '#6b7280', fontSize: '12px', wordBreak: 'break-word' }}>
                                          {payment.reference}
                                        </span>
                                      </>
                                    )}

                                    {data.attachments
                                      .filter(
                                        (attachment) =>
                                          attachment.contextType === "payment-proof" &&
                                          attachment.recordId === payment.id,
                                      )
                                      .map((attachment) => (
                                        <a
                                          key={attachment.id}
                                          href={`/api/files?id=${attachment.id}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{ fontSize: '12px', color: '#008861', fontWeight: 600, whiteSpace: 'nowrap' }}
                                        >
                                          View payment slip
                                        </a>
                                      ))}
                                  </div>

                                  {/* 下半部分：操作按钮 */}
                                  <div
                                    className="reservation-payment-actions"
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'flex-end',
                                      gap: '8px',
                                      borderTop: '1px dashed #e5e7eb',
                                      paddingTop: '8px'
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="reservation-btn reservation-btn-secondary"
                                      style={{ padding: '4px 12px', fontSize: '12px', minHeight: 'unset', borderRadius: '4px' }}
                                      disabled={busy}
                                      onClick={() => {
                                        const newAmount = prompt("Enter new amount (RM) for this payment:", payment.amount);

                                        if (newAmount !== null && newAmount.trim() !== "" && !isNaN(Number(newAmount))) {
                                          save(
                                            {
                                              action: "payment-update",
                                              reservationId: r.id,
                                              paymentId: payment.id,
                                              amount: Number(newAmount),
                                            },
                                            "Payment amount updated"
                                          );
                                        }
                                      }}
                                    >
                                      Edit
                                    </button>

                                    <button
                                      type="button"
                                      className="reservation-btn reservation-btn-danger"
                                      style={{ padding: '4px 12px', fontSize: '12px', minHeight: 'unset', borderRadius: '4px' }}
                                      disabled={busy}
                                      onClick={() => {
                                        const confirmed = confirm(`Are you sure you want to delete this payment of ${money(payment.amount)}?`);

                                        if (confirmed) {
                                          save(
                                            {
                                              action: "payment-delete",
                                              reservationId: r.id,
                                              paymentId: payment.id,
                                            },
                                            "Payment deleted"
                                          );
                                        }
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="reservation-no-payments">
                              No payments have been recorded for this reservation.
                            </div>
                          )}
                        </section>

                        {/* Quick payment and actions — converted reservations
                            keep collecting the balance owed even after the
                            room assignment is finalised. */}
                        {(r.status === "reserved" ||
                          r.status === "converted") && (
                          <div className="reservation-card-footer" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <form
                              className="reservation-quick-payment"
                              onSubmit={async (event) => {
                                event.preventDefault();

                                const form = event.currentTarget;

                                const result = await save(
                                  {
                                    action: "reservation-payment",
                                    reservationId: r.id,
                                    ...formValues(event),
                                  },
                                  "Payment added",
                                );

                                if (result) {
                                  const file = (
                                    form.elements.namedItem(
                                      "paymentProof",
                                    ) as HTMLInputElement
                                  ).files?.[0];
                                  if (file && result.id) {
                                    await uploadAttachment(
                                      file,
                                      "payment-proof",
                                      result.id,
                                      data.currentUser?.displayName,
                                    );
                                    await load();
                                  }
                                  form.reset();
                                }
                              }}
                              // 彻底采用安全的三层纵向结构，给每个输入框充足的宽度
                              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                            >
                              {/* 第一行：Payment Type */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payment type</span>
                                <select
                                  name="paymentStatus"
                                  defaultValue="partial"
                                  disabled={busy}
                                  onChange={(event) => {
                                    const form = event.currentTarget.form;
                                    const amountInput = form?.elements.namedItem(
                                      "paymentAmount",
                                    ) as HTMLInputElement | null;
                                    if (!amountInput) return;
                                    const type = event.currentTarget.value;
                                    if (type === "admin-fee") {
                                      amountInput.value = String(
                                        r.nationality === "International"
                                          ? STANDARD_ADMIN_FEE.International
                                          : STANDARD_ADMIN_FEE.Malaysian,
                                      );
                                      amountInput.readOnly = true;
                                    } else if (type === "full") {
                                      amountInput.value = String(balanceRequired);
                                      amountInput.readOnly = true;
                                    } else {
                                      amountInput.value = "";
                                      amountInput.readOnly = false;
                                    }
                                  }}
                                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
                                >
                                  <option value="admin-fee">Admin fee paid</option>
                                  <option value="partial">Partial payment</option>
                                  <option value="full">Full payment</option>
                                </select>
                              </label>

                              {/* 第二行：Amount */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Amount</span>
                                <input
                                  name="paymentAmount"
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  inputMode="decimal"
                                  placeholder="RM 0.00"
                                  required
                                  disabled={busy}
                                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
                                />
                              </label>

                              {/* 第三行：Payment Reference */}
                              <label className="reservation-reference-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payment reference</span>
                                <input
                                  name="paymentReference"
                                  placeholder="Receipt number, bank reference..."
                                  disabled={busy}
                                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
                                />
                              </label>

                              {/* 第四行：Payment slip */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payment slip (optional)</span>
                                <input
                                  name="paymentProof"
                                  type="file"
                                  accept="image/*,.pdf"
                                  disabled={busy}
                                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
                                />
                              </label>

                              {/* 添加付款按钮：稍微控制高度，让它不那么巨型 */}
                              <button
                                type="submit"
                                className="reservation-btn reservation-btn-add-payment"
                                disabled={busy}
                                style={{ width: '100%', padding: '8px', fontSize: '12px', fontWeight: 600, justifyContent: 'center', marginTop: '2px' }}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                  className="reservation-button-icon"
                                  style={{ width: '12px', height: '12px' }}
                                >
                                  <path d="M12 5v14M5 12h14" />
                                </svg>

                                {busy ? "Saving..." : "Add payment"}
                              </button>
                            </form>

                            {/* 底部操作按钮区域：恢复并排，释放纵向空间 */}
                            <div className="reservation-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '2px' }}>
                              <div className="reservation-main-actions" style={{ display: 'flex', gap: '6px', width: '100%' }}>
                                <button
                                  type="button"
                                  className="reservation-btn reservation-btn-secondary"
                                  style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
                                  disabled={busy}
                                  onClick={() => openReservation(null, r)}
                                >
                                  Edit reservation
                                </button>

                                {r.status === "reserved" && (
                                  <button
                                    type="button"
                                    className="reservation-btn reservation-btn-convert"
                                    style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
                                    disabled={busy}
                                    onClick={() => setConvertReservation(r)}
                                  >
                                    Convert assignment
                                  </button>
                                )}
                              </div>

                              <div className="reservation-main-actions" style={{ display: 'flex', gap: '6px', width: '100%' }}>
                                {r.status === "reserved" && (
                                  <button
                                    type="button"
                                    className="reservation-btn reservation-btn-cancel"
                                    style={{ flex: 1, padding: '5px', fontSize: '11px', justifyContent: 'center' }}
                                    disabled={busy}
                                    onClick={() => {
                                      const confirmed = confirm(
                                        `Cancel reservation ${r.referenceNo}? The room is released and payment history is kept for your records.`,
                                      );

                                      if (confirmed) {
                                        save(
                                          {
                                            action: "reservation-cancel",
                                            reservationId: r.id,
                                          },
                                          "Reservation cancelled",
                                        );
                                      }
                                    }}
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="reservation-btn reservation-btn-danger"
                                  style={{ flex: 1, padding: '5px', fontSize: '11px', justifyContent: 'center' }}
                                  disabled={busy}
                                  onClick={() => {
                                    const confirmed = confirm(
                                      `Permanently delete reservation ${r.referenceNo}? This also erases its payment history.`,
                                    );

                                    if (confirmed) {
                                      save(
                                        {
                                          action: "reservation-delete",
                                          reservationId: r.id,
                                        },
                                        "Reservation deleted",
                                      );
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <footer className="reservation-results-footer">
                  Showing{" "}
                  <strong>{filteredReservations.length}</strong>{" "}
                  {filteredReservations.length === 1
                    ? "reservation"
                    : "reservations"}
                </footer>
              </>
            ) : (
              <div className="reservation-empty-state">
                <div className="reservation-empty-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m15.5 15.5 4 4M8 10.5h5" />
                  </svg>
                </div>

                <h4>No reservations found</h4>

                <p>
                  No reservations match the current student name, reference or hostel
                  filters.
                </p>

                <button
                  type="button"
                  className="reservation-btn reservation-btn-secondary"
                  onClick={() => {
                    setReservationQuery("");
                    setReservationHostelFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </section>
        )}
        {currentHostelTab === "pricing" && (
          <div className="pricing-page">
            {canUseSales && (
              <>
                {/* Header */}
                <div className="pricing-hero">
                  <div className="pricing-hero-content">
                    <small>BULK SALES PRICING</small>

                    <h3>Room category + room type pricing</h3>

                    <p>
                      Update pricing for vacant rooms only. Current occupants&apos;
                      tenancy rates remain unchanged.
                    </p>
                  </div>

                  <div className="pricing-hero-art" aria-hidden="true">
                    <div className="hero-building">▦</div>
                    <div className="hero-document">✓</div>
                    <div className="hero-discount">%</div>
                  </div>
                </div>

                {/* Pricing control card */}
                <section className="pricing-card pricing-editor">
                  <div className="pricing-filter-grid">
                    {/* Hostel */}
                    <label className="pricing-field">
                      <span className="pricing-field-label">Hostel</span>

                      <div className="pricing-control">
                        <span className="pricing-control-icon" aria-hidden="true">
                          ▦
                        </span>

                        <select
                          value={pricingHostel}
                          onChange={(event) => {
                            setPricingHostel(event.target.value);
                            setSelectedRooms([]);
                          }}
                        >
                          {data.hostels.map((hostel) => (
                            <option key={hostel.id} value={hostel.code}>
                              {hostel.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>

                    {/* Room category */}
                    <label className="pricing-field">
                      <span className="pricing-field-label">Room category</span>

                      <div className="pricing-control">
                        <span className="pricing-control-icon" aria-hidden="true">
                          ◇
                        </span>

                        <select
                          value={pricingCategory}
                          onChange={(event) => {
                            setPricingCategory(event.target.value);
                            setSelectedRooms([]);
                          }}
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              Room {category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>

                    {/* Room type */}
                    <label className="pricing-field">
                      <span className="pricing-field-label">Room type</span>

                      <div className="pricing-control">
                        <span className="pricing-control-icon" aria-hidden="true">
                          ▱
                        </span>

                        <select
                          value={pricingRoomType}
                          onChange={(event) => {
                            setPricingRoomType(event.target.value);
                            setSelectedRooms([]);
                          }}
                        >
                          <option value="single">Single room</option>
                          <option value="sharing">Sharing room</option>
                        </select>
                      </div>
                    </label>

                    {/* Price type */}
                    <label className="pricing-field">
                      <span className="pricing-field-label">Price type</span>

                      <div className="pricing-control">
                        <span className="pricing-control-icon pricing-money-icon">
                          $
                        </span>

                        <select
                          value={priceType}
                          onChange={(event) => setPriceType(event.target.value)}
                        >
                          <option value="standard">
                            Original / standard price
                          </option>

                          <option value="promotion">Promotion price</option>
                        </select>
                      </div>
                    </label>

                    {/* New rate */}
                    <label className="pricing-field">
                      <span className="pricing-field-label">New rate (MYR)</span>

                      <div className="pricing-control pricing-rate-control">
                        <span className="pricing-rate-prefix">RM</span>

                        <input
                          type="number"
                          min="0"
                          value={pricingRate}
                          onChange={(event) => setPricingRate(event.target.value)}
                          placeholder="e.g. 799"
                        />
                      </div>
                    </label>
                  </div>

                  {/* Default rate for Damai/Nadayu */}
                  {canSetDefaultRate && (
                    <div className="pricing-default-area">
                      <div className="default-area-heading">
                        <div>
                          <strong>Default rate — Room {pricingCategory}</strong>
                          <small>
                            New rooms in this hostel + category inherit this
                            rate automatically, and reservation payment
                            breakdowns use it too.
                          </small>
                        </div>

                        <span className="default-status">
                          {currentDefaultRate !== undefined
                            ? money(currentDefaultRate)
                            : "Not set"}
                        </span>
                      </div>

                      {priceType === "standard" && (
                        <label className="pricing-default-checkbox">
                          <input
                            type="checkbox"
                            checked={setAsDefault}
                            onChange={(event) =>
                              setSetAsDefault(event.target.checked)
                            }
                          />
                          Set as default price for this hostel + category
                        </label>
                      )}
                    </div>
                  )}

                  {/* Promotion date fields */}
                  {priceType === "promotion" && (
                    <div className="pricing-promotion-area">
                      <div className="promotion-area-heading">
                        <div>
                          <strong>Promotion period</strong>
                          <small>
                            Set the start and end dates for this promotion.
                          </small>
                        </div>

                        <span className="promotion-status">Promotion price</span>
                      </div>

                      <div className="pricing-promotion-grid">
                        <label className="pricing-field">
                          <span className="pricing-field-label">
                            Promotion starts
                          </span>

                          <div className="pricing-control">
                            <input
                              type="date"
                              value={promotionStart}
                              onChange={(event) =>
                                setPromotionStart(event.target.value)
                              }
                            />
                          </div>
                        </label>

                        <label className="pricing-field">
                          <span className="pricing-field-label">Promotion ends</span>

                          <div className="pricing-control">
                            <input
                              type="date"
                              value={promotionEnd}
                              onChange={(event) =>
                                setPromotionEnd(event.target.value)
                              }
                            />
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Action row */}
                  <div className="pricing-action-row">
                    <label
                      className={`pricing-select-all ${allMatchingRoomsSelected ? "is-checked" : ""
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={allMatchingRoomsSelected}
                        disabled={!rooms.length}
                        onChange={(event) => {
                          setSelectedRooms(
                            event.target.checked
                              ? rooms.map((room) => room.id)
                              : [],
                          );
                        }}
                      />

                      <span>
                        <strong>Apply to all matching rooms</strong>

                        <small>
                          {rooms.length} matching{" "}
                          {rooms.length === 1 ? "room" : "rooms"}
                        </small>
                      </span>
                    </label>

                    <button
                      type="button"
                      className="pricing-confirm-button"
                      disabled={busy || !pricingRate || !selectedRooms.length}
                      onClick={bulkPrice}
                    >
                      <span className="pricing-button-icon">✓</span>

                      <span>
                        {selectedRooms.length
                          ? `Confirm ${selectedRooms.length}`
                          : "Confirm update"}
                      </span>
                    </button>

                    <button
                      type="button"
                      className="pricing-end-promotion-button"
                      disabled={busy || priceType !== "promotion"}
                      onClick={endPromotions}
                      title="End every active promotion matching this hostel, room category and room type"
                    >
                      <span className="pricing-button-icon">▣</span>
                      <span>End matching promotions today</span>
                    </button>
                  </div>
                </section>

                {/* Vacant room preview */}
                <section className="pricing-card pricing-preview-card">
                  <div className="pricing-preview-header">
                    <div className="pricing-preview-title">
                      <span className="pricing-preview-icon" aria-hidden="true">
                        ▤
                      </span>

                      <div>
                        <strong>Vacant rooms</strong>

                        <small>
                          Review the matching rooms before updating the price.
                        </small>
                      </div>
                    </div>

                    <div className="pricing-preview-count">
                      <strong>{rooms.length}</strong>
                      <span>
                        {rooms.length === 1 ? "room found" : "rooms found"}
                      </span>

                      {selectedRooms.length > 0 && (
                        <span className="selected-count">
                          {selectedRooms.length} selected
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pricing-table-wrap">
                    <table className="pricing-table">
                      <thead>
                        <tr>
                          <th className="pricing-checkbox-column">
                            <input
                              type="checkbox"
                              aria-label="Select all matching rooms"
                              checked={allMatchingRoomsSelected}
                              disabled={!rooms.length}
                              onChange={(event) => {
                                setSelectedRooms(
                                  event.target.checked
                                    ? rooms.map((room) => room.id)
                                    : [],
                                );
                              }}
                            />
                          </th>

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
                        {rooms.length > 0 ? (
                          rooms.map((room) => {
                            const isSelected = selectedRooms.includes(room.id);

                            return (
                              <tr
                                key={room.id}
                                className={isSelected ? "is-selected" : ""}
                              >
                                <td className="pricing-checkbox-column">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${room.hostelName} ${room.unitCode} Room ${room.roomLabel}`}
                                    checked={isSelected}
                                    onChange={(event) => {
                                      setSelectedRooms((currentIds) =>
                                        event.target.checked
                                          ? [
                                            ...new Set([
                                              ...currentIds,
                                              room.id,
                                            ]),
                                          ]
                                          : currentIds.filter(
                                            (id) => id !== room.id,
                                          ),
                                      );
                                    }}
                                  />
                                </td>

                                <td>
                                  <div className="pricing-unit-cell">
                                    <span className="pricing-unit-icon">▦</span>

                                    <strong>
                                      {room.hostelName} / {room.unitCode}
                                    </strong>
                                  </div>
                                </td>

                                <td>Room {room.roomLabel}</td>

                                <td>
                                  <span className="pricing-room-type">
                                    {titleCase(room.roomType)}
                                  </span>
                                </td>

                                <td>{room.vacant}</td>

                                <td>
                                  <strong>{money(room.salesRate)}</strong>
                                </td>

                                <td>
                                  {room.promotionRate !== null ? (
                                    <div className="pricing-promotion-price">
                                      <strong>
                                        {money(room.promotionRate)}
                                      </strong>

                                      <small>
                                        {dateLabel(room.promotionStartDate)} –{" "}
                                        {dateLabel(room.promotionEndDate)}
                                      </small>
                                    </div>
                                  ) : (
                                    <span className="pricing-no-promotion">
                                      No promotion
                                    </span>
                                  )}
                                </td>

                                <td>
                                  <strong className="pricing-new-price">
                                    {pricingRate
                                      ? money(Number(pricingRate))
                                      : "Enter above"}
                                  </strong>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={8} className="pricing-empty-state">
                              <div className="pricing-empty-icon">▤</div>
                              <strong>No matching vacant rooms</strong>
                              <span>
                                Try changing the hostel, room category or room type.
                              </span>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {canUseRates && (
              <div className="pricing-rates-section">
                <HostelRates data={data} save={save} busy={busy} />
              </div>
            )}
          </div>
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
      {hostelModalOpen && (
        <Modal
          title={editingHostel ? "Edit property" : "Add property"}
          kicker="HOSTEL DIRECTORY"
          onClose={() => {
            setHostelModalOpen(false);
            setEditingHostel(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingHostel ? "hostel-update" : "hostel-create",
                  hostelId: editingHostel?.id,
                  ...formValues(e),
                },
                editingHostel ? "Property updated" : "Property added",
              );
              if (ok) {
                setHostelModalOpen(false);
                setEditingHostel(null);
              }
            }}
          >
            <label>
              Property name
              <input
                name="name"
                required
                defaultValue={editingHostel?.name || ""}
              />
            </label>
            <label>
              Property code
              <input
                name="code"
                required
                maxLength={10}
                style={{ textTransform: "uppercase" }}
                defaultValue={editingHostel?.code || ""}
              />
            </label>
            <label className="wide">
              Address
              <input
                name="address"
                defaultValue={editingHostel?.address || ""}
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={editingHostel?.status || "active"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingHostel ? "Update property" : "Save property"}
              </button>
            </div>
          </form>
        </Modal>
      )}
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
            setCharges={setCharges}
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
          <ConvertAssignmentForm
            data={data}
            save={save}
            busy={busy}
            convertReservation={convertReservation}
            onDone={() => setConvertReservation(null)}
          />
        </Modal>
      )}
    </>
  );
}

// A fresh instance mounts every time the "Convert to actual assignment"
// modal opens (the caller only renders it while convertReservation is
// set), so the hostel-then-room cascade always starts clean.
function ConvertAssignmentForm({
  data,
  save,
  busy,
  convertReservation,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  convertReservation: Row;
  onDone: () => void;
}) {
  const [hostelId, setHostelId] = useState(
    String(convertReservation.preferredHostelId || ""),
  );
  const vacantBeds = data.bedSpaces.filter(
    (bed) =>
      bed.status === "vacant" &&
      (!hostelId || String(bed.hostelId) === hostelId),
  );
  // A reservation almost always converts into the exact room it already
  // holds — only special cases (the room got taken, or the student wants a
  // different one) need the hostel-then-room picker at all.
  const reservedBed = data.bedSpaces.find(
    (bed) => bed.id === convertReservation.provisionalBedSpaceId,
  );
  const reservedBedAvailable = Boolean(
    reservedBed && reservedBed.status === "vacant",
  );
  const reservedUnit = data.units.find(
    (unit) => unit.id === convertReservation.preferredUnitId,
  );
  const reservedUnitAvailable = Boolean(reservedUnit);
  const hasDefaultTarget =
    convertReservation.reservationType === "group"
      ? reservedUnitAvailable
      : reservedBedAvailable;
  const [useReservedTarget, setUseReservedTarget] = useState(hasDefaultTarget);
  return (
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
        if (ok) onDone();
      }}
    >
      {/* ---------------- SECTION 1: Reservation Summary ---------------- */}
      <div className="wide" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '8px', marginTop: '4px' }}>
        <h4 style={{ margin: 0, color: '#111827', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>1. Reservation Summary</h4>
      </div>

      <div className="wide" style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb', marginBottom: '16px', fontSize: '14px', color: '#4b5563' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span>{convertReservation.reservationType === "group" ? "Representative:" : "Student Name:"}</span>
          <strong style={{ color: '#111827' }}>{convertReservation.studentName}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span>Check-in Date:</span>
          <strong style={{ color: '#111827' }}>{dateLabel(convertReservation.targetMoveInDate)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #d1d5db', paddingTop: '8px', marginTop: '4px' }}>
          <span>Target Preferences:</span>
          <strong style={{ color: '#111827', textAlign: 'right' }}>
            {convertReservation.preferredHostelName || "Any Hostel"}
            {convertReservation.reservationType === "individual" && convertReservation.roomCategory !== "any"
              ? ` · Room ${convertReservation.roomCategory}`
              : ""}
          </strong>
        </div>
      </div>

      {/* ---------------- SECTION 2: Final Assignment ---------------- */}
      <div className="wide" style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, color: '#111827', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>2. Final Assignment</h4>
      </div>

      {useReservedTarget && hasDefaultTarget ? (
        <div
          className="wide"
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <span style={{ fontSize: '11px', color: '#166534', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {convertReservation.reservationType === "group"
                ? "Reserved unit"
                : "Reserved room"}
            </span>
            <div style={{ fontSize: '14px', color: '#111827', marginTop: '4px' }}>
              {convertReservation.reservationType === "group" ? (
                <strong>
                  {reservedUnit!.hostelName} / {reservedUnit!.unitCode} ·{" "}
                  {genderLabel(reservedUnit!.gender)}
                </strong>
              ) : (
                <strong>
                  {reservedBed!.legacyCode} · {reservedBed!.hostelName}/
                  {reservedBed!.unitCode} · Room {reservedBed!.roomLabel}
                </strong>
              )}
            </div>
          </div>
          <button
            type="button"
            className="secondary compact"
            onClick={() => setUseReservedTarget(false)}
          >
            Change {convertReservation.reservationType === "group" ? "unit" : "room"}
          </button>
          {convertReservation.reservationType === "group" ? (
            <input type="hidden" name="unitId" value={reservedUnit!.id} />
          ) : (
            <input type="hidden" name="bedSpaceId" value={reservedBed!.id} />
          )}
        </div>
      ) : convertReservation.reservationType === "group" ? (
        <>
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
          {hasDefaultTarget && (
            <button
              type="button"
              className="secondary compact wide"
              onClick={() => setUseReservedTarget(true)}
            >
              Use reserved unit instead
            </button>
          )}
        </>
      ) : (
        <>
          <label className="wide">
            Hostel
            <select
              value={hostelId}
              onChange={(event) => setHostelId(event.target.value)}
            >
              <option value="">All hostels</option>
              {data.hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Actual room code
            <SearchSelect
              key={hostelId}
              name="bedSpaceId"
              required
              defaultValue={
                vacantBeds.some(
                  (bed) =>
                    String(bed.id) ===
                    String(convertReservation.provisionalBedSpaceId),
                )
                  ? convertReservation.provisionalBedSpaceId
                  : undefined
              }
              options={vacantBeds.map((bed) => ({
                value: bed.id,
                label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode} · Room ${bed.roomLabel}`,
              }))}
              placeholder={
                hostelId
                  ? "Type room code or unit"
                  : "Select a hostel first, or search all hostels"
              }
            />
            <select
              hidden
              disabled
              name="bedSpaceId"
              required
              defaultValue={convertReservation.provisionalBedSpaceId || ""}
            >
              <option value="">Select room code manually</option>
              {vacantBeds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.legacyCode} · {bed.hostelName} / {bed.unitCode} · Room{" "}
                  {bed.roomLabel}
                </option>
              ))}
            </select>
          </label>
          {hasDefaultTarget && (
            <button
              type="button"
              className="secondary compact wide"
              onClick={() => setUseReservedTarget(true)}
            >
              Use reserved room instead
            </button>
          )}
        </>
      )}

      <div className="form-actions wide" style={{ marginTop: '16px' }}>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Confirm assignment
        </button>
      </div>
    </form>
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
  setCharges,
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
  setCharges: (
    update: (current: Record<string, number>) => Record<string, number>,
  ) => void;
  totalCharges: number;
  effectiveRate: (bed: Row) => number | null;
  openCharges: () => void;
  cancel: () => void;
  complete: () => void;
}) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState(
    editingReservation?.reservationType || "individual",
  );
  const [studentName, setStudentName] = useState(
    editingReservation?.studentName || "",
  );
  const [salesPerson, setSalesPerson] = useState(
    editingReservation?.salesPerson || "",
  );
  const [gender, setGender] = useState(
    editingReservation?.preferredGender || reservationBed?.gender || "male",
  );
  const [nationality, setNationality] = useState(
    editingReservation?.nationality || "",
  );
  const [identityNo, setIdentityNo] = useState(
    editingReservation?.nationality === "International"
      ? editingReservation?.identityNo || ""
      : formatIC(editingReservation?.identityNo || ""),
  );
  const [race, setRace] = useState(editingReservation?.race || "");
  const [religion, setReligion] = useState(editingReservation?.religion || "");
  const [date, setDate] = useState(
    editingReservation?.targetMoveInDate || availableDate,
  );
  const [hostelId, setHostelId] = useState(
    String(
      editingReservation?.preferredHostelId || reservationBed?.hostelId || "",
    ),
  );
  const [block, setBlock] = useState(() =>
    blockOf(reservationBed?.unitCode),
  );
  const [unitId, setUnitId] = useState(
    String(editingReservation?.preferredUnitId || reservationBed?.unitId || ""),
  );
  const [roomType, setRoomType] = useState(
    editingReservation?.roomType || reservationBed?.roomType || "any",
  );
  const [category, setCategory] = useState(
    editingReservation?.roomCategory || reservationBed?.roomLabel || "any",
  );
  const [bedSpaceId, setBedSpaceId] = useState(
    String(
      editingReservation?.provisionalBedSpaceId || reservationBed?.id || "",
    ),
  );

  // Standard first-payment pricing for hostels with fixed rates (Damai,
  // Nadayu) — derived from hostel + room category + nationality so staff
  // don't need to type the breakdown in by hand for a new reservation.
  // Reads the same hostel_category_rates rows the Pricing tab's "set as
  // default price" writes, so the two stay in sync by construction.
  const selectedHostelCode =
    data.hostels.find((hostel) => String(hostel.id) === hostelId)?.code ||
    "";
  const selectedBed = bedSpaceId
    ? data.bedSpaces.find((bed) => String(bed.id) === bedSpaceId)
    : undefined;
  const resolvedCategory =
    (category !== "any" ? category : selectedBed?.roomLabel) || "";
  const standardRate = data.categoryRates.find(
    (rate) =>
      String(rate.hostelId) === hostelId &&
      rate.roomCategory === resolvedCategory,
  )?.monthlyRate as number | undefined;
  const standardCharges =
    standardRate !== undefined
      ? {
          "first-month-rental": standardRate,
          deposit: standardRate * 3,
          "admin-fee":
            STANDARD_ADMIN_FEE[nationality] || STANDARD_ADMIN_FEE.Malaysian,
          "access-card-deposit":
            STANDARD_CARD_PRICE[selectedHostelCode] || 0,
          "access-card-handling": STANDARD_CARD_HANDLING_FEE,
        }
      : null;

  // Only auto-fill for a brand-new reservation — never silently overwrite
  // an existing reservation's already-agreed charges when editing.
  useEffect(() => {
    if (editingReservation || !standardCharges) return;
    setCharges((current) => ({ ...current, ...standardCharges }));
  }, [editingReservation, selectedHostelCode, resolvedCategory, nationality]);

  // Beds another live reservation already holds — never offer these again.
  const reservedBedIds = new Set(
    data.reservations
      .filter(
        (row) =>
          row.status === "reserved" && row.id !== editingReservation?.id,
      )
      .flatMap((row) => [row.provisionalBedSpaceId, row.assignedBedSpaceId])
      .filter(Boolean)
      .map(String),
  );
  /** Free on the move-in date, not held by another reservation. */
  const isSelectable = (bed: Row) =>
    (bed.status === "vacant" ||
      (bed.availableFrom && bed.availableFrom <= date)) &&
    !reservedBedIds.has(String(bed.id));
  /**
   * A mixed / unspecified unit accepts any student, and a student with no
   * stated preference accepts any unit — so compatibility runs both ways.
   */
  const genderFits = (bedGender: string) =>
    ["mixed", "unspecified"].includes(gender) ||
    ["mixed", "unspecified"].includes(String(bedGender)) ||
    bedGender === gender;

  // Each step only offers what the step before it allows. Gender is applied
  // as early as possible so block/category/room options never show a choice
  // that has nothing available for this student.
  const hostelBeds = data.bedSpaces.filter(
    (bed) =>
      isSelectable(bed) &&
      genderFits(bed.gender) &&
      (!hostelId || String(bed.hostelId) === hostelId),
  );
  const blockOptions = [
    ...new Set(hostelBeds.map((bed) => blockOf(bed.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blockedBeds = hostelBeds.filter(
    (bed) => !block || blockOf(bed.unitCode) === block,
  );
  const unitOptions = [
    ...new Map(
      blockedBeds.map((bed) => [String(bed.unitId), String(bed.unitCode)]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
  const categories = [
    ...new Set(blockedBeds.map((bed) => String(bed.roomLabel))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const options = blockedBeds.filter(
    (bed) =>
      (roomType === "any" || bed.roomType === roomType) &&
      (category === "any" || bed.roomLabel === category),
  );

  const goToHousing = () => {
    if (!salesPerson || !studentName.trim()) {
      window.alert(
        "Sales person and student / representative name are required.",
      );
      return;
    }
    setStep(2);
  };
  const goToPayment = () => {
    if (!hostelId) {
      window.alert("Select a hostel first.");
      return;
    }
    if (kind === "group" && !unitId) {
      window.alert("Select the unit to reserve for this group.");
      return;
    }
    if (kind !== "group" && !bedSpaceId) {
      window.alert("Select an available room.");
      return;
    }
    setStep(3);
  };

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
      <div className="wide reservation-steps">
        <span className={step === 1 ? "active" : step > 1 ? "done" : ""}>
          1. Personal information
        </span>
        <span className={step === 2 ? "active" : step > 2 ? "done" : ""}>
          2. Housing information
        </span>
        <span className={step === 3 ? "active" : ""}>3. Payment</span>
      </div>

      {!editingReservation && reservationBed?.status === "occupied" && (
        <div
          className="wide"
          style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            padding: '12px 16px',
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: '16px', lineHeight: 1 }}>⚠️</span>
          <div style={{ fontSize: '13px', color: '#92400e' }}>
            <strong>
              {reservationBed.legacyCode || `Room ${reservationBed.roomLabel}`}{" "}
              is still occupied
            </strong>
            <div>
              {reservationBed.occupantName || "The current student"} is living
              here until{" "}
              {dateLabel(reservationBed.agreementEndDate) || "an unset date"}
              , and hasn&apos;t applied to renew. You can pre-reserve this
              room for a new student, but the room only actually frees up
              once the current tenancy ends.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: step === 1 ? "contents" : "none" }}>
        <label>
          Reservation type
          <select
            name="reservationType"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="individual">Individual</option>
            <option value="group">Whole unit</option>
          </select>
        </label>
        <label>
          Sales person-in-charge
          <select
            name="salesPerson"
            required
            value={salesPerson}
            onChange={(event) => setSalesPerson(event.target.value)}
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
            placeholder="e.g. John Doe"
            value={studentName}
            onChange={(event) => setStudentName(event.target.value)}
          />
        </label>
        <label>
          Student gender
          <select
            name="preferredGender"
            value={gender}
            onChange={(event) => setGender(event.target.value)}
          >
            <option value="male">Male student</option>
            <option value="female">Female student</option>
          </select>
        </label>
        <label>
          Phone number
          <input
            name="contactNumber"
            placeholder="e.g. 0123456789"
            defaultValue={editingReservation?.contactNumber || ""}
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            placeholder="e.g. john.doe@example.com"
            defaultValue={editingReservation?.email || ""}
          />
        </label>
        <label>
          Nationality
          <select
            name="nationality"
            value={nationality}
            onChange={(event) => setNationality(event.target.value)}
          >
            <option value="">Not set</option>
            {NATIONALITIES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {nationality === "International" ? "Passport" : "IC"}
          <input
            name="identityNo"
            placeholder={
              nationality === "International"
                ? "e.g. A1234567"
                : "e.g. 010101-01-0101"
            }
            value={identityNo}
            onChange={(event) =>
              setIdentityNo(
                nationality === "International"
                  ? event.target.value
                  : formatIC(event.target.value),
              )
            }
            pattern={
              nationality === "International"
                ? undefined
                : "\\d{6}-\\d{2}-\\d{4}"
            }
            title={
              nationality === "International"
                ? undefined
                : "Enter the full IC number in the format 010101-01-0101"
            }
          />
        </label>
        {nationality === "Malaysian" && (
          <label>
            State
            <select
              name="state"
              defaultValue={editingReservation?.state || ""}
            >
              <option value="">Select state</option>
              {MALAYSIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {nationality === "International" && (
          <>
            <label>
              Specify country
              <input
                name="nationalityOther"
                placeholder="e.g. Indonesia"
                defaultValue={editingReservation?.nationalityOther || ""}
              />
            </label>
            <label>
              Hometown
              <input
                name="hometown"
                placeholder="e.g. Jakarta"
                defaultValue={editingReservation?.hometown || ""}
              />
            </label>
          </>
        )}
        <label>
          Race
          <select
            name="race"
            value={race}
            onChange={(event) => setRace(event.target.value)}
          >
            <option value="">Select race</option>
            {RACES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {race === "Others" && (
          <label>
            Specify race
            <input
              name="raceOther"
              placeholder="e.g. Eurasian"
              defaultValue={editingReservation?.raceOther || ""}
            />
          </label>
        )}
        <label>
          Religion
          <select
            name="religion"
            value={religion}
            onChange={(event) => setReligion(event.target.value)}
          >
            <option value="">Select religion</option>
            {RELIGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        {religion === "Others" && (
          <label>
            Specify religion
            <input
              name="religionOther"
              placeholder="e.g. Sikhism"
              defaultValue={editingReservation?.religionOther || ""}
            />
          </label>
        )}
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
        <div className="form-actions wide">
          <button type="button" className="secondary" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={goToHousing}>
            Next: Housing information
          </button>
        </div>
      </div>

      <div style={{ display: step === 2 ? "contents" : "none" }}>
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
          1. Hostel
          <select
            name="preferredHostelId"
            required
            value={hostelId}
            onChange={(event) => {
              setHostelId(event.target.value);
              setBlock("");
              setUnitId("");
              setCategory("any");
              setBedSpaceId("");
            }}
          >
            <option value="">Select hostel</option>
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
            disabled={!hostelId}
            onChange={(event) => {
              setRoomType(event.target.value);
              setBedSpaceId("");
            }}
          >
            <option value="any">Any room type</option>
            <option value="single">Single</option>
            <option value="sharing">Twin</option>
          </select>
        </label>
        {blockOptions.length > 0 && (
          <label>
            2. Block
            <select
              value={block}
              disabled={!hostelId}
              onChange={(event) => {
                setBlock(event.target.value);
                setUnitId("");
                setCategory("any");
                setBedSpaceId("");
              }}
            >
              <option value="">All blocks in this hostel</option>
              {blockOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "group" ? (
          <label className="wide">
            Unit / house to reserve
            <select
              name="preferredUnitId"
              required
              value={unitId}
              disabled={!hostelId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <option value="">
                {hostelId ? "Select a unit" : "Select a hostel first"}
              </option>
              {unitOptions.map(([id, code]) => (
                <option key={id} value={id}>
                  {code}
                </option>
              ))}
            </select>
            <small className="field-note">
              The whole unit is reserved for this group.
            </small>
          </label>
        ) : (
          <>
            <label>
              Room category
              <select
                name="roomCategory"
                value={category}
                disabled={!hostelId}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setBedSpaceId("");
                }}
              >
                <option value="any">Any category</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    Room {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              3. Room available {hostelId && `— ${options.length} available`}
              <select
                name="provisionalBedSpaceId"
                required
                disabled={!hostelId}
                value={bedSpaceId}
                onChange={(event) => setBedSpaceId(event.target.value)}
              >
                <option value="">
                  {!hostelId
                    ? "Select a hostel first"
                    : options.length
                      ? "Select an available room"
                      : "No free rooms match these choices"}
                </option>
                {options.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {`${bed.legacyCode} · ${bed.unitCode} · ${genderLabel(bed.gender)} · ${money(effectiveRate(bed))}`}
                  </option>
                ))}
              </select>
              <small className="field-note">
                Only shows rooms matching the student&apos;s gender that no
                other reservation is holding. Reference only; this is not the
                actual room assignment.
              </small>
            </label>
          </>
        )}
        <div className="form-actions wide">
          <button type="button" className="secondary" onClick={() => setStep(1)}>
            Back
          </button>
          <button type="button" className="primary" onClick={goToPayment}>
            Next: Payment
          </button>
        </div>
      </div>

      <div style={{ display: step === 3 ? "contents" : "none" }}>
        {!editingReservation && standardCharges ? (
          <div className="wide standard-charge-breakdown">
            <small>
              {data.hostels.find(
                (hostel) => String(hostel.id) === hostelId,
              )?.name}{" "}
              Room {resolvedCategory}
            </small>
            <ul>
              <li>
                <span>1st month rental</span>
                <strong>
                  {money(standardCharges["first-month-rental"])}
                </strong>
              </li>
              <li>
                <span>
                  3 months rental deposit
                  <small>2 month deposit + 1 month utility deposit</small>
                </span>
                <strong>{money(standardCharges.deposit)}</strong>
              </li>
              <li>
                <span>Admin fee</span>
                <strong>{money(standardCharges["admin-fee"])}</strong>
              </li>
              <li>
                <span>Access card deposit</span>
                <strong>
                  {money(standardCharges["access-card-deposit"])}
                </strong>
              </li>
              <li>
                <span>Card admin fee</span>
                <strong>
                  {money(standardCharges["access-card-handling"])}
                </strong>
              </li>
            </ul>
            <div className="standard-charge-total">
              <span>Total</span>
              <strong>{money(totalCharges)}</strong>
            </div>
            <button type="button" className="secondary compact" onClick={openCharges}>
              Adjust breakdown
            </button>
          </div>
        ) : (
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
        )}
        <label>
          Payment status
          <select
            name="paymentStatus"
            defaultValue={editingReservation?.paymentStatus || "unpaid"}
            onChange={(event) => {
              const form = event.currentTarget.form;
              const amountInput = form?.elements.namedItem(
                "paymentAmount",
              ) as HTMLInputElement | null;
              if (!amountInput) return;
              const type = event.currentTarget.value;
              if (type === "admin-fee") {
                amountInput.value = String(
                  nationality === "International"
                    ? STANDARD_ADMIN_FEE.International
                    : STANDARD_ADMIN_FEE.Malaysian,
                );
                amountInput.readOnly = true;
              } else if (type === "full") {
                amountInput.value = String(totalCharges);
                amountInput.readOnly = true;
              } else {
                amountInput.value = "0";
                amountInput.readOnly = false;
              }
            }}
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
          <button type="button" className="secondary" onClick={() => setStep(2)}>
            Back
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving..." : "Save reservation"}
          </button>
        </div>
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
