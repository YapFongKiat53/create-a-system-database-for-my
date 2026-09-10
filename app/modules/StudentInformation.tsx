"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  CheckInModal,
  CourseOptions,
  DemographicFields,
  Modal,
  SearchIcon,
  Stat,
  StatusPill,
  DEPOSIT_MONTHS,
  blockOf,
  dateLabel,
  depositFor,
  effectiveRateOn,
  formValues,
  money,
  nextScheduledRate,
  paginationItems,
  roomOptionLabel,
  roomOptionsFrom,
  titleCase,
  today,
} from "./shared";
import type { Data, Row } from "./shared";
import { BASE_PATH } from "../basePath";

type DirectoryTab =
  | "all"
  | "active"
  | "awaiting-check-in"
  | "checked-in"
  | "moved-out"
  | "agency";
type CompletionFilter = "all" | "complete" | "incomplete";
type SelectedStudentRef = {
  studentId: string | number;
  assignmentId?: string | number | null;
};

const UNASSIGNED_HOSTEL_KEY = "__unassigned__";

// Moving a sitting tenant. Unlike the reservation-stage room change in Hostel
// Information, this does not restate the move-in charges: what the student was
// billed on arrival is history, and the new rent takes over through the next
// monthly invoice instead. The figures still deserve the same treatment the
// reservation flow gives them — priced off the room, deposit at the house
// rate, and the change spelled out before it is confirmed.
function RoomChangeForm({
  data,
  student,
  save,
  busy,
  onDone,
}: {
  data: Data;
  student: Row;
  save: any;
  busy: boolean;
  onDone: () => void;
}) {
  const current = effectiveRateOn(data.studentRateChanges, student.assignmentId, {
    monthlyRental: student.monthlyRental,
    securityDeposit: student.securityDeposit,
  });
  const [bed, setBed] = useState<Row | null>(null);
  // Staff picked a room, so the summary has to name rooms too — echoing the
  // internal bed code back at them would contradict the picker they just used.
  const roomCodeOf = (row: Row | null | undefined) =>
    row ? `${row.unitCode}-${row.roomLabel}` : null;
  const currentRoomCode =
    roomCodeOf(
      data.bedSpaces.find(
        (row) => String(row.assignmentId) === String(student.assignmentId),
      ),
    ) || student.roomCode;
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rental, setRental] = useState("");
  const [deposit, setDeposit] = useState("");
  const [depositOverridden, setDepositOverridden] = useState(false);
  const [accessCardDeposit, setAccessCardDeposit] = useState(
    student.accessCardDeposit === null || student.accessCardDeposit === undefined
      ? ""
      : String(student.accessCardDeposit),
  );

  // Same promotion-window rule the availability picker and conversion use.
  const rateOfBed = (row: Row | null) => {
    if (!row) return null;
    const promoActive =
      row.promotionRate !== null &&
      row.promotionRate !== undefined &&
      (!row.promotionStartDate || row.promotionStartDate <= today) &&
      (!row.promotionEndDate || row.promotionEndDate >= today);
    const rate = promoActive
      ? row.promotionRate
      : (row.salesRate ?? row.monthlyRental);
    return rate === null || rate === undefined ? null : Number(rate);
  };

  const applyRental = (value: string) => {
    setRental(value);
    if (!depositOverridden)
      setDeposit(value === "" ? "" : String(depositFor(Number(value))));
  };

  const onPickRoom = (row: Row | null) => {
    setBed(row);
    const rate = rateOfBed(row);
    if (rate !== null) applyRental(String(rate));
  };

  const rentDelta =
    rental === "" || current.monthlyRental === null
      ? null
      : Number(rental) - Number(current.monthlyRental);
  const depositDelta =
    deposit === "" || current.securityDeposit === null
      ? null
      : Number(deposit) - Number(current.securityDeposit);

  return (
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
            monthlyRental: rental,
            securityDeposit: deposit,
            accessCardDeposit,
            effectiveDate,
          },
          "Student moved to new room",
        );
        if (ok) onDone();
      }}
    >
      <p className="wide rate-form-current">
        Currently in <b>{currentRoomCode || "no room"}</b> at{" "}
        <b>{money(current.monthlyRental, true)}</b> with{" "}
        <b>{money(current.securityDeposit, true)}</b> deposit on record.
      </p>

      <RoomPickerFields
        data={data}
        gender={student.gender}
        onSelect={onPickRoom}
      />

      <label>
        Effective date
        <input
          name="effectiveDate"
          type="date"
          required
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
      </label>
      <label>
        New monthly rental
        <input
          type="number"
          min="0"
          value={rental}
          onChange={(event) => applyRental(event.target.value)}
          placeholder="e.g. 1000"
        />
        <small className="field-note">
          {bed
            ? rateOfBed(bed) === null
              ? "This room has no price set — enter one."
              : "Taken from the room's price. Override if a special rate applies."
            : "Pick a room and its price fills in."}
        </small>
      </label>
      <label>
        New security deposit
        <input
          type="number"
          min="0"
          value={deposit}
          onChange={(event) => {
            setDeposit(event.target.value);
            setDepositOverridden(true);
          }}
          placeholder="e.g. 3000"
        />
        <small className="field-note">
          {depositOverridden
            ? `Manually set — the house rate would be ${money(depositFor(Number(rental || 0)), true)}.`
            : `Automatically ${DEPOSIT_MONTHS} months of the new rent.`}
        </small>
      </label>
      <label>
        Access card deposit
        <input
          type="number"
          min="0"
          value={accessCardDeposit}
          onChange={(event) => setAccessCardDeposit(event.target.value)}
          placeholder="e.g. 100"
        />
      </label>
      <label>
        Old room check-out meter
        <input name="checkOutMeter" type="number" step="0.01" placeholder="e.g. 1000" />
        <small className="field-note">
          Leave blank and this student is charged for the old room&apos;s full
          meter period, including usage after they left.
        </small>
      </label>
      <label>
        New room check-in meter
        <input name="checkInMeter" type="number" step="0.01" placeholder="e.g. 1000" />
        <small className="field-note">
          Blank means they share the new room&apos;s whole period, including
          usage before they arrived.
        </small>
      </label>
      <label>
        New lease end
        <input name="leaseEndDate" type="date" />
      </label>
      <label className="wide">
        Reason / remarks
        <input name="reason" placeholder="e.g. Upgrading to a larger room" />
      </label>

      {(rentDelta !== null || depositDelta !== null) && (
        <div className="wide move-summary">
          <small>WHAT CHANGES</small>
          <ul>
            <li>
              Room <b>{currentRoomCode || "—"}</b> →{" "}
              <b>{roomCodeOf(bed) || "not selected"}</b>
            </li>
            {rentDelta !== null && (
              <li className={rentDelta > 0 ? "up" : rentDelta < 0 ? "down" : ""}>
                Rent {money(current.monthlyRental, true)} →{" "}
                <b>{money(Number(rental), true)}</b>
                {rentDelta === 0
                  ? " (no change)"
                  : rentDelta > 0
                    ? ` · up ${money(rentDelta, true)} a month`
                    : ` · down ${money(-rentDelta, true)} a month`}
              </li>
            )}
            {depositDelta !== null && (
              <li
                className={
                  depositDelta > 0 ? "up" : depositDelta < 0 ? "down" : ""
                }
              >
                Deposit on record {money(current.securityDeposit, true)} →{" "}
                <b>{money(Number(deposit), true)}</b>
                {depositDelta === 0
                  ? " (no change)"
                  : depositDelta > 0
                    ? ` · up ${money(depositDelta, true)}`
                    : ` · down ${money(-depositDelta, true)}`}
              </li>
            )}
          </ul>
          {depositDelta !== null && depositDelta !== 0 && (
            <p className="field-note">
              The {money(Math.abs(depositDelta), true)} difference
              {depositDelta > 0
                ? " is added to the next monthly invoice as a deposit top-up"
                : " is credited back on the next monthly invoice"}
              . The deposit already held stays held — the student is never
              asked for a second full deposit.
            </p>
          )}
        </div>
      )}

      <div className="form-actions wide">
        <button className="primary" disabled={busy || !effectiveDate}>
          Confirm room change
        </button>
      </div>
    </form>
  );
}

// Deposit tracks rent at the house rate unless someone deliberately breaks
// the link, matching how every other part of the system derives it. Leaving
// a field blank carries the current figure forward rather than zeroing it.
function RateChangeForm({
  data,
  student,
  save,
  busy,
  onDone,
}: {
  data: Data;
  student: Row;
  save: any;
  busy: boolean;
  onDone: () => void;
}) {
  const current = effectiveRateOn(data.studentRateChanges, student.assignmentId, {
    monthlyRental: student.monthlyRental,
    securityDeposit: student.securityDeposit,
  });
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rental, setRental] = useState(
    current.monthlyRental === null ? "" : String(current.monthlyRental),
  );
  const [deposit, setDeposit] = useState(
    current.securityDeposit === null ? "" : String(current.securityDeposit),
  );
  const [depositOverridden, setDepositOverridden] = useState(false);
  const [reason, setReason] = useState("");

  const applyRental = (value: string) => {
    setRental(value);
    if (!depositOverridden)
      setDeposit(value === "" ? "" : String(depositFor(Number(value))));
  };

  const rentDelta =
    rental === "" || current.monthlyRental === null
      ? null
      : Number(rental) - Number(current.monthlyRental);
  const backdated = effectiveDate !== "" && effectiveDate <= today;

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          {
            action: "student-rate-change",
            assignmentId: student.assignmentId,
            effectiveDate,
            monthlyRental: rental,
            securityDeposit: deposit,
            reason,
          },
          "Rate change scheduled",
        );
        if (ok) onDone();
      }}
    >
      <p className="wide rate-form-current">
        Currently billing at <b>{money(current.monthlyRental, true)}</b> with{" "}
        <b>{money(current.securityDeposit, true)}</b> deposit on record.
      </p>
      <label>
        Effective date
        <input
          name="effectiveDate"
          type="date"
          required
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
        <small className="field-note">
          {backdated
            ? "This date has passed — the change counts as already in effect and cannot be removed afterwards."
            : "The first billing cut-off on or after this date uses the new rate."}
        </small>
      </label>
      <label>
        New monthly rental
        <input
          type="number"
          min="0"
          value={rental}
          onChange={(event) => applyRental(event.target.value)}
          placeholder="e.g. 1000"
        />
        {rentDelta !== null && rentDelta !== 0 && (
          <small
            className={`field-note ${rentDelta > 0 ? "rate-up" : "rate-down"}`}
          >
            {rentDelta > 0 ? "Increase of " : "Decrease of "}
            {money(Math.abs(rentDelta), true)} per month
          </small>
        )}
      </label>
      <label>
        Security deposit
        <input
          type="number"
          min="0"
          value={deposit}
          onChange={(event) => {
            setDeposit(event.target.value);
            setDepositOverridden(true);
          }}
          placeholder="e.g. 3000"
        />
        <small className="field-note">
          {depositOverridden
            ? `Manually set — the house rate would be ${money(depositFor(Number(rental || 0)), true)}.`
            : `Automatically ${DEPOSIT_MONTHS} months of the new rent.`}
        </small>
      </label>
      <label className="wide">
        Reason
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Short-term renewal, promotion ended..."
        />
      </label>
      <p className="wide field-note">
        Only the difference between the deposit held and the new figure is
        billed — it lands on the next monthly invoice as a deposit top-up, or
        as a credit if the new figure is lower. The student is never charged a
        second full deposit.
      </p>
      <div className="form-actions wide">
        <button className="primary" disabled={busy || !effectiveDate}>
          Schedule change
        </button>
      </div>
    </form>
  );
}

// A rate change is scheduled, not applied — it sits beside the tenancy and
// the monthly billing run picks up whichever one is in effect on the cut-off
// date. That makes the headline figure here the important one: it is what
// the next invoice will actually charge, which is not necessarily the rent
// recorded on the tenancy itself.
function StudentRateChanges({
  data,
  student,
  save,
  busy,
  onAdd,
}: {
  data: Data;
  student: Row;
  save: any;
  busy: boolean;
  onAdd: () => void;
}) {
  const changes = data.studentRateChanges
    .filter(
      (change) => String(change.assignmentId) === String(student.assignmentId),
    )
    .sort((a, b) =>
      String(b.effectiveDate).localeCompare(String(a.effectiveDate)),
    );
  const current = effectiveRateOn(data.studentRateChanges, student.assignmentId, {
    monthlyRental: student.monthlyRental,
    securityDeposit: student.securityDeposit,
  });
  const upcoming = nextScheduledRate(
    data.studentRateChanges,
    student.assignmentId,
  );
  // Only the newest change on or before today is the one billing reads; any
  // older one has been superseded even though it still shows in the history.
  const liveChangeId = changes.find(
    (change) => String(change.effectiveDate) <= today,
  )?.id;

  const removeChange = async (change: Row) => {
    if (
      !window.confirm(
        `Remove the rate change effective ${dateLabel(change.effectiveDate)}? This cannot be undone.`,
      )
    )
      return;
    await save(
      { action: "student-rate-change-delete", changeId: change.id },
      "Scheduled rate change removed",
    );
  };

  if (!student.assignmentId)
    return (
      <section className="drawer-section">
        <div className="section-title">
          <div>
            <small>RATE CHANGE</small>
            <h3>Effective-dated rental adjustments</h3>
          </div>
        </div>
        <p className="empty-copy">
          No active room assignment yet — assign a room first.
        </p>
      </section>
    );

  return (
    <section className="drawer-section">
      <div className="section-title">
        <div>
          <small>RATE CHANGE</small>
          <h3>What this student is billed, and when it changes</h3>
        </div>
        <button className="secondary compact" onClick={onAdd}>
          + Rate change
        </button>
      </div>

      <div className="rate-now">
        <div>
          <small>BILLING AT</small>
          <b>{money(current.monthlyRental, true)}</b>
          <span>
            {current.source === "rate-change"
              ? `Rate change effective ${dateLabel(current.effectiveDate)}`
              : "Rate recorded on the tenancy"}
          </span>
        </div>
        <div>
          <small>DEPOSIT ON RECORD</small>
          <b>{money(current.securityDeposit, true)}</b>
          <span>
            {current.securityDeposit && current.monthlyRental
              ? `${(Number(current.securityDeposit) / Number(current.monthlyRental)).toFixed(1)} months of rent`
              : "Not set"}
          </span>
        </div>
        <div>
          <small>NEXT CHANGE</small>
          <b>
            {upcoming ? money(upcoming.monthlyRental, true) : "None scheduled"}
          </b>
          <span>
            {upcoming
              ? `From ${dateLabel(upcoming.effectiveDate)}`
              : "Current rate continues"}
          </span>
        </div>
      </div>

      {changes.length ? (
        <div className="rate-timeline">
          {changes.map((change) => {
            const scheduled = String(change.effectiveDate) > today;
            const live = String(change.id) === String(liveChangeId);
            return (
              <div
                key={change.id}
                className={`rate-entry${live ? " live" : ""}${scheduled ? " scheduled" : ""}`}
              >
                <span className="rate-entry-date">
                  <b>{dateLabel(change.effectiveDate)}</b>
                  <small>
                    {scheduled
                      ? "Scheduled"
                      : live
                        ? "In effect now"
                        : "Superseded"}
                  </small>
                </span>
                <span className="rate-entry-figures">
                  <b>
                    {change.monthlyRental === null
                      ? "Rent unchanged"
                      : `${money(change.monthlyRental, true)} rent`}
                  </b>
                  <small>
                    {change.securityDeposit === null
                      ? "Deposit unchanged"
                      : `${money(change.securityDeposit, true)} deposit`}
                    {change.reason ? ` · ${change.reason}` : ""}
                  </small>
                </span>
                {scheduled ? (
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => removeChange(change)}
                  >
                    Remove
                  </button>
                ) : (
                  <span className="muted">Locked</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">
          No rate changes yet — this student is billed at the rent recorded on
          their tenancy.
        </p>
      )}

      <p className="field-note">
        A rate change does not rewrite the tenancy or any invoice already
        issued. The monthly billing run applies whichever change is in effect
        on its cut-off date. Only a change that has not taken effect yet can be
        removed.
      </p>
    </section>
  );
}

// Everything this student has ever been charged and everything they have
// actually paid, in one place. The figures are read straight from Finance's
// own records — invoices, their charge lines and their receipts — so this is
// a per-student view of Finance, never a second set of books. Parking is
// listed separately because an outside-tenant style rental is billed on its
// own and never appears as an invoice line.
function StudentBilling({
  data,
  student,
  openInvoiceId,
  setOpenInvoiceId,
}: {
  data: Data;
  student: Row;
  openInvoiceId: string | number | null;
  setOpenInvoiceId: (id: string | number | null) => void;
}) {
  const invoices = data.invoices.filter(
    (invoice) => String(invoice.studentId) === String(student.id),
  );
  // A payment counts as money in hand once Finance has verified it; the
  // verified figure wins because that is the amount that actually landed.
  const receivedOn = (invoice: Row) =>
    (invoice.payments || [])
      .filter((payment: Row) => payment.status === "verified")
      .reduce(
        (sum: number, payment: Row) =>
          sum + Number(payment.verifiedAmount ?? payment.amount ?? 0),
        0,
      );
  const pendingOn = (invoice: Row) =>
    (invoice.payments || [])
      .filter((payment: Row) => payment.status !== "verified")
      .reduce(
        (sum: number, payment: Row) => sum + Number(payment.amount || 0),
        0,
      );

  const totalBilled = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.totalAmount || 0),
    0,
  );
  const totalReceived = invoices.reduce(
    (sum, invoice) => sum + receivedOn(invoice),
    0,
  );
  const totalPending = invoices.reduce(
    (sum, invoice) => sum + pendingOn(invoice),
    0,
  );
  const balance = totalBilled - totalReceived;

  // Money arrives against one invoice but settles the account as a whole: an
  // overpayment on an early bill covers a later one. Billing no longer emits a
  // credit line for that (doing so let the same ringgit reduce the balance
  // twice), so the surplus is applied here instead — oldest invoice first,
  // which is both how the money would be applied in practice and what stops a
  // covered invoice from looking unpaid.
  const settledOf = new Map<string, number>();
  let creditPool = totalReceived;
  for (const invoice of [...invoices].sort(
    (a, b) => Number(a.id) - Number(b.id),
  )) {
    const due = Math.max(0, Number(invoice.totalAmount || 0));
    const applied = Math.min(creditPool, due);
    creditPool -= applied;
    settledOf.set(String(invoice.id), applied);
  }
  // Anything left over has not been claimed by any invoice yet.
  const unappliedCredit = creditPool;

  // Why the rent on an invoice changed. A room change closes one tenancy and
  // opens another, so the rent and deposit only make sense read against the
  // room that was actually held at the time.
  const tenancies = [
    ...(data.pastTenancies || []).filter(
      (row) => String(row.studentId) === String(student.id),
    ),
    {
      id: student.assignmentId,
      roomCode:
        (() => {
          const bed = data.bedSpaces.find(
            (row) => String(row.assignmentId) === String(student.assignmentId),
          );
          return bed ? `${bed.unitCode}-${bed.roomLabel}` : student.roomCode;
        })(),
      hostelName: student.hostelName,
      monthlyRental: student.monthlyRental,
      securityDeposit: student.securityDeposit,
      checkInDate: student.checkInDate,
      checkOutDate: null,
      status: "active",
    },
  ]
    .filter((row) => row.id)
    .sort((a, b) => Number(a.id) - Number(b.id));
  const depositChanges = (data.depositAdjustments || []).filter((row) =>
    tenancies.some((t) => String(t.id) === String(row.assignmentId)),
  );

  const parking = data.parkingRentals.filter(
    (rental) => String(rental.studentId) === String(student.id),
  );

  const slipsFor = (paymentId: string | number) =>
    data.attachments.filter(
      (attachment) =>
        attachment.contextType === "payment-proof" &&
        String(attachment.recordId) === String(paymentId),
    );

  return (
    <section className="drawer-section">
      <div className="section-title">
        <div>
          <small>BILLING INFORMATION</small>
          <h3>Everything charged and everything paid</h3>
        </div>
      </div>

      <div className="billing-summary">
        <div>
          <small>TOTAL BILLED</small>
          <b>{money(totalBilled, true)}</b>
          <span>
            {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
          </span>
        </div>
        <div>
          <small>RECEIVED</small>
          <b className="figure-in">{money(totalReceived, true)}</b>
          <span>
            {totalPending
              ? `${money(totalPending, true)} awaiting verification`
              : "All payments verified"}
          </span>
        </div>
        <div>
          <small>{balance < 0 ? "CREDIT" : "OUTSTANDING"}</small>
          <b className={balance > 0 ? "figure-out" : "figure-in"}>
            {money(Math.abs(balance), true)}
          </b>
          <span>
            {balance > 0
              ? "Still owed by the student"
              : balance < 0
                ? "Carries to the next invoice"
                : "Fully settled"}
          </span>
        </div>
      </div>

      {unappliedCredit > 0.005 && (
        <p className="billing-credit-note">
          <b>{money(unappliedCredit, true)}</b> of this student&apos;s payments
          is not claimed by any invoice yet — it settles the next one
          automatically, so nothing needs to be recorded again.
        </p>
      )}

      {invoices.length ? (
        <div className="billing-invoice-list">
          {invoices.map((invoice) => {
            const received = receivedOn(invoice);
            const pending = pendingOn(invoice);
            // Settled by the account, not just by payments booked against
            // this one invoice — otherwise a bill covered by an earlier
            // overpayment reads as outstanding.
            const settled = settledOf.get(String(invoice.id)) || 0;
            const owed = Number(invoice.totalAmount || 0) - settled;
            const coveredElsewhere = settled - received;
            const open = String(openInvoiceId) === String(invoice.id);
            const items = invoice.items || [];
            const payments = invoice.payments || [];
            return (
              <article
                key={invoice.id}
                className={`billing-invoice${open ? " open" : ""}`}
              >
                <button
                  type="button"
                  className="billing-invoice-head"
                  aria-expanded={open}
                  onClick={() => setOpenInvoiceId(open ? null : invoice.id)}
                >
                  <span className="billing-invoice-id">
                    <code>{invoice.invoiceNo}</code>
                    <small>
                      {invoice.cycleId ? "Monthly billing" : "Move-in costs"}
                      {invoice.roomCode ? ` · ${invoice.roomCode}` : ""}
                      {invoice.dueDate
                        ? ` · Due ${dateLabel(invoice.dueDate)}`
                        : ""}
                    </small>
                  </span>
                  <span className="billing-invoice-figures">
                    <b>{money(invoice.totalAmount, true)}</b>
                    <small>
                      {money(settled, true)} settled
                      {coveredElsewhere > 0.005
                        ? ` (${money(coveredElsewhere, true)} from earlier payments)`
                        : ""}
                      {owed > 0.005 ? ` · ${money(owed, true)} owing` : ""}
                    </small>
                  </span>
                  {/* Reads the account position, not the stored status: an
                      invoice covered by an earlier overpayment is settled even
                      though no payment was booked against it directly. */}
                  <StatusPill
                    status={
                      owed <= 0.005
                        ? "paid"
                        : settled > 0.005
                          ? "partial"
                          : "unpaid"
                    }
                  />
                  <span className="billing-chevron" aria-hidden="true">
                    {open ? "−" : "+"}
                  </span>
                </button>

                {open && (
                  <div className="billing-invoice-body">
                    <h4>What was charged</h4>
                    {items.length ? (
                      <table className="billing-mini-table">
                        <tbody>
                          {items.map((item: Row) => (
                            <tr key={item.id}>
                              <td>{item.description}</td>
                              <td className="num">
                                {money(item.amount, true)}
                              </td>
                            </tr>
                          ))}
                          <tr className="billing-total-row">
                            <td>Invoice total</td>
                            <td className="num">
                              {money(invoice.totalAmount, true)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="empty-copy">
                        No charge lines recorded on this invoice.
                      </p>
                    )}

                    <h4>
                      Payments received
                      {pending
                        ? ` · ${money(pending, true)} awaiting verification`
                        : ""}
                    </h4>
                    {payments.length ? (
                      <div className="billing-payment-list">
                        {payments.map((payment: Row) => {
                          const slips = slipsFor(payment.id);
                          const verified = payment.status === "verified";
                          return (
                            <div key={payment.id} className="billing-payment">
                              <span className="billing-payment-amount">
                                <b>
                                  {money(
                                    verified
                                      ? (payment.verifiedAmount ??
                                        payment.amount)
                                      : payment.amount,
                                    true,
                                  )}
                                </b>
                                {verified &&
                                  payment.verifiedAmount !== null &&
                                  Number(payment.verifiedAmount) !==
                                    Number(payment.amount) && (
                                    <small>
                                      submitted {money(payment.amount, true)}
                                    </small>
                                  )}
                              </span>
                              <span className="billing-payment-meta">
                                <b>
                                  {payment.receiptNo || "Receipt not issued"}
                                </b>
                                <small>
                                  {dateLabel(
                                    payment.verifiedAt || payment.submittedAt,
                                  )}
                                  {payment.actualReference || payment.reference
                                    ? ` · ${payment.actualReference || payment.reference}`
                                    : ""}
                                  {payment.verifiedBy
                                    ? ` · verified by ${payment.verifiedBy}`
                                    : ""}
                                </small>
                              </span>
                              <StatusPill status={payment.status} />
                              {slips.length ? (
                                <a
                                  className="secondary compact"
                                  href={`${BASE_PATH}/api/files?id=${slips[0].id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View slip
                                </a>
                              ) : (
                                <span className="muted">No slip</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="empty-copy">
                        Nothing has been paid against this invoice yet.
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy">
          No invoices for this student yet. Move-in costs appear here once the
          reservation is converted; monthly charges appear once a billing cycle
          is run.
        </p>
      )}

      {tenancies.length > 1 && (
        <>
          <h4>Rooms held — what each invoice was billed at</h4>
          <div className="tenancy-timeline">
            {tenancies.map((row, index) => {
              const previous = index > 0 ? tenancies[index - 1] : null;
              const rentDelta =
                previous && previous.monthlyRental !== null
                  ? Number(row.monthlyRental || 0) -
                    Number(previous.monthlyRental || 0)
                  : null;
              const change = depositChanges.find(
                (item) => String(item.assignmentId) === String(row.id),
              );
              return (
                <div
                  key={row.id}
                  className={`tenancy-entry${row.status === "active" ? " current" : ""}`}
                >
                  <span className="tenancy-when">
                    <b>{row.roomCode || "Room not set"}</b>
                    <small>
                      {dateLabel(row.checkInDate)} →{" "}
                      {row.checkOutDate
                        ? dateLabel(row.checkOutDate)
                        : "current"}
                    </small>
                  </span>
                  <span className="tenancy-figures">
                    <b>{money(row.monthlyRental, true)} a month</b>
                    <small>
                      {money(row.securityDeposit, true)} deposit
                      {rentDelta !== null && rentDelta !== 0
                        ? ` · rent ${rentDelta > 0 ? "up" : "down"} ${money(Math.abs(rentDelta), true)}`
                        : ""}
                      {change
                        ? ` · deposit ${Number(change.amount) > 0 ? "top-up" : "refund"} ${money(Math.abs(Number(change.amount)), true)}${change.invoiceNo ? ` on ${change.invoiceNo}` : " on the next invoice"}`
                        : ""}
                    </small>
                  </span>
                  <StatusPill
                    status={row.status === "active" ? "active" : "moved-out"}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}

      {parking.length > 0 && (
        <>
          <h4>Parking — billed separately</h4>
          <div className="compact-list">
            {parking.map((rental) => (
              <span key={rental.id}>
                <b>
                  {money(rental.monthlyRental, true)} ·{" "}
                  {titleCase(rental.billingFrequency || "monthly")}
                </b>
                <small>
                  {rental.carPlateNumber || "No plate recorded"} ·{" "}
                  {titleCase(rental.paymentStatus || "not-due")}
                  {rental.depositAmount
                    ? ` · deposit ${money(rental.depositAmount, true)} held`
                    : ""}
                </small>
              </span>
            ))}
          </div>
        </>
      )}

      <p className="field-note">
        These figures come straight from Finance. To record or verify a payment,
        open the invoice in Finance — this tab is a read-only view.
      </p>
    </section>
  );
}
const PAGE_SIZE = 20;

function normaliseStatus(value: unknown, fallback = "") {
  const status = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return status || fallback;
}

// Someone whose booking has converted but who hasn't arrived yet: the
// tenancy is already active and holds the room, but nobody is living in it.
function isAwaitingCheckIn(student: Row) {
  return student.bedStatus === "reserved" && !student.checkedInAt;
}

// Arrivals that have actually been processed through the check-in step, so
// staff can see what came in without hunting through the whole directory.
// The tenancies imported from the pre-system spreadsheets have no
// checked_in_at and never appear here — they were already living in.
function isCheckedIn(student: Row) {
  return Boolean(student.checkedInAt) && !isMovedOutOrInactive(student);
}

function isCurrentOccupant(student: Row) {
  return (
    normaliseStatus(student.profileStatus, "active") === "active" &&
    normaliseStatus(student.assignmentStatus) === "active" &&
    // Counted under "awaiting check-in" instead, so this figure agrees with
    // the occupied-bed count on the dashboard.
    !isAwaitingCheckIn(student)
  );
}

function isMovedOutOrInactive(student: Row) {
  const inactiveStatuses = new Set([
    "moved-out",
    "inactive",
    "ended",
    "terminated",
  ]);

  return (
    inactiveStatuses.has(normaliseStatus(student.profileStatus)) ||
    inactiveStatuses.has(normaliseStatus(student.assignmentStatus))
  );
}

function isActiveProfile(student: Row) {
  return (
    normaliseStatus(student.profileStatus, "active") === "active" &&
    !isMovedOutOrInactive(student)
  );
}

function isAgencyLinked(student: Row) {
  return Boolean(String(student.agency || "").trim());
}

function isProfileIncomplete(student: Row) {
  return (
    !String(student.identityNo || "").trim() ||
    !String(student.contactNumber || "").trim() ||
    !String(student.email || "").trim() ||
    !String(student.nationality || "").trim()
  );
}

function hostelInitials(name: unknown) {
  const text = String(name || "Hostel").trim();
  const number = text.match(/\d/);
  const firstLetter = text.match(/[A-Za-z]/)?.[0]?.toUpperCase() || "H";

  if (number) return `${firstLetter}${number[0]}`;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
}

function hostelAddress(hostel: Row | null) {
  if (!hostel) return "Profiles not yet tied to a hostel or room.";
  return (
    hostel.address ||
    hostel.propertyAddress ||
    hostel.fullAddress ||
    "Property address not set"
  );
}

function studentMatchesHostel(student: Row, hostel: Row) {
  const studentHostelId = String(student.hostelId ?? "").trim();
  if (studentHostelId) return studentHostelId === String(hostel.id);

  const studentHostelName = String(student.hostelName || "")
    .trim()
    .toLowerCase();
  const hostelName = String(hostel.name || "").trim().toLowerCase();

  return Boolean(studentHostelName && studentHostelName === hostelName);
}

function isUnassignedStudent(student: Row, hostels: Row[]) {
  return !hostels.some((hostel) => studentMatchesHostel(student, hostel));
}

// Cascading hostel → unit → type/category/bathroom room picker for the
// "Assign a room" flow. A fresh instance mounts every time the modal opens
// (the caller only renders it while `modal === "assign"`), so its filter
// state always starts empty without needing a reset effect.
// Hostel -> room type -> block -> category -> room cascade, matching Hostel
// Information's "Housing information" step exactly (no separate Unit
// step, no Bathroom filter). Renders inline — no <form>/submit of its own —
// so it can drop into any caller's form; only the final `bedSpaceId` select
// carries a `name`, everything above it is a pure narrowing filter.
function RoomPickerFields({
  data,
  gender,
  onSelect,
}: {
  data: Data;
  gender?: string;
  // Lets a caller price the move off the chosen room without duplicating the
  // cascade's filtering rules.
  onSelect?: (bed: Row | null) => void;
}) {
  const [hostelId, setHostelId] = useState("");
  const [roomType, setRoomType] = useState("any");
  const [block, setBlock] = useState("");
  const [category, setCategory] = useState("any");
  const [bedSpaceId, setBedSpaceId] = useState("");

  // Beds an active sales reservation already holds — never offer these.
  const heldBedIds = new Set(
    data.reservations
      .filter((row) => row.status === "reserved")
      .flatMap((row) => [row.provisionalBedSpaceId, row.assignedBedSpaceId])
      .filter(Boolean)
      .map(String),
  );
  const genderFits = (bedGender: string) =>
    !gender ||
    ["mixed", "unspecified"].includes(gender) ||
    ["mixed", "unspecified"].includes(String(bedGender)) ||
    bedGender === gender;
  const isSelectable = (bed: Row) =>
    bed.status === "vacant" &&
    !heldBedIds.has(String(bed.id)) &&
    genderFits(bed.gender);

  // Each step only offers what the step before it allows.
  const hostelBeds = data.bedSpaces.filter(
    (bed) =>
      isSelectable(bed) && (!hostelId || String(bed.hostelId) === hostelId),
  );
  const blockOptions = [
    ...new Set(hostelBeds.map((bed) => blockOf(bed.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blockedBeds = hostelBeds.filter(
    (bed) => !block || blockOf(bed.unitCode) === block,
  );
  const categories = [
    ...new Set(blockedBeds.map((bed) => String(bed.roomLabel))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // Rooms, not beds — see roomOptionsFrom(). isSelectable already ran when
  // hostelBeds was built, so every bed reaching here is takeable.
  const options = roomOptionsFrom(
    blockedBeds.filter(
      (bed) =>
        (roomType === "any" || bed.roomType === roomType) &&
        (category === "any" || bed.roomLabel === category),
    ),
    () => true,
  );

  return (
    <>
      <label>
        1. Hostel
        <select
          required
          value={hostelId}
          onChange={(event) => {
            setHostelId(event.target.value);
            setBlock("");
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
      <label>
        Room category
        <select
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
          name="bedSpaceId"
          required
          disabled={!hostelId}
          value={bedSpaceId}
          onChange={(event) => {
            setBedSpaceId(event.target.value);
            onSelect?.(
              options.find(
                (option) => String(option.bed.id) === event.target.value,
              )?.bed || null,
            );
          }}
        >
          <option value="">
            {!hostelId
              ? "Select a hostel first"
              : options.length
                ? "Select an available room"
                : "No free rooms match these choices"}
          </option>
          {options.map((option) => (
            <option key={option.roomId} value={option.bed.id}>
              {roomOptionLabel(option)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function AssignRoomForm({
  data,
  save,
  busy,
  studentId,
  studentGender,
  salesperson,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  studentId: string | number;
  studentGender?: string;
  salesperson?: string;
  onDone: () => void;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          {
            action: "student-assign",
            studentId,
            salesperson,
            ...formValues(e),
          },
          "Room assigned",
        );
        if (ok) onDone();
      }}
    >
      <RoomPickerFields data={data} gender={studentGender} />
      <label>
        Check-in date
        <input name="checkInDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <label>
        Monthly rental
        <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Security deposit
        <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Access card deposit
        <input name="accessCardDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Parking deposit
        <input name="parkingDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Lease start
        <input name="leaseStartDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <label>
        Lease end
        <input name="leaseEndDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <div className="form-actions wide">
        <button className="primary" disabled={busy}>
          Confirm assignment
        </button>
      </div>
    </form>
  );
}

export function StudentsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [selectedHostelKey, setSelectedHostelKey] = useState<string | null>(
    "all",
  );
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");
  // Check-in is reachable from the directory row as well as from inside the
  // profile drawer, so it carries its own target rather than piggy-backing
  // on the drawer's selection — pressing it in the list shouldn't drag the
  // whole profile open behind the dialog.
  const [checkInTarget, setCheckInTarget] = useState<Row | null>(null);
  const [selectedStudentRef, setSelectedStudentRef] =
    useState<SelectedStudentRef | null>(null);
  const [modal, setModal] = useState("");
  const [directoryTab, setDirectoryTab] =
    useState<DirectoryTab>("active");
  const [sortKey, setSortKey] = useState("roomCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [addAssignRoom, setAddAssignRoom] = useState(false);
  const [editSchool, setEditSchool] = useState<Row | null>(null);
  const [editCourse, setEditCourse] = useState<Row | null>(null);
  const [drawerRecordsTab, setDrawerRecordsTab] = useState("profile");
  // Which invoice's charge lines and receipts are expanded in the billing tab.
  const [openInvoiceId, setOpenInvoiceId] = useState<string | number | null>(
    null,
  );
  // Jump back to the first records tab whenever a different student's
  // drawer opens, without the extra render a useEffect would cost here.
  const [drawerRecordsStudentId, setDrawerRecordsStudentId] = useState(
    selectedStudentRef?.studentId,
  );
  if (selectedStudentRef?.studentId !== drawerRecordsStudentId) {
    setDrawerRecordsStudentId(selectedStudentRef?.studentId);
    setDrawerRecordsTab("profile");
  }

  const tenantRole = data.roles.find((role) => role.roleKey === "tenant");
  const loginFor = (studentId: number | string) =>
    data.users.find((user) => String(user.studentId) === String(studentId));
  const schoolNames = data.schools.map((school) => school.name as string);
  const withCurrent = (list: string[], current?: string) =>
    current && !list.includes(current) ? [current, ...list] : list;

  const student = useMemo(() => {
    if (!selectedStudentRef) return null;

    const assignmentId = selectedStudentRef.assignmentId ?? "";
    const exact = data.students.find(
      (item) =>
        String(item.id) === String(selectedStudentRef.studentId) &&
        String(item.assignmentId ?? "") === String(assignmentId),
    );

    return (
      exact ||
      data.students.find(
        (item) => String(item.id) === String(selectedStudentRef.studentId),
      ) ||
      null
    );
  }, [data.students, selectedStudentRef]);

  const hostelDirectory = useMemo(() => {
    const rows: Array<{
      key: string;
      hostel: Row | null;
      students: Row[];
    }> = data.hostels.map((hostel) => ({
      key: String(hostel.id),
      hostel,
      students: data.students.filter((item) =>
        studentMatchesHostel(item, hostel),
      ),
    }));

    const unassignedStudents = data.students.filter((item) =>
      isUnassignedStudent(item, data.hostels),
    );

    if (unassignedStudents.length) {
      rows.push({
        key: UNASSIGNED_HOSTEL_KEY,
        hostel: null,
        students: unassignedStudents,
      });
    }

    return rows;
  }, [data.hostels, data.students]);

  const selectedHostel = useMemo(() => {
    if (
      !selectedHostelKey ||
      selectedHostelKey === "all" ||
      selectedHostelKey === UNASSIGNED_HOSTEL_KEY
    )
      return null;

    return (
      data.hostels.find(
        (hostel) => String(hostel.id) === String(selectedHostelKey),
      ) || null
    );
  }, [data.hostels, selectedHostelKey]);

  const selectedHostelStudents = useMemo(() => {
    if (!selectedHostelKey) return [];

    if (selectedHostelKey === "all") return data.students;

    if (selectedHostelKey === UNASSIGNED_HOSTEL_KEY) {
      return data.students.filter((item) =>
        isUnassignedStudent(item, data.hostels),
      );
    }

    if (!selectedHostel) return [];
    return data.students.filter((item) =>
      studentMatchesHostel(item, selectedHostel),
    );
  }, [data.hostels, data.students, selectedHostel, selectedHostelKey]);

  // Arrivals still to be processed in the hostel currently in view — the
  // tab doubles as a to-do count, so it is worth showing on the label.
  const awaitingCheckInCount = useMemo(
    () =>
      selectedHostelStudents.filter(isAwaitingCheckIn).length,
    [selectedHostelStudents],
  );

  const checkedInCount = useMemo(
    () => selectedHostelStudents.filter(isCheckedIn).length,
    [selectedHostelStudents],
  );

  const scopeStudents = selectedHostelKey
    ? selectedHostelStudents
    : data.students;

  const unitOptions = useMemo(
    () =>
      [...new Set(
        selectedHostelStudents
          .map((item) => String(item.unitCode || "").trim())
          .filter(Boolean),
      )].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [selectedHostelStudents],
  );

  const scopedSchoolOptions = useMemo(
    () =>
      [...new Set(
        selectedHostelStudents
          .map((item) => String(item.school || "").trim())
          .filter(Boolean),
      )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [selectedHostelStudents],
  );

  const filteredStudents = useMemo(() => {
    const search = query.trim().toLowerCase();

    return selectedHostelStudents
      .filter((item) => {
        const tabMatch =
          directoryTab === "all"
            ? true
            : directoryTab === "agency"
              ? isAgencyLinked(item)
              : directoryTab === "awaiting-check-in"
                ? isAwaitingCheckIn(item)
                : directoryTab === "checked-in"
                  ? isCheckedIn(item)
                  : directoryTab === "active"
                    ? isActiveProfile(item)
                    : isMovedOutOrInactive(item);

        const unitMatch =
          unitFilter === "all" || String(item.unitCode || "") === unitFilter;
        const schoolMatch =
          schoolFilter === "all" || String(item.school || "") === schoolFilter;
        const completionMatch =
          completionFilter === "all" ||
          (completionFilter === "incomplete"
            ? isProfileIncomplete(item)
            : !isProfileIncomplete(item));
        const text = `${item.fullName || ""} ${item.studentCode || ""} ${item.identityNo || ""
          } ${item.roomCode || ""} ${item.unitCode || ""} ${item.hostelName || ""
          } ${item.school || ""} ${item.course || ""} ${item.nationality || ""
          } ${item.agency || ""}`.toLowerCase();

        return (
          tabMatch &&
          unitMatch &&
          schoolMatch &&
          completionMatch &&
          (!search || text.includes(search))
        );
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
  }, [
    completionFilter,
    directoryTab,
    query,
    schoolFilter,
    selectedHostelStudents,
    sortDirection,
    sortKey,
    unitFilter,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredStudents.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const paginatedStudents = filteredStudents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const rangeStart = filteredStudents.length
    ? (currentPage - 1) * PAGE_SIZE + 1
    : 0;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredStudents.length);

  const resetDirectoryFilters = (resetTab = false) => {
    setQuery("");
    setUnitFilter("all");
    setSchoolFilter("all");
    setCompletionFilter("all");
    setPage(1);
    if (resetTab) setDirectoryTab("active");
  };

  const selectHostel = (key: string) => {
    setSelectedHostelKey(key);
    resetDirectoryFilters(true);
  };

  const closeAddStudentModal = () => {
    setModal("");
    setAddAssignRoom(false);
  };

  const sortStudents = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc",
      );
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortHeader = (key: string, label: string) => (
    <th>
      <button
        type="button"
        className="sort-button"
        onClick={() => sortStudents(key)}
      >
        {label}{" "}
        {sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );

  const selectedHostelName =
    selectedHostelKey === "all"
      ? "All hostels"
      : selectedHostelKey === UNASSIGNED_HOSTEL_KEY
        ? "Unassigned profiles"
        : selectedHostel?.name || "Student directory";

  return (
    <div className="table-v2">
      <div className="student-hostel-page">
        <section className="intro compact-intro student-directory-intro">
          <div>
            <span className="section-kicker">
              STUDENT &amp; SUB-TENANT DIRECTORY
            </span>
            <h2>
              {selectedHostelKey
                ? `${selectedHostelName} resident information.`
                : "Choose a hostel before viewing resident profiles."}
            </h2>
            <p>
              {selectedHostelKey
                ? "Search, filter and manage students under the selected hostel."
                : "Each hostel opens into its own student directory, filters and room-linked records."}
            </p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="v2-btn-ghost"
              onClick={() => setModal("schools")}
            >
              Manage schools
            </button>
            <button
              type="button"
              className="v2-btn-primary"
              onClick={() => setModal("add")}
            >
              + Add student
            </button>
          </div>
        </section>

        <section className="module-metrics student-directory-metrics">
          <Stat
            value={scopeStudents.filter(isCurrentOccupant).length}
            label="Current occupants"
          />
          <Stat
            value={scopeStudents.filter(isAwaitingCheckIn).length}
            label="Awaiting check-in"
          />
          <Stat
            value={scopeStudents.filter(isMovedOutOrInactive).length}
            label="Moved out / inactive"
          />
          <Stat
            value={scopeStudents.filter(isAgencyLinked).length}
            label="Agency-linked"
          />
          <Stat
            value={scopeStudents.filter(isProfileIncomplete).length}
            label="Profiles to complete"
          />
        </section>

        <section className="panel student-filter-panel">
          <div className="workspace-tabs">
            <button
              type="button"
              className={selectedHostelKey === "all" ? "active" : ""}
              onClick={() => selectHostel("all")}
            >
              All ({data.students.length})
            </button>
            {hostelDirectory.map(({ key, hostel, students }) => (
              <button
                key={key}
                type="button"
                className={selectedHostelKey === key ? "active" : ""}
                onClick={() => selectHostel(key)}
              >
                {hostel?.name || "Unassigned profiles"} ({students.length})
              </button>
            ))}
            {!hostelDirectory.length && <em>No hostels added yet.</em>}
          </div>
        </section>

        {selectedHostelKey ? (
          <>
            <section className="student-selected-hostel">
              <div className="student-selected-hostel-card">
                <span className="student-hostel-avatar large">
                  {selectedHostel
                    ? hostelInitials(selectedHostel.name)
                    : "--"}
                </span>
                <div className="student-selected-hostel-copy">
                  <small>SELECTED HOSTEL</small>
                  <h3>{selectedHostelName}</h3>
                  <p>{hostelAddress(selectedHostel)}</p>
                </div>
                <div className="student-selected-hostel-total">
                  <small>Total profiles</small>
                  <strong>{selectedHostelStudents.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel student-filter-panel">
              <div className="workspace-tabs">
                <button
                  type="button"
                  className={directoryTab === "all" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("all");
                    setPage(1);
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  className={directoryTab === "active" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("active");
                    setPage(1);
                  }}
                >
                  Active students
                </button>
                <button
                  type="button"
                  className={
                    directoryTab === "awaiting-check-in" ? "active" : ""
                  }
                  onClick={() => {
                    setDirectoryTab("awaiting-check-in");
                    setPage(1);
                  }}
                >
                  Awaiting check-in
                  {awaitingCheckInCount > 0 && ` (${awaitingCheckInCount})`}
                </button>
                <button
                  type="button"
                  className={directoryTab === "checked-in" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("checked-in");
                    setPage(1);
                  }}
                >
                  Checked in
                  {checkedInCount > 0 && ` (${checkedInCount})`}
                </button>
                <button
                  type="button"
                  className={directoryTab === "moved-out" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("moved-out");
                    setPage(1);
                  }}
                >
                  Moved-out / inactive
                </button>
                <button
                  type="button"
                  className={directoryTab === "agency" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("agency");
                    setPage(1);
                  }}
                >
                  Agency-linked
                </button>
              </div>

              <div className="v2-toolbar">
                <label className="v2-search">
                  <SearchIcon />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Name, IC/passport, room, school or country"
                  />
                </label>

                <select
                  className="v2-pill-select"
                  value={unitFilter}
                  onChange={(event) => {
                    setUnitFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All units</option>
                  {unitOptions.map((unitCode) => (
                    <option key={unitCode} value={unitCode}>
                      {unitCode}
                    </option>
                  ))}
                </select>

                <select
                  className="v2-pill-select"
                  value={schoolFilter}
                  onChange={(event) => {
                    setSchoolFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All schools</option>
                  {scopedSchoolOptions.map((school) => (
                    <option key={school} value={school}>
                      {school}
                    </option>
                  ))}
                </select>

                <select
                  className="v2-pill-select"
                  value={completionFilter}
                  onChange={(event) => {
                    setCompletionFilter(
                      event.target.value as CompletionFilter,
                    );
                    setPage(1);
                  }}
                >
                  <option value="all">All profiles</option>
                  <option value="complete">Complete profiles</option>
                  <option value="incomplete">Needs completion</option>
                </select>

                <button
                  type="button"
                  className="v2-reset"
                  onClick={() => resetDirectoryFilters(false)}
                >
                  Reset filters
                </button>
              </div>
            </section>

            <section className="panel student-results-panel">
              <div className="student-results-heading">
                <div>
                  <small>STUDENT INFORMATION</small>
                  <h3>
                    {filteredStudents.length} matching student
                    {filteredStudents.length === 1 ? "" : "s"}
                  </h3>
                </div>
                <span>
                  {selectedHostelName} · {titleCase(directoryTab)}
                </span>
              </div>

              <div className="table-wrap student-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {sortHeader("fullName", "Name")}
                      {sortHeader("roomCode", "Room")}
                      {sortHeader("contactNumber", "Contact")}
                      {sortHeader("school", "School / course")}
                      {sortHeader("monthlyRental", "Rental")}
                      {sortHeader("leaseEndDate", "Lease end")}
                      {sortHeader("salesperson", "Sales / agency")}
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedStudents.length ? (
                      paginatedStudents.map((item) => (
                        <tr key={`${item.id}-${item.assignmentId || 0}`}>
                          <td>
                            <strong>{item.fullName}</strong>
                            <small>
                              {item.identityNo || "IC / passport not set"}
                            </small>
                          </td>
                          <td>
                            {item.roomCode ? (
                              <>
                                <code>{item.roomCode}</code>
                                <small>
                                  {item.hostelName} / {item.unitCode}
                                </small>
                              </>
                            ) : (
                              <span className="muted">Not assigned</span>
                            )}
                          </td>
                          <td>
                            {item.contactNumber || "-"}
                            <small>{item.email || "Email not set"}</small>
                          </td>
                          <td>
                            {item.school || "-"}
                            <small>
                              {item.course || "Course not set"} ·{" "}
                              {item.nationality || "Nationality not set"}
                            </small>
                          </td>
                          <td>
                            {(() => {
                              // Show what billing will actually charge, not
                              // the tenancy figure a rate change has already
                              // superseded.
                              const rate = effectiveRateOn(
                                data.studentRateChanges,
                                item.assignmentId,
                                {
                                  monthlyRental: item.monthlyRental,
                                  securityDeposit: item.securityDeposit,
                                },
                              );
                              return (
                                <>
                                  {money(rate.monthlyRental)}
                                  {rate.source === "rate-change" && (
                                    <small>
                                      Rate change {dateLabel(rate.effectiveDate)}
                                    </small>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                          <td>
                            <strong className="lease-end">
                              {dateLabel(item.leaseEndDate)}
                            </strong>
                            <small>
                              Starts {dateLabel(item.leaseStartDate)}
                            </small>
                          </td>
                          <td>
                            {item.salesperson || "-"}
                            <small>{item.agency || "Direct"}</small>
                          </td>
                          <td>
                            {/* The tenancy is already 'active' the moment
                                the booking converts, so "Active" alone
                                wouldn't say whether the student is actually
                                living there yet. */}
                            {isAwaitingCheckIn(item) ? (
                              <StatusPill status="awaiting-check-in" />
                            ) : (
                              <>
                                <StatusPill
                                  status={
                                    item.assignmentStatus || item.profileStatus
                                  }
                                />
                                {isCheckedIn(item) && (
                                  <small>
                                    Checked in {dateLabel(item.checkInDate)}
                                  </small>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <div className="row-actions">
                              {/* Processing an arrival is a two-click job
                                  from the list — no need to open the
                                  profile to reach it. */}
                              {isAwaitingCheckIn(item) && (
                                <button
                                  type="button"
                                  className="primary compact"
                                  onClick={() => setCheckInTarget(item)}
                                >
                                  Check in
                                </button>
                              )}
                              <button
                                type="button"
                                className="secondary compact"
                                onClick={() =>
                                  setSelectedStudentRef({
                                    studentId: item.id,
                                    assignmentId: item.assignmentId,
                                  })
                                }
                              >
                                Open profile
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <div className="student-empty-state">
                            <strong>No students found</strong>
                            <span>
                              Try changing the tab, search or second-level
                              filters.
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="student-pagination">
                <span>
                  Showing {rangeStart} to {rangeEnd} of {filteredStudents.length}{" "}
                  students
                </span>

                <div className="student-pagination-buttons">
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>

                  {paginationItems(currentPage, totalPages).map(
                    (item, index) =>
                      item === "ellipsis" ? (
                        <span
                          className="student-pagination-ellipsis"
                          key={`ellipsis-${index}`}
                        >
                          …
                        </span>
                      ) : (
                        <button
                          type="button"
                          key={item}
                          className={`student-page-button ${item === currentPage ? "active" : ""
                            }`}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </button>
                      ),
                  )}

                  <button
                    type="button"
                    className="secondary compact"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setPage(Math.min(totalPages, currentPage + 1))
                    }
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </footer>
            </section>
          </>
        ) : (
          <section className="panel student-results-panel">
            <em>Select a hostel above to view its students.</em>
          </section>
        )}
      </div>
      {student && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedStudentRef(null)}
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
              <button onClick={() => setSelectedStudentRef(null)}>×</button>
            </div>

            <div className="workspace-tabs sticky-tabs drawer-records-tabs">
              <button
                type="button"
                className={drawerRecordsTab === "profile" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("profile")}
              >
                Personal &amp; tenancy
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "login" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("login")}
              >
                Tenant login credentials
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "billing" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("billing")}
              >
                Billing information
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "rate" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("rate")}
              >
                Rate change
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "room" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("room")}
              >
                Change room
              </button>
            </div>

            {drawerRecordsTab === "profile" && (
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

              <div className="drawer-subsection">
                <h4>Student information</h4>
                <div className="form-grid">
                  <label>
                    Full name
                    <input name="fullName" defaultValue={student.fullName} />
                  </label>
                  <label>
                    Student code
                    <input
                      name="studentCode"
                      placeholder="e.g. B200000000"
                      defaultValue={student.studentCode}
                    />
                  </label>
                  <label>
                    Gender
                    <select name="gender" defaultValue={student.gender}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                  <label>
                    Date of birth
                    <input
                      name="dateOfBirth"
                      type="date"
                      defaultValue={student.dateOfBirth || ""}
                    />
                  </label>
                  <DemographicFields
                    key={student.id}
                    identityNo={student.identityNo || ""}
                    nationality={student.nationality || ""}
                    nationalityOther={student.nationalityOther || ""}
                    state={student.state || ""}
                    hometown={student.hometown || ""}
                    race={student.race || ""}
                    raceOther={student.raceOther || ""}
                    religion={student.religion || ""}
                    religionOther={student.religionOther || ""}
                  />
                </div>
              </div>

              <div className="drawer-subsection">
                <h4>Contacts</h4>
                <div className="form-grid">
                  <label>
                    Contact number
                    <input
                      name="contactNumber"
                      placeholder="e.g. 0123456789"
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
                </div>
              </div>

              <div className="drawer-subsection">
                <div className="subsection-head">
                  <h4>Room details</h4>
                  {student.assignmentId ? (
                    <div className="subsection-actions">
                      {/* The room is held for them but they haven't arrived
                          — checking in is the only sensible next step, so
                          it leads. */}
                      {isAwaitingCheckIn(student) && (
                        <button
                          type="button"
                          className="primary compact"
                          onClick={() => setCheckInTarget(student)}
                        >
                          Check in
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => setModal("moveout")}
                      >
                        Move out / deactivate
                      </button>
                    </div>
                  ) : (
                    // 新增：如果还没有 assignmentId，则显示分配房间的按钮
                    <button
                      type="button"
                      className="primary compact"
                      onClick={() => setModal("assign")}
                    >
                      Assign a room
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
                  <>
                    <div className="form-grid">
                      <label className="wide">
                        Room code
                        <input value={student.roomCode || ""} readOnly />
                      </label>
                    </div>
                    <p className="section-kicker room-details-group">FINANCIAL</p>
                    <div className="form-grid">
                      <label>
                        Monthly rental
                        <input
                          name="monthlyRental"
                          type="number"
                          defaultValue={student.monthlyRental ?? ""}
                        />
                        {(() => {
                          // Editing this field changes the tenancy's base
                          // rent, which an active rate change overrides — say
                          // so, or the saved figure looks like it did nothing.
                          const rate = effectiveRateOn(
                            data.studentRateChanges,
                            student.assignmentId,
                            {
                              monthlyRental: student.monthlyRental,
                              securityDeposit: student.securityDeposit,
                            },
                          );
                          if (rate.source !== "rate-change") return null;
                          return (
                            <small className="field-note rate-up">
                              A rate change effective{" "}
                              {dateLabel(rate.effectiveDate)} overrides this —
                              billing charges {money(rate.monthlyRental, true)}.
                              Edit it in the Rate change tab.
                            </small>
                          );
                        })()}
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
                    </div>
                    <p className="section-kicker room-details-group">TENANCY DATES</p>
                    <div className="form-grid">
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
                    </div>
                    <p className="section-kicker room-details-group">RENEWAL</p>
                    <div className="form-grid">
                      <label className="wide">
                        Renewal status
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {student.renewalAppliedAt ? (
                            <span>
                              Applied on {dateLabel(student.renewalAppliedAt)}
                            </span>
                          ) : (
                            <>
                              <span style={{ color: '#6b7280' }}>
                                Not yet applied
                              </span>
                              <button
                                type="button"
                                className="secondary compact"
                                onClick={() =>
                                  save(
                                    {
                                      action: "assignment-renewal-apply",
                                      assignmentId: student.assignmentId,
                                    },
                                    "Renewal marked as applied",
                                  )
                                }
                              >
                                Mark renewal applied
                              </button>
                            </>
                          )}
                        </div>
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    {/* 更新提示文案 */}
                    <p className="empty-copy">
                      No active room assignment. Click &ldquo;Assign a room&rdquo; above to place this student in a vacant bed space.
                    </p>
                    {/* Moving out normally ends the tenancy and the profile
                        together, from the button above — this is only for
                        the mismatch it leaves behind when a tenancy was
                        ended without the profile following, so the record
                        still counts as an active student with no room. It
                        appears solely in that contradictory state. */}
                    {normaliseStatus(student.profileStatus, "active") ===
                      "active" && (
                      <div className="record-fix">
                        <div>
                          <strong>Still counted as an active student</strong>
                          <small>
                            This profile has no room, so it is neither
                            occupying one nor showing under Moved-out. If they
                            have already left, correct the record here.
                          </small>
                        </div>
                        <button
                          type="button"
                          className="secondary compact"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Mark ${student.fullName} as moved out?\n\nThis only changes the profile status — there is no tenancy left to end.`,
                              )
                            )
                              return;
                            const ok = await save(
                              {
                                action: "student-move-out",
                                studentId: student.id,
                                profileStatus: "moved-out",
                              },
                              "Marked as moved out",
                            );
                            // The Status select below is uncontrolled, so it
                            // would still read "Active" after this and quietly
                            // undo the correction on the next Save. Closing
                            // the drawer is what the normal move-out does for
                            // the same reason.
                            if (ok) setSelectedStudentRef(null);
                          }}
                        >
                          Mark as moved out
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="drawer-subsection">

                <div className="form-grid">
                  <label>
                    School
                    <select name="school" defaultValue={student.school || ""}>
                      <option value="">Not set</option>
                      {withCurrent(schoolNames, student.school).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label>
                    Course enrolled
                    <select name="course" defaultValue={student.course || ""}>
                      <CourseOptions courses={data.courses} current={student.course} />
                    </select>
                  </label>
                  <label>
                    Application form no.
                    <input
                      name="applicationFormNo"
                      defaultValue={student.applicationFormNo}
                    />
                  </label>
                </div>
              </div>

              <div className="drawer-subsection">
                <h4>Other information</h4>
                <div className="form-grid">
                  <label>
                    Sales person
                    <select name="salesperson" defaultValue={student.salesperson || ""}>
                      <option value="">Select Sales Team</option>
                      {data.salesPeople.map((name: string) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <input type="hidden" name="agency" value={student.agency || ""} />
                  <label>
                    Receipt serial no.
                    <input name="receiptNo" placeholder="e.g. 1234567890" defaultValue={student.receiptNo} />
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
                    <input name="remarks" placeholder="e.g. Student is relocating to a different unit" defaultValue={student.remarks} />
                  </label>
                </div>
              </div>
            </form>
            )}

            {drawerRecordsTab === "login" && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>LOGIN ACCESS</small>
                    <h3>Tenant login credentials</h3>
                  </div>
                </div>
                {loginFor(student.id) ? (
                  <div className="compact-list">
                    <span>
                      <b>{loginFor(student.id)?.email}</b>
                      <small>
                        Tenant login active ·{" "}
                        {loginFor(student.id)?.lastLoginAt
                          ? `Last login ${dateLabel(loginFor(student.id)?.lastLoginAt)}`
                          : "Never signed in"}
                      </small>
                    </span>
                  </div>
                ) : (
                  <form
                    className="form-grid"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!tenantRole) return;
                      await save(
                        {
                          action: "user-save",
                          roleId: tenantRole.id,
                          studentId: student.id,
                          displayName: student.fullName,
                          ...formValues(e),
                        },
                        "Tenant login enabled",
                      );
                    }}
                  >
                    <label className="wide">
                      Login email
                      <input
                        name="email"
                        type="email"
                        required
                        defaultValue={student.email || ""}
                        placeholder="student@email.com"
                      />
                    </label>
                    <div className="form-actions wide">
                      <button
                        className="secondary compact"
                        disabled={busy || !tenantRole}
                      >
                        Enable tenant login
                      </button>
                    </div>
                    <p className="empty-copy wide">
                      The student signs in with this email through the platform. No
                      password is stored in this system.
                    </p>
                  </form>
                )}
              </section>
            )}

            {drawerRecordsTab === "billing" && (
              <StudentBilling
                data={data}
                student={student}
                openInvoiceId={openInvoiceId}
                setOpenInvoiceId={setOpenInvoiceId}
              />
            )}

            {drawerRecordsTab === "rate" && (
              <StudentRateChanges
                data={data}
                student={student}
                save={save}
                busy={busy}
                onAdd={() => setModal("rate")}
              />
            )}

            {drawerRecordsTab === "room" && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>CHANGE ROOM</small>
                    <h3>Move to a different room</h3>
                  </div>
                  {student.assignmentId && (
                    <button
                      className="secondary compact"
                      onClick={() => setModal("move")}
                    >
                      Change room
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
                  <div className="compact-list">
                    <span>
                      <b>{student.roomCode || "-"}</b>
                      <small>
                        {student.hostelName} · Since{" "}
                        {dateLabel(student.checkInDate)}
                      </small>
                    </span>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No active room assignment yet — assign a room first.
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>
      )}

      {modal === "add" && (
        <Modal
          title="Add new student"
          kicker="NEW RESIDENT PROFILE"
          onClose={closeAddStudentModal}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const { loginEmail, ...values } = formValues(e);
              const ok = await save(
                { action: "student-create", ...values },
                "Student added",
              );
              if (ok && loginEmail && tenantRole) {
                await save(
                  {
                    action: "user-save",
                    roleId: tenantRole.id,
                    studentId: ok.id,
                    displayName: String(values.fullName || ""),
                    email: loginEmail,
                  },
                  "Student added and tenant login enabled",
                );
              }
              if (ok) closeAddStudentModal();
            }}
          >
            <div className="drawer-subsection wide">
              <h4>Student information</h4>
              <div className="form-grid">
                <label>
                  Full name
                  <input name="fullName" required placeholder="e.g. John Doe" />

                </label>
                <label>
                  Student code
                  <input name="studentCode"
                    placeholder="e.g. B200000000"
                  />
                </label>
                <label>
                  Gender
                  <select name="gender" defaultValue="unspecified">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label>
                  Date of birth
                  <input name="dateOfBirth" type="date" />
                </label>
                <DemographicFields />
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Contacts</h4>
              <div className="form-grid">
                <label>
                  Contact number
                  <input name="contactNumber" placeholder="e.g. 0123456789" />
                </label>
                <label>
                  Email
                  <input name="email" type="email" placeholder="e.g. john.doe@example.com" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <div className="subsection-head">
                <h4>Academic information</h4>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setModal("courses")}
                >
                  Manage courses
                </button>
              </div>
              <div className="form-grid">
                <label>
                  School
                  <select name="school" defaultValue="">
                    <option value="">Not set</option>
                    {schoolNames.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label>
                  Course enrolled
                  <select name="course" defaultValue="">
                    <CourseOptions courses={data.courses} />
                  </select>
                </label>
                <label>
                  Application form no.
                  <input name="applicationFormNo" placeholder="e.g. A200000000" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Other information</h4>
              <div className="form-grid">
                <label>
                  Sales person
                  <select name="salesperson" defaultValue="">
                    <option value="">Select Sales Team</option>
                    {data.salesPeople.map((name: string) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Receipt serial no.
                  <input name="receiptNo" placeholder="e.g. 1234567890" />
                </label>
                <label className="wide">
                  Remarks
                  <input name="remarks" placeholder="e.g. Student is relocating to a different unit" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Tenant login credentials</h4>
              <div className="form-grid">
                <label className="wide">
                  Login email
                  <input
                    name="loginEmail"
                    type="email"
                    placeholder="student@email.com"
                  />
                </label>
              </div>
              <p className="auto-address-note">
                Optional — if filled in, a tenant login is created for this
                email once the profile is saved. No password is stored in
                this system.
              </p>
            </div>
            <div className="drawer-subsection wide">
              <div className="subsection-head">
                <h4>Room details</h4>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={addAssignRoom}
                    onChange={(e) => setAddAssignRoom(e.target.checked)}
                  />
                  Assign a room now
                </label>
              </div>
              {addAssignRoom && (
                <div className="form-grid">
                  <RoomPickerFields data={data} />
                  <label>
                    Monthly rental
                    <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Security deposit
                    <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Access card deposit
                    <input name="accessCardDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Parking deposit
                    <input name="parkingDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Check-in
                    <input name="checkInDate" type="date" placeholder="e.g. 2026-01-01" />
                  </label>
                  <label>
                    Lease start
                    <input name="leaseStartDate" type="date" placeholder="e.g. 2026-01-01"  />
                  </label>
                  <label>
                    Lease end
                    <input name="leaseEndDate" type="date" placeholder="e.g. 2026-01-01" />
                  </label>
                </div>
              )}
            </div>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Create student
              </button>
            </div>
          </form>
        </Modal>
      )}

      {checkInTarget && (
        <CheckInModal
          tenancy={checkInTarget}
          data={data}
          save={save}
          busy={busy}
          onClose={() => setCheckInTarget(null)}
        />
      )}

      {modal === "moveout" && student && (
        <Modal
          title="Move out / deactivate"
          kicker={student.fullName}
          description="Ends the room assignment, frees the bed space, releases any active parking, and marks the profile as moved out."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-move-out",
                  studentId: student.id,
                  assignmentId: student.assignmentId,
                  ...formValues(e),
                },
                "Student moved out",
              );
              if (ok) {
                setModal("");
                setSelectedStudentRef(null);
              }
            }}
          >
            <label>
              Check-out date
              <input name="checkOutDate" type="date" required placeholder="e.g. 2026-01-01" />
            </label>
            <label>
              Check-out meter
              <input name="checkOutMeter" type="number" step="0.01" placeholder="e.g. 1000" />
            </label>
            <label>
              Set profile status
              <select name="profileStatus" defaultValue="moved-out">
                <option value="moved-out">Moved out</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Confirm move out
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "schools" && (
        <Modal
          title="Manage schools"
          kicker="ACADEMIC LIST"
          onClose={() => {
            setModal("");
            setEditSchool(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                editSchool
                  ? {
                    action: "school-update",
                    schoolId: editSchool.id,
                    ...formValues(e),
                  }
                  : { action: "school-create", ...formValues(e) },
                editSchool ? "School updated" : "School added",
              );
              if (ok) {
                setEditSchool(null);
                (e.target as HTMLFormElement).reset();
              }
            }}
          >
            <label className="wide">
              {editSchool ? "Rename school" : "New school name"}
              <input
                name="name"
                required
                key={editSchool?.id || "new"}
                defaultValue={editSchool?.name || ""}
              />
            </label>
            <div className="form-actions wide">
              {editSchool && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setEditSchool(null)}
                >
                  Cancel edit
                </button>
              )}
              <button className="primary compact" disabled={busy}>
                {editSchool ? "Save school" : "Add school"}
              </button>
            </div>
          </form>
          <div className="compact-list">
            {data.schools.map((school) => (
              <span key={school.id}>
                <b>{school.name}</b>
                <div className="button-row">
                  <button
                    className="secondary compact"
                    onClick={() => setEditSchool(school)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      save(
                        { action: "school-delete", schoolId: school.id },
                        "School removed",
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </span>
            ))}
            {data.schools.length === 0 && (
              <p className="empty-copy">No schools yet. Add one above.</p>
            )}
          </div>
        </Modal>
      )}

      {modal === "courses" && (
        <Modal
          title="Manage courses"
          kicker="ACADEMIC LIST"
          onClose={() => {
            setModal("");
            setEditCourse(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                editCourse
                  ? {
                    action: "course-update",
                    courseId: editCourse.id,
                    ...formValues(e),
                  }
                  : { action: "course-create", ...formValues(e) },
                editCourse ? "Course updated" : "Course added",
              );
              if (ok) {
                setEditCourse(null);
                (e.target as HTMLFormElement).reset();
              }
            }}
          >
            <label className="wide">
              {editCourse ? "Rename course" : "New course name"}
              <input
                name="name"
                required
                key={editCourse?.id || "new"}
                defaultValue={editCourse?.name || ""}
              />
            </label>
            <label>
              Level
              <select
                name="level"
                key={editCourse?.id || "new-level"}
                defaultValue={editCourse?.level || "other"}
              >
                {COURSE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {COURSE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions wide">
              {editCourse && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setEditCourse(null)}
                >
                  Cancel edit
                </button>
              )}
              <button className="primary compact" disabled={busy}>
                {editCourse ? "Save course" : "Add course"}
              </button>
            </div>
          </form>
          <div className="compact-list">
            {data.courses.map((course) => (
              <span key={course.id}>
                <b>{course.name}</b>
                <small>{COURSE_LEVEL_LABELS[course.level] || course.level}</small>
                <div className="button-row">
                  <button
                    className="secondary compact"
                    onClick={() => setEditCourse(course)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      save(
                        { action: "course-delete", courseId: course.id },
                        "Course removed",
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </span>
            ))}
            {data.courses.length === 0 && (
              <p className="empty-copy">No courses yet. Add one above.</p>
            )}
          </div>
        </Modal>
      )}

      {modal === "rate" && student && (
        <Modal
          title="Schedule a rate change"
          kicker={student.fullName}
          description="Takes effect on the date you choose. Invoices already issued are never restated."
          onClose={() => setModal("")}
        >
          <RateChangeForm
            data={data}
            student={student}
            save={save}
            busy={busy}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "assign" && student && (
        <Modal
          title="Assign a room"
          kicker={student.fullName}
          description="Narrow down by hostel, block and category to find a currently vacant room."
          onClose={() => setModal("")}
          wide
        >
          <AssignRoomForm
            data={data}
            save={save}
            busy={busy}
            studentId={student.id}
            studentGender={student.gender}
            salesperson={student.salesperson}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "move" && student && (
        <Modal
          title="Manual room change"
          kicker={student.fullName}
          description="For a tenant moving mid-stay. The old room is released and the new one is taken from the effective date."
          onClose={() => setModal("")}
          wide
        >
          <RoomChangeForm
            data={data}
            student={student}
            save={save}
            busy={busy}
            onDone={() => {
              setModal("");
              setSelectedStudentRef(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}