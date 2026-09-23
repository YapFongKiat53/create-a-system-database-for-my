"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  DateField,
  Modal,
  ParkingRentalForm,
  SearchIcon,
  Stat,
  StatusPill,
  blockOf,
  dateLabel,
  formValues,
  money,
  titleCase,
} from "./shared";
import type { Data, Row } from "./shared";

// Lot-number formats differ per hostel (Damai: "Parking 248", Nadayu:
// "Parking L3-427"), so we hint via a per-hostel example instead of forcing
// a rigid pattern.
const LOT_NUMBER_HINTS: Record<string, string> = {
  DAM: "e.g. Parking 248",
  NDY: "e.g. Parking L3-427",
};

function AddParkingLotForm({
  data,
  save,
  busy,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  onDone: () => void;
}) {
  const [hostelId, setHostelId] = useState("");
  const [block, setBlock] = useState("");
  const [unitId, setUnitId] = useState("");

  const hostel = data.hostels.find((h) => String(h.id) === hostelId);
  const hostelUnits = data.units.filter(
    (u) => !hostelId || String(u.hostelId) === hostelId,
  );
  const blockOptions = [
    ...new Set(hostelUnits.map((u) => blockOf(u.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blockedUnits = hostelUnits.filter(
    (u) => !block || blockOf(u.unitCode) === block,
  );

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          { action: "parking-lot", ...formValues(e) },
          "Parking lot added",
        );
        if (ok) onDone();
      }}
    >
      <label>
        Hostel
        <select
          name="hostelId"
          required
          value={hostelId}
          onChange={(event) => {
            setHostelId(event.target.value);
            setBlock("");
            setUnitId("");
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
        Lot number
        <input
          name="lotNumber"
          required
          placeholder={
            LOT_NUMBER_HINTS[String(hostel?.code || "")] || "e.g. Parking 101"
          }
        />
      </label>
      {blockOptions.length > 0 && (
        <label>
          Block
          <select
            value={block}
            disabled={!hostelId}
            onChange={(event) => {
              setBlock(event.target.value);
              setUnitId("");
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
      <label>
        Unit
        <select
          name="unitId"
          value={unitId}
          disabled={!hostelId}
          onChange={(event) => setUnitId(event.target.value)}
        >
          <option value="">Common / hostel lot</option>
          {blockedUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.unitCode}
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
        <input name="notes" placeholder="e.g. Notes about the lot" />
      </label>
      <div className="form-actions wide">
        <button className="primary" disabled={busy}>
          Add lot
        </button>
      </div>
    </form>
  );
}

export function ParkingModule({
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
  const [reservingLotId, setReservingLotId] = useState<
    string | number | null
  >(null);
  const [rentalSearch, setRentalSearch] = useState("");
  const [rentalTab, setRentalTab] = useState<
    "all" | "active" | "ended" | "outside" | "deleted"
  >("active");
  const [rentalSort, setRentalSort] = useState("lotNumber");
  const [rentalSortDir, setRentalSortDir] = useState<"asc" | "desc">("asc");
  const [rental, setRental] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDeletedLots, setShowDeletedLots] = useState(false);
  const [lot, setLot] = useState<Row | null>(null);
  const [confirmDeleteLot, setConfirmDeleteLot] = useState(false);
  const sortRentals = (key: string) => {
    if (rentalSort === key)
      setRentalSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setRentalSort(key);
      setRentalSortDir("asc");
    }
  };
  const rentalHeader = (key: string, label: string) => (
    <th>
      <button className="sort-button" onClick={() => sortRentals(key)}>
        {label}{" "}
        {rentalSort === key ? (rentalSortDir === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );
  const filteredLots = data.parkingLots.filter(
    (l) =>
      (hostelFilter === "all" || String(l.hostelId) === hostelFilter) &&
      (showDeletedLots ? Boolean(l.deletedAt) : !l.deletedAt),
  );
  const filteredRentals = data.parkingRentals
    .filter((r) => {
      const parkingLot = data.parkingLots.find((l) => l.id === r.parkingLotId);
      const hostelMatch =
        hostelFilter === "all" ||
        String(parkingLot?.hostelId || "") === hostelFilter;
      const tabMatch =
        rentalTab === "deleted"
          ? Boolean(r.deletedAt)
          : r.deletedAt
            ? false
            : rentalTab === "all"
              ? true
              : rentalTab === "outside"
                ? r.tenantType === "outside"
                : rentalTab === "active"
                  ? r.status === "active"
                  : r.status !== "active";
      const search = rentalSearch.trim().toLowerCase();
      const text =
        `${r.tenantName} ${r.contactNumber} ${r.carPlateNumber} ${r.carModel} ${r.lotNumber} ${r.hostelName} ${r.unitNumber}`.toLowerCase();
      return hostelMatch && tabMatch && (!search || text.includes(search));
    })
    .sort((left, right) => {
      const a = String(left[rentalSort] ?? "");
      const b = String(right[rentalSort] ?? "");
      const result = a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return rentalSortDir === "asc" ? result : -result;
    });
  return (
    <div className="table-v2">
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
          <button className="v2-btn-primary" onClick={() => setModal("lot")}>
            + Add parking lot
          </button>
        </div>
      </section>
      <section className="module-metrics">
        <Stat
          value={data.parkingLots.filter((l) => !l.deletedAt).length}
          label="Total lots"
        />
        <Stat
          value={
            data.parkingLots.filter(
              (l) => l.status === "available" && !l.deletedAt,
            ).length
          }
          label="Available"
        />
        <Stat
          value={
            data.parkingRentals.filter(
              (r) =>
                r.status === "active" &&
                r.tenantType === "in-house" &&
                !r.deletedAt,
            ).length
          }
          label="In-house"
        />
        <Stat
          value={
            data.parkingRentals.filter(
              (r) =>
                r.status === "active" &&
                r.tenantType === "outside" &&
                !r.deletedAt,
            ).length
          }
          label="Outside tenants"
        />
      </section>
      <section className="panel">
        <div className="workspace-tabs">
          <button
            className={rentalTab === "all" ? "active" : ""}
            onClick={() => setRentalTab("all")}
          >
            All ({data.parkingRentals.filter((r) => !r.deletedAt).length})
          </button>
          <button
            className={rentalTab === "active" ? "active" : ""}
            onClick={() => setRentalTab("active")}
          >
            Active rentals
          </button>
          <button
            className={rentalTab === "ended" ? "active" : ""}
            onClick={() => setRentalTab("ended")}
          >
            Ended / inactive
          </button>
          <button
            className={rentalTab === "outside" ? "active" : ""}
            onClick={() => setRentalTab("outside")}
          >
            Outside tenants
          </button>
          <button
            className={rentalTab === "deleted" ? "active" : ""}
            onClick={() => setRentalTab("deleted")}
          >
            Deleted (
            {data.parkingRentals.filter((r) => r.deletedAt).length})
          </button>
        </div>
        <div className="v2-toolbar">
          <label className="v2-search">
            <SearchIcon />
            <input
              value={rentalSearch}
              onChange={(e) => setRentalSearch(e.target.value)}
              placeholder="Search tenant, car plate, lot or hostel"
            />
          </label>
          <select
            className="v2-pill-select"
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
          <button
            className="v2-reset"
            onClick={() => {
              setRentalSearch("");
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
                {rentalHeader("lotNumber", "Lot")}
                {rentalHeader("tenantName", "Tenant")}
                {rentalHeader("carPlateNumber", "Car")}
                {rentalHeader("monthlyRental", "Rental / deposit")}
                <th>Billing</th>
                {rentalHeader("paidUntil", "Paid until")}
                {rentalHeader("status", "Status")}
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRentals.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.lotNumber}</code>
                    <small>
                      {r.hostelName}
                      {r.unitNumber ? ` / ${r.unitNumber}` : ""}
                    </small>
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
                    {r.billingFrequency === "package" ||
                    r.billingFrequency === "annually"
                      ? "Annually"
                      : "Monthly"}
                    <small>
                      {r.tenantType === "outside"
                        ? titleCase(r.paymentStatus || "current")
                        : "Student billing"}
                    </small>
                  </td>
                  <td>
                    {dateLabel(r.paidUntil)}
                    {r.nextDueDate && (
                      <small>Next due {dateLabel(r.nextDueDate)}</small>
                    )}
                  </td>
                  <td>
                    <StatusPill status={r.deletedAt ? "deleted" : r.status} />
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setRental(r);
                        setConfirmDelete(false);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRentals.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <em>No parking rentals match this view.</em>
                  </td>
                </tr>
              )}
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
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={showDeletedLots}
              onChange={(event) => setShowDeletedLots(event.target.checked)}
            />
            Show deleted lots (
            {data.parkingLots.filter((l) => l.deletedAt).length})
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Hostel / Unit</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredLots.map((l) => (
                <tr key={l.id}>
                  <td>
                    <code>{l.lotNumber}</code>
                  </td>
                  <td>
                    <strong>{l.hostelName}</strong>
                    <small>
                      {l.unitCode
                        ? `Belongs to unit ${l.unitCode}`
                        : "Common / hostel lot"}
                    </small>
                  </td>
                  <td>
                    <StatusPill status={l.deletedAt ? "deleted" : l.status} />
                  </td>
                  <td>
                    <div className="button-row">
                      <button
                        className="secondary compact"
                        onClick={() => setLot(l)}
                      >
                        History
                      </button>
                      {!l.deletedAt && l.status === "available" && (
                        <button
                          className="secondary compact"
                          onClick={() => {
                            setReservingLotId(l.id);
                            setModal("rental");
                          }}
                        >
                          Reserve / rent this lot
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredLots.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <em>No parking lots match this view.</em>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {rental && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setRental(null)}
        >
          <aside className="unit-drawer student-drawer">
            <div className="drawer-head">
              <div>
                <small>PARKING RENTAL</small>
                <h2>{rental.tenantName}</h2>
                <p>
                  {rental.lotNumber} · {rental.hostelName}
                  {rental.unitNumber ? ` / ${rental.unitNumber}` : ""}
                </p>
              </div>
              <button onClick={() => setRental(null)}>×</button>
            </div>
            {rental.deletedAt && (
              <section className="drawer-section">
                <div className="empty-copy">
                  Deleted {dateLabel(rental.deletedAt)}
                  {rental.deletedBy ? ` by ${rental.deletedBy}` : ""}. Restore
                  it to edit or to free up the lot again.
                </div>
                <button
                  className="primary compact"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await save(
                      { action: "parking-rental-restore", rentalId: rental.id },
                      "Parking rental restored",
                    );
                    if (ok) setRental(null);
                  }}
                >
                  Restore rental
                </button>
              </section>
            )}
            {!rental.deletedAt && (
            <form
              className="drawer-section"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await save(
                  {
                    action: "parking-rental-update",
                    rentalId: rental.id,
                    ...formValues(e),
                  },
                  "Parking rental updated",
                );
                if (ok) setRental(null);
              }}
            >
              <div className="section-title">
                <div>
                  <small>EDIT RENTAL</small>
                  <h3>Rental &amp; tenant details</h3>
                </div>
                <button className="primary compact" disabled={busy}>
                  Save changes
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Tenant name
                  <input
                    name="tenantName"
                    required
                    placeholder="e.g. John Doe"
                    defaultValue={rental.tenantName}
                  />
                </label>
                <label>
                  Contact number
                  <input
                    name="contactNumber"
                    placeholder="e.g. 0123456789"
                    defaultValue={rental.contactNumber}
                  />
                </label>
                <label>
                  Unit number
                  <input name="unitNumber" placeholder="e.g. NB-0801" defaultValue={rental.unitNumber} />
                </label>
                <label>
                  Car plate
                  <input
                    name="carPlateNumber"
                    placeholder="e.g. ABC 1234"
                    defaultValue={rental.carPlateNumber}
                  />
                </label>
                <label>
                  Car model
                  <input name="carModel" placeholder="e.g. Proton Persona" defaultValue={rental.carModel} />
                </label>
                <label>
                  Monthly rental
                  <input
                    name="monthlyRental"
                    type="number"
                    min="0"
                    placeholder="e.g. 100"
                    defaultValue={rental.monthlyRental ?? ""}
                  />
                </label>
                <label>
                  Deposit
                  <input
                    name="depositAmount"
                    type="number"
                    min="0"
                    placeholder="e.g. 100"
                    defaultValue={rental.depositAmount ?? ""}
                  />
                </label>
                <label>
                  Start date
                  <DateField
                    name="startDate"
                    type="date"
                    required
                    placeholder="e.g. 2026-01-01"
                    defaultValue={rental.startDate || ""}
                  />
                </label>
                <label>
                  Paid until
                  <DateField
                    name="paidUntil"
                    type="date"
                    placeholder="e.g. 2026-01-01"
                    defaultValue={rental.paidUntil || ""}
                  />
                </label>
                <label>
                  Billing frequency
                  <select
                    name="billingFrequency"
                    defaultValue={rental.billingFrequency || "monthly"}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annually">Annually</option>
                  </select>
                </label>
                <label>
                  Next payment due
                  <DateField
                    name="nextDueDate"
                    type="date"
                    defaultValue={rental.nextDueDate || ""}
                  />
                </label>
                <label>
                  Payment status
                  <select
                    name="paymentStatus"
                    defaultValue={rental.paymentStatus || "current"}
                  >
                    <option value="current">Current</option>
                    <option value="due">Due</option>
                    <option value="advance">Paid in advance</option>
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={rental.status || "active"}>
                    <option value="active">Active</option>
                    <option value="ended">Ended</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label className="wide">
                  Remarks
                  <input name="notes" defaultValue={rental.notes} />
                </label>
              </div>
            </form>
            )}
            {!rental.deletedAt && rental.status === "active" && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>NEW TENANT</small>
                    <h3>This lot changed hands</h3>
                  </div>
                </div>
                <p className="field-note">
                  Ends this rental today and starts a new one for the
                  incoming tenant, so {rental.tenantName}&rsquo;s record
                  stays on file instead of being overwritten.
                </p>
                <button
                  className="secondary compact"
                  onClick={() => setModal("replace")}
                >
                  Start new rental for this lot
                </button>
              </section>
            )}
            {!rental.deletedAt && (
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>REMOVE</small>
                  <h3>Delete this rental</h3>
                </div>
              </div>
              {confirmDelete ? (
                <div className="button-row">
                  <span className="empty-copy">
                    Delete this rental? It can be restored later from the
                    Deleted tab, and an active rental frees its lot.
                  </span>
                  <button
                    className="secondary compact"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary compact"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await save(
                        {
                          action: "parking-rental-delete",
                          rentalId: rental.id,
                        },
                        "Parking rental deleted",
                      );
                      if (ok) {
                        setRental(null);
                        setConfirmDelete(false);
                      }
                    }}
                  >
                    Confirm delete
                  </button>
                </div>
              ) : (
                <button
                  className="secondary compact"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete rental
                </button>
              )}
            </section>
            )}
          </aside>
        </div>
      )}
      {lot && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setLot(null)}
        >
          <aside className="unit-drawer student-drawer">
            <div className="drawer-head">
              <div>
                <small>PARKING LOT</small>
                <h2>{lot.lotNumber}</h2>
                <p>
                  {lot.hostelName}
                  {lot.unitCode ? ` / ${lot.unitCode}` : " · Common lot"}
                </p>
              </div>
              <button onClick={() => setLot(null)}>×</button>
            </div>
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>STATUS</small>
                  <h3>Current state</h3>
                </div>
                <StatusPill status={lot.deletedAt ? "deleted" : lot.status} />
              </div>
              {lot.deletedAt && (
                <p className="field-note">
                  Deleted {dateLabel(lot.deletedAt)}
                  {lot.deletedBy ? ` by ${lot.deletedBy}` : ""}.
                </p>
              )}
            </section>
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>RENTAL HISTORY</small>
                  <h3>Every tenant this lot has had</h3>
                </div>
              </div>
              {(() => {
                const history = data.parkingRentals
                  .filter((r) => r.parkingLotId === lot.id)
                  .sort((a, b) => Number(b.id) - Number(a.id));
                if (!history.length)
                  return (
                    <p className="empty-copy">
                      No rentals recorded for this lot yet.
                    </p>
                  );
                return (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tenant</th>
                          <th>Car</th>
                          <th>Period</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((r) => (
                          <tr
                            key={r.id}
                            className="v2-row-clickable"
                            onClick={() => {
                              setLot(null);
                              setRental(r);
                              setConfirmDelete(false);
                            }}
                          >
                            <td>
                              <strong>{r.tenantName}</strong>
                              <small>{titleCase(r.tenantType)}</small>
                            </td>
                            <td>
                              {r.carPlateNumber || "-"}
                              <small>{r.carModel || "Model not set"}</small>
                            </td>
                            <td>
                              {dateLabel(r.startDate)} –{" "}
                              {r.endDate ? dateLabel(r.endDate) : "now"}
                            </td>
                            <td>
                              <StatusPill
                                status={r.deletedAt ? "deleted" : r.status}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </section>
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>{lot.deletedAt ? "RESTORE" : "REMOVE"}</small>
                  <h3>
                    {lot.deletedAt ? "Restore this lot" : "Delete this lot"}
                  </h3>
                </div>
              </div>
              {lot.deletedAt ? (
                <button
                  className="primary compact"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await save(
                      { action: "parking-lot-restore", lotId: lot.id },
                      "Parking lot restored",
                    );
                    if (ok) setLot(null);
                  }}
                >
                  Restore lot
                </button>
              ) : confirmDeleteLot ? (
                <div className="button-row">
                  <span className="empty-copy">
                    Delete this lot? It can be restored later, and a lot
                    with an active rental can&rsquo;t be deleted.
                  </span>
                  <button
                    className="secondary compact"
                    onClick={() => setConfirmDeleteLot(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary compact"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await save(
                        { action: "parking-lot-delete", lotId: lot.id },
                        "Parking lot deleted",
                      );
                      if (ok) {
                        setLot(null);
                        setConfirmDeleteLot(false);
                      }
                    }}
                  >
                    Confirm delete
                  </button>
                </div>
              ) : (
                <button
                  className="secondary compact"
                  onClick={() => setConfirmDeleteLot(true)}
                >
                  Delete lot
                </button>
              )}
            </section>
          </aside>
        </div>
      )}
      {modal === "lot" && (
        <Modal
          title="Add parking lot"
          kicker="PARKING INVENTORY"
          onClose={() => setModal("")}
        >
          <AddParkingLotForm
            data={data}
            save={save}
            busy={busy}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "rental" && (
        <Modal
          title="New parking rental"
          kicker="IN-HOUSE OR OUTSIDE"
          onClose={() => setModal("")}
          wide
        >
          <ParkingRentalForm
            data={data}
            save={save}
            busy={busy}
            lockedLotId={reservingLotId ?? undefined}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "replace" && rental && (
        <Modal
          title="New tenant for this lot"
          kicker={rental.lotNumber}
          description={`Ends ${rental.tenantName}'s rental today and starts a new one — the old rental stays on file, it just moves to "Ended".`}
          onClose={() => setModal("")}
          wide
        >
          <ParkingRentalForm
            data={data}
            save={save}
            busy={busy}
            lockedLotId={rental.parkingLotId}
            replacesRentalId={rental.id}
            onDone={() => {
              setModal("");
              setRental(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
