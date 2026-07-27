"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  Modal,
  Stat,
  dateLabel,
  formValues,
  genderLabel,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

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
