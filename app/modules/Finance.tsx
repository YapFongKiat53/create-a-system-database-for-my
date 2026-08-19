"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Empty,
  Modal,
  SearchIcon,
  Stat,
  StatusPill,
  dateLabel,
  formValues,
  money,
  paginationItems,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

const PAGE_SIZE = 30;

// Every billing item already carries an itemType from the backend — this
// just gives each one a consistent label/color so rent, electricity,
// parking and maintenance charges stop looking identical in the invoice
// list. "other"/legacy items (pre-dating the "maintenance" split) fall
// back to a neutral grey.
const CHARGE_TYPE_META: Record<
  string,
  { label: string; color: string; background: string; icon: string }
> = {
  "room-rental": {
    label: "Rental",
    color: "#0e7490",
    background: "#cffafe",
    icon: "🏠",
  },
  electricity: {
    label: "Electricity",
    color: "#92400e",
    background: "#fef3c7",
    icon: "⚡",
  },
  parking: {
    label: "Parking",
    color: "#3730a3",
    background: "#e0e7ff",
    icon: "🚗",
  },
  maintenance: {
    label: "Maintenance",
    color: "#9f1239",
    background: "#ffe4e6",
    icon: "🔧",
  },
  "carry-forward": {
    label: "Carried forward",
    color: "#166534",
    background: "#dcfce7",
    icon: "↺",
  },
  "late-payment-charge": {
    label: "Late fee",
    color: "#991b1b",
    background: "#fee2e2",
    icon: "⏰",
  },
  other: {
    label: "Other",
    color: "#374151",
    background: "#f3f4f6",
    icon: "•",
  },
};
const chargeTypeMeta = (itemType: string) =>
  CHARGE_TYPE_META[itemType] || CHARGE_TYPE_META.other;

export function FinanceModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [modal, setModal] = useState("");
  const latest = data.billingCycles[0];
  const [financeTab, setFinanceTab] = useState<
    "invoices" | "deposits" | "adjustments" | "maintenance" | "parking"
  >("invoices");
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const filteredInvoices = data.invoices.filter((invoice) => {
    const balance =
      Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0);
    const statusMatch =
      paymentStatusFilter === "all" ||
      (paymentStatusFilter === "paid" && balance === 0) ||
      (paymentStatusFilter === "outstanding" && balance > 0) ||
      (paymentStatusFilter === "credit" && balance < 0) ||
      (paymentStatusFilter === "pending" &&
        invoice.payments.some(
          (payment: Row) => payment.status === "pending-verification",
        ));
    const search = invoiceQuery.trim().toLowerCase();
    const searchMatch =
      !search ||
      `${invoice.studentName} ${invoice.roomCode} ${invoice.unitCode} ${invoice.invoiceNo}`
        .toLowerCase()
        .includes(search);
    return (
      statusMatch &&
      searchMatch &&
      (cycleFilter === "all" || String(invoice.cycleId) === cycleFilter)
    );
  });
  const totalPages = Math.max(
    1,
    Math.ceil(filteredInvoices.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const rangeStart = filteredInvoices.length
    ? (currentPage - 1) * PAGE_SIZE + 1
    : 0;
  const rangeEnd = Math.min(
    currentPage * PAGE_SIZE,
    filteredInvoices.length,
  );
  // Sales collects deposits/admin fees while a reservation is still an
  // enquiry, well before the student has a monthly invoice — Finance has
  // no other way to see that money came in, so it gets its own register
  // here. "Pending review" just means Finance hasn't acknowledged the
  // latest payment yet (reviewed timestamp missing or stale).
  const isReservationPendingReview = (reservation: Row) =>
    !reservation.financeReviewedAt ||
    (reservation.paymentUpdatedAt &&
      reservation.financeReviewedAt < reservation.paymentUpdatedAt);
  const reservationDeposits = data.reservations
    .filter((reservation) => Number(reservation.amountPaid) > 0)
    .sort((a, b) =>
      String(b.paymentUpdatedAt || "").localeCompare(
        String(a.paymentUpdatedAt || ""),
      ),
    );
  const pendingReservationReviews = reservationDeposits.filter(
    isReservationPendingReview,
  );
  const pendingAdjustments = data.billingAdjustments.filter(
    (adjustment) => adjustment.approvalStatus === "pending",
  );
  // Maintenance tickets carry two separate money figures that never meet
  // anywhere else: actualCost (what the repair cost the operator, e.g. paid
  // to a contractor) and studentCharge (already billed to the student via
  // the "maintenance" invoice line item). This is the only place either the
  // expense side or the net cost-to-operator is visible.
  const maintenanceCostTickets = data.tickets.filter(
    (ticket: Row) =>
      Number(ticket.actualCost || 0) > 0 ||
      Number(ticket.studentCharge || 0) > 0,
  );
  const maintenanceTotalCost = maintenanceCostTickets.reduce(
    (sum: number, ticket: Row) => sum + Number(ticket.actualCost || 0),
    0,
  );
  const maintenanceTotalCharged = maintenanceCostTickets.reduce(
    (sum: number, ticket: Row) => sum + Number(ticket.studentCharge || 0),
    0,
  );
  const maintenanceNetCost = maintenanceTotalCost - maintenanceTotalCharged;
  const maintenanceByResponsibility = maintenanceCostTickets.reduce(
    (totals: Record<string, number>, ticket: Row) => {
      const key = ticket.costResponsibility || "management";
      totals[key] = (totals[key] || 0) + Number(ticket.actualCost || 0);
      return totals;
    },
    {} as Record<string, number>,
  );
  // In-house parking is already billed automatically through the student's
  // monthly invoice (see the "parking" charge type above) — but outside
  // (non-student) tenants pay directly and were never visible in Finance at
  // all. This tab surfaces both so total parking income lives in one place.
  const activeParkingRentals = data.parkingRentals.filter(
    (rental: Row) => rental.status === "active",
  );
  const inHouseParkingRentals = activeParkingRentals.filter(
    (rental: Row) => rental.tenantType === "in-house",
  );
  const outsideParkingRentals = activeParkingRentals.filter(
    (rental: Row) => rental.tenantType === "outside",
  );
  const parkingMonthlyIncome = activeParkingRentals.reduce(
    (sum: number, rental: Row) => sum + Number(rental.monthlyRental || 0),
    0,
  );
  const inHouseParkingIncome = inHouseParkingRentals.reduce(
    (sum: number, rental: Row) => sum + Number(rental.monthlyRental || 0),
    0,
  );
  const outsideParkingIncome = outsideParkingRentals.reduce(
    (sum: number, rental: Row) => sum + Number(rental.monthlyRental || 0),
    0,
  );
  const parkingDepositsHeld = activeParkingRentals.reduce(
    (sum: number, rental: Row) => sum + Number(rental.depositAmount || 0),
    0,
  );
  const outsideParkingDue = outsideParkingRentals.filter(
    (rental: Row) => rental.paymentStatus === "due",
  );
  // How much money is billed under each charge type, across every invoice
  // — the "where's the money" overview the flat item list couldn't answer.
  const chargeTypeTotals = data.invoices.reduce(
    (totals, invoice) => {
      for (const item of invoice.items as Row[]) {
        const type = item.itemType || "other";
        totals[type] = (totals[type] || 0) + Number(item.amount || 0);
      }
      return totals;
    },
    {} as Record<string, number>,
  );
  const chargeTypeOrder = [
    "room-rental",
    "electricity",
    "parking",
    "maintenance",
    "late-payment-charge",
    "carry-forward",
    "other",
  ].filter((type) => Number(chargeTypeTotals[type] || 0) !== 0);
  return (
    <div className="table-v2">
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MONTHLY BILLING</span>
          <h2>Cut off on the 24th, then post bills for resident review.</h2>
          <p>
            Room rental, electricity, parking and verified additional charges
            are combined. Students can submit payment proof for Accounts
            verification.
          </p>
        </div>
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className="v2-btn-primary"
            onClick={() => setModal("cycle")}
          >
            + Prepare billing month
          </button>
        )}
      </section>
      <section className="module-metrics">
        <Stat value={data.billingCycles.length} label="Billing cycles" />
        <Stat value={data.invoices.length} label="Invoices" />
        <Stat
          value={money(
            data.invoices.reduce(
              (sum, i) => sum + Number(i.totalAmount || 0),
              0,
            ),
            true,
          )}
          label="Total billed"
        />
        <Stat
          value={money(
            data.invoices.reduce(
              (sum, i) =>
                sum + Number(i.totalAmount || 0) - Number(i.amountPaid || 0),
              0,
            ),
            true,
          )}
          label="Outstanding"
        />
      </section>
      {chargeTypeOrder.length > 0 && (
        <section className="panel charge-type-breakdown">
          <div className="section-heading">
            <div>
              <small>WHERE THE MONEY IS</small>
              <h3>Billed amount by charge type</h3>
              <p>Across every invoice, so rental, electricity, parking and maintenance never blur together.</p>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              padding: '4px 0 8px',
            }}
          >
            {chargeTypeOrder.map((type) => {
              const meta = chargeTypeMeta(type);
              return (
                <div
                  key={type}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 16px',
                    borderRadius: '10px',
                    background: meta.background,
                    minWidth: '150px',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{meta.icon}</span>
                  <div>
                    <strong style={{ display: 'block', fontSize: '15px', color: meta.color }}>
                      {money(chargeTypeTotals[type], true)}
                    </strong>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {latest && (
        <section className="cycle-banner">
          <div>
            <small>LATEST BILLING CYCLE</small>
            <h3>{latest.periodLabel}</h3>
            <p>
              Cut-off {dateLabel(latest.cutoffDate)} · Due{" "}
              {dateLabel(latest.dueDate)} · {titleCase(latest.status)}
            </p>
          </div>
          {latest.status === "draft" &&
            data.currentUser?.roleKey !== "tenant" && (
              <button
                className="primary"
                onClick={() =>
                  save(
                    { action: "billing-post", cycleId: latest.id },
                    "Billing cycle posted",
                  )
                }
              >
                Post monthly billing
              </button>
            )}
        </section>
      )}
      <div className="workspace-tabs module-tabs">
        <button
          className={financeTab === "invoices" ? "active" : ""}
          onClick={() => setFinanceTab("invoices")}
        >
          Invoices
        </button>
        <button
          className={financeTab === "deposits" ? "active" : ""}
          onClick={() => setFinanceTab("deposits")}
        >
          Reservation deposits
          {pendingReservationReviews.length > 0 && (
            <span>{pendingReservationReviews.length}</span>
          )}
        </button>
        <button
          className={financeTab === "adjustments" ? "active" : ""}
          onClick={() => setFinanceTab("adjustments")}
        >
          Adjustments
          {pendingAdjustments.length > 0 && (
            <span>{pendingAdjustments.length}</span>
          )}
        </button>
        <button
          className={financeTab === "maintenance" ? "active" : ""}
          onClick={() => setFinanceTab("maintenance")}
        >
          Maintenance costs
        </button>
        <button
          className={financeTab === "parking" ? "active" : ""}
          onClick={() => setFinanceTab("parking")}
        >
          Parking income
          {outsideParkingDue.length > 0 && (
            <span>{outsideParkingDue.length}</span>
          )}
        </button>
      </div>
      {financeTab === "invoices" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>STUDENT BILLS</small>
            <h3>Invoices, payments and receipts</h3>
            <p>
              Use Print / download for a student statement. Verified payments
              update the outstanding balance.
            </p>
          </div>
        </div>
        <div className="v2-toolbar">
          <label className="v2-search">
            <SearchIcon />
            <input
              value={invoiceQuery}
              onChange={(event) => {
                setInvoiceQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Student, room, unit or invoice"
            />
          </label>
          <select
            className="v2-pill-select"
            value={paymentStatusFilter}
            onChange={(event) => {
              setPaymentStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            <option value="outstanding">Outstanding</option>
            <option value="paid">Fully paid</option>
            <option value="credit">Excess / credit</option>
            <option value="pending">Pending verification</option>
          </select>
          <select
            className="v2-pill-select"
            value={cycleFilter}
            onChange={(event) => {
              setCycleFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All months</option>
            {data.billingCycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.periodLabel}
              </option>
            ))}
          </select>
          <button
            className="v2-reset"
            onClick={() => {
              setInvoiceQuery("");
              setPaymentStatusFilter("all");
              setCycleFilter("all");
              setPage(1);
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="table-wrap">
          <table className="finance-invoices">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Student</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginatedInvoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <code>{i.invoiceNo}</code>
                    <small>{titleCase(i.invoiceFrequency)}</small>
                  </td>
                  <td>
                    <strong>{i.studentName}</strong>
                    <small>
                      {i.roomCode || "Not assigned"}
                      {i.hostelName ? ` · ${i.hostelName}` : ""}
                    </small>
                  </td>
                  <td>
                    {i.items.map((x: Row) => {
                      const meta = chargeTypeMeta(x.itemType);
                      return (
                        <small
                          key={x.id}
                          style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                        >
                          <span
                            title={meta.label}
                            style={{
                              display: 'inline-flex',
                              width: '16px',
                              height: '16px',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              background: meta.background,
                              fontSize: '10px',
                              flexShrink: 0,
                            }}
                          >
                            {meta.icon}
                          </span>
                          {x.description}: {money(x.amount, true)}
                        </small>
                      );
                    })}
                  </td>
                  <td>
                    <strong>{money(i.totalAmount, true)}</strong>
                    <small>
                      Paid {money(i.amountPaid, true)} · Owed{" "}
                      {money(i.totalAmount - i.amountPaid, true)}
                    </small>
                  </td>
                  <td>{dateLabel(i.dueDate)}</td>
                  <td>
                    <StatusPill status={i.status} />
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setModal(`invoice:${i.id}`);
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredInvoices.length > 0 && (
          <footer className="student-pagination">
            <span>
              Showing {rangeStart} to {rangeEnd} of {filteredInvoices.length}{" "}
              invoices
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
              {paginationItems(currentPage, totalPages).map((item, index) =>
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
                    className={`student-page-button ${
                      item === currentPage ? "active" : ""
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
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          </footer>
        )}
        {!data.invoices.length && (
          <Empty
            title="No monthly bills generated"
            text="Prepare the first billing month. Active students will receive draft bills."
          />
        )}
      </section>
      )}
      {financeTab === "deposits" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>SALES DEPOSITS</small>
            <h3>Reservation deposits received</h3>
            <p>
              Payments collected during Sales reservations, before the
              student has a monthly invoice.
            </p>
          </div>
          {pendingReservationReviews.length > 0 && (
            <span className="v2-pending-badge">
              {pendingReservationReviews.length} pending review
            </span>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Student</th>
                <th>Hostel / room</th>
                <th>Payment</th>
                <th>Slip</th>
                <th>Salesperson</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reservationDeposits.map((reservation) => {
                const hostel = data.hostels.find(
                  (item) => item.id === reservation.preferredHostelId,
                );
                const pending = isReservationPendingReview(reservation);
                const slips = data.attachments.filter(
                  (attachment) =>
                    attachment.contextType === "payment-proof" &&
                    (reservation.payments || []).some(
                      (payment: Row) => payment.id === attachment.recordId,
                    ),
                );
                return (
                  <tr key={reservation.id}>
                    <td>
                      <code>{reservation.referenceNo}</code>
                      <small>{dateLabel(reservation.paymentUpdatedAt)}</small>
                    </td>
                    <td>
                      <strong>{reservation.studentName}</strong>
                      <small>{titleCase(reservation.reservationType)}</small>
                    </td>
                    <td>
                      {hostel?.name || "Hostel not set"}
                      <small>
                        {reservation.roomCategory === "any"
                          ? "Any room"
                          : `Room ${reservation.roomCategory}`}
                      </small>
                    </td>
                    <td>
                      <strong>{money(reservation.amountPaid, true)}</strong>
                      <small>
                        of{" "}
                        {reservation.totalPayable
                          ? money(reservation.totalPayable, true)
                          : "-"}{" "}
                        payable
                      </small>
                    </td>
                    <td>
                      {slips.length ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          {slips.map((attachment) => (
                            <a
                              key={attachment.id}
                              className="secondary compact"
                              href={`/api/files?id=${attachment.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View slip
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td>{reservation.salesPerson || "-"}</td>
                    <td>
                      <StatusPill status={reservation.paymentStatus} />
                    </td>
                    <td>
                      {pending ? (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            save(
                              {
                                action: "reservation-finance-review",
                                reservationId: reservation.id,
                              },
                              "Marked as reviewed",
                            )
                          }
                        >
                          Mark as reviewed
                        </button>
                      ) : (
                        <span className="muted">Reviewed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!reservationDeposits.length && (
                <tr>
                  <td colSpan={8}>
                    <em>No reservation deposits recorded yet.</em>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}
      {financeTab === "adjustments" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>CONTROLLED BILLING CHANGES</small>
              <h3>Adjustment and electricity approval register</h3>
            </div>
          </div>
          {data.billingAdjustments.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Item</th>
                  <th>Previous</th>
                  <th>New</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.billingAdjustments.map((adjustment) => {
                  const invoice = data.invoices.find((entry) =>
                    entry.items.some(
                      (item: Row) => item.id === adjustment.billingItemId,
                    ),
                  );
                  const item = invoice?.items.find(
                    (entry: Row) => entry.id === adjustment.billingItemId,
                  );
                  return (
                    <tr key={adjustment.id}>
                      <td>
                        {dateLabel(adjustment.createdAt)}
                        <small>{adjustment.requestedBy}</small>
                      </td>
                      <td>
                        {item?.description ||
                          `Item ${adjustment.billingItemId}`}
                        <small>{invoice?.studentName}</small>
                      </td>
                      <td>{money(adjustment.previousAmount, true)}</td>
                      <td>{money(adjustment.newAmount, true)}</td>
                      <td>{adjustment.reason}</td>
                      <td>
                        <StatusPill status={adjustment.approvalStatus} />
                      </td>
                      <td>
                        {adjustment.approvalStatus === "pending" &&
                          data.currentUser?.permissions?.some(
                            (permission: Row) =>
                              permission.moduleKey === "finance" &&
                              permission.canApprove,
                          ) && (
                            <button
                              className="primary compact"
                              onClick={() =>
                                save(
                                  {
                                    action: "billing-adjust-approve",
                                    adjustmentId: adjustment.id,
                                  },
                                  "Adjustment approved",
                                )
                              }
                            >
                              Approve
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : (
            <Empty
              title="No adjustments requested"
              text="Billing adjustment and electricity-rate approval requests will show up here."
            />
          )}
        </section>
      )}
      {financeTab === "maintenance" && (
        <>
          <section className="module-metrics">
            <Stat
              value={money(maintenanceTotalCost, true)}
              label="Maintenance cost"
            />
            <Stat
              value={money(maintenanceTotalCharged, true)}
              label="Charged to students"
            />
            <Stat
              value={money(maintenanceNetCost, true)}
              label="Net cost to operator"
            />
          </section>
          {Object.keys(maintenanceByResponsibility).length > 0 && (
            <section className="panel charge-type-breakdown">
              <div className="section-heading">
                <div>
                  <small>WHO PAYS FOR IT</small>
                  <h3>Maintenance cost by responsibility</h3>
                  <p>
                    Actual repair cost, grouped by who&apos;s responsible for
                    it — management, the unit owner, or the student.
                  </p>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  padding: "4px 0 8px",
                }}
              >
                {Object.entries(maintenanceByResponsibility).map(
                  ([responsibility, amount]) => (
                    <div
                      key={responsibility}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 16px",
                        borderRadius: "10px",
                        background: "#f3f4f6",
                        minWidth: "150px",
                      }}
                    >
                      <span style={{ fontSize: "18px" }}>🔧</span>
                      <div>
                        <strong
                          style={{
                            display: "block",
                            fontSize: "15px",
                            color: "#374151",
                          }}
                        >
                          {money(amount, true)}
                        </strong>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#374151",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                          }}
                        >
                          {titleCase(responsibility)}
                        </span>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="section-heading">
              <div>
                <small>REPAIR COSTS</small>
                <h3>Maintenance tickets with cost recorded</h3>
                <p>
                  Actual cost paid out versus the portion charged to the
                  student — the difference is what maintenance work cost the
                  operator net.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Location</th>
                    <th>Responsibility</th>
                    <th>Actual cost</th>
                    <th>Charged to student</th>
                    <th>Net cost</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenanceCostTickets.map((ticket: Row) => {
                    const actualCost = Number(ticket.actualCost || 0);
                    const studentCharge = Number(ticket.studentCharge || 0);
                    return (
                      <tr key={ticket.id}>
                        <td>
                          <code>{ticket.ticketNo}</code>
                          <small>{ticket.subject}</small>
                        </td>
                        <td>
                          {ticket.hostelName || "-"}
                          <small>
                            {[ticket.unitCode, ticket.roomLabel]
                              .filter(Boolean)
                              .join(" / ") || "No location set"}
                          </small>
                        </td>
                        <td>{titleCase(ticket.costResponsibility)}</td>
                        <td>{money(actualCost, true)}</td>
                        <td>{money(studentCharge, true)}</td>
                        <td>{money(actualCost - studentCharge, true)}</td>
                        <td>{dateLabel(ticket.completedAt) || "-"}</td>
                      </tr>
                    );
                  })}
                  {!maintenanceCostTickets.length && (
                    <tr>
                      <td colSpan={7}>
                        <em>No maintenance tickets have cost recorded yet.</em>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {financeTab === "parking" && (
        <>
          <section className="module-metrics">
            <Stat
              value={money(parkingMonthlyIncome, true)}
              label="Monthly parking income"
            />
            <Stat
              value={money(inHouseParkingIncome, true)}
              label="In-house (billed to students)"
            />
            <Stat
              value={money(outsideParkingIncome, true)}
              label="Outside tenants"
            />
            <Stat
              value={money(parkingDepositsHeld, true)}
              label="Deposits held"
            />
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <small>ACTIVE RENTALS</small>
                <h3>Parking rentals and payment status</h3>
                <p>
                  In-house tenants are billed automatically through the
                  monthly student invoice (see the Parking charge type
                  above). Outside tenants pay directly and are tracked here.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Type</th>
                    <th>Lot</th>
                    <th>Car</th>
                    <th>Monthly rental</th>
                    <th>Deposit</th>
                    <th>Paid until</th>
                    <th>Next due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeParkingRentals.map((rental: Row) => (
                    <tr key={rental.id}>
                      <td>
                        <strong>{rental.tenantName}</strong>
                        <small>{rental.hostelName}</small>
                      </td>
                      <td>{titleCase(rental.tenantType)}</td>
                      <td>{rental.lotNumber}</td>
                      <td>
                        {rental.carPlateNumber || "-"}
                        <small>{rental.carModel}</small>
                      </td>
                      <td>{money(rental.monthlyRental, true)}</td>
                      <td>{money(rental.depositAmount, true)}</td>
                      <td>{dateLabel(rental.paidUntil) || "-"}</td>
                      <td>{dateLabel(rental.nextDueDate) || "-"}</td>
                      <td>
                        <StatusPill
                          status={rental.paymentStatus || "current"}
                        />
                      </td>
                    </tr>
                  ))}
                  {!activeParkingRentals.length && (
                    <tr>
                      <td colSpan={9}>
                        <em>No active parking rentals.</em>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {modal === "cycle" && (
        <Modal
          title="Prepare billing month"
          kicker="CUT-OFF CONTROL"
          description="The 24th is the normal cut-off. Review draft calculations before posting."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "billing-cycle", ...formValues(e) },
                "Draft billing cycle prepared",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Billing month
              <input name="periodLabel" type="month" required />
            </label>
            <label>
              Cut-off date
              <input name="cutoffDate" type="date" required />
            </label>
            <label>
              Payment due date
              <input name="dueDate" type="date" required />
            </label>
            <label>
              Invoice frequency
              <select name="invoiceFrequency">
                <option value="on-request">Invoice on request</option>
                <option value="monthly">Generate invoice monthly</option>
                <option value="one-time">One-time invoice</option>
              </select>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Generate draft bills
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal.startsWith("invoice:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title={invoice.invoiceNo}
              kicker="STUDENT BILL"
              description={`${invoice.studentName} · Due ${dateLabel(invoice.dueDate)}`}
              onClose={() => setModal("")}
            >
              <div className="invoice-sheet">
                <div>
                  {invoice.items.map((x: Row) => {
                    const meta = chargeTypeMeta(x.itemType);
                    return (
                      <p key={x.id}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: meta.background,
                              color: meta.color,
                              fontSize: '10px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.02em',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {meta.icon} {meta.label}
                          </span>
                          {x.description}
                        </span>
                        <b>{money(x.amount, true)}</b>
                        {data.currentUser?.roleKey !== "tenant" && (
                          <button
                            className="secondary compact"
                            onClick={() => setModal(`edit-item:${x.id}`)}
                          >
                            Edit
                          </button>
                        )}
                      </p>
                    );
                  })}
                </div>
                <footer>
                  <span>Total</span>
                  <strong>{money(invoice.totalAmount, true)}</strong>
                </footer>
                <footer>
                  <span>Outstanding</span>
                  <strong>
                    {money(invoice.totalAmount - invoice.amountPaid, true)}
                  </strong>
                </footer>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => window.print()}>
                  Print / download PDF
                </button>
                <button
                  className="primary"
                  onClick={() => setModal(`payment:${invoice.id}`)}
                >
                  Submit payment
                </button>
              </div>
              {invoice.payments.length > 0 && (
                <div className="payment-review">
                  <h4>Payment submissions</h4>
                  {invoice.payments.map((p: Row) => (
                    <div key={p.id}>
                      <span>
                        {money(p.verifiedAmount ?? p.amount, true)} ·{" "}
                        {p.remark || "No remark"} · {titleCase(p.status)}
                      </span>
                      {data.attachments
                        .filter(
                          (attachment) =>
                            attachment.contextType === "payment-proof" &&
                            attachment.recordId === p.id,
                        )
                        .map((attachment) => (
                          <a
                            key={attachment.id}
                            className="secondary compact"
                            href={`/api/files?id=${attachment.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View payment slip
                          </a>
                        ))}
                      {p.status !== "verified" && (
                        <button
                          className="secondary compact"
                          onClick={() => setModal(`verify:${p.id}`)}
                        >
                          Verify & issue receipt
                        </button>
                      )}
                      {p.status === "verified" && (
                        <button
                          className="secondary compact"
                          onClick={() => window.print()}
                        >
                          Receipt {p.receiptNo}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Modal>
          );
        })()}
      {modal.startsWith("payment:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title="Submit payment proof"
              kicker={invoice.invoiceNo}
              onClose={() => setModal("")}
            >
              <form
                className="form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const result = await save(
                    {
                      action: "billing-payment",
                      invoiceId: invoice.id,
                      ...formValues(e),
                    },
                    "Payment submitted for verification",
                  );
                  if (result) {
                    const file = (
                      form.elements.namedItem("proof") as HTMLInputElement
                    ).files?.[0];
                    if (file && result.id)
                      await uploadAttachment(
                        file,
                        "payment-proof",
                        result.id,
                        data.currentUser?.displayName,
                      );
                    setModal("");
                  }
                }}
              >
                <label>
                  Amount
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  Remark (optional)
                  <input name="remark" placeholder="Payment note" />
                </label>
                <label className="wide">
                  Payment slip
                  <input
                    name="proof"
                    type="file"
                    accept="image/*,.pdf"
                    required
                  />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Submit proof
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      {modal.startsWith("verify:") &&
        (() => {
          const paymentId = Number(modal.split(":")[1]);
          const invoice = data.invoices.find((item) =>
            item.payments.some((payment: Row) => payment.id === paymentId),
          );
          const payment = invoice?.payments.find(
            (item: Row) => item.id === paymentId,
          );
          if (!invoice || !payment) return null;
          const slips = data.attachments.filter(
            (attachment) =>
              attachment.contextType === "payment-proof" &&
              attachment.recordId === payment.id,
          );
          return (
            <Modal
              title="Verify payment received"
              kicker={invoice.invoiceNo}
              description="Review the submitted slip, then record the actual bank amount and reference."
              onClose={() => setModal(`invoice:${invoice.id}`)}
            >
              <div className="payment-slip-preview">
                <strong>Submitted amount: {money(payment.amount, true)}</strong>
                <span>{payment.remark || "No remark submitted"}</span>
                {slips.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/files?id=${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open payment slip: {attachment.fileName}
                  </a>
                ))}
              </div>
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    {
                      action: "billing-verify",
                      paymentId: payment.id,
                      ...formValues(event),
                    },
                    "Payment verified and receipt issued",
                  );
                  if (ok) setModal(`invoice:${invoice.id}`);
                }}
              >
                <label>
                  Actual amount received
                  <input
                    name="verifiedAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={payment.amount}
                  />
                </label>
                <label>
                  Bank / receipt reference
                  <input name="actualReference" required />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Verify & issue receipt
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      {modal.startsWith("edit-item:") &&
        (() => {
          const itemId = Number(modal.split(":")[1]);
          const invoice = data.invoices.find((entry) =>
            entry.items.some((item: Row) => item.id === itemId),
          );
          const item = invoice?.items.find((entry: Row) => entry.id === itemId);
          if (!invoice || !item) return null;
          return (
            <Modal
              title="Edit billing breakdown"
              kicker={invoice.invoiceNo}
              description={
                item.itemType === "electricity"
                  ? "Electricity changes require Manager or Director approval and remain in the adjustment report."
                  : "This change is recorded in the billing adjustment history."
              }
              onClose={() => setModal(`invoice:${invoice.id}`)}
            >
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    {
                      action: "billing-item-adjust",
                      itemId: item.id,
                      ...formValues(event),
                    },
                    item.itemType === "electricity"
                      ? "Electricity adjustment sent for approval"
                      : "Billing item updated",
                  );
                  if (ok) setModal(`invoice:${invoice.id}`);
                }}
              >
                <label className="wide">
                  Item
                  <input value={item.description} readOnly />
                </label>
                <label>
                  Current amount
                  <input value={item.amount} readOnly />
                </label>
                <label>
                  New amount
                  <input
                    name="newAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={item.amount}
                  />
                </label>
                <label className="wide">
                  Reason / remark
                  <input name="reason" required />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Submit change
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
    </div>
  );
}
