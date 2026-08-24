"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  CourseOptions,
  DEPOSIT_MONTHS,
  Empty,
  MALAYSIAN_STATES,
  RESERVATION_BREAKDOWN_CHARGE_TYPES,
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
  depositFor,
  formatIC,
  formValues,
  genderLabel,
  linkAttachment,
  money,
  renameAttachment,
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
  const [changeRoomReservation, setChangeRoomReservation] =
    useState<Row | null>(null);
  const [manageReservation, setManageReservation] = useState<Row | null>(
    null,
  );
  const [chargeOpen, setChargeOpen] = useState(false);
  const [charges, setCharges] = useState<Record<string, number>>(blankCharges);
  const [reservationKind, setReservationKind] = useState("individual");
  const [reservationQuery, setReservationQuery] = useState("");
  const [reservationHostelFilter, setReservationHostelFilter] = useState("all");
  const [reservationStatusTab, setReservationStatusTab] = useState<
    "all" | "reserved" | "converted" | "cancelled"
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
  const canUseOccupancy = Boolean(permissionFor("hostels-occupancy"));
  const allowedHostelTabs: HostelTab[] = [
    ...(canUseSales ? (["availability", "reservations"] as HostelTab[]) : []),
    ...(canUseSales ? (["pricing"] as HostelTab[]) : []),
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
    all: data.reservations.length,
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
  // Temporary room changes (Change room's optional "expected return date")
  // land here once that date has arrived, so staff can confirm whether the
  // student actually moved back or the room change became permanent.
  const pendingRoomReturns = convertedReservations.filter(
    (r) => r.expectedReturnDate && r.expectedReturnDate <= today,
  );
  const filteredReservations = data.reservations.filter((reservation) => {
    const search = reservationQuery.trim().toLowerCase();
    const matchesPayment =
      reservationStatusTab !== "converted" ||
      reservationPaymentFilter === "all" ||
      (reservation.paymentStatus || "unpaid") === reservationPaymentFilter;
    return (
      (reservationStatusTab === "all" ||
        reservation.status === reservationStatusTab) &&
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
  >("all");
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

  const isAllHostelsAvailability = activeAvailabilityHostel === "all";
  const activeAvailabilityGroup = bedsByHostel.find(
    (group) => group.hostel.code === activeAvailabilityHostel,
  );
  // "All" flattens every hostel's beds into one combined list rather than
  // picking a single group — everything downstream (category breakdown,
  // the unit table) works off this instead of activeAvailabilityGroup.beds.
  const activeAvailabilityBeds = useMemo(
    () =>
      isAllHostelsAvailability
        ? bedsByHostel.flatMap((group) => group.beds)
        : (activeAvailabilityGroup?.beds ?? []),
    [isAllHostelsAvailability, bedsByHostel, activeAvailabilityGroup],
  );

  // Rooms grouped by unit so the table shows one row per unit — each
  // room becomes a colored chip instead of its own row.
  const unitsInActiveGroup = useMemo(() => {
    if (!activeAvailabilityBeds.length) return [];
    const map = new Map<
      number,
      { unit: Row; beds: Row[]; hostelName: string }
    >();
    for (const bed of activeAvailabilityBeds) {
      const unit = data.units.find((u) => u.id === bed.unitId);
      if (!unit) continue;
      if (!map.has(unit.id))
        map.set(unit.id, { unit, beds: [], hostelName: bed.hostelName || "" });
      map.get(unit.id)!.beds.push(bed);
    }
    return [...map.values()].sort((a, b) =>
      a.unit.unitCode.localeCompare(b.unit.unitCode, undefined, {
        numeric: true,
      }),
    );
  }, [activeAvailabilityBeds, data.units]);

  // Quick per-category vacancy count for the selected hostel — how many
  // Room A/B/C/D are still available right now, split by gender so staff
  // can see male vs female availability at a glance.
  const categoryAvailability = useMemo(() => {
    if (!activeAvailabilityBeds.length) return [];
    const counts = new Map<
      string,
      { total: number; male: number; female: number; other: number }
    >();
    for (const bed of activeAvailabilityBeds) {
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
  }, [activeAvailabilityBeds]);

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
          {canUseSales && (
            <button
              className={currentHostelTab === "pricing" ? "active" : ""}
              onClick={() => setTab("pricing")}
            >
              Room pricing & rates
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
                <button
                  className={isAllHostelsAvailability ? "active" : ""}
                  onClick={() => setActiveAvailabilityHostel("all")}
                >
                  All (
                  {bedsByHostel.reduce(
                    (sum, group) => sum + group.beds.length,
                    0,
                  )}
                  )
                </button>
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

            {(activeAvailabilityGroup || isAllHostelsAvailability) && (
              <section className="directory-table-container">
                <div className="section-heading">
                  <div>
                    <small>HOSTEL</small>
                    <h3>
                      {isAllHostelsAvailability
                        ? "All hostels"
                        : activeAvailabilityGroup!.hostel.name}
                    </h3>
                    <p>
                      {isAllHostelsAvailability
                        ? "Every property combined."
                        : activeAvailabilityGroup!.hostel.address}
                    </p>
                  </div>
                  <span>
                    {activeAvailabilityBeds.length} room
                    {activeAvailabilityBeds.length === 1 ? "" : "s"}
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
                        {isAllHostelsAvailability && <th>Hostel</th>}
                        <th>Unit</th>
                        <th>Gender</th>
                        <th>Rooms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitsInActiveGroup.map(
                        ({ unit, beds: unitBeds, hostelName }) => (
                        <tr key={unit.id}>
                          {isAllHostelsAvailability && <td>{hostelName}</td>}
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
                          <td colSpan={isAllHostelsAvailability ? 4 : 3}>
                            <em>No rooms match this view.</em>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {!activeAvailabilityGroup &&
              !isAllHostelsAvailability &&
              bedsByHostel.length > 0 && (
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
                className={reservationStatusTab === "all" ? "active" : ""}
                onClick={() => setReservationStatusTab("all")}
              >
                All ({reservationCounts.all})
              </button>
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
                {pendingRoomReturns.length > 0 && (
                  <span>{pendingRoomReturns.length}</span>
                )}
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

            {reservationStatusTab === "converted" &&
              pendingRoomReturns.length > 0 && (
                <section
                  className="panel"
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <strong style={{ fontSize: '13px', color: '#92400e' }}>
                    {pendingRoomReturns.length} temporary room{" "}
                    {pendingRoomReturns.length === 1 ? "change needs" : "changes need"}{" "}
                    a decision
                  </strong>
                  {pendingRoomReturns.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        fontSize: '13px',
                      }}
                    >
                      <span>
                        <strong>{r.studentName}</strong> · {r.assignedCode} ·
                        expected back {dateLabel(r.expectedReturnDate)}
                      </span>
                      <span style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => setChangeRoomReservation(r)}
                        >
                          Moved back
                        </button>
                        <button
                          type="button"
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            save(
                              {
                                action: "assignment-clear-return-date",
                                assignmentId: r.assignmentId,
                              },
                              "Room change confirmed as permanent",
                            )
                          }
                        >
                          Staying
                        </button>
                      </span>
                    </div>
                  ))}
                </section>
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

              {reservationStatusTab === "converted" && (
                <label className="reservation-field">
                  <span>Payment status</span>

                  <div className="reservation-input-control">
                    <select
                      value={reservationPaymentFilter}
                      onChange={(event) =>
                        setReservationPaymentFilter(
                          event.target.value as typeof reservationPaymentFilter,
                        )
                      }
                    >
                      <option value="all">
                        All ({convertedPaymentCounts.all})
                      </option>
                      <option value="partial">
                        Partial ({convertedPaymentCounts.partial})
                      </option>
                      <option value="unpaid">
                        Unpaid ({convertedPaymentCounts.unpaid})
                      </option>
                      <option value="admin-fee">
                        Admin fee ({convertedPaymentCounts["admin-fee"]})
                      </option>
                      <option value="full">
                        Full payment ({convertedPaymentCounts.full})
                      </option>
                    </select>
                  </div>
                </label>
              )}
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
                    // A room change can leave the student having paid more
                    // than the new room costs (e.g. they moved to a cheaper
                    // room) — surfaced separately rather than folded into
                    // balanceRequired, which stays clamped at 0.
                    const creditBalance = Math.max(
                      totalPaid - totalPayable,
                      0,
                    );

                    const paymentStatusClass = String(
                      r.paymentStatus || "unpaid",
                    )
                      .toLowerCase()
                      .replace(/\s+/g, "-");

                    const paymentStatusLabel =
                      r.paymentStatus === "admin-fee"
                        ? "Admin fee"
                        : titleCase(r.paymentStatus || "unpaid");

                    const commitmentTitle = isCancelled
                      ? "Cancelled"
                      : isConverted
                        ? `Assigned: ${r.assignedCode || "Unit confirmed"}`
                        : r.inventoryCommitted
                          ? "Included in sales balance"
                          : "Enquiry only";

                    return (
                      <article
                        key={r.id}
                        className={`reservation-card ${isConverted ? "is-converted" : ""}`}
                        style={{
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px'
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

                        {/* Room + money — one compact line each, everything
                            else (preferences, payment history, quick-add
                            payment, Edit/Cancel/Delete) lives behind Manage
                            so the card stays scannable at a glance. */}
                        <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
                          {commitmentTitle}
                        </p>
                        <p style={{ margin: 0, fontSize: '13px' }}>
                          Payable <strong>{money(totalPayable)}</strong> · Paid{" "}
                          <strong>{money(totalPaid)}</strong> ·{" "}
                          {creditBalance > 0 ? (
                            <strong style={{ color: '#166534' }}>
                              Credit {money(creditBalance)}
                            </strong>
                          ) : (
                            <strong
                              style={{
                                color: balanceRequired > 0 ? '#b91c1c' : '#166534',
                              }}
                            >
                              {balanceRequired > 0
                                ? `Owes ${money(balanceRequired)}`
                                : "Settled"}
                            </strong>
                          )}
                        </p>

                        {(r.status === "reserved" ||
                          r.status === "converted") && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
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

                            {r.status === "converted" &&
                              r.reservationType !== "group" && (
                                <button
                                  type="button"
                                  className="reservation-btn reservation-btn-convert"
                                  style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
                                  disabled={busy}
                                  onClick={() => setChangeRoomReservation(r)}
                                >
                                  Change room
                                </button>
                              )}

                            <button
                              type="button"
                              className="reservation-btn reservation-btn-secondary"
                              style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
                              disabled={busy}
                              onClick={() => setManageReservation(r)}
                            >
                              Manage
                            </button>
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

                {/* Room transfer fee */}
                <section
                  className="pricing-card"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: '16px',
                    flexWrap: 'wrap',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <small style={{ fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', fontSize: '11px' }}>
                      Room transfer fee
                    </small>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#4b5563' }}>
                      Default amount offered when changing a converted
                      reservation&apos;s room. Staff can still waive it or
                      edit the amount per case.
                    </p>
                  </div>
                  <form
                    style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      await save(
                        {
                          action: "system-setting-update",
                          settingKey: "room-transfer-fee",
                          ...formValues(event),
                        },
                        "Room transfer fee updated",
                      );
                    }}
                  >
                    <label>
                      Amount (RM)
                      <input
                        name="settingValue"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={data.settings.roomTransferFee}
                        style={{ width: '140px' }}
                      />
                    </label>
                    <button className="secondary compact" disabled={busy}>
                      Save
                    </button>
                  </form>
                </section>

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
            {RESERVATION_BREAKDOWN_CHARGE_TYPES.map((key) => (
              <label key={key}>
                {chargeLabels[key]}
                <input
                  type="number"
                  min="0"
                  value={charges[key] || ""}
                  onChange={(e) => {
                    const amount = Number(e.target.value || 0);
                    setCharges((current) => ({
                      ...current,
                      [key]: amount,
                      // Deposit is defined as a multiple of the agreed rent,
                      // so it follows the rent here too instead of leaving a
                      // stale figure from the previous rate behind.
                      ...(key === "first-month-rental"
                        ? { deposit: depositFor(amount) }
                        : {}),
                    }));
                  }}
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
      {changeRoomReservation && (
        <Modal
          title="Change room"
          kicker="CONVERTED RESERVATION"
          description="Move this reservation to a different room. The old room becomes vacant and any difference from what's already been paid is worked out automatically."
          onClose={() => setChangeRoomReservation(null)}
        >
          <ChangeRoomForm
            data={data}
            save={save}
            busy={busy}
            reservation={changeRoomReservation}
            onDone={() => setChangeRoomReservation(null)}
          />
        </Modal>
      )}
      {manageReservation && (
        <Modal
          title={manageReservation.studentName}
          kicker={manageReservation.referenceNo}
          description="Payment history, preferences and the less-common actions for this reservation."
          onClose={() => setManageReservation(null)}
          wide
        >
          <ReservationManageDetails
            data={data}
            save={save}
            busy={busy}
            load={load}
            reservation={manageReservation}
            onEditReservation={() => {
              setManageReservation(null);
              openReservation(null, manageReservation);
            }}
            onDone={() => setManageReservation(null)}
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
  const [block, setBlock] = useState("");
  const [roomType, setRoomType] = useState("any");
  const [bedSpaceId, setBedSpaceId] = useState(
    String(convertReservation.provisionalBedSpaceId || ""),
  );
  // Same narrowing as the Change room picker: hostel, then room type, then
  // block, and only rooms matching the student's gender are ever offered.
  const genderFits = (bed: Row) =>
    ["unspecified", "mixed"].includes(convertReservation.preferredGender) ||
    convertReservation.preferredGender === bed.gender;
  const hostelBeds = data.bedSpaces.filter(
    (bed) =>
      bed.status === "vacant" &&
      (!hostelId || String(bed.hostelId) === hostelId) &&
      genderFits(bed),
  );
  const blockOptions = [
    ...new Set(hostelBeds.map((bed) => blockOf(bed.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const vacantBeds = hostelBeds.filter(
    (bed) =>
      (!block || blockOf(bed.unitCode) === block) &&
      (roomType === "any" || bed.roomType === roomType),
  );
  // A reservation almost always converts into the exact room it already
  // holds — only special cases (the room got taken, or the student wants a
  // different one) need the hostel-then-room picker at all.
  const reservedBed = data.bedSpaces.find(
    (bed) => bed.id === convertReservation.provisionalBedSpaceId,
  );
  // Judge the reserved room on the same terms it was booked under. The
  // reservation form offers rooms that are vacant OR that free up by the
  // check-in date (the outgoing tenant's agreement has ended), so demanding
  // "vacant right now" here would drop staff into the room picker for a
  // room this reservation already holds — the room stays the default.
  const reservedBedAvailable = Boolean(
    reservedBed &&
      (reservedBed.status === "vacant" ||
        (reservedBed.availableFrom &&
          reservedBed.availableFrom <= convertReservation.targetMoveInDate)),
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
                  {reservedBed!.hostelName} · {reservedBed!.legacyCode}
                </strong>
              )}
            </div>
            {/* Held on an upcoming vacancy: the outgoing tenant's agreement
                has ended but nobody has checked them out, so flag it rather
                than let it look like a clash. */}
            {convertReservation.reservationType !== "group" &&
              reservedBed!.status !== "vacant" && (
                <small style={{ color: '#92400e', fontWeight: 600 }}>
                  Frees up {dateLabel(reservedBed!.availableFrom)} — the
                  previous tenant still needs checking out.
                </small>
              )}
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
          {/* Normally the reserved room is shown ready to confirm. Landing
              here without the staff pressing "Change room" means that room
              is gone, so say which one and why rather than silently
              presenting an empty picker. */}
          {reservedBed && !reservedBedAvailable && (
            <div
              className="wide"
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '13px',
                color: '#991b1b',
              }}
            >
              The reserved room <strong>{reservedBed.legacyCode}</strong> is no
              longer available ({titleCase(reservedBed.status)}) — choose
              another room below.
            </div>
          )}
          <label>
            Hostel
            <select
              required
              value={hostelId}
              onChange={(event) => {
                setHostelId(event.target.value);
                setBlock("");
                setRoomType("any");
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
              Block
              <select
                value={block}
                disabled={!hostelId}
                onChange={(event) => {
                  setBlock(event.target.value);
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
          <label className="wide">
            Actual room code {hostelId && `— ${vacantBeds.length} available`}
            <select
              name="bedSpaceId"
              required
              disabled={!hostelId}
              value={bedSpaceId}
              onChange={(event) => setBedSpaceId(event.target.value)}
            >
              <option value="">
                {!hostelId
                  ? "Select a hostel first"
                  : vacantBeds.length
                    ? "Select an available room"
                    : "No free rooms match these choices"}
              </option>
              {vacantBeds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.legacyCode}
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

// A fresh instance mounts every time the "Change room" modal opens (the
// caller only renders it while changeRoomReservation is set). Monthly
// rental / access card deposit auto-fill from the newly picked room's own
// rates the same way reservation-convert does server-side, except this
// needs to happen client-side so the paid-vs-new-total delta can be
// previewed live before the staff member confirms.
function ChangeRoomForm({
  data,
  save,
  busy,
  reservation,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  reservation: Row;
  onDone: () => void;
}) {
  const currentBed = data.bedSpaces.find(
    (bed: Row) => bed.id === reservation.assignedBedSpaceId,
  );
  const [hostelId, setHostelId] = useState(
    String(currentBed?.hostelId || reservation.preferredHostelId || ""),
  );
  const [block, setBlock] = useState("");
  const [roomType, setRoomType] = useState("any");
  const [bedSpaceId, setBedSpaceId] = useState("");
  const genderFits = (bed: Row) =>
    ["unspecified", "mixed"].includes(reservation.preferredGender) ||
    reservation.preferredGender === bed.gender;
  const hostelBeds = data.bedSpaces.filter(
    (bed: Row) =>
      bed.status === "vacant" &&
      (!hostelId || String(bed.hostelId) === hostelId) &&
      genderFits(bed),
  );
  const blockOptions = [
    ...new Set(hostelBeds.map((bed: Row) => blockOf(bed.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const vacantBeds = hostelBeds.filter(
    (bed: Row) =>
      (!block || blockOf(bed.unitCode) === block) &&
      (roomType === "any" || bed.roomType === roomType),
  );
  const today = new Date().toISOString().slice(0, 10);
  const effectiveRate = (bed: Row) =>
    bed.promotionRate !== null &&
    bed.promotionRate !== undefined &&
    (!bed.promotionStartDate || bed.promotionStartDate <= today) &&
    (!bed.promotionEndDate || bed.promotionEndDate >= today)
      ? bed.promotionRate
      : bed.currentRental;
  const charges: Row[] = reservation.charges || [];
  // Sums every row of the type, not just the first — a charge the student
  // part-paid before a room change is stored as a paid row plus a top-up
  // row, and the agreed figure is the two together.
  const chargeAmount = (type: string) =>
    charges
      .filter((c) => c.chargeType === type)
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const otherChargesTotal = charges
    .filter(
      (c) =>
        !["first-month-rental", "deposit", "access-card-deposit"].includes(
          c.chargeType,
        ),
    )
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  // Captured once and never mutated, purely so the "what's changing" list
  // below can compare against the room this reservation is leaving.
  const originalMonthlyRental = chargeAmount("first-month-rental");
  const originalSecurityDeposit = chargeAmount("deposit");
  const originalAccessCardDeposit = chargeAmount("access-card-deposit");
  const [monthlyRental, setMonthlyRental] = useState(originalMonthlyRental);
  const [securityDeposit, setSecurityDeposit] = useState(
    originalSecurityDeposit,
  );
  // The deposit is rent × DEPOSIT_MONTHS by default and follows the rent
  // automatically, so staff never retype it for an ordinary room change.
  // Touching the deposit field flips this and stops the auto-recalculation,
  // which is the escape hatch for a one-off agreed amount.
  const [depositOverridden, setDepositOverridden] = useState(false);
  const applyMonthlyRental = (amount: number) => {
    setMonthlyRental(amount);
    if (!depositOverridden) setSecurityDeposit(depositFor(amount));
  };
  const [accessCardDeposit, setAccessCardDeposit] = useState(
    originalAccessCardDeposit,
  );
  const [chargeTransferFee, setChargeTransferFee] = useState(false);
  const [roomTransferFee, setRoomTransferFee] = useState(
    data.settings.roomTransferFee,
  );
  const newTotalPayable =
    otherChargesTotal +
    Number(monthlyRental || 0) +
    Number(securityDeposit || 0) +
    Number(accessCardDeposit || 0) +
    (chargeTransferFee ? Number(roomTransferFee || 0) : 0);
  const amountPaid = Number(reservation.amountPaid || 0);
  const delta = amountPaid - newTotalPayable;
  const priceChanges = [
    { label: "Room rent", from: originalMonthlyRental, to: monthlyRental },
    { label: "Deposit", from: originalSecurityDeposit, to: securityDeposit },
    {
      label: "Access card deposit",
      from: originalAccessCardDeposit,
      to: accessCardDeposit,
    },
    // A transfer fee is a brand-new charge rather than a changed one, so it
    // has no "from" — but it still moves what the student owes, and leaving
    // it out would make the totals below not add up.
    ...(chargeTransferFee
      ? [{ label: "Room transfer fee", from: 0, to: Number(roomTransferFee || 0) }]
      : []),
  ].filter((row) => row.from !== row.to);
  const netPriceChange = priceChanges.reduce(
    (sum, row) => sum + (row.to - row.from),
    0,
  );
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          {
            action: "reservation-room-change",
            reservationId: reservation.id,
            ...formValues(e),
            roomTransferFee: chargeTransferFee ? roomTransferFee : 0,
          },
          "Room changed",
        );
        if (ok) onDone();
      }}
    >
      <div
        className="wide"
        style={{
          background: '#f9fafb',
          padding: '16px',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          marginBottom: '8px',
          fontSize: '14px',
          color: '#4b5563',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span>Current room:</span>
          <strong style={{ color: '#111827' }}>
            {reservation.assignedCode || "Not set"}
          </strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Already paid:</span>
          <strong style={{ color: '#111827' }}>{money(amountPaid)}</strong>
        </div>
      </div>

      <label>
        Hostel
        <select
          required
          value={hostelId}
          onChange={(event) => {
            setHostelId(event.target.value);
            setBlock("");
            setRoomType("any");
            setBedSpaceId("");
          }}
        >
          <option value="">Select hostel</option>
          {data.hostels.map((hostel: Row) => (
            <option key={hostel.id} value={hostel.id}>
              {hostel.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Room type
        <select
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
          Block
          <select
            value={block}
            disabled={!hostelId}
            onChange={(event) => {
              setBlock(event.target.value);
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
      <label className="wide">
        New room code {hostelId && `— ${vacantBeds.length} available`}
        <select
          name="bedSpaceId"
          required
          disabled={!hostelId}
          value={bedSpaceId}
          onChange={(event) => {
            setBedSpaceId(event.target.value);
            const bed = data.bedSpaces.find(
              (b: Row) => String(b.id) === event.target.value,
            );
            if (!bed) return;
            applyMonthlyRental(Number(effectiveRate(bed) || 0));
            if (bed.legacyAccessCardDeposit !== null && bed.legacyAccessCardDeposit !== undefined)
              setAccessCardDeposit(Number(bed.legacyAccessCardDeposit));
          }}
        >
          <option value="">
            {!hostelId
              ? "Select a hostel first"
              : vacantBeds.length
                ? "Select an available room"
                : "No free rooms match these choices"}
          </option>
          {vacantBeds.map((bed: Row) => (
            <option key={bed.id} value={bed.id}>
              {bed.legacyCode}
            </option>
          ))}
        </select>
      </label>

      <label>
        New monthly rental
        <input
          name="monthlyRental"
          type="number"
          min="0"
          step="0.01"
          value={monthlyRental}
          onChange={(event) => applyMonthlyRental(Number(event.target.value))}
        />
      </label>
      <label>
        New security deposit
        <input
          name="securityDeposit"
          type="number"
          min="0"
          step="0.01"
          value={securityDeposit}
          onChange={(event) => {
            setDepositOverridden(true);
            setSecurityDeposit(Number(event.target.value));
          }}
        />
        <small style={{ fontWeight: 400, color: '#6b7280' }}>
          {depositOverridden ? (
            <>
              Manually set — no longer following the rent.{" "}
              <button
                type="button"
                className="reservation-btn reservation-btn-secondary"
                style={{ padding: '1px 6px', fontSize: '11px', minHeight: 'unset', borderRadius: '4px' }}
                onClick={() => {
                  setDepositOverridden(false);
                  setSecurityDeposit(depositFor(monthlyRental));
                }}
              >
                Reset to {DEPOSIT_MONTHS}× rent
              </button>
            </>
          ) : (
            `Automatically ${DEPOSIT_MONTHS}× the monthly rental. Edit only for a specially agreed amount.`
          )}
        </small>
      </label>
      <label>
        New access card deposit
        <input
          name="accessCardDeposit"
          type="number"
          min="0"
          step="0.01"
          value={accessCardDeposit}
          onChange={(event) => setAccessCardDeposit(Number(event.target.value))}
        />
      </label>
      {bedSpaceId && priceChanges.length > 0 && (
        <div
          className="wide"
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '13px',
            color: '#4b5563',
          }}
        >
          <strong style={{ display: 'block', marginBottom: '6px', color: '#92400e' }}>
            What changes with this room
          </strong>
          {priceChanges.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}
            >
              <span>{row.label}</span>
              <span>
                {money(row.from)} → <strong>{money(row.to)}</strong>{" "}
                <span style={{ color: row.to > row.from ? '#991b1b' : '#166534' }}>
                  ({row.to > row.from ? "+" : ""}
                  {money(row.to - row.from)})
                </span>
              </span>
            </div>
          ))}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid #fde68a',
              marginTop: '6px',
              paddingTop: '6px',
              fontWeight: 700,
            }}
          >
            <span>Total payable change</span>
            <span style={{ color: netPriceChange > 0 ? '#991b1b' : '#166534' }}>
              {netPriceChange > 0 ? "+" : ""}
              {money(netPriceChange)}
            </span>
          </div>
        </div>
      )}

      <label
        className="wide"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexDirection: 'row',
        }}
      >
        <input
          type="checkbox"
          checked={chargeTransferFee}
          onChange={(event) => setChargeTransferFee(event.target.checked)}
          style={{ width: 'auto' }}
        />
        Charge a room transfer fee for this move
      </label>
      {chargeTransferFee && (
        <label>
          Room transfer fee
          <input
            name="roomTransferFeeAmount"
            type="number"
            min="0"
            step="0.01"
            value={roomTransferFee}
            onChange={(event) => setRoomTransferFee(Number(event.target.value))}
          />
        </label>
      )}

      <label className="wide">
        Expected return date (optional)
        <input name="expectedReturnDate" type="date" />
        <small style={{ fontWeight: 400, color: '#6b7280' }}>
          Only fill this in for a temporary move (e.g. a maintenance issue in
          their usual room). Leave blank for a permanent room change — a
          date here flags this room for a follow-up check once it arrives.
        </small>
      </label>

      <div
        className="wide"
        style={{
          borderRadius: '8px',
          padding: '14px 16px',
          fontSize: '14px',
          fontWeight: 600,
          background:
            delta > 0 ? '#f0fdf4' : delta < 0 ? '#fef2f2' : '#f9fafb',
          border: `1px solid ${delta > 0 ? '#bbf7d0' : delta < 0 ? '#fecaca' : '#e5e7eb'}`,
          color: delta > 0 ? '#166534' : delta < 0 ? '#991b1b' : '#374151',
        }}
      >
        {delta > 0
          ? `Credit: ${money(delta)} already paid in excess of the new room's total (${money(newTotalPayable)})`
          : delta < 0
            ? `Balance required: ${money(-delta)} more needed to cover the new room's total (${money(newTotalPayable)})`
            : `No change — already paid matches the new room's total (${money(newTotalPayable)})`}
      </div>

      <div className="form-actions wide" style={{ marginTop: '8px' }}>
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          Confirm room change
        </button>
      </div>
    </form>
  );
}

// The "Manage" modal for one reservation card — everything that isn't the
// primary at-a-glance info (name, room, money, primary action) lives here:
// preferences, the fuller status description, payment history, the
// quick-add-payment form, and Edit reservation / Cancel / Delete. A fresh
// instance mounts each time the modal opens, same pattern as the other
// per-reservation forms in this file.
function ReservationManageDetails({
  data,
  save,
  busy,
  load,
  reservation: r,
  onEditReservation,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
  reservation: Row;
  onEditReservation: () => void;
  onDone: () => void;
}) {
  const isConverted = r.status === "converted";
  const isCancelled = r.status === "cancelled";
  const totalPayable = Number(r.totalPayable || 0);
  const totalPaid = Number(r.amountPaid || 0);
  const balanceRequired = Math.max(totalPayable - totalPaid, 0);
  const [selectedChargeIds, setSelectedChargeIds] = useState<number[]>([]);
  const selectedChargesTotal = (r.charges || [])
    .filter((charge: Row) => selectedChargeIds.includes(charge.id))
    .reduce((sum: number, charge: Row) => sum + Number(charge.amount || 0), 0);
  const creditBalance = Math.max(totalPaid - totalPayable, 0);
  const preferredUnitCode = r.preferredUnitId
    ? data.units.find((unit: Row) => unit.id === r.preferredUnitId)?.unitCode
    : null;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Preferences */}
      <div className="reservation-preferences" style={{ gap: '6px' }}>
        <span className="reservation-chip">
          {r.preferredHostelName || "Hostel not selected"}
        </span>
        {preferredUnitCode && (
          <span className="reservation-chip">Unit {preferredUnitCode}</span>
        )}
        <span className="reservation-chip">
          {genderLabel(r.preferredGender)} student
        </span>
        <span className="reservation-chip">
          {r.roomCategory === "any" ? "Any category" : `Room ${r.roomCategory}`}
        </span>
        <span className="reservation-chip">
          {r.roomType === "any" ? "Any room type" : titleCase(r.roomType)}
        </span>
      </div>

      {/* Reservation state */}
      <div
        className={`reservation-commitment ${commitmentClass}`}
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
          textAlign: 'center',
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
            className={balanceRequired > 0 ? "outstanding" : "settled"}
          >
            {money(balanceRequired)}
          </strong>
        </div>
      </div>

      {creditBalance > 0 && (
        <div
          className="reservation-credit-note"
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#166534',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '6px',
            padding: '6px 10px',
          }}
        >
          Credit: {money(creditBalance)} paid in excess (e.g. after moving to a cheaper room)
        </div>
      )}

      {/* Payment history */}
      <section className="reservation-payment-history">
        <div className="reservation-subheading" style={{ marginBottom: '8px' }}>
          <span>Payment history</span>
          <span>
            {(r.payments || []).length}{" "}
            {(r.payments || []).length === 1 ? "payment" : "payments"}
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
                  backgroundColor: '#fafafa',
                }}
              >
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
                      (attachment: Row) =>
                        attachment.contextType === "payment-proof" &&
                        attachment.recordId === payment.id,
                    )
                    .map((attachment: Row) => (
                      <span key={attachment.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <a
                          href={`/api/files?id=${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: '12px', color: '#008861', fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          {attachment.fileName || "View payment slip"}
                        </a>
                        <button
                          type="button"
                          className="reservation-btn reservation-btn-secondary"
                          style={{ padding: '1px 6px', fontSize: '11px', minHeight: 'unset', borderRadius: '4px' }}
                          disabled={busy}
                          onClick={async () => {
                            const newName = prompt(
                              "Rename this payment slip:",
                              attachment.fileName,
                            );
                            if (newName && newName.trim()) {
                              await renameAttachment(attachment.id, newName.trim());
                              await load();
                            }
                          }}
                        >
                          Rename
                        </button>
                      </span>
                    ))}
                </div>
                <div
                  className="reservation-payment-actions"
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    borderTop: '1px dashed #e5e7eb',
                    paddingTop: '8px',
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
                          "Payment amount updated",
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
                          "Payment deleted",
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

      {/* Quick payment — hidden once fully paid, since there's nothing left
          to collect. */}
      {(r.status === "reserved" || r.status === "converted") &&
        r.paymentStatus !== "full" && (
          <form
            className="reservation-quick-payment"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              if (!selectedChargeIds.length) {
                window.alert("Select at least one charge to record this payment for.");
                return;
              }
              const chargeLabelsSelected = (r.charges || [])
                .filter((charge: Row) => selectedChargeIds.includes(charge.id))
                .map((charge: Row) => chargeLabels[charge.chargeType] || charge.chargeType);
              const proofLabel = (
                (form.elements.namedItem("paymentProofLabel") as HTMLInputElement)
                  ?.value || ""
              ).trim();
              const result = await save(
                {
                  action: "reservation-payment",
                  reservationId: r.id,
                  chargeIds: selectedChargeIds,
                  ...formValues(event),
                  paymentNotes: chargeLabelsSelected.join(", "),
                },
                "Payment added",
              );
              if (result) {
                const file = (
                  form.elements.namedItem("paymentProof") as HTMLInputElement
                ).files?.[0];
                if (file && result.id) {
                  const uploaded = await uploadAttachment(
                    file,
                    "payment-proof",
                    result.id,
                    data.currentUser?.displayName,
                    proofLabel ||
                      (chargeLabelsSelected.length
                        ? `${chargeLabelsSelected.join(" + ")} — ${r.studentName}`
                        : undefined),
                  );
                  if (uploaded.id && result.linkedPaymentId) {
                    await linkAttachment(
                      uploaded.id,
                      "payment-proof",
                      result.linkedPaymentId,
                      data.currentUser?.displayName,
                    );
                  }
                  await load();
                }
                form.reset();
                setSelectedChargeIds([]);
              }
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            {(r.charges || []).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
                  Charges covered by this payment
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '8px', backgroundColor: '#fff' }}>
                  {(r.charges || []).map((charge: Row) => {
                    const isPaid = Boolean(charge.paidAt);
                    return (
                      <label
                        key={charge.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', opacity: isPaid ? 0.6 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={isPaid || selectedChargeIds.includes(charge.id)}
                          disabled={isPaid || busy}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            setSelectedChargeIds(
                              checked
                                ? [...selectedChargeIds, charge.id]
                                : selectedChargeIds.filter((id) => id !== charge.id),
                            );
                          }}
                        />
                        <span style={{ flex: 1 }}>
                          {chargeLabels[charge.chargeType] || charge.chargeType}
                          {charge.notes && (
                            <em
                              style={{
                                color: '#92400e',
                                fontStyle: 'normal',
                                fontSize: '10px',
                                fontWeight: 700,
                                marginLeft: '6px',
                                textTransform: 'uppercase',
                              }}
                            >
                              {charge.notes}
                            </em>
                          )}
                        </span>
                        <strong>{money(charge.amount)}</strong>
                        {isPaid && (
                          <span style={{ color: '#166534', fontWeight: 700, fontSize: '11px' }}>
                            ✓ Paid
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                {selectedChargesTotal > 0 && (
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    Amount for this payment: <strong>{money(selectedChargesTotal)}</strong>
                  </span>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '12px', color: '#6b7280' }}>
                No charges recorded for this reservation yet — edit the
                reservation to add charges before recording a payment.
              </p>
            )}
            <label className="reservation-reference-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payment reference</span>
              <input
                name="paymentReference"
                placeholder="Receipt number, bank reference..."
                disabled={busy}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payment slip</span>
              <input
                name="paymentProof"
                type="file"
                accept="image/*,.pdf"
                required
                disabled={busy}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>Payslip name (optional)</span>
              <input
                name="paymentProofLabel"
                placeholder="e.g. Deposit + Admin fee receipt"
                disabled={busy}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}
              />
            </label>
            <button
              type="submit"
              className="reservation-btn reservation-btn-add-payment"
              disabled={busy || !selectedChargeIds.length}
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
        )}

      {/* Edit / Cancel / Delete */}
      <div className="reservation-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '2px', borderTop: '1px solid #e5e7eb' }}>
        <div className="reservation-main-actions" style={{ display: 'flex', gap: '6px', width: '100%' }}>
          <button
            type="button"
            className="reservation-btn reservation-btn-secondary"
            style={{ flex: 1, padding: '6px 4px', fontSize: '11px', justifyContent: 'center' }}
            disabled={busy}
            onClick={onEditReservation}
          >
            Edit reservation
          </button>
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
                    { action: "reservation-cancel", reservationId: r.id },
                    "Reservation cancelled",
                  );
                  onDone();
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
                  { action: "reservation-delete", reservationId: r.id },
                  "Reservation deleted",
                );
                onDone();
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
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
          deposit: depositFor(standardRate),
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
          Date of birth
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={editingReservation?.dateOfBirth || ""}
          />
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
        <label>
          School
          <select name="school" defaultValue={editingReservation?.school || ""}>
            <option value="">Not set</option>
            {data.schools.map((school: Row) => (
              <option key={school.id} value={school.name}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Course enrolled
          <select name="course" defaultValue={editingReservation?.course || ""}>
            <CourseOptions
              courses={data.courses}
              current={editingReservation?.course}
            />
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
                    {bed.legacyCode}
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
        {/* No payment status or initial-payment field here on purpose: this
            step only agrees what the student will owe. Money is recorded
            afterwards from the reservation's Manage screen, by ticking the
            charges a payment covers and attaching its slip — that flow is
            what marks charges paid and drives the status. */}
        <p
          className="wide"
          style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}
        >
          Payment is recorded after the reservation is saved — open{" "}
          <strong>Manage</strong> on the reservation and tick the charges the
          payment covers.
        </p>
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

