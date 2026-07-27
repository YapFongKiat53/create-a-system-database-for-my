"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Modal,
  SearchSelect,
  Stat,
  dateLabel,
  formValues,
  money,
  titleCase,
} from "./shared";
import type { Data, Row } from "./shared";

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
  const [tenantType, setTenantType] = useState("in-house");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [billingFrequency, setBillingFrequency] = useState("monthly");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [rentalSearch, setRentalSearch] = useState("");
  const [rentalTab, setRentalTab] = useState<"active" | "ended" | "outside">(
    "active",
  );
  const [rentalSort, setRentalSort] = useState("lotNumber");
  const [rentalSortDir, setRentalSortDir] = useState<"asc" | "desc">("asc");
  const [rental, setRental] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectedStudent = data.students.find(
    (student) => String(student.id) === selectedStudentId,
  );
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
  const filteredOwnerPayments = data.ownerParkingPayments.filter(
    (payment) =>
      hostelFilter === "all" || String(payment.hostelId || "") === hostelFilter,
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
            className="secondary"
            onClick={() => setModal("owner-payment")}
          >
            + Owner payment
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
                    {r.billingFrequency === "package"
                      ? `${r.packageMonths || 2}-month package`
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
            <small>OWNER PARKING PAYMENTS</small>
            <h3>Payments recorded for owners</h3>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Owner / Unit</th>
                <th>Lot</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Payment date</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filteredOwnerPayments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.ownerName || "Owner not set"}</strong>
                    <small>
                      {p.hostelName} / {p.unitCode}
                    </small>
                  </td>
                  <td>{p.lotNumber || "-"}</td>
                  <td>{p.period || "-"}</td>
                  <td>{money(p.amount)}</td>
                  <td>{dateLabel(p.paymentDate)}</td>
                  <td>{titleCase(p.method)}</td>
                  <td>{p.reference || "-"}</td>
                  <td>
                    <span className={`unit-status ${p.status}`}>
                      {titleCase(p.status)}
                    </span>
                  </td>
                  <td>{p.remarks || "-"}</td>
                </tr>
              ))}
              {filteredOwnerPayments.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <em>No owner parking payments recorded yet.</em>
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
                    defaultValue={rental.tenantName}
                  />
                </label>
                <label>
                  Contact number
                  <input
                    name="contactNumber"
                    defaultValue={rental.contactNumber}
                  />
                </label>
                <label>
                  Unit number
                  <input name="unitNumber" defaultValue={rental.unitNumber} />
                </label>
                <label>
                  Car plate
                  <input
                    name="carPlateNumber"
                    defaultValue={rental.carPlateNumber}
                  />
                </label>
                <label>
                  Car model
                  <input name="carModel" defaultValue={rental.carModel} />
                </label>
                <label>
                  Monthly rental
                  <input
                    name="monthlyRental"
                    type="number"
                    min="0"
                    defaultValue={rental.monthlyRental ?? ""}
                  />
                </label>
                <label>
                  Deposit
                  <input
                    name="depositAmount"
                    type="number"
                    min="0"
                    defaultValue={rental.depositAmount ?? ""}
                  />
                </label>
                <label>
                  Start date
                  <input
                    name="startDate"
                    type="date"
                    required
                    defaultValue={rental.startDate || ""}
                  />
                </label>
                <label>
                  End date
                  <input
                    name="endDate"
                    type="date"
                    defaultValue={rental.endDate || ""}
                  />
                </label>
                <label>
                  Paid until
                  <input
                    name="paidUntil"
                    type="date"
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
                    <option value="package">Package / several months</option>
                  </select>
                </label>
                <label>
                  Package length (months)
                  <input
                    name="packageMonths"
                    type="number"
                    min="1"
                    max="24"
                    defaultValue={rental.packageMonths ?? 1}
                  />
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
      {modal === "owner-payment" && (
        <Modal
          title="Add owner parking payment"
          kicker="PARKING PAYMENT TO OWNER"
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "parking-owner-payment", ...formValues(e) },
                "Owner payment recorded",
              );
              if (ok) setModal("");
            }}
          >
            <label className="wide">
              Owner / Unit
              <SearchSelect
                name="unitId"
                required
                options={data.units.map((u) => ({
                  value: u.id,
                  label: `${u.hostelName}/${u.unitCode}${u.ownerName ? ` · ${u.ownerName}` : ""}`,
                }))}
                placeholder="Type unit code, hostel or owner name"
              />
            </label>
            <label className="wide">
              Parking lot (optional)
              <SearchSelect
                name="parkingLotId"
                options={data.parkingLots.map((lot) => ({
                  value: lot.id,
                  label: `${lot.hostelName} · ${lot.lotNumber} · ${lot.unitCode || "Common"}`,
                }))}
                placeholder="Type hostel, lot or unit"
              />
            </label>
            <label>
              Payment for period
              <input name="period" placeholder="e.g. July 2026" />
            </label>
            <label>
              Amount
              <input name="amount" type="number" min="0" step="0.01" required />
            </label>
            <label>
              Payment date
              <input name="paymentDate" type="date" required />
            </label>
            <label>
              Payment method
              <select name="method">
                <option value="bank-transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
            <label>
              Reference / receipt no.
              <input name="reference" />
            </label>
            <label>
              Status
              <select name="status">
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <label className="wide">
              Remarks
              <input name="remarks" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Record payment
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
