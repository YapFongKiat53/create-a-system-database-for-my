"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentLink,
  DateField,
  Empty,
  FileField,
  Lightbox,
  Modal,
  MonthField,
  SearchIcon,
  Stat,
  StatusPill,
  SuspiciousConfirm,
  dateLabel,
  formValues,
  money,
  paginationItems,
  renameAttachment,
  titleCase,
  uploadAttachment,
  useLightbox,
} from "./shared";
import type { Data, Row } from "./shared";
import { BASE_PATH } from "../basePath";

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
  // The gap between the deposit held and the deposit now required — never a
  // second full deposit, only the difference either way.
  "deposit-adjustment": {
    label: "Deposit change",
    color: "#8f6a2c",
    background: "#f4ecdc",
    icon: "🔐",
  },
  "first-month-rental": {
    label: "First month rental",
    color: "#0e7490",
    background: "#cffafe",
    icon: "🏠",
  },
  deposit: {
    label: "Deposit",
    color: "#1d4ed8",
    background: "#dbeafe",
    icon: "🔒",
  },
  "admin-fee": {
    label: "Admin fee",
    color: "#6d28d9",
    background: "#ede9fe",
    icon: "📄",
  },
  "access-card-deposit": {
    label: "Access card deposit",
    color: "#1d4ed8",
    background: "#dbeafe",
    icon: "🪪",
  },
  "access-card-handling": {
    label: "Access card handling fee",
    color: "#6d28d9",
    background: "#ede9fe",
    icon: "🪪",
  },
  "stamping-fee": {
    label: "Stamping fee",
    color: "#6d28d9",
    background: "#ede9fe",
    icon: "📝",
  },
  "cleaning-package": {
    label: "Cleaning package",
    color: "#9f1239",
    background: "#ffe4e6",
    icon: "🧹",
  },
  "bedding-set": {
    label: "Bedding set",
    color: "#9f1239",
    background: "#ffe4e6",
    icon: "🛏️",
  },
  "advance-rental": {
    label: "Advance rental",
    color: "#0e7490",
    background: "#cffafe",
    icon: "🏠",
  },
  "advance-utility": {
    label: "Advance utility fee",
    color: "#92400e",
    background: "#fef3c7",
    icon: "⚡",
  },
  "room-transfer-fee": {
    label: "Room transfer fee",
    color: "#6d28d9",
    background: "#ede9fe",
    icon: "🔁",
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
  load,
  suspicious,
}: {
  data: Data;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
  /** Set when the last save was refused only because a figure looked wrong. */
  suspicious: string;
}) {
  const [modal, setModal] = useState("");
  const lightbox = useLightbox();
  const latest = data.billingCycles[0];
  const latestCycleInvoiceCount = latest
    ? data.invoices.filter((invoice: Row) => invoice.cycleId === latest.id)
        .length
    : 0;
  // Nothing is charged until this is set AND staff explicitly presses
  // "Generate invoices" below — see the "cycle" modal.
  const [cyclePreview, setCyclePreview] = useState<{
    cycleId: number;
    periodLabel: string;
    cutoffDate: string;
    dueDate: string;
    invoiceCount: number;
    totalBilled: number;
    electricityBilled: number;
    // Occupied rooms billing no electricity because their meter hasn't been
    // read since the last cycle. The list is capped server-side, so the
    // count is what to trust for "how many".
    unreadMeterRoomCount: number;
    // Money that will never be charged because nobody set it up: a rent left
    // unset, a room with no meter baseline, an expired agreement. Reported
    // before the invoices are created, while it can still be fixed.
    preflight?: {
      checkedAt: string;
      issues: {
        key: string;
        title: string;
        detail: string;
        count: number;
        rows: { label: string; note: string }[];
      }[];
    };
    // Of those, the ones with no reading at all — they need two rounds
    // before they can ever charge, so they are the urgent half.
    neverReadRoomCount: number;
    unreadMeterRooms: { roomCode: string; lastReadingDate: string | null }[];
    rows: {
      studentId: number;
      studentName: string;
      roomCode: string;
      invoiceNo: string;
      total: number;
      items: {
        itemType: string;
        description: string;
        quantity: number;
        rate: number;
        amount: number;
      }[];
    }[];
  } | null>(null);
  const [cycleInputs, setCycleInputs] = useState<Record<
    string,
    string
  > | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // The gate between "generated" and "posted". A cycle's invoices exist in
  // the database (and residents cannot see them yet — see billing-cycle's
  // tenant-visibility filter) the moment "Generate invoices" is pressed;
  // this is Accounts checking them before "Post monthly billing" makes them
  // real. reviewCycleId names which cycle is open; cycleReview is the
  // per-invoice {chargedRent, expectedRent} the server just computed fresh
  // — never cached, since an edit made while this is open should be judged
  // against the current answer, not the one from when the modal opened.
  const [reviewCycleId, setReviewCycleId] = useState<number | null>(null);
  const [cycleReview, setCycleReview] = useState<
    { invoiceId: number; chargedRent: number; expectedRent: number }[] | null
  >(null);
  const [reviewOnlyIssues, setReviewOnlyIssues] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  // Which row's rent is mid-edit, and what's typed into it — only one at a
  // time, so switching rows without saving just discards the abandoned one.
  const [rentEditInvoiceId, setRentEditInvoiceId] = useState<number | null>(
    null,
  );
  const [rentEditAmount, setRentEditAmount] = useState("");
  const [rentEditReason, setRentEditReason] = useState("");
  const loadCycleReview = async (cycleId: number) => {
    setReviewBusy(true);
    const result = await save(
      { action: "billing-cycle-review", cycleId },
      "",
    );
    setReviewBusy(false);
    if (result?.cycleReview) {
      setCycleReview(result.cycleReview);
      setReviewCycleId(cycleId);
      setModal("review");
    }
  };
  // Ticked by the staff member after the server refused an over-payment.
  const [confirmOverpay, setConfirmOverpay] = useState(false);
  // The house rule, in one place: a month is cut off on the same day of that
  // month, and its rent falls due on a fixed day of the NEXT month. Typing
  // all three dates by hand is how cycle 2026-10 ended up cut off on
  // 2026-09-28 — four days after September's — so the month now drives the
  // other two and staff only correct them when a month genuinely differs.
  const cycleDatesFor = (period: string) => {
    if (!/^\d{4}-\d{2}$/.test(period)) return { cutoffDate: "", dueDate: "" };
    const [year, month] = period.split("-").map(Number);
    const day = (value: number) =>
      String(Math.min(28, Math.max(1, Number(value) || 1))).padStart(2, "0");
    const next = new Date(Date.UTC(year, month, 1));
    return {
      cutoffDate: `${period}-${day(data.settings.autoBillingCutoffDay)}`,
      dueDate: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${day(data.settings.autoBillingDueDay)}`,
    };
  };
  const [cycleMonth, setCycleMonth] = useState("");
  const [cycleCutoff, setCycleCutoff] = useState("");
  const [cycleDue, setCycleDue] = useState("");
  const openCycleModal = () => {
    const period = new Date().toISOString().slice(0, 7);
    const dates = cycleDatesFor(period);
    setCycleMonth(period);
    setCycleCutoff(dates.cutoffDate);
    setCycleDue(dates.dueDate);
    setModal("cycle");
  };
  const [financeTab, setFinanceTab] = useState<
    "invoices" | "cycles" | "deposits" | "adjustments" | "maintenance" | "parking"
  >("invoices");
  // The reservation whose deposit detail modal is open — replaces the old
  // "Mark as reviewed" action, which just stamped a timestamp nobody
  // downstream ever read.
  const [openDeposit, setOpenDeposit] = useState<Row | null>(null);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  // A due-date range replaces the old "All months" dropdown — that one only
  // covered invoices belonging to a billing cycle, so the move-in invoices
  // (INV-MI-*, no cycleId at all) never showed up under any month. Every
  // invoice has a due date regardless of whether it has a cycle, so the
  // range reaches both kinds.
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");
  // Lines up with the "WHERE THE MONEY IS" breakdown above the table — lets
  // Accounts jump straight to, say, every invoice still carrying a late fee.
  const [chargeTypeFilter, setChargeTypeFilter] = useState("all");
  // A move-in invoice (INV-MI-*) has no cycleId at all — it's raised the
  // moment a reservation converts, not by a billing run. Everything else
  // came out of "Prepare billing month". Lets staff tell the two apart
  // instead of hunting for "MI" in the invoice number.
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState("all");
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
    // Plain string comparison — dueDate is always "YYYY-MM-DD", the same
    // shape the date inputs hand back, so it sorts the same as a real date.
    const dueDateMatch =
      (!dueDateFrom || String(invoice.dueDate || "") >= dueDateFrom) &&
      (!dueDateTo || String(invoice.dueDate || "") <= dueDateTo);
    const chargeTypeMatch =
      chargeTypeFilter === "all" ||
      (invoice.items as Row[]).some(
        (item) => (item.itemType || "other") === chargeTypeFilter,
      );
    const typeMatch =
      invoiceTypeFilter === "all" ||
      (invoiceTypeFilter === "move-in" ? !invoice.cycleId : !!invoice.cycleId);
    return (
      statusMatch && searchMatch && dueDateMatch && chargeTypeMatch && typeMatch
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
  // here.
  // Only the charge types that are actually refundable deposits belong
  // here — admin fee, first month rental, access card handling, etc. are
  // real income, not money Finance will ever hand back. "Deposit" and
  // "access card deposit" are the only reservation charge types with that
  // property (parking's own deposit is tracked separately, see
  // parkingDepositsHeld below).
  const isDepositChargeType = (chargeType: string) =>
    chargeType === "deposit" || chargeType === "access-card-deposit";
  const depositChargesOf = (reservation: Row) =>
    (reservation.charges || []).filter((charge: Row) =>
      isDepositChargeType(charge.chargeType),
    );
  const depositPaidOf = (reservation: Row) =>
    depositChargesOf(reservation)
      .filter((charge: Row) => charge.paidAt)
      .reduce((sum: number, charge: Row) => sum + Number(charge.amount || 0), 0);
  const depositPayableOf = (reservation: Row) =>
    depositChargesOf(reservation).reduce(
      (sum: number, charge: Row) => sum + Number(charge.amount || 0),
      0,
    );
  const reservationDeposits = data.reservations
    .filter((reservation) => depositPaidOf(reservation) > 0)
    .sort((a, b) =>
      String(b.paymentUpdatedAt || "").localeCompare(
        String(a.paymentUpdatedAt || ""),
      ),
    );
  // Deposits do not stop moving once the student is in. A rate change or a
  // room change books the difference, which the next invoice collects (or
  // credits back) — so the money actually held is the move-in deposits plus
  // the net of those adjustments, and the ledger has to show both or it
  // understates what the house is holding.
  const depositMovements = data.depositAdjustments || [];
  const movementState = (row: Row) =>
    !row.billedCycleId
      ? "scheduled"
      : row.invoiceStatus === "paid"
        ? "settled"
        : "billed";
  const depositsCollectedAtMoveIn = data.reservations.reduce(
    (sum, reservation) => sum + depositPaidOf(reservation),
    0,
  );
  // Only a settled movement has actually changed the cash held; one that is
  // merely billed is still a receivable.
  const depositMovementSettled = depositMovements
    .filter((row) => movementState(row) === "settled")
    .reduce((sum: number, row: Row) => sum + Number(row.amount || 0), 0);
  const depositMovementPending = depositMovements
    .filter((row) => movementState(row) !== "settled")
    .reduce((sum: number, row: Row) => sum + Number(row.amount || 0), 0);

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
          <div className="button-row">
            <button
              className="secondary compact"
              onClick={() => setModal("auto-billing")}
            >
              Automatic billing
            </button>
            <button
              className="v2-btn-primary"
              onClick={() => setFinanceTab("cycles")}
            >
              Billing cycles
            </button>
          </div>
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
      <div className="workspace-tabs module-tabs">
        <button
          className={financeTab === "invoices" ? "active" : ""}
          onClick={() => setFinanceTab("invoices")}
        >
          Invoices
        </button>
        <button
          className={financeTab === "cycles" ? "active" : ""}
          onClick={() => setFinanceTab("cycles")}
        >
          Billing cycles
        </button>
        <button
          className={financeTab === "deposits" ? "active" : ""}
          onClick={() => setFinanceTab("deposits")}
        >
          Reservation deposits
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
      {financeTab === "cycles" && (
      <section className="panel">
        <div className="section-heading">
          <div>
            <small>MONTHLY BILLING RUNS</small>
            <h3>Billing cycles</h3>
            <p>
              Each month&rsquo;s billing run, separate from the individual bills it
              produces — those live under Invoices.
            </p>
          </div>
          {data.currentUser?.roleKey !== "tenant" && (
            <button className="v2-btn-primary" onClick={openCycleModal}>
              + Prepare billing month
            </button>
          )}
        </div>
        {latest && (
          <section className="cycle-banner">
            <div>
              <small>LATEST BILLING CYCLE</small>
              <h3>{latest.periodLabel}</h3>
              <p>
                Cut-off {dateLabel(latest.cutoffDate)} · Due{" "}
                {dateLabel(latest.dueDate)} · {titleCase(latest.status)}
                {latest.status === "draft" &&
                  latestCycleInvoiceCount === 0 &&
                  " · Reserved, not yet generated"}
              </p>
            </div>
            {latest.status === "draft" &&
              latestCycleInvoiceCount === 0 &&
              data.currentUser?.roleKey !== "tenant" && (
                <button
                  className="primary"
                  disabled={previewBusy}
                  onClick={async () => {
                    const values = {
                      periodLabel: latest.periodLabel,
                      cutoffDate: latest.cutoffDate,
                      dueDate: latest.dueDate,
                      invoiceFrequency: "monthly",
                    };
                    setPreviewBusy(true);
                    const result = await save(
                      { action: "billing-cycle-preview", ...values },
                      "Preview ready",
                    );
                    setPreviewBusy(false);
                    if (result?.preview) {
                      setCycleInputs(values);
                      setCyclePreview(result.preview);
                      setModal("cycle");
                    }
                  }}
                >
                  {previewBusy ? "Calculating…" : "Preview & generate"}
                </button>
              )}
            {latest.status === "draft" &&
              latestCycleInvoiceCount > 0 &&
              data.currentUser?.roleKey !== "tenant" && (
                <button
                  className="primary"
                  disabled={reviewBusy}
                  onClick={() => loadCycleReview(latest.id)}
                >
                  {reviewBusy ? "Checking…" : "Review & post"}
                </button>
              )}
          </section>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Cut-off</th>
                <th>Due</th>
                <th>Status</th>
                <th>Invoices</th>
                <th>Total billed</th>
                <th>Outstanding</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.billingCycles.map((cycle) => {
                const cycleInvoices = data.invoices.filter(
                  (invoice) => invoice.cycleId === cycle.id,
                );
                const cycleTotal = cycleInvoices.reduce(
                  (sum: number, invoice: Row) =>
                    sum + Number(invoice.totalAmount || 0),
                  0,
                );
                const cycleOutstanding = cycleInvoices.reduce(
                  (sum: number, invoice: Row) =>
                    sum +
                    Number(invoice.totalAmount || 0) -
                    Number(invoice.amountPaid || 0),
                  0,
                );
                return (
                  <tr key={cycle.id}>
                    <td>
                      <strong>{cycle.periodLabel}</strong>
                    </td>
                    <td>{dateLabel(cycle.cutoffDate)}</td>
                    <td>{dateLabel(cycle.dueDate)}</td>
                    <td>
                      <StatusPill status={cycle.status} />
                    </td>
                    <td>{cycleInvoices.length}</td>
                    <td>{money(cycleTotal, true)}</td>
                    <td>{money(cycleOutstanding, true)}</td>
                    <td>
                      {cycle.status === "draft" &&
                      cycleInvoices.length > 0 &&
                      data.currentUser?.roleKey !== "tenant" ? (
                        <button
                          className="secondary compact"
                          disabled={reviewBusy}
                          onClick={() => loadCycleReview(cycle.id)}
                        >
                          {reviewBusy ? "Checking…" : "Review & post"}
                        </button>
                      ) : (
                        cycleInvoices.length > 0 && (
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setInvoiceQuery("");
                              setDueDateFrom(cycle.dueDate);
                              setDueDateTo(cycle.dueDate);
                              setFinanceTab("invoices");
                            }}
                          >
                            View invoices
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
              {!data.billingCycles.length && (
                <tr>
                  <td colSpan={8}>
                    <em>No billing cycles yet — prepare the first one above.</em>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}
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
            value={chargeTypeFilter}
            onChange={(event) => {
              setChargeTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All charge types</option>
            {chargeTypeOrder.map((type) => (
              <option key={type} value={type}>
                {chargeTypeMeta(type).label}
              </option>
            ))}
          </select>
          <select
            className="v2-pill-select"
            value={invoiceTypeFilter}
            onChange={(event) => {
              setInvoiceTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Move-in & billing cycles</option>
            <option value="move-in">Move-in only</option>
            <option value="cycle">Billing cycles only</option>
          </select>
          <div className="v2-date-range">
            <span className="v2-date-range-label">Due</span>
            <DateField
              className="v2-date-input"
              value={dueDateFrom}
              onChange={(event) => {
                setDueDateFrom(event.target.value);
                setPage(1);
              }}
              max={dueDateTo || undefined}
              aria-label="Due date from"
            />
            <span className="v2-date-range-sep">–</span>
            <DateField
              className="v2-date-input"
              value={dueDateTo}
              onChange={(event) => {
                setDueDateTo(event.target.value);
                setPage(1);
              }}
              min={dueDateFrom || undefined}
              aria-label="Due date to"
            />
          </div>
          <button
            className="v2-reset"
            onClick={() => {
              setInvoiceQuery("");
              setDueDateFrom("");
              setDueDateTo("");
              setPaymentStatusFilter("all");
              setChargeTypeFilter("all");
              setInvoiceTypeFilter("all");
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
                    <span
                      className={`invoice-type-badge ${i.cycleId ? "is-cycle" : "is-movein"}`}
                    >
                      {i.cycleId ? "📅 Billing cycle" : "🏠 Move-in"}
                    </span>
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
                      Paid {money(i.amountPaid, true)} ·{" "}
                      {i.amountPaid > i.totalAmount ? (
                        <span style={{ color: "#166534", fontWeight: 700 }}>
                          Overpaid{" "}
                          {money(i.amountPaid - i.totalAmount, true)}
                        </span>
                      ) : (
                        <>Owed {money(i.totalAmount - i.amountPaid, true)}</>
                      )}
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
            <small>REFUNDABLE MONEY HELD</small>
            <h3>Deposits</h3>
            <p>
              Deposits taken at move-in, plus every change since. Only money
              the house will hand back appears here.
            </p>
          </div>
        </div>

        <div className="deposit-ledger">
          <div>
            <small>COLLECTED AT MOVE-IN</small>
            <b>{money(depositsCollectedAtMoveIn, true)}</b>
            <span>{reservationDeposits.length} reservations</span>
          </div>
          <div>
            <small>CHANGES SETTLED SINCE</small>
            <b className={depositMovementSettled < 0 ? "figure-out" : ""}>
              {depositMovementSettled >= 0 ? "+" : "−"}
              {money(Math.abs(depositMovementSettled), true)}
            </b>
            <span>
              {
                depositMovements.filter(
                  (row) => movementState(row) === "settled",
                ).length
              }{" "}
              paid changes
            </span>
          </div>
          <div>
            <small>TOTAL HELD</small>
            <b className="figure-in">
              {money(
                depositsCollectedAtMoveIn + depositMovementSettled,
                true,
              )}
            </b>
            <span>Refundable to students</span>
          </div>
          <div>
            <small>CHANGES NOT YET SETTLED</small>
            <b className={depositMovementPending ? "figure-out" : ""}>
              {depositMovementPending >= 0 ? "+" : "−"}
              {money(Math.abs(depositMovementPending), true)}
            </b>
            <span>
              {
                depositMovements.filter(
                  (row) => movementState(row) !== "settled",
                ).length
              }{" "}
              awaiting payment
            </span>
          </div>
        </div>

        <h4 className="deposit-section-label">Collected at move-in</h4>
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
                const depositCharges = depositChargesOf(reservation);
                const depositPaymentIds = new Set(
                  depositCharges
                    .filter((charge: Row) => charge.paidAt)
                    .map((charge: Row) => charge.paymentId),
                );
                const slips = data.attachments.filter(
                  (attachment) =>
                    attachment.contextType === "payment-proof" &&
                    depositPaymentIds.has(attachment.recordId),
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
                      <strong>{money(depositPaidOf(reservation), true)}</strong>
                      <small>
                        of {money(depositPayableOf(reservation), true)} deposit
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
                            <div
                              key={attachment.id}
                              style={{ display: "flex", alignItems: "center", gap: "4px" }}
                            >
                              <AttachmentLink
                                attachment={attachment}
                                onOpen={lightbox.open}
                                className="secondary compact"
                              >
                                View slip
                              </AttachmentLink>
                              <button
                                type="button"
                                className="secondary compact"
                                style={{ color: "#b91c1c" }}
                                disabled={busy}
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      "Delete this payment slip? This cannot be undone.",
                                    )
                                  )
                                    return;
                                  await fetch(
                                    `${BASE_PATH}/api/files?id=${attachment.id}`,
                                    { method: "DELETE" },
                                  );
                                  await load(["attachments"]);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td>{reservation.salesPerson || "-"}</td>
                    <td>
                      <StatusPill
                        status={
                          depositPaidOf(reservation) >= depositPayableOf(reservation)
                            ? "full"
                            : "partial"
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => setOpenDeposit(reservation)}
                      >
                        Open
                      </button>
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

        {openDeposit &&
          (() => {
            const hostel = data.hostels.find(
              (item) => item.id === openDeposit.preferredHostelId,
            );
            const depositCharges = depositChargesOf(openDeposit);
            const depositPaymentIds = new Set(
              depositCharges
                .filter((charge: Row) => charge.paidAt)
                .map((charge: Row) => charge.paymentId),
            );
            const slips = data.attachments.filter(
              (attachment) =>
                attachment.contextType === "payment-proof" &&
                depositPaymentIds.has(attachment.recordId),
            );
            const paid = depositPaidOf(openDeposit);
            const payable = depositPayableOf(openDeposit);
            return (
              <Modal
                title={openDeposit.studentName}
                kicker="RESERVATION DEPOSIT"
                description={`${openDeposit.referenceNo} · ${hostel?.name || "Hostel not set"}`}
                onClose={() => setOpenDeposit(null)}
              >
                <div className="deposit-modal-summary">
                  <div>
                    <small>DEPOSIT PAID</small>
                    <strong>{money(paid, true)}</strong>
                    <span>of {money(payable, true)} required</span>
                  </div>
                  <StatusPill status={paid >= payable ? "full" : "partial"} />
                </div>

                <div className="deposit-modal-meta">
                  <div>
                    <small>ROOM</small>
                    <span>
                      {openDeposit.roomCategory === "any"
                        ? "Any room"
                        : `Room ${openDeposit.roomCategory}`}
                    </span>
                  </div>
                  <div>
                    <small>TYPE</small>
                    <span>{titleCase(openDeposit.reservationType)}</span>
                  </div>
                  <div>
                    <small>SALESPERSON</small>
                    <span>{openDeposit.salesPerson || "-"}</span>
                  </div>
                  <div>
                    <small>LAST PAYMENT</small>
                    <span>{dateLabel(openDeposit.paymentUpdatedAt)}</span>
                  </div>
                </div>

                <h4 className="deposit-section-label">Charges</h4>
                <div className="deposit-breakdown">
                  {depositCharges.length ? (
                    depositCharges.map((charge: Row) => {
                      const meta = chargeTypeMeta(charge.chargeType);
                      return (
                        <div
                          key={charge.id}
                          className="deposit-breakdown-item"
                        >
                          <span
                            className="deposit-breakdown-icon"
                            style={{
                              background: meta.background,
                              color: meta.color,
                            }}
                          >
                            {meta.icon}
                          </span>
                          <div>
                            <strong>{meta.label}</strong>
                            <small>
                              {charge.paidAt
                                ? `Paid ${dateLabel(charge.paidAt)}`
                                : "Not yet paid"}
                              {charge.notes ? ` · ${charge.notes}` : ""}
                            </small>
                          </div>
                          <b>{money(charge.amount, true)}</b>
                        </div>
                      );
                    })
                  ) : (
                    <em>No deposit charges on this reservation.</em>
                  )}
                </div>

                {slips.length > 0 && (
                  <>
                    <h4 className="deposit-section-label">Payment slips</h4>
                    <div className="button-row">
                      {slips.map((attachment) => (
                        <span
                          key={attachment.id}
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                        >
                          <AttachmentLink
                            attachment={attachment}
                            onOpen={lightbox.open}
                            className="secondary compact"
                          >
                            View slip
                          </AttachmentLink>
                          <button
                            type="button"
                            className="secondary compact"
                            style={{ color: "#b91c1c" }}
                            disabled={busy}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  "Delete this payment slip? This cannot be undone.",
                                )
                              )
                                return;
                              await fetch(
                                `${BASE_PATH}/api/files?id=${attachment.id}`,
                                { method: "DELETE" },
                              );
                              await load(["attachments"]);
                            }}
                          >
                            Delete
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Modal>
            );
          })()}

        <h4 className="deposit-section-label">Changes during tenancy</h4>
        <p className="deposit-section-note">
          When rent changes or a student moves room, only the difference
          between the deposit held and the new figure is billed — never a
          second full deposit. It is collected (or credited back) on the next
          monthly invoice.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Hostel / room</th>
                <th>Deposit</th>
                <th>Difference</th>
                <th>Reason</th>
                <th>Effective</th>
                <th>Invoice</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {depositMovements.map((row) => {
                const state = movementState(row);
                const up = Number(row.amount) > 0;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.studentName || "Unknown"}</strong>
                      <small>{titleCase(row.source || "")}</small>
                    </td>
                    <td>
                      {row.hostelName || "-"}
                      <small>{row.roomCode || "Room not set"}</small>
                    </td>
                    <td>
                      {money(row.previousAmount, true)} →{" "}
                      <strong>{money(row.newAmount, true)}</strong>
                    </td>
                    <td>
                      <strong className={up ? "figure-out" : "figure-in"}>
                        {up ? "+" : "−"}
                        {money(Math.abs(Number(row.amount)), true)}
                      </strong>
                      <small>{up ? "top-up owed" : "refund due"}</small>
                    </td>
                    <td>{row.reason || "-"}</td>
                    <td>{dateLabel(row.effectiveDate)}</td>
                    <td>
                      {row.invoiceNo ? (
                        <code>{row.invoiceNo}</code>
                      ) : (
                        <span className="muted">Next invoice</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        status={
                          state === "settled"
                            ? "paid"
                            : state === "billed"
                              ? "partial"
                              : "unpaid"
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {!depositMovements.length && (
                <tr>
                  <td colSpan={8}>
                    <em>
                      No deposit changes yet — every tenancy still holds the
                      deposit taken at move-in.
                    </em>
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
      {modal === "auto-billing" && (
        <Modal
          title="Automatic monthly billing"
          kicker="SCHEDULED RUN"
          description="Rent and electricity are charged every month whether or not anyone opens Finance."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const values = formValues(e) as Record<string, string>;
              for (const [settingKey, settingValue] of [
                ["auto-billing-enabled", values.enabled === "on" ? "on" : "off"],
                ["auto-billing-cutoff-day", String(values.cutoffDay || 24)],
                ["auto-billing-due-day", String(values.dueDay || 5)],
                ["money-guard-meter-jump-kwh", String(values.meterJumpKwh || 500)],
                ["money-guard-overpay-rm", String(values.overpayRm || 100)],
                ["money-guard-overpay-pct", String(values.overpayPct || 20)],
                ["money-guard-rent-max", String(values.rentMax || 5000)],
              ])
                await save(
                  { action: "system-setting-update", settingKey, settingValue },
                  "Automatic billing updated",
                );
              setModal("");
            }}
          >
            <label className="wide">
              Run automatically
              <select
                name="enabled"
                defaultValue={data.settings.autoBillingEnabled ? "on" : "off"}
              >
                <option value="off">Off — prepare each month by hand</option>
                <option value="on">On — build each month automatically</option>
              </select>
            </label>
            <label>
              Cut-off day of month
              <input
                name="cutoffDay"
                type="number"
                min="1"
                max="28"
                defaultValue={data.settings.autoBillingCutoffDay}
              />
              <small className="field-note">
                The month&apos;s bills are built on this day. Capped at 28 so
                every month has one.
              </small>
            </label>
            <label>
              Payment due, day of the following month
              <input
                name="dueDay"
                type="number"
                min="1"
                max="28"
                defaultValue={data.settings.autoBillingDueDay}
              />
              <small className="field-note">
                A fixed calendar day, so every month falls due on the same
                date. Keep it in step with the &ldquo;Payment due today&rdquo;
                reminder under Announcements.
              </small>
            </label>

            {/* The point at which a figure stops looking like a normal month
                and starts looking like a slipped digit. Kept adjustable
                because the right line depends on the estate, not on us: too
                tight and staff learn to tick past the warning without
                reading it, too loose and it never fires. */}
            <p className="wide settings-note">
              The four below are <strong>amount checks</strong>. Anything past
              them is refused until somebody ticks &ldquo;I have checked
              this&rdquo;.
            </p>
            <label>
              Meter reading — monthly usage ceiling (kWh)
              <input
                name="meterJumpKwh"
                type="number"
                min="1"
                defaultValue={data.settings.moneyGuardMeterJumpKwh}
              />
              <small className="field-note">
                A room here averages about 89 kWh a month. One extra digit on
                a reading lands far above this.
              </small>
            </label>
            <label>
              Over-payment allowed (RM)
              <input
                name="overpayRm"
                type="number"
                min="1"
                defaultValue={data.settings.moneyGuardOverpayRm}
              />
              <small className="field-note">
                Only refused once a receipt exceeds the outstanding balance by
                more than this, so small roundings do not nag.
              </small>
            </label>
            <label>
              Over-payment allowed (%)
              <input
                name="overpayPct"
                type="number"
                min="1"
                defaultValue={data.settings.moneyGuardOverpayPct}
              />
              <small className="field-note">
                For small invoices, judged by proportion instead. A receipt
                passes only when it is under both limits.
              </small>
            </label>
            <label>
              Monthly rent ceiling (RM)
              <input
                name="rentMax"
                type="number"
                min="1"
                defaultValue={data.settings.moneyGuardRentMax}
              />
              <small className="field-note">
                Whole-unit contracts genuinely run above this — tick to
                confirm when one does.
              </small>
            </label>

            <p className="wide field-note">
              Each bill is the tenant&apos;s rent plus their share of the
              room&apos;s electricity, with parking, maintenance and any deposit
              difference added when they apply. A room with no new meter reading
              is billed rent only — its usage is picked up in full on the next
              reading, never estimated and never charged twice.
            </p>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "cycle" && (
        <Modal
          wide={Boolean(cyclePreview)}
          title={
            cyclePreview ? `Preview — ${cyclePreview.periodLabel}` : "Prepare billing month"
          }
          kicker="CUT-OFF CONTROL"
          description={
            cyclePreview
              ? "Nothing has been charged yet. Check the figures below, then generate — or go back and adjust the dates."
              : `Both dates follow the billing month: cut off on day ${data.settings.autoBillingCutoffDay}, due on day ${data.settings.autoBillingDueDay} of the month after. Change them only for a month that genuinely differs — the next step shows exactly what this would bill before anything is created.`
          }
          onClose={() => {
            setModal("");
            setCyclePreview(null);
            setCycleInputs(null);
          }}
        >
          {!cyclePreview ? (
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                // Fixed rather than asked for — see the note in the form.
                const values = {
                  ...(formValues(e) as Record<string, string>),
                  invoiceFrequency: "monthly",
                };
                setPreviewBusy(true);
                const result = await save(
                  { action: "billing-cycle-preview", ...values },
                  "Preview ready",
                );
                setPreviewBusy(false);
                if (result?.preview) {
                  setCycleInputs(values);
                  setCyclePreview(result.preview);
                }
              }}
            >
              <label>
                Billing month
                <MonthField
                  name="periodLabel"
                  required
                  value={cycleMonth}
                  onChange={(event) => {
                    const period = event.target.value;
                    const dates = cycleDatesFor(period);
                    setCycleMonth(period);
                    setCycleCutoff(dates.cutoffDate);
                    setCycleDue(dates.dueDate);
                  }}
                />
              </label>
              <label>
                Cut-off date
                <DateField
                  name="cutoffDate"
                  type="date"
                  required
                  value={cycleCutoff}
                  onChange={(event) => setCycleCutoff(event.target.value)}
                />
              </label>
              <label>
                Payment due date
                <DateField
                  name="dueDate"
                  type="date"
                  required
                  value={cycleDue}
                  onChange={(event) => setCycleDue(event.target.value)}
                />
              </label>
              {/* The mistake that silently costs a month of electricity: a
                  cut-off outside the month being billed ends the period
                  early, so that month's meter round never lands in it. */}
              {cycleMonth && cycleCutoff.slice(0, 7) !== cycleMonth && (
                <p className="wide field-note field-note-warn">
                  The cut-off {dateLabel(cycleCutoff)} is outside {cycleMonth},
                  so this month would be billed short — anything read after it
                  waits for the next cycle. The house rule is day{" "}
                  {data.settings.autoBillingCutoffDay} of the billing month
                  itself, and day {data.settings.autoBillingDueDay} of the month
                  after for payment.
                </p>
              )}
              {/* Frequency used to be a dropdown here, but this screen only
                  ever prepares the recurring rent run — anything else is
                  raised on an invoice directly. Picking it per month was a
                  way to get it wrong, so it is fixed and just stated. */}
              <p className="wide field-note">
                Every invoice this creates is marked <strong>Monthly</strong> on
                the tenant&apos;s account, so it shows as part of the recurring
                rent run rather than a one-off charge.
              </p>
              <div className="form-actions wide">
                <button className="primary" disabled={busy || previewBusy}>
                  {previewBusy ? "Calculating…" : "Preview this month"}
                </button>
              </div>
            </form>
          ) : (
            <div className="billing-preview">
              <section className="module-metrics">
                <Stat value={cyclePreview.invoiceCount} label="Would bill" />
                <Stat
                  value={money(cyclePreview.totalBilled, true)}
                  label="Would total"
                />
                <Stat
                  value={money(cyclePreview.electricityBilled || 0, true)}
                  label="Of which electricity"
                />
                <Stat
                  value={`${dateLabel(cyclePreview.cutoffDate)} → ${dateLabel(cyclePreview.dueDate)}`}
                  label="Cut-off / due"
                />
              </section>
              {/* Not "this figure is wrong" but "this money is not going to
                  be charged at all" — a tenancy with no rent, a room that has
                  never been metered, an agreement that ran out. Shown before
                  the invoices exist, because afterwards it is a correction
                  rather than a fix. */}
              {cyclePreview.preflight &&
                cyclePreview.preflight.issues.length > 0 && (
                  <div className="billing-preflight">
                    <strong>
                      Before you generate — {cyclePreview.preflight.issues.length}{" "}
                      thing{cyclePreview.preflight.issues.length === 1 ? "" : "s"} to look at
                    </strong>
                    <span>
                      None of these stop the run, but each one is money this
                      cycle will not charge. There is still time to fix them.
                    </span>
                    <div className="preflight-issues">
                      {cyclePreview.preflight.issues.map((issue) => (
                        <div key={issue.key} className="preflight-issue">
                          <b>
                            {issue.title}
                            <em>{issue.count}</em>
                          </b>
                          <small>{issue.detail}</small>
                          <p>
                            {issue.rows
                              .map((row) => `${row.label} (${row.note})`)
                              .join(" · ")}
                            {issue.count > issue.rows.length &&
                              ` … and ${issue.count - issue.rows.length} more`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              {/* Electricity is only charged for movement between two
                  readings, so a room nobody read this period bills rent
                  only. That used to happen silently — this is the last
                  chance to go and key the readings in before invoices are
                  issued. */}
              {cyclePreview.unreadMeterRoomCount > 0 && (
                <div className="billing-meter-warning">
                  <strong>
                    {cyclePreview.unreadMeterRoomCount} occupied room
                    {cyclePreview.unreadMeterRoomCount === 1 ? "" : "s"} will
                    bill no electricity
                  </strong>
                  <span>
                    No meter reading has been taken for{" "}
                    {cyclePreview.unreadMeterRoomCount === 1 ? "it" : "them"}{" "}
                    since the last billing month. Key the readings in under
                    Maintenance → Meter readings, then preview again — or carry
                    on, and next month&apos;s bill will charge the whole
                    movement at once.
                  </span>
                  {/* Deferring only works where there is an earlier reading to
                      measure from. A room that has never been read has
                      nothing to defer: this month's usage is simply gone, and
                      goes on being lost every month until a first reading
                      sets the baseline and a second one starts charging. */}
                  {cyclePreview.neverReadRoomCount > 0 && (
                    <span className="billing-meter-never">
                      {cyclePreview.neverReadRoomCount} of{" "}
                      {cyclePreview.unreadMeterRoomCount === 1
                        ? "them"
                        : `those ${cyclePreview.unreadMeterRoomCount}`}{" "}
                      {cyclePreview.neverReadRoomCount === 1
                        ? "has never been read at all"
                        : "have never been read at all"}
                      . Nothing carries over for{" "}
                      {cyclePreview.neverReadRoomCount === 1 ? "it" : "them"} —
                      a first reading only sets the baseline, so{" "}
                      {cyclePreview.neverReadRoomCount === 1 ? "it" : "they"}{" "}
                      cannot charge anything until a second round, and every
                      month until then is lost rather than deferred.
                    </span>
                  )}
                  <small>
                    {cyclePreview.unreadMeterRooms
                      .map(
                        (room) =>
                          `${room.roomCode}${
                            room.lastReadingDate
                              ? ` (last read ${dateLabel(room.lastReadingDate)})`
                              : " (never read)"
                          }`,
                      )
                      .join(" · ")}
                    {cyclePreview.unreadMeterRoomCount >
                      cyclePreview.unreadMeterRooms.length &&
                      ` … and ${
                        cyclePreview.unreadMeterRoomCount -
                        cyclePreview.unreadMeterRooms.length
                      } more`}
                  </small>
                </div>
              )}
              {cyclePreview.rows.length === 0 ? (
                <p className="empty-copy">
                  Nobody would be billed for this month — either everyone
                  already has an invoice in it, or no active tenant has rent
                  set.
                </p>
              ) : (
                <div className="table-wrap billing-preview-table">
                  <table className="finance-invoices">
                    <thead>
                      <tr>
                        <th>Tenant</th>
                        <th>Room</th>
                        <th>Breakdown</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cyclePreview.rows.map((row) => (
                        <tr key={row.studentId}>
                          <td>{row.studentName}</td>
                          <td>{row.roomCode}</td>
                          <td>
                            {row.items
                              .map(
                                (item) =>
                                  `${chargeTypeMeta(item.itemType).label}: ${money(item.amount, true)}`,
                              )
                              .join(" · ")}
                          </td>
                          <td>{money(row.total, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="form-actions wide">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setCyclePreview(null)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || cyclePreview.rows.length === 0}
                  onClick={async () => {
                    const ok = await save(
                      { action: "billing-cycle", ...cycleInputs },
                      "Invoices generated",
                    );
                    if (ok) {
                      setModal("");
                      setCyclePreview(null);
                      setCycleInputs(null);
                    }
                  }}
                >
                  Generate invoices
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
      {modal === "review" &&
        reviewCycleId &&
        cycleReview &&
        (() => {
          const cycle = data.billingCycles.find(
            (c: Row) => c.id === reviewCycleId,
          );
          const reviewByInvoice = new Map(
            cycleReview.map((row) => [row.invoiceId, row]),
          );
          const reviewRows = data.invoices
            .filter((invoice: Row) => invoice.cycleId === reviewCycleId)
            .map((invoice: Row) => {
              const review = reviewByInvoice.get(invoice.id);
              const chargedRent = review?.chargedRent ?? 0;
              const expectedRent = review?.expectedRent ?? chargedRent;
              const diff = chargedRent - expectedRent;
              const rentState: "under" | "over" | "match" =
                Math.abs(diff) < 0.005 ? "match" : diff < 0 ? "under" : "over";
              return { invoice, chargedRent, expectedRent, rentState };
            });
          const issueCount = reviewRows.filter(
            (row) => row.rentState !== "match",
          ).length;
          const visibleRows = reviewOnlyIssues
            ? reviewRows.filter((row) => row.rentState !== "match")
            : reviewRows;
          const closeReview = () => {
            setModal("");
            setReviewCycleId(null);
            setCycleReview(null);
            setReviewOnlyIssues(false);
            setRentEditInvoiceId(null);
          };
          return (
            <Modal
              title={`Review — ${cycle?.periodLabel || reviewCycleId}`}
              kicker="ACCOUNTS REVIEW"
              description="Generated, but not sent out yet — residents can't see any of this until it's posted. Check the rent on each room, fix or drop anything wrong, then post."
              onClose={closeReview}
              wide
            >
              <div className="billing-review">
                {issueCount > 0 && (
                  <p className="billing-review-banner">
                    <b>{issueCount}</b> of {reviewRows.length} invoice
                    {reviewRows.length === 1 ? "" : "s"} charge{" "}
                    {issueCount === 1
                      ? "a rent that doesn't"
                      : "rents that don't"}{" "}
                    match the room&apos;s contracted rate — check before
                    posting.
                  </p>
                )}
                <label className="billing-review-toggle">
                  <input
                    type="checkbox"
                    checked={reviewOnlyIssues}
                    onChange={(event) =>
                      setReviewOnlyIssues(event.target.checked)
                    }
                  />
                  Show only rooms that need checking
                </label>
                <div className="table-wrap">
                  <table className="billing-review-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Student</th>
                        <th>Rent charged</th>
                        <th>Other charges</th>
                        <th>Total</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map(
                        ({ invoice, chargedRent, expectedRent, rentState }) => {
                          const rentItem = (invoice.items || []).find(
                            (item: Row) => item.itemType === "room-rental",
                          );
                          const otherItems = (invoice.items || []).filter(
                            (item: Row) => item.itemType !== "room-rental",
                          );
                          const editingThis =
                            rentEditInvoiceId === invoice.id;
                          return (
                            <tr
                              key={invoice.id}
                              className={`billing-review-row is-${rentState}`}
                            >
                              <td>
                                <code>{invoice.invoiceNo}</code>
                              </td>
                              <td>
                                <strong>{invoice.studentName}</strong>
                                <small>{invoice.roomCode}</small>
                              </td>
                              <td>
                                {editingThis ? (
                                  <div className="billing-review-edit">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      autoFocus
                                      value={rentEditAmount}
                                      onChange={(event) =>
                                        setRentEditAmount(event.target.value)
                                      }
                                    />
                                    <input
                                      placeholder="Reason for the change"
                                      value={rentEditReason}
                                      onChange={(event) =>
                                        setRentEditReason(event.target.value)
                                      }
                                    />
                                    <div className="billing-review-edit-actions">
                                      <button
                                        type="button"
                                        className="secondary compact"
                                        disabled={busy}
                                        onClick={() =>
                                          setRentEditInvoiceId(null)
                                        }
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className="primary compact"
                                        disabled={
                                          busy ||
                                          rentEditAmount === "" ||
                                          !rentEditReason.trim() ||
                                          !rentItem
                                        }
                                        onClick={async () => {
                                          if (!rentItem) return;
                                          const ok = await save(
                                            {
                                              action: "billing-item-adjust",
                                              itemId: rentItem.id,
                                              newAmount: rentEditAmount,
                                              reason: rentEditReason,
                                            },
                                            "Rent updated",
                                          );
                                          if (ok) {
                                            setRentEditInvoiceId(null);
                                            setRentEditAmount("");
                                            setRentEditReason("");
                                            await loadCycleReview(
                                              reviewCycleId,
                                            );
                                          }
                                        }}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <strong>{money(chargedRent, true)}</strong>
                                    {rentState !== "match" && (
                                      <small>
                                        Contracted {money(expectedRent, true)}
                                      </small>
                                    )}
                                    {rentItem ? (
                                      <button
                                        type="button"
                                        className="secondary compact"
                                        disabled={busy}
                                        onClick={() => {
                                          setRentEditInvoiceId(invoice.id);
                                          setRentEditAmount(
                                            String(chargedRent),
                                          );
                                          setRentEditReason("");
                                        }}
                                      >
                                        Edit
                                      </button>
                                    ) : (
                                      rentState !== "match" && (
                                        <small className="billing-review-no-item">
                                          No rent line to edit — use Edit
                                          invoice.
                                        </small>
                                      )
                                    )}
                                  </>
                                )}
                              </td>
                              <td>
                                {otherItems.length ? (
                                  otherItems.map((item: Row) => (
                                    <small key={item.id}>
                                      {chargeTypeMeta(item.itemType).label}:{" "}
                                      {money(item.amount, true)}
                                    </small>
                                  ))
                                ) : (
                                  <small>—</small>
                                )}
                              </td>
                              <td>
                                <strong>
                                  {money(invoice.totalAmount, true)}
                                </strong>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="secondary compact"
                                  onClick={() =>
                                    setModal(`invoice:${invoice.id}`)
                                  }
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  className="danger compact"
                                  disabled={busy}
                                  onClick={async () => {
                                    const confirmed = confirm(
                                      `Delete invoice ${invoice.invoiceNo}? This also removes its payment records and cannot be undone.`,
                                    );
                                    if (!confirmed) return;
                                    const ok = await save(
                                      {
                                        action: "billing-invoice-delete",
                                        invoiceId: invoice.id,
                                      },
                                      "Invoice deleted",
                                    );
                                    if (ok)
                                      await loadCycleReview(reviewCycleId);
                                  }}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        },
                      )}
                      {!visibleRows.length && (
                        <tr>
                          <td colSpan={6}>
                            <em>
                              {reviewOnlyIssues
                                ? "Nothing left to check — every rent matches."
                                : "No invoices in this cycle."}
                            </em>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="form-actions wide">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={closeReview}
                >
                  Back — keep as draft
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !reviewRows.length}
                  onClick={async () => {
                    const ok = await save(
                      { action: "billing-post", cycleId: reviewCycleId },
                      "Billing cycle posted",
                    );
                    if (ok) closeReview();
                  }}
                >
                  Confirm & post
                </button>
              </div>
            </Modal>
          );
        })()}
      {modal.startsWith("invoice:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title={invoice.studentName}
              kicker="STUDENT BILL"
              description={`${invoice.invoiceNo} · ${invoice.roomCode ? `Room ${invoice.roomCode}` : "No room assigned"} · Due ${dateLabel(invoice.dueDate)}`}
              onClose={() => setModal("")}
            >
              <div className="invoice-sheet">
                <div className="invoice-items">
                  {invoice.items.map((x: Row) => {
                    const meta = chargeTypeMeta(x.itemType);
                    return (
                      <div key={x.id} className="invoice-item-row">
                        <div className="invoice-item-main">
                          <span
                            className="invoice-item-badge"
                            style={{ background: meta.background, color: meta.color }}
                          >
                            {meta.icon} {meta.label}
                          </span>
                          <span className="invoice-item-desc">{x.description}</span>
                        </div>
                        <div className="invoice-item-actions">
                          <strong className="invoice-item-amount">
                            {money(x.amount, true)}
                          </strong>
                          {data.currentUser?.roleKey !== "tenant" && (
                            <button
                              className="secondary compact"
                              onClick={() => setModal(`edit-item:${x.id}`)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="invoice-totals">
                  <div>
                    <span>Total</span>
                    <strong>{money(invoice.totalAmount, true)}</strong>
                  </div>
                  <div>
                    <span>Paid</span>
                    <strong className="paid">{money(invoice.amountPaid, true)}</strong>
                  </div>
                  {invoice.amountPaid > invoice.totalAmount ? (
                    <div>
                      <span>Overpaid (credit)</span>
                      <strong className="paid">
                        {money(invoice.amountPaid - invoice.totalAmount, true)}
                      </strong>
                    </div>
                  ) : (
                    <div>
                      <span>Outstanding</span>
                      <strong
                        className={
                          invoice.totalAmount > invoice.amountPaid ? "outstanding" : "settled"
                        }
                      >
                        {money(invoice.totalAmount - invoice.amountPaid, true)}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
              {data.currentUser?.roleKey !== "tenant" &&
                (() => {
                  const lateCharge = (invoice.items as Row[]).find(
                    (item) => item.itemType === "late-payment-charge",
                  );
                  if (!lateCharge && !invoice.lateChargeExempt) return null;
                  return (
                    <div
                      className={`invoice-late-charge${invoice.lateChargeExempt ? " is-exempt" : ""}`}
                    >
                      {invoice.lateChargeExempt ? (
                        <>
                          <p>
                            <b>Late charges waived</b> for this invoice
                            {invoice.lateChargeExemptReason
                              ? ` — ${invoice.lateChargeExemptReason}`
                              : ""}
                            . Set by {invoice.lateChargeExemptBy || "staff"} on{" "}
                            {dateLabel(invoice.lateChargeExemptAt)}.
                          </p>
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              save(
                                {
                                  action: "billing-late-charge-exempt",
                                  invoiceId: invoice.id,
                                  exempt: false,
                                },
                                "Late charges re-enabled",
                              )
                            }
                          >
                            Re-enable late charges
                          </button>
                        </>
                      ) : (
                        <>
                          <p>
                            This invoice is accruing a late payment charge —{" "}
                            <b>{money(lateCharge!.amount, true)}</b> so far.
                            If the student has a genuine special
                            circumstance, waive it here.
                          </p>
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt(
                                "Reason for waiving this late charge (shown on the invoice):",
                              );
                              if (reason === null) return;
                              save(
                                {
                                  action: "billing-late-charge-exempt",
                                  invoiceId: invoice.id,
                                  exempt: true,
                                  reason,
                                },
                                "Late charge waived",
                              );
                            }}
                          >
                            Waive late charge
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}
              {/* The bill is confirmed once, as a whole: staff read the
                  charges above and confirm the total, instead of ticking
                  every line. It is still stored per line, so a line whose
                  amount is changed afterwards comes back unverified on its
                  own — and this box asks for the check again. */}
              {data.currentUser?.roleKey !== "tenant" &&
                invoice.items.length > 0 &&
                (() => {
                  const items: Row[] = invoice.items;
                  const count = `${items.length} charge${items.length === 1 ? "" : "s"}`;
                  const verified = items.every((item) => item.verifiedAt);
                  const latest = verified
                    ? [...items].sort((a, b) =>
                        String(b.verifiedAt).localeCompare(String(a.verifiedAt)),
                      )[0]
                    : null;
                  return (
                    <div
                      className={`invoice-verify${verified ? " is-verified" : ""}`}
                    >
                      {verified ? (
                        <>
                          <span className="invoice-item-verified">
                            ✓ Charges verified
                          </span>
                          <p>
                            {count}, <b>{money(invoice.totalAmount, true)}</b> —
                            checked by {latest?.verifiedBy || "staff"} on{" "}
                            {dateLabel(latest?.verifiedAt)}
                          </p>
                        </>
                      ) : (
                        <>
                          <p>
                            Check the {count} above, then confirm the total of{" "}
                            <b>{money(invoice.totalAmount, true)}</b> is right.
                          </p>
                          <button
                            className="primary compact"
                            disabled={busy}
                            onClick={() =>
                              save(
                                {
                                  action: "billing-invoice-verify",
                                  invoiceId: invoice.id,
                                },
                                "Invoice charges verified",
                              )
                            }
                          >
                            Confirm charges
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}
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
                {data.currentUser?.roleKey !== "tenant" && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setModal(`edit-invoice:${invoice.id}`)}
                    >
                      Edit invoice
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={async () => {
                        const confirmed = confirm(
                          `Delete invoice ${invoice.invoiceNo}? This also removes its payment records and cannot be undone.`,
                        );
                        if (confirmed) {
                          const ok = await save(
                            {
                              action: "billing-invoice-delete",
                              invoiceId: invoice.id,
                            },
                            "Invoice deleted",
                          );
                          if (ok) setModal("");
                        }
                      }}
                    >
                      Delete invoice
                    </button>
                  </>
                )}
              </div>
              {invoice.payments.length > 0 && (
                <div className="payment-review">
                  <h4>
                    Payment submissions
                    <span className="payment-review-count">
                      {invoice.payments.length}
                    </span>
                  </h4>
                  {invoice.payments.map((p: Row) => {
                    const slips = data.attachments.filter(
                      (attachment) =>
                        attachment.contextType === "payment-proof" &&
                        attachment.recordId === p.id,
                    );
                    return (
                      <div key={p.id} className="payment-review-item">
                        <div className="payment-review-item-head">
                          <strong>{money(p.verifiedAmount ?? p.amount, true)}</strong>
                          <span
                            className={`payment-review-item-status${p.status === "verified" ? " is-verified" : ""}`}
                          >
                            {titleCase(p.status)}
                          </span>
                          <span className="payment-review-item-date">
                            {dateLabel(p.verifiedAt || p.submittedAt)}
                          </span>
                        </div>
                        <div className="payment-review-item-meta">
                          <span className="payment-review-item-covers">
                            {p.remark || "No remark"}
                          </span>
                          {(p.actualReference || p.reference) && (
                            <span className="payment-review-item-ref">
                              Ref {p.actualReference || p.reference}
                            </span>
                          )}
                        </div>
                        {slips.length > 0 && (
                          <div className="payment-review-item-slips">
                            {slips.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="payment-review-item-slip"
                              >
                                <svg
                                  className="payment-review-item-slip-icon"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                                  <path d="M14 2v6h6" />
                                </svg>
                                <AttachmentLink
                                  attachment={attachment}
                                  onOpen={lightbox.open}
                                >
                                  {attachment.fileName || "View payment slip"}
                                </AttachmentLink>
                                <button
                                  type="button"
                                  className="secondary compact"
                                  disabled={busy}
                                  onClick={async () => {
                                    const newName = prompt(
                                      "Rename this payment slip:",
                                      attachment.fileName,
                                    );
                                    if (newName && newName.trim()) {
                                      await renameAttachment(
                                        attachment.id,
                                        newName.trim(),
                                      );
                                      await load();
                                    }
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  className="secondary compact"
                                  style={{ color: "#b91c1c" }}
                                  disabled={busy}
                                  onClick={async () => {
                                    if (
                                      !window.confirm(
                                        "Delete this payment slip? This cannot be undone.",
                                      )
                                    )
                                      return;
                                    await fetch(
                                      `${BASE_PATH}/api/files?id=${attachment.id}`,
                                      { method: "DELETE" },
                                    );
                                    await load(["attachments"]);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="payment-review-item-actions">
                          {p.status !== "verified" ? (
                            <button
                              className="secondary compact"
                              onClick={() => setModal(`verify:${p.id}`)}
                            >
                              Verify & issue receipt
                            </button>
                          ) : (
                            <button
                              className="secondary compact"
                              onClick={() => window.print()}
                            >
                              Receipt {p.receiptNo}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                      confirmSuspicious: confirmOverpay,
                    },
                    "Payment submitted for verification",
                  );
                  if (result) {
                    const file = (
                      form.elements.namedItem("proof") as HTMLInputElement
                    ).files?.[0];
                    if (file && result.id) {
                      await uploadAttachment(
                        file,
                        "payment-proof",
                        result.id,
                        data.currentUser?.displayName,
                      );
                      await load();
                    }
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
                  <FileField
                    name="proof"
                    accept={ATTACHMENT_ACCEPT}
                    required
                    hint="Photo, PDF, Word, Excel or CSV."
                  />
                </label>
                <SuspiciousConfirm
                  message={suspicious}
                  checked={confirmOverpay}
                  onChange={setConfirmOverpay}
                />
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
                    href={`${BASE_PATH}/api/files?id=${attachment.id}`}
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
      {modal.startsWith("edit-invoice:") &&
        (() => {
          const invoice = data.invoices.find(
            (i) => i.id === Number(modal.split(":")[1]),
          );
          if (!invoice) return null;
          return (
            <Modal
              title="Edit invoice"
              kicker={invoice.invoiceNo}
              onClose={() => setModal(`invoice:${invoice.id}`)}
            >
              <form
                className="form-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const ok = await save(
                    {
                      action: "billing-invoice-update",
                      invoiceId: invoice.id,
                      ...formValues(event),
                    },
                    "Invoice updated",
                  );
                  if (ok) setModal(`invoice:${invoice.id}`);
                }}
              >
                <label>
                  Due date
                  <DateField
                    name="dueDate"
                    type="date"
                    required
                    defaultValue={invoice.dueDate}
                  />
                </label>
                <div className="form-actions wide">
                  <button className="primary" disabled={busy}>
                    Save changes
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      <Lightbox attachment={lightbox.attachment} onClose={lightbox.close} />
    </div>
  );
}
