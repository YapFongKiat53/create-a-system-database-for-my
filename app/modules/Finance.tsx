"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Empty,
  Modal,
  Stat,
  dateLabel,
  formValues,
  money,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

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
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("all");
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
  return (
    <>
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
          <button className="primary" onClick={() => setModal("cycle")}>
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
        <div className="filters finance-filters">
          <label className="search">
            Student name or room code
            <input
              value={invoiceQuery}
              onChange={(event) => setInvoiceQuery(event.target.value)}
              placeholder="Type student, room, unit or invoice"
            />
          </label>
          <label>
            Payment status
            <select
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="outstanding">Outstanding</option>
              <option value="paid">Fully paid</option>
              <option value="credit">Excess / credit</option>
              <option value="pending">Pending verification</option>
            </select>
          </label>
          <label>
            Billing month
            <select
              value={cycleFilter}
              onChange={(event) => setCycleFilter(event.target.value)}
            >
              <option value="all">All months</option>
              {data.billingCycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.periodLabel}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary reset-button"
            onClick={() => {
              setInvoiceQuery("");
              setPaymentStatusFilter("all");
              setCycleFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Student</th>
                <th>Room</th>
                <th>Items</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Due</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <code>{i.invoiceNo}</code>
                    <small>{titleCase(i.invoiceFrequency)}</small>
                  </td>
                  <td>
                    <strong>{i.studentName}</strong>
                  </td>
                  <td>
                    <code>{i.roomCode || "-"}</code>
                    <small>{i.hostelName || ""}</small>
                  </td>
                  <td>
                    {i.items.map((x: Row) => (
                      <small key={x.id}>
                        {x.description}: {money(x.amount, true)}
                      </small>
                    ))}
                  </td>
                  <td>
                    <strong>{money(i.totalAmount, true)}</strong>
                  </td>
                  <td>{money(i.amountPaid, true)}</td>
                  <td>
                    <strong>{money(i.totalAmount - i.amountPaid, true)}</strong>
                  </td>
                  <td>{dateLabel(i.dueDate)}</td>
                  <td>
                    <span className={`payment-status ${i.status}`}>
                      {titleCase(i.status)}
                    </span>
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
        {!data.invoices.length && (
          <Empty
            title="No monthly bills generated"
            text="Prepare the first billing month. Active students will receive draft bills."
          />
        )}
      </section>
      {data.billingAdjustments.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>CONTROLLED BILLING CHANGES</small>
              <h3>Adjustment and electricity approval register</h3>
            </div>
          </div>
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
                      <td>{titleCase(adjustment.approvalStatus)}</td>
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
        </section>
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
                  {invoice.items.map((x: Row) => (
                    <p key={x.id}>
                      <span>{x.description}</span>
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
                  ))}
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
    </>
  );
}
