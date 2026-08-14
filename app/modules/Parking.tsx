"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Modal,
  ParkingRentalForm,
  Stat,
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
          placeholder={LOT_NUMBER_HINTS[String(hostel?.code || "")] || "e.g. Parking 101"}
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
  const [rentalTab, setRentalTab] = useState<"active" | "ended" | "outside">(
    "active",
  );
  const [rentalSort, setRentalSort] = useState("lotNumber");
  const [rentalSortDir, setRentalSortDir] = useState<"asc" | "desc">("asc");
  const [rental, setRental] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    (lot) => hostelFilter === "all" || String(lot.hostelId) === hostelFilter,
  );
  const filteredRentals = data.parkingRentals
    .filter((r) => {
      const lot = data.parkingLots.find((l) => l.id === r.parkingLotId);
      const hostelMatch =
        hostelFilter === "all" || String(lot?.hostelId || "") === hostelFilter;
      const tabMatch =
        rentalTab === "outside"
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
        <div className="workspace-tabs">
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
        </div>
        <div className="filters">
          <label className="search">
            <span>Search rentals</span>
            <input
              value={rentalSearch}
              onChange={(e) => setRentalSearch(e.target.value)}
              placeholder="Tenant, car plate, lot or hostel"
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
                    <span className={`unit-status ${r.status}`}>
                      {titleCase(r.status)}
                    </span>
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
                    setReservingLotId(l.id);
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
                  <input
                    name="startDate"
                    type="date"
                    required
                    placeholder="e.g. 2026-01-01"
                    defaultValue={rental.startDate || ""}
                  />
                </label>
                <label>
                  Paid until
                  <input
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
                  <input
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
                    Delete permanently? An active rental frees its lot.
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
    </>
  );
}
