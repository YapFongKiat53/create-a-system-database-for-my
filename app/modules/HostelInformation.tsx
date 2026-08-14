"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
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
  formValues,
  genderLabel,
  money,
  reservationWeight,
  titleCase,
  today,
} from "./shared";
import type { Data, HostelTab, Row } from "./shared";
import React from "react";

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

type UnitAvailability =
  | "no-rooms"
  | "available"
  | "partial"
  | "occupied"
  | "unavailable";

const UNIT_STATUS_LABEL: Record<UnitAvailability, string> = {
  "no-rooms": "No Rooms",
  available: "Fully Available",
  partial: "Partially Available",
  occupied: "Fully Occupied",
  unavailable: "Unavailable",
};

// Reuses the existing .status-badge color language (green/gray/red);
// "partial" is the one new amber variant.
const UNIT_STATUS_BADGE_CLASS: Record<UnitAvailability, string> = {
  "no-rooms": "occupied",
  available: "available",
  partial: "partial",
  occupied: "occupied",
  unavailable: "unavailable",
};

// Derives the unit's own availability from its rooms — never labels a unit
// "Available" just because it has any vacant room.
const unitAvailabilitySummary = (unit: Row, bedsInUnit: Row[]) => {
  const totalRooms = bedsInUnit.length;
  const availableBeds = bedsInUnit.filter(isRoomAvailable);
  const occupiedCount = bedsInUnit.filter(
    (bed) => roomStatus(bed) === "occupied",
  ).length;
  const unavailableCount = totalRooms - availableBeds.length - occupiedCount;

  let status: UnitAvailability;
  if (unit.status && unit.status !== "active") status = "unavailable";
  else if (totalRooms === 0) status = "no-rooms";
  else if (availableBeds.length === totalRooms) status = "available";
  else if (availableBeds.length > 0) status = "partial";
  else status = "occupied";

  return {
    totalRooms,
    availableCount: availableBeds.length,
    occupiedCount,
    unavailableCount,
    status,
    availableCodes: availableBeds
      .map((bed) => bed.legacyCode)
      .filter(Boolean),
  };
};

export function HostelModule({
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



  const [expandedHostel, setExpandedHostel] = useState<string | null>(null);
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [unitSearchQuery, setUnitSearchQuery] = useState("");
  const [unitStatusFilter, setUnitStatusFilter] = useState("all"); // 'all' | 'available' | 'unavailable'
  const [hostelSearchQuery, setHostelSearchQuery] = useState("");
  const [hostelStatusFilter, setHostelStatusFilter] = useState("all"); // 'all' | 'available' | 'full'
  const [hostelGenderFilter, setHostelGenderFilter] = useState("all");
  const [hostelModalOpen, setHostelModalOpen] = useState(false);
  const [editingHostel, setEditingHostel] = useState<Row | null>(null);

  const [roomSearchQuery, setRoomSearchQuery] = useState("");
  const [roomStatusFilter, setRoomStatusFilter] = useState("all"); // 'all' | 'available' | 'occupied'

  const toggleHostel = (id: string) => {
    setExpandedHostel((prev) => (prev === id ? null : id));
    setExpandedUnit(null);
    // 切换 Hostel 时清空 Unit 筛选条件
    setUnitSearchQuery("");
    setUnitStatusFilter("all");
  };

  const toggleUnit = (id: string) => {
    setExpandedUnit((prev) => (prev === id ? null : id));
  };

  const getInitial = (name?: string) => (name ? name.charAt(0).toUpperCase() : "?");

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

  const filteredHostels = data.hostels.filter((hostel) => {
    const query = hostelSearchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      hostel.name.toLowerCase().includes(query) ||
      hostel.address.toLowerCase().includes(query) ||
      hostel.code.toLowerCase().includes(query);
    const matchesStatus =
      hostelStatusFilter === "all" ||
      (hostelStatusFilter === "available" && hostel.vacant > 0) ||
      (hostelStatusFilter === "full" && hostel.vacant === 0);
    const gendersInHostel = new Set(
      data.units
        .filter((unit) => unit.hostelId === hostel.id)
        .map((unit) => unit.gender),
    );
    const hostelGender =
      gendersInHostel.size > 1
        ? "mixed"
        : [...gendersInHostel][0] || "mixed";
    const matchesGender =
      hostelGenderFilter === "all" || hostelGender === hostelGenderFilter;
    return matchesSearch && matchesStatus && matchesGender;
  });

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
            {/* <div className="section-heading">
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
            </div> */}
            <section className="directory-filters">
              <div className="inline-filters">
              <div className="search-input-wrapper">
                <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
                <input
                  type="text"
                  placeholder="Search property, address..."
                  value={hostelSearchQuery}
                  onChange={(e) => setHostelSearchQuery(e.target.value)}
                />
              </div>
              <select
                value={hostelStatusFilter}
                onChange={(e) => setHostelStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="available">Available</option>
                <option value="full">Full</option>
              </select>
              <select
                value={hostelGenderFilter}
                onChange={(e) => setHostelGenderFilter(e.target.value)}
              >
                <option value="all">All Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="mixed">Mixed</option>
              </select>
              </div>
            </section>
            <section className="directory-table-container">
              <div className="modern-property-table">
                <div className="mpt-header">
                  <span>Property</span>
                  <span>Units</span>
                  <span>Gender / Type</span>
                  <span>Status</span>
                  <span>Occupancy</span>
                  <span>Access / Wi-Fi</span>
                  <span>Parking</span>
                  <span>Action</span>
                </div>

                {filteredHostels.map((hostel) => {
                  const unitsInHostel = data.units.filter(u => u.hostelId === hostel.id);
                  const isHostelExpanded = expandedHostel === hostel.id;
                  const activeUnitsCount = unitsInHostel.filter(
                    (u) => u.status === "active",
                  ).length;
                  const gendersInHostel = new Set(
                    unitsInHostel.map((u) => u.gender),
                  );
                  const hostelGenderLabel =
                    gendersInHostel.size > 1
                      ? "Mixed"
                      : genderLabel([...gendersInHostel][0] || "mixed");
                  const accessCardsCount = data.accessCards.filter(
                    (c) => c.hostelName === hostel.name,
                  ).length;
                  const wifiCount = data.services.filter(
                    (s) => s.hostelName === hostel.name,
                  ).length;
                  const parkingCount = data.parkingLots.filter(
                    (p) => p.hostelId === hostel.id,
                  ).length;
                  const hostelOccupancyRate =
                    hostel.bedSpaces > 0
                      ? Math.round((hostel.occupied / hostel.bedSpaces) * 1000) / 10
                      : 0;

                  // 1. 提前处理好【过滤后的 Unit 数组】
                  const filteredUnits = unitsInHostel.filter((unit) => {
                    // 该 unit 是否至少有一个可预订的房间 (Fully/Partially Available)
                    const bedsInUnit = data.bedSpaces.filter(b => b.unitId === unit.id);
                    const hasAvailableRoom =
                      unitAvailabilitySummary(unit, bedsInUnit).availableCount > 0;

                    // 文本搜索逻辑 (搜 Unit 编号或性别)
                    const query = unitSearchQuery.toLowerCase().trim();
                    const matchesSearch = !query ||
                      unit.unitCode?.toLowerCase().includes(query) ||
                      genderLabel(unit.gender).toLowerCase().includes(query);

                    // 状态筛选逻辑
                    const matchesStatus = unitStatusFilter === "all" ||
                      (unitStatusFilter === "available" && hasAvailableRoom) ||
                      (unitStatusFilter === "unavailable" && !hasAvailableRoom);

                    return matchesSearch && matchesStatus;
                  });

                  return (
                    <React.Fragment key={hostel.id}>
                      {/* 第一层：Hostel 级别 */}
                      <div className="mpt-row hostel-row" onClick={() => toggleHostel(hostel.id)}>
                        <div className="mpt-property">
                          <span className="hostel-avatar">{hostel.code}</span>
                          <div className="info">
                            <strong>{hostel.name}</strong>
                            <span>{hostel.address}</span>
                          </div>
                        </div>
                        <div className="mpt-cell">{unitsInHostel.length} units</div>
                        <div className="mpt-cell mpt-cell-stacked">
                          <span>{hostelGenderLabel}</span>
                          <small>Unit allocation</small>
                        </div>
                        <div className="mpt-cell">
                          <span className={`status-badge ${hostel.vacant > 0 ? 'available' : 'occupied'}`}>
                            {hostel.vacant > 0 ? 'Available' : 'Full'}
                          </span>
                        </div>
                        <div className="mpt-cell mpt-cell-stacked">
                          <span>{hostelOccupancyRate}%</span>
                          <small>
                            {activeUnitsCount} active of {unitsInHostel.length}
                          </small>
                        </div>
                        <div className="mpt-cell mpt-cell-stacked">
                          <span>{accessCardsCount} cards</span>
                          <small>{wifiCount} Wi-Fi</small>
                        </div>
                        <div className="mpt-cell">
                          {parkingCount} {parkingCount === 1 ? "lot" : "lots"}
                        </div>
                        <div className="mpt-cell hostel-action-cell">
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHostel(hostel.id);
                            }}
                          >
                            {isHostelExpanded ? "Hide units" : "View units"}
                          </button>
                          <button
                            type="button"
                            className="secondary compact icon-btn"
                            aria-label="Edit property"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingHostel(hostel);
                              setHostelModalOpen(true);
                            }}
                          >
                            ⋮
                          </button>
                        </div>
                      </div>

                      {/* =========================================
                      第二层顶部：Unit 筛选栏 (Inline Filter)
                      ========================================= */}
                      {isHostelExpanded && (
                        <div className="mpt-row unit-filter-row">
                          <div className="inline-filters">
                            <div className="search-input-wrapper">
                              <svg className="search-icon" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                              </svg>
                              <input
                                type="text"
                                placeholder="Search unit code (e.g. A-1)..."
                                value={unitSearchQuery}
                                onChange={(e) => setUnitSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                            <select
                              value={unitStatusFilter}
                              onChange={(e) => setUnitStatusFilter(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="all">All Units</option>
                              <option value="available">Available Units</option>
                              <option value="unavailable">Full / Unavailable</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* 第二层：Unit 级别 (使用过滤后的 filteredUnits 进行映射) */}
                      {isHostelExpanded && filteredUnits.map((unit) => {
                        const bedsInUnit = data.bedSpaces.filter(b => b.unitId === unit.id);
                        const summary = unitAvailabilitySummary(unit, bedsInUnit);
                        const isUnitExpanded = expandedUnit === unit.id;
                        const handleUnitToggle = (e: React.MouseEvent) => {
                          e.stopPropagation();
                          toggleUnit(unit.id);
                        };

                        return (
                          <React.Fragment key={unit.id}>
                            <div className="mpt-row unit-row" onClick={handleUnitToggle}>
                              <div className="mpt-property">
                                <div className="info">
                                  <strong style={{ color: '#4b5563' }}>Unit {unit.unitCode}</strong>
                                </div>
                              </div>
                              <div className="mpt-cell">Apartment</div>
                              <div className="mpt-cell">{genderLabel(unit.gender)}</div>
                              <div className="mpt-cell">
                                <span className={`status-badge ${UNIT_STATUS_BADGE_CLASS[summary.status]}`}>
                                  {UNIT_STATUS_LABEL[summary.status]}
                                </span>
                              </div>
                              <div className="mpt-cell">-</div>
                              <div className="mpt-cell rate-cell">
                                {summary.totalRooms === 0
                                  ? "0 rooms"
                                  : `${summary.availableCount}/${summary.totalRooms} available`}
                              </div>
                            </div>

                            {/* Unit-level availability summary — visible without expanding the unit. */}
                            <div className="mpt-row unit-summary-row" onClick={handleUnitToggle}>
                              <div className="unit-summary-content">
                                <span className="unit-summary-count">
                                  {summary.totalRooms} Room{summary.totalRooms === 1 ? "" : "s"}
                                </span>
                                {summary.totalRooms > 0 && (
                                  <>
                                    <span className="unit-summary-chip available">
                                      {summary.availableCount} Available
                                    </span>
                                    <span className="unit-summary-chip occupied">
                                      {summary.occupiedCount} Occupied
                                    </span>
                                    {summary.unavailableCount > 0 && (
                                      <span className="unit-summary-chip unavailable">
                                        {summary.unavailableCount} Unavailable
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                              {summary.availableCodes.length > 0 && (
                                <div className="unit-summary-available-rooms">
                                  <span className="unit-summary-label">Available:</span>
                                  {summary.availableCodes.map((code: string) => (
                                    <span className="room-chip" key={code}>
                                      {code}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* 第三层：Room 级别 (不带过滤，直接显示该 Unit 下的所有房间) */}
                            {isUnitExpanded && bedsInUnit.map((bed) => {
                              const isAvailable = isRoomAvailable(bed);
                              const status = roomStatus(bed);
                              const statusLabel =
                                status === "available"
                                  ? "Available"
                                  : status === "occupied"
                                    ? "Occupied"
                                    : "Unavailable";

                              return (
                                <div className="mpt-row room-row" key={bed.id}>
                                  <div className="mpt-property">
                                    <div className="info">
                                      <strong>Room {bed.roomLabel}</strong>
                                      <span>{bed.legacyCode}</span>
                                    </div>
                                  </div>
                                  <div className="mpt-cell">{titleCase(bed.roomType)}</div>
                                  <div className="mpt-cell">{genderLabel(bed.gender)}</div>
                                  <div className="mpt-cell">
                                    <span className={`status-badge ${status}`}>
                                      {statusLabel}
                                    </span>
                                  </div>
                                  <div className="mpt-cell occupant-cell">
                                    {bed.occupantName ? (
                                      <>
                                        <div className="occupant-avatar">{getInitial(bed.occupantName)}</div>
                                        <span>{bed.occupantName}</span>
                                      </>
                                    ) : (
                                      <span style={{ color: '#9ca3af' }}>No occupant</span>
                                    )}
                                  </div>
                                  <div className="mpt-cell action-cell">
                                    {isAvailable ? (
                                      <button
                                        className="primary compact mpt-reserve-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openReservation(bed);
                                        }}
                                      >
                                        Reserve
                                      </button>
                                    ) : (
                                      <button className="secondary compact mpt-reserve-btn disabled" disabled>
                                        Unavailable
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}

                      {/* 当搜不到匹配的 Unit 时的空状态提示 */}
                      {isHostelExpanded && unitsInHostel.length > 0 && filteredUnits.length === 0 && (
                        <div className="mpt-row unit-row empty-result">
                          <div className="mpt-cell" style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#9ca3af', padding: '20px 0' }}>
                            No units match your filter criteria.
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </section>
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

                    const commitmentClass = isConverted
                      ? "assigned"
                      : r.inventoryCommitted
                        ? "committed"
                        : "enquiry";

                    const commitmentTitle = isConverted
                      ? `Assigned: ${r.assignedCode || "Unit confirmed"}`
                      : r.inventoryCommitted
                        ? "Included in sales balance"
                        : "Enquiry only";

                    const commitmentDescription = isConverted
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

                        {/* Quick payment and actions */}
                        {r.status === "reserved" && (
                          <div className="reservation-card-footer" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <form
                              className="reservation-quick-payment"
                              onSubmit={async (event) => {
                                event.preventDefault();

                                const form = event.currentTarget;

                                const ok = await save(
                                  {
                                    action: "reservation-payment",
                                    reservationId: r.id,
                                    ...formValues(event),
                                  },
                                  "Payment added",
                                );

                                if (ok) {
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

                                <button
                                  type="button"
                                  className="reservation-btn reservation-btn-convert"
                                  style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
                                  disabled={busy}
                                  onClick={() => setConvertReservation(r)}
                                >
                                  Convert assignment
                                </button>
                              </div>

                              <button
                                type="button"
                                className="reservation-btn reservation-btn-danger"
                                style={{ width: '100%', padding: '5px', fontSize: '11px', justifyContent: 'center' }}
                                disabled={busy}
                                onClick={() => {
                                  const confirmed = confirm(
                                    `Delete reservation ${r.referenceNo}?`,
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

            <div className="form-actions wide" style={{ marginTop: '16px' }}>
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
