"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  Empty,
  Metric,
  Modal,
  SearchSelect,
  bedTypeLabel,
  blankCharges,
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
  const sellable = Math.max(0, availability.length - committedWeight);
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
                <span>Needed on</span>
                <input
                  type="date"
                  value={availableDate}
                  onChange={(e) => setAvailableDate(e.target.value)}
                />
              </label>
              <label>
                <span>Hostel</span>
                <select
                  value={hostelFilter}
                  onChange={(e) => {
                    setHostelFilter(e.target.value);
                    setUnitFilter("all");
                    setRoomCodeFilter("all");
                  }}
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
                <span>Unit</span>
                <select
                  value={unitFilter}
                  onChange={(e) => {
                    setUnitFilter(e.target.value);
                    setRoomCodeFilter("all");
                  }}
                >
                  <option value="all">All units</option>
                  {unitOptions.map(([id, code]) => (
                    <option key={id} value={id}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Room</span>
                <select
                  value={roomCodeFilter}
                  onChange={(e) => setRoomCodeFilter(e.target.value)}
                  disabled={unitFilter === "all"}
                >
                  <option value="all">
                    {unitFilter === "all" ? "Select a unit first" : "All rooms"}
                  </option>
                  {roomOptions.map((room) => (
                    <option key={room} value={room}>
                      Room {room}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Student gender</span>
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
                <span>Room category</span>
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
                <span>Room type</span>
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
                <span>Bathroom</span>
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
          <option value="group">Whole unit</option>
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
