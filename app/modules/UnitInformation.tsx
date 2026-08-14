"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  Modal,
  ParkingRentalForm,
  Stat,
  dateLabel,
  formValues,
  genderLabel,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";


function directoryInitials(value: unknown) {
  const parts = String(value || "Property")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "PR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function unitInitials(value: unknown) {
  const compact = String(value || "UN").replace(/[^a-zA-Z0-9]/g, "");
  return (compact.slice(0, 2) || "UN").toUpperCase();
}

export function UnitsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedHostelCode, setSelectedHostelCode] = useState<string | null>(
    null,
  );
  const [genderFilter, setGenderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unit, setUnit] = useState<Row | null>(null);
  const [drawerTab, setDrawerTab] = useState("general");
  const [modal, setModal] = useState("");
  const [editingAsset, setEditingAsset] = useState<Row | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Row | null>(null);
  const [recordingLotId, setRecordingLotId] = useState<
    string | number | null
  >(null);

  const ownerByUnit = useMemo(
    () =>
      new Map(
        data.owners.map((item) => [item.unitId, item] as const),
      ),
    [data.owners],
  );
  const owner = unit ? ownerByUnit.get(unit.id) : undefined;
  const cards = data.accessCards.filter((c) => c.unitId === unit?.id);
  const services = data.services.filter((s) => s.unitId === unit?.id);
  const beds = data.bedSpaces.filter((b) => b.unitId === unit?.id);

  const rooms = useMemo(() => {
    const map = new Map<number, Row>();
    for (const b of beds) {
      if (!map.has(b.roomId))
        map.set(b.roomId, {
          ...b,
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

  const hostelSummaries = useMemo(
    () =>
      data.hostels.map((property) => {
        const propertyUnits = data.units.filter(
          (item) => item.hostelCode === property.code,
        );
        const unitIds = new Set(propertyUnits.map((item) => item.id));
        const activeUnits = propertyUnits.filter(
          (item) => item.status === "active",
        ).length;
        const genderValues = [
          ...new Set(
            propertyUnits
              .map((item) => item.gender)
              .filter(
                (value) => value && value !== "unspecified",
              ),
          ),
        ];
        const genderSummary =
          genderValues.length === 0
            ? "Not set"
            : genderValues.length === 1
              ? genderLabel(genderValues[0])
              : "Mixed";

        return {
          property,
          unitCount: propertyUnits.length,
          activeUnits,
          genderSummary,
          accessCardCount: data.accessCards.filter((item) =>
            unitIds.has(item.unitId),
          ).length,
          wifiCount: data.services.filter(
            (item) =>
              item.serviceType === "wifi" && unitIds.has(item.unitId),
          ).length,
          parkingCount: data.parkingLots.filter(
            (item) =>
              item.hostelId === property.id || unitIds.has(item.unitId),
          ).length,
        };
      }),
    [
      data.hostels,
      data.units,
      data.accessCards,
      data.services,
      data.parkingLots,
    ],
  );

  const selectedHostel = data.hostels.find(
    (item) => item.code === selectedHostelCode,
  );
  const selectedHostelSummary = hostelSummaries.find(
    (item) => item.property.code === selectedHostelCode,
  );

  const selectedHostelUnits = useMemo(
    () =>
      selectedHostelCode
        ? data.units.filter((item) => item.hostelCode === selectedHostelCode)
        : [],
    [data.units, selectedHostelCode],
  );

  const filtered = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    return selectedHostelUnits.filter((item) => {
      const itemOwner = ownerByUnit.get(item.id);
      const matchesQuery =
        !normalisedQuery ||
        `${item.unitCode} ${item.address || ""} ${itemOwner?.ownerName || ""}`
          .toLowerCase()
          .includes(normalisedQuery);
      const matchesGender =
        genderFilter === "all" || item.gender === genderFilter;
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      return matchesQuery && matchesGender && matchesStatus;
    });
  }, [
    selectedHostelUnits,
    ownerByUnit,
    query,
    genderFilter,
    statusFilter,
  ]);

  const listedCards = data.accessCards.filter((card) => {
    const cardUnit = data.units.find((item) => item.id === card.unitId);
    return Boolean(
      selectedHostelCode && cardUnit?.hostelCode === selectedHostelCode,
    );
  });
  const listedServices = data.services.filter((service) => {
    const serviceUnit = data.units.find((item) => item.id === service.unitId);
    return Boolean(
      selectedHostelCode &&
        service.serviceType === "wifi" &&
        serviceUnit?.hostelCode === selectedHostelCode,
    );
  });
  const listedParking = data.parkingLots.filter((lot) => {
    const property = data.hostels.find((item) => item.id === lot.hostelId);
    const lotUnit = data.units.find((item) => item.id === lot.unitId);
    return Boolean(
      selectedHostelCode &&
        (property?.code === selectedHostelCode ||
          lotUnit?.hostelCode === selectedHostelCode),
    );
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
      {!selectedHostel ? (
        <section className="hostel-directory">
          <div className="hostel-directory-title">
            <div>
              <small>HOSTEL DIRECTORY</small>
              <h3>Select a hostel to view its units</h3>
              <p>
                Unit search and filters are available after a hostel is opened.
              </p>
            </div>
            <span className="hostel-directory-count">
              {hostelSummaries.length} properties
            </span>
          </div>

          <div className="hostel-directory-scroll">
            <div className="hostel-directory-table">
              <div className="hostel-directory-header" role="row">
                <span>Property</span>
                <span>Units</span>
                <span>Gender</span>
                <span>Status</span>
                <span>Access / Wi-Fi</span>
                <span>Parking</span>
                <span>Action</span>
              </div>

              <div className="hostel-directory-body">
                {hostelSummaries.map((summary) => {
                  const property = summary.property;

                  return (
                    <article
                      key={property.id}
                      className="hostel-directory-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`View units in ${property.name}`}
                      onClick={() => {
                        setSelectedHostelCode(property.code);
                        setQuery("");
                        setGenderFilter("all");
                        setStatusFilter("all");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedHostelCode(property.code);
                          setQuery("");
                          setGenderFilter("all");
                          setStatusFilter("all");
                        }
                      }}
                    >
                      <div className="hostel-directory-property">
                        <span
                          className="hostel-directory-badge"
                          aria-hidden="true"
                        >
                          {directoryInitials(property.name)}
                        </span>
                        <div>
                          <strong>{property.name}</strong>
                          <small>{property.address || "Address not set"}</small>
                        </div>
                      </div>

                      <div className="hostel-directory-number">
                        <strong>{summary.unitCount}</strong>
                        <small>
                          {summary.unitCount === 1 ? "unit" : "units"}
                        </small>
                      </div>

                      <div className="hostel-directory-copy">
                        <strong>{summary.genderSummary}</strong>
                        <small>Unit allocation</small>
                      </div>

                      <div className="hostel-directory-copy">
                        <span
                          className={`hostel-directory-status ${
                            summary.activeUnits ? "available" : "inactive"
                          }`}
                        >
                          {summary.activeUnits ? "Available" : "Inactive"}
                        </span>
                        <small>
                          {summary.activeUnits} active of {summary.unitCount}
                        </small>
                      </div>

                      <div className="hostel-directory-services">
                        <span>
                          <b>{summary.accessCardCount}</b>
                          <small>cards</small>
                        </span>
                        <span>
                          <b>{summary.wifiCount}</b>
                          <small>Wi-Fi</small>
                        </span>
                      </div>

                      <div className="hostel-directory-copy">
                        <strong>{summary.parkingCount}</strong>
                        <small>registered lots</small>
                      </div>

                      <div className="hostel-directory-action">
                        <span className="hostel-directory-open">
                          View units <b aria-hidden="true">→</b>
                        </span>
                      </div>
                    </article>
                  );
                })}

                {!hostelSummaries.length && (
                  <div className="hostel-directory-empty">
                    <span>HP</span>
                    <strong>No hostels added</strong>
                    <p>Add a hostel before creating unit records.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="hostel-unit-stage">
          <div className="hostel-unit-navigation">
            <button
              type="button"
              className="hostel-back-button"
              onClick={() => {
                setSelectedHostelCode(null);
                setQuery("");
                setGenderFilter("all");
                setStatusFilter("all");
              }}
            >
              <span aria-hidden="true">←</span> All hostels
            </button>
            <span>
              Hostel directory <b>/</b> {selectedHostel.name}
            </span>
          </div>

          <section className="selected-hostel-card">
            <div className="selected-hostel-main">
              <span className="selected-hostel-badge" aria-hidden="true">
                {directoryInitials(selectedHostel.name)}
              </span>
              <div>
                <small>SELECTED HOSTEL</small>
                <h3>{selectedHostel.name}</h3>
                <p>{selectedHostel.address || "Address not set"}</p>
              </div>
            </div>

            <div className="selected-hostel-stats">
              <span>
                <small>Units</small>
                <strong>{selectedHostelSummary?.unitCount || 0}</strong>
              </span>
              <span>
                <small>Active</small>
                <strong>{selectedHostelSummary?.activeUnits || 0}</strong>
              </span>
              <span>
                <small>Access cards</small>
                <strong>{selectedHostelSummary?.accessCardCount || 0}</strong>
              </span>
              <span>
                <small>Wi-Fi</small>
                <strong>{selectedHostelSummary?.wifiCount || 0}</strong>
              </span>
            </div>
          </section>

          <section className="unit-directory">
            <div className="unit-directory-heading">
              <div>
                <small>UNIT INFORMATION</small>
                <h3>Units in {selectedHostel.name}</h3>
                <p>
                  Search and filter only the units under this hostel.
                </p>
              </div>
              <span>
                {filtered.length} of {selectedHostelUnits.length} shown
              </span>
            </div>

            <div className="unit-directory-toolbar unit-directory-toolbar--nested">
              <label className="unit-directory-search">
                <span>Search units</span>
                <div className="unit-directory-control">
                  <span
                    className="unit-directory-search-icon"
                    aria-hidden="true"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Unit, owner or address"
                  />
                  {query && (
                    <button
                      type="button"
                      className="unit-directory-clear"
                      onClick={() => setQuery("")}
                      aria-label="Clear unit search"
                    >
                      x
                    </button>
                  )}
                </div>
              </label>

              <label className="unit-directory-filter">
                <span>Gender</span>
                <div className="unit-directory-control">
                  <select
                    value={genderFilter}
                    onChange={(event) => setGenderFilter(event.target.value)}
                  >
                    <option value="all">All genders</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="mixed">Special / mixed</option>
                    <option value="unspecified">Not set</option>
                  </select>
                </div>
              </label>

              <label className="unit-directory-filter">
                <span>Status</span>
                <div className="unit-directory-control">
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="return-planned">To surrender</option>
                    <option value="surrendered">Surrendered</option>
                  </select>
                </div>
              </label>
            </div>

            <div className="unit-directory-summary">
              <div>
                <strong>{filtered.length}</strong>
                <span>
                  {filtered.length === 1 ? "unit shown" : "units shown"}
                </span>
              </div>
              <button
                type="button"
                className="unit-filter-reset"
                disabled={
                  !query && genderFilter === "all" && statusFilter === "all"
                }
                onClick={() => {
                  setQuery("");
                  setGenderFilter("all");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </button>
            </div>

            <div className="unit-directory-scroll">
              <div className="unit-directory-table">
                <div className="unit-directory-header" role="row">
                  <span>Unit</span>
                  <span>Agreement / owner</span>
                  <span>Gender</span>
                  <span>Status</span>
                  <span>Access / Wi-Fi</span>
                  <span>Surrender</span>
                  <span>Action</span>
                </div>

                <div className="unit-directory-body">
                  {filtered.map((u) => {
                    const o = ownerByUnit.get(u.id);
                    const accessCardCount = data.accessCards.filter(
                      (c) => c.unitId === u.id,
                    ).length;
                    const wifiCount = data.services.filter(
                      (s) =>
                        s.unitId === u.id && s.serviceType === "wifi",
                    ).length;

                    return (
                      <article className="unit-directory-row" key={u.id}>
                        <div className="unit-directory-property">
                          <span
                            className="unit-directory-badge"
                            aria-hidden="true"
                          >
                            {unitInitials(u.unitCode)}
                          </span>

                          <div className="unit-directory-property-copy">
                            <div className="unit-directory-name-line">
                              <strong>{u.unitCode}</strong>
                              <code>{u.hostelName}</code>
                            </div>
                            <small>{u.address || "Address not set"}</small>
                          </div>
                        </div>

                        <div className="unit-directory-owner">
                          {o ? (
                            <>
                              <strong>{o.ownerName || "Owner not set"}</strong>
                              <small>
                                {titleCase(
                                  o.agreementType || "Agreement not set",
                                )}
                              </small>
                            </>
                          ) : (
                            <>
                              <strong>Owner not set</strong>
                              <small>No agreement record</small>
                            </>
                          )}
                        </div>

                        <div className="unit-directory-gender">
                          <span className={`gender-pill ${u.gender}`}>
                            {genderLabel(u.gender)}
                          </span>
                        </div>

                        <div className="unit-directory-status-cell">
                          <span
                            className={`unit-directory-status ${u.status}`}
                          >
                            {titleCase(u.status)}
                          </span>
                        </div>

                        <div className="unit-directory-services">
                          <span>
                            <b>{accessCardCount}</b>
                            <small>cards</small>
                          </span>
                          <span>
                            <b>{wifiCount}</b>
                            <small>Wi-Fi</small>
                          </span>
                        </div>

                        <div className="unit-directory-surrender">
                          <strong>
                            {u.surrenderDate
                              ? dateLabel(u.surrenderDate)
                              : "-"}
                          </strong>
                          <small>
                            {u.surrenderDate
                              ? "Surrender date"
                              : "Not planned"}
                          </small>
                        </div>

                        <div className="unit-directory-action">
                          <button
                            type="button"
                            className="unit-directory-open"
                            onClick={() => {
                              setUnit(u);
                              setSelectedRoom(null);
                              setDrawerTab("general");
                            }}
                          >
                            Open unit
                          </button>
                        </div>
                      </article>
                    );
                  })}

                  {!filtered.length && (
                    <div className="unit-directory-empty">
                      <span>UN</span>
                      <strong>No matching units</strong>
                      <p>
                        Try another unit number, owner name, gender or status.
                      </p>
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => {
                          setQuery("");
                          setGenderFilter("all");
                          setStatusFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* <section className="split-registers">
            <article className="panel">
              <div className="section-heading">
                <div>
                  <small>ACCESS CARDS · {selectedHostel.name}</small>
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
                  <small>WI-FI ACCOUNTS · {selectedHostel.name}</small>
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
                        {s.accountReference || "No account"} ·{" "}
                        {titleCase(s.status)}
                      </small>
                    </span>
                  );
                })}
                {!listedServices.length && (
                  <p className="empty-copy">
                    No Wi-Fi service accounts registered yet.
                  </p>
                )}
              </div>
            </article>

            <article className="panel">
              <div className="section-heading">
                <div>
                  <small>PARKING LOTS · {selectedHostel.name}</small>
                  <h3>{listedParking.length} parking lots</h3>
                </div>
              </div>
              <div className="compact-list">
                {listedParking.map((lot) => {
                  const lotUnit = data.units.find(
                    (item) => item.id === lot.unitId,
                  );
                  const rental = data.parkingRentals.find(
                    (item) =>
                      item.parkingLotId === lot.id &&
                      item.status === "active",
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
          </section> */}
        </div>
      )}
      {unit && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedRoom(null);
              setUnit(null);
            }
          }}
        >
          <aside className="unit-drawer">
            <div className="drawer-head">
              <div>
                <small>{unit.hostelName}</small>
                <h2>{unit.unitCode}</h2>
                <p>{unit.address}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedRoom(null);
                  setUnit(null);
                }}
              >
                ×
              </button>
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
                        placeholder="e.g. Student is relocating to a different unit"
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
                    <button
                      className="secondary compact"
                      onClick={() => setModal("add-parking-lot")}
                    >
                      + Add parking lot
                    </button>
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
                          <span
                            key={lot.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <code>{lot.lotNumber}</code>
                            <b>{rental?.tenantName || "Available"}</b>
                            <small>
                              {titleCase(rental ? "rented" : lot.status)}
                            </small>
                            {!rental && lot.status === "available" && (
                              <button
                                type="button"
                                className="secondary compact"
                                style={{ marginLeft: "auto" }}
                                onClick={() => {
                                  setRecordingLotId(lot.id);
                                  setModal("parking");
                                }}
                              >
                                Record parking
                              </button>
                            )}
                          </span>
                        );
                      })}
                  </div>
                  {!data.parkingLots.filter((lot) => lot.unitId === unit.id)
                    .length && (
                    <p className="empty-copy">
                      No parking lots registered for this unit yet.
                    </p>
                  )}
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
                            className="primary compact"
                            onClick={() => setSelectedRoom(room)}
                          >
                            View room
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
      {selectedRoom && unit && (
        <RoomOverviewPanel
          unit={unit}
          room={selectedRoom}
          attachments={data.attachments.filter(
            (attachment) =>
              attachment.contextType === "room" &&
              attachment.recordId === selectedRoom.id,
          )}
          uploadedBy={data.currentUser?.displayName}
          save={save}
          busy={busy}
          onClose={() => setSelectedRoom(null)}
        />
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
              <select
                name="hostelId"
                required
                defaultValue={selectedHostel?.id || ""}
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
              Unit number
              <input name="unitCode" required placeholder="e.g. NB-0801" />
              
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
      {modal === "parking" && recordingLotId !== null && (
        <Modal
          title="Record parking"
          kicker={unit?.unitCode || ""}
          onClose={() => {
            setModal("");
            setRecordingLotId(null);
          }}
          wide
        >
          <ParkingRentalForm
            data={data}
            save={save}
            busy={busy}
            lockedLotId={recordingLotId}
            onDone={() => {
              setModal("");
              setRecordingLotId(null);
            }}
          />
        </Modal>
      )}
      {modal === "add-parking-lot" && unit && (
        <Modal
          title="Add parking lot"
          kicker={unit.unitCode}
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "parking-lot",
                  hostelId: unit.hostelId,
                  unitId: unit.id,
                  ...formValues(e),
                },
                "Parking lot added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Lot number
              <input name="lotNumber" required placeholder="e.g. NB-0801"/>
            </label>
            <label>
              Status
              <select name="status" defaultValue="available">
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
                Save lot
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


const ROOM_AMENITIES = [
  { key: "bed", label: "Bed" },
  { key: "mattress", label: "Mattress" },
  { key: "study-table", label: "Study table" },
  { key: "chair", label: "Chair" },
  { key: "wardrobe", label: "Wardrobe" },
  { key: "air-conditioner", label: "Air-conditioner" },
  { key: "ceiling-fan", label: "Ceiling fan" },
  { key: "curtain-blind", label: "Curtain / blind" },
  { key: "power-sockets", label: "Power sockets" },
  { key: "wifi", label: "Wi-Fi coverage" },
];

function normaliseAmenities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Older records may store comma-separated values.
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function roomValue(room: Row, key: string, fallback: any = "") {
  const direct = room?.[key];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  const firstBed = room?.beds?.[0];
  const bedValue = firstBed?.[key];
  return bedValue !== undefined && bedValue !== null && bedValue !== ""
    ? bedValue
    : fallback;
}

function RoomOverviewPanel({
  unit,
  room,
  attachments,
  uploadedBy,
  save,
  busy,
  onClose,
}: {
  unit: Row;
  room: Row;
  attachments: Row[];
  uploadedBy?: string;
  save: any;
  busy: boolean;
  onClose: () => void;
}) {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [amenities, setAmenities] = useState<string[]>(
    normaliseAmenities(roomValue(room, "amenities", [])),
  );

  const beds: Row[] = room.beds || [];
  const primaryBed = beds[0] || {};
  const roomCode =
    primaryBed.legacyCode || `${unit.unitCode}-${String(room.label || "Room")}`;
  const occupiedBeds = beds.filter(
    (bed) =>
      bed.status === "occupied" ||
      bed.occupantId ||
      bed.tenantId ||
      bed.studentId,
  ).length;
  const capacity = Math.max(beds.length, 1);
  const isOccupied = occupiedBeds > 0;
  const monthlyRate = roomValue(
    room,
    "monthlyRate",
    roomValue(room, "salesRate", roomValue(room, "rent", "")),
  );
  const roomPhotos = attachments.filter(
    (attachment) => attachment.fileType?.startsWith?.("image/") !== false,
  );

  const toggleAmenity = (key: string) => {
    setAmenities((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  return (
    <div
      className="room-overview-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="room-overview-panel">
        <header className="room-overview-header">
          <div>
            <button type="button" className="text-button" onClick={onClose}>
              ← Back to {unit.unitCode}
            </button>
            <small>
              {unit.hostelName} / {unit.unitCode}
            </small>
            <h2>Room {room.label}</h2>
            <p>Room information, contents, photos and inspection condition.</p>
          </div>
          <button type="button" className="room-close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="room-hero-card">
          <div className="room-photo-cover">
            {roomPhotos[0] ? (
              <img
                src={`/api/files?id=${roomPhotos[0].id}`}
                alt={`${roomCode} cover`}
              />
            ) : (
              <div className="room-photo-placeholder">
                <span>ROOM</span>
                <small>No photo uploaded</small>
              </div>
            )}
            <span className="photo-count">▧ {roomPhotos.length}</span>
          </div>
          <div className="room-hero-main">
            <div className="room-title-line">
              <div>
                <h3>{roomCode}</h3>
                <span className="room-type-pill">
                  Room {room.label} · {titleCase(room.type || "single")}
                </span>
              </div>
              <span className={`room-availability ${isOccupied ? "occupied" : "vacant"}`}>
                {isOccupied ? "Occupied" : "Vacant"}
              </span>
            </div>
            <div className="room-hero-facts">
              <span>
                <small>Hostel</small>
                <strong>{unit.hostelName}</strong>
              </span>
              <span>
                <small>Unit</small>
                <strong>{unit.unitCode}</strong>
              </span>
              <span>
                <small>Bathroom</small>
                <strong>{titleCase(room.bathroomType || "not set")}</strong>
              </span>
              <span>
                <small>Monthly rate</small>
                <strong>{monthlyRate ? `RM ${monthlyRate}` : "Not set"}</strong>
              </span>
              <span>
                <small>Availability</small>
                <strong>{isOccupied ? "Currently occupied" : "Available now"}</strong>
              </span>
            </div>
          </div>
        </section>

        <section className="room-stat-grid">
          <article>
            <span className="room-stat-icon">✓</span>
            <div>
              <small>Room status</small>
              <strong>{isOccupied ? "Occupied" : "Vacant"}</strong>
              <p>{isOccupied ? "Tenant assigned" : "Ready to assign"}</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">RM</span>
            <div>
              <small>Monthly rent</small>
              <strong>{monthlyRate ? `RM ${monthlyRate}` : "Not set"}</strong>
              <p>Sales rate per month</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">◎</span>
            <div>
              <small>Occupancy</small>
              <strong>
                {occupiedBeds} / {capacity}
              </strong>
              <p>{Math.round((occupiedBeds / capacity) * 100)}% occupied</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">▰</span>
            <div>
              <small>Bed type</small>
              <strong>{titleCase(primaryBed.bedType || "not set")}</strong>
              <p>{titleCase(room.bathroomType || "Bathroom not set")}</p>
            </div>
          </article>
        </section>

        <form
          className="room-overview-layout"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await save(
              {
                action: "room-details",
                roomId: room.id,
                ...formValues(event),
                amenities: JSON.stringify(amenities),
              },
              "Room overview updated",
            );
            if (ok && photoFile) {
              await uploadAttachment(
                photoFile,
                "room",
                room.id,
                uploadedBy,
              );
              setPhotoFile(null);
            }
          }}
        >
          <div className="room-main-column">
            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM CONFIGURATION</small>
                  <h3>Basic room information</h3>
                </div>
              </div>
              <div className="form-grid room-edit-grid">
                <label>
                  Room label
                  <input name="roomLabel" defaultValue={room.label} />
                </label>
                <label>
                  Room type
                  <select name="roomType" defaultValue={room.type}>
                    <option value="single">Single room</option>
                    <option value="sharing">Sharing room</option>
                  </select>
                </label>
                <label>
                  Bathroom
                  <select name="bathroomType" defaultValue={room.bathroomType}>
                    <option value="unknown">Bathroom not set</option>
                    <option value="attached">Attached</option>
                    <option value="non-attached">Non-attached</option>
                  </select>
                </label>
                <label>
                  Monthly sales rate
                  <input
                    name="monthlyRate"
                    type="number"
                    min="0"
                    defaultValue={monthlyRate}
                    placeholder="800"
                  />
                </label>
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>INCLUDED IN THIS ROOM</small>
                  <h3>Furniture and facilities</h3>
                </div>
                <span>{amenities.length} selected</span>
              </div>
              <div className="amenity-grid">
                {ROOM_AMENITIES.map((item) => {
                  const included = amenities.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`amenity-tile ${included ? "included" : ""}`}
                      onClick={() => toggleAmenity(item.key)}
                    >
                      <span>{included ? "✓" : "+"}</span>
                      <b>{item.label}</b>
                      <small>{included ? "Included" : "Not included"}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM CODES & BEDS</small>
                  <h3>{beds.length} bed space record(s)</h3>
                </div>
              </div>
              <div className="room-bed-table">
                {beds.map((bed) => (
                  <div key={bed.id}>
                    <code>{bed.legacyCode || "Code not set"}</code>
                    <span>{titleCase(bed.bedType || "Bed type not set")}</span>
                    <span>{titleCase(bed.status || "Vacant")}</span>
                  </div>
                ))}
                {!beds.length && <p className="empty-copy">No bed spaces added.</p>}
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>NOTES & REMARKS</small>
                  <h3>Operational notes</h3>
                </div>
              </div>
              <label className="room-notes-field">
                Notes
                <textarea
                  name="roomNotes"
                  defaultValue={roomValue(room, "roomNotes", roomValue(room, "notes", ""))}
                  placeholder="Add room-specific notes, defects or instructions"
                />
              </label>
            </section>
          </div>

          <div className="room-side-column">
            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>BATHROOM & UTILITIES</small>
                  <h3>Facilities status</h3>
                </div>
              </div>
              <div className="utility-fields">
                <label>
                  Water heater
                  <select name="waterHeater" defaultValue={roomValue(room, "waterHeater", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Sink / basin
                  <select name="sinkBasin" defaultValue={roomValue(room, "sinkBasin", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Lighting
                  <select name="lighting" defaultValue={roomValue(room, "lighting", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Ventilation
                  <select name="ventilation" defaultValue={roomValue(room, "ventilation", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM PHOTOS</small>
                  <h3>{roomPhotos.length} uploaded</h3>
                </div>
              </div>
              <div className="room-photo-grid">
                {roomPhotos.slice(0, 6).map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/files?id=${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={`/api/files?id=${attachment.id}`}
                      alt={attachment.fileName || "Room photo"}
                    />
                  </a>
                ))}
                {!roomPhotos.length && (
                  <div className="room-photo-empty">No room photos yet</div>
                )}
              </div>
              <label className="room-photo-upload">
                Add room photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setPhotoFile(event.target.files?.[0] || null)
                  }
                />
              </label>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>CONDITION / INSPECTION</small>
                  <h3>Latest room condition</h3>
                </div>
              </div>
              <div className="inspection-fields">
                {[
                  ["cleanliness", "Cleanliness"],
                  ["furnitureCondition", "Furniture condition"],
                  ["electricalCondition", "Electrical & sockets"],
                  ["wallCondition", "Wall & paint"],
                ].map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <select name={name} defaultValue={roomValue(room, name, "not-set")}>
                      <option value="not-set">Not set</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="repair">Needs repair</option>
                    </select>
                  </label>
                ))}
                <label>
                  Last inspected on
                  <input
                    name="lastInspectedOn"
                    type="date"
                    defaultValue={roomValue(room, "lastInspectedOn", "")}
                  />
                </label>
              </div>
            </section>

            <div className="room-save-bar">
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save room overview
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
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
          <input name="ownerName" placeholder="e.g. John Doe" defaultValue={owner?.ownerName || ""} />
        </label>
        <label>
          Owner IC / passport / registration no.
          <input
            name="ownerIdentityNo"
            placeholder="e.g. 010101-01-0101"
            defaultValue={owner?.ownerIdentityNo || ""}
          />
        </label>
        <label>
          Owner email
          <input
            name="ownerEmail"
            placeholder="e.g. john.doe@example.com"
            type="email"
            defaultValue={owner?.ownerEmail || ""}
          />
        </label>
        <label className="wide">
          Registered residential address
          <textarea
            name="registeredAddress"
            placeholder="e.g. 123, Jalan Merdeka, 50000 Kuala Lumpur"
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
            placeholder="e.g. John Doe"
            defaultValue={owner?.primaryContactName || ""}
          />
        </label>
        <label>
          Primary contact number
          <input
            name="primaryContactPhone"
            placeholder="e.g. 0123456789"
            defaultValue={owner?.primaryContactPhone || ""}
          />
        </label>
        <label>
          Secondary contact name
          <input
            name="secondaryContactName"
            placeholder="e.g. Jane Doe"
            defaultValue={owner?.secondaryContactName || ""}
          />
        </label>
        <label>
          Secondary contact number
          <input
            name="secondaryContactPhone"
            placeholder="e.g. 0123456789"
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
            placeholder="e.g. 1234567890"
            defaultValue={owner?.bankAccountNumber || ""}
          />
        </label>
        <label>
          Account holder
          <input
            name="bankAccountHolder"
            placeholder="e.g. John Doe"
            defaultValue={owner?.bankAccountHolder || ""}
          />
        </label>
        <label>
          Bank name
          <input name="bankName" placeholder="e.g. Maybank" defaultValue={owner?.bankName || ""} />
        </label>
        <div className="wide form-divider">
          <strong>Lease information</strong>
        </div>
        <label>
          Lease start
          <input
            name="leaseStartDate"
            type="date"
            placeholder="e.g. 2026-01-01"
            defaultValue={owner?.leaseStartDate || ""}
          />
        </label>
        <label>
          Lease end
          <input
            name="leaseEndDate"
            type="date"
            placeholder="e.g. 2026-01-01"
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
                placeholder="e.g. 1000"
                defaultValue={owner?.monthlyLeaseRental ?? ""}
              />
            </label>
            <label>
              Security deposit
              <input
                name="securityDeposit"
                type="number"
                min="0"
                placeholder="e.g. 1000"
                defaultValue={owner?.securityDeposit ?? ""}
              />
            </label>
            <label>
              Utility deposit
              <input
                name="utilityDeposit"
                type="number"
                min="0"
                placeholder="e.g. 1000"
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
                placeholder="e.g. 10"
                defaultValue={owner?.servicePercentage ?? ""}
              />
            </label>
            <label>
              New student commission
              <input
                name="commissionAmount"
                type="number"
                min="0"
                placeholder="e.g. 100"
                defaultValue={owner?.commissionAmount ?? ""}
              />
            </label>
            <label>
              Monthly cleaning fee
              <input
                name="monthlyCleaningFee"
                type="number"
                min="0"
                placeholder="e.g. 100"
                defaultValue={owner?.monthlyCleaningFee ?? ""}
              />
            </label>
            <label>
              Monthly water dispenser fee
              <input
                name="monthlyWaterDispenserFee"
                type="number"
                min="0"
                placeholder="e.g. 100"
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
          <input name="tnbAccount" placeholder="e.g. 1234567890" defaultValue={owner?.tnbAccount || ""} />
        </label>
        <label>
          Air Selangor account
          <input
            name="airSelangorAccount"
            placeholder="e.g. 1234567890"
            defaultValue={owner?.airSelangorAccount || ""}
          />
        </label>
        <label>
          Indah Water account
          <input
            name="indahWaterAccount"
            placeholder="e.g. 1234567890"
            defaultValue={owner?.indahWaterAccount || ""}
          />
        </label>
        <label className="wide">
          Agreement notes
          <input name="ownerNotes" placeholder="e.g. Agreement notes" defaultValue={owner?.notes || ""} />
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