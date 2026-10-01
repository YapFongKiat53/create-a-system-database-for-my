"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentLink,
  FileField,
  Lightbox,
  Modal,
  StatusPill,
  SuspiciousConfirm,
  dateLabel,
  formValues,
  money,
  titleCase,
  uploadAttachment,
  useLightbox,
} from "./shared";
import type { Data, Row } from "./shared";

export function StudentBillingModule({
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
  /** Set when the last save was refused only because a figure looked wrong — see Finance.tsx's identical use of this prop. */
  suspicious: string;
}) {
  const [tab, setTab] = useState<"outstanding" | "paid" | "all">("outstanding");
  const [invoice, setInvoice] = useState<Row | null>(null);
  const [confirmOverpay, setConfirmOverpay] = useState(false);
  const lightbox = useLightbox();

  const invoices = data.invoices.filter((i) =>
    tab === "all" ? true : tab === "paid" ? i.status === "paid" : i.status !== "paid",
  );

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">BILLING</span>
        <h1>Your invoices</h1>
        <div className="workspace-tabs">
          <button className={tab === "outstanding" ? "active" : ""} onClick={() => setTab("outstanding")}>
            Outstanding
          </button>
          <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>
            Paid
          </button>
          <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
            All
          </button>
        </div>
      </section>

      <section className="portal-stack">
        {invoices.map((i) => (
          <button key={i.id} className="portal-list-row" onClick={() => setInvoice(i)}>
            <div>
              <strong>{i.invoiceNo}</strong>
              <small>Due {dateLabel(i.dueDate)}</small>
            </div>
            <div className="portal-list-row-end">
              <strong>{money(i.totalAmount, true)}</strong>
              <StatusPill status={i.status} />
            </div>
          </button>
        ))}
        {!invoices.length && <p className="empty-copy">No invoices here.</p>}
      </section>

      {invoice &&
        (() => {
          const current = data.invoices.find((i) => i.id === invoice.id) || invoice;
          const slips = data.attachments.filter(
            (a) => a.contextType === "payment-proof" && current.payments?.some((p: Row) => p.id === a.recordId),
          );
          const outstanding = Number(current.totalAmount || 0) - Number(current.amountPaid || 0);
          return (
            <Modal
              title={current.invoiceNo}
              kicker="INVOICE"
              description={`Due ${dateLabel(current.dueDate)}`}
              onClose={() => setInvoice(null)}
            >
              <div className="portal-invoice-items">
                {current.items.map((item: Row) => (
                  <div key={item.id} className="portal-invoice-item">
                    <span>{item.description || titleCase(item.itemType)}</span>
                    <strong>{money(item.amount, true)}</strong>
                  </div>
                ))}
              </div>
              <div className="portal-invoice-totals">
                <span>Total {money(current.totalAmount, true)}</span>
                <span>Paid {money(current.amountPaid, true)}</span>
                <strong>Owed {money(outstanding, true)}</strong>
              </div>

              {current.payments?.length > 0 && (
                <div className="portal-payment-history">
                  <small>PAYMENT HISTORY</small>
                  {current.payments.map((p: Row) => (
                    <div key={p.id} className="portal-payment-row">
                      <span>{money(p.verifiedAmount ?? p.amount, true)}</span>
                      <StatusPill status={p.status} />
                    </div>
                  ))}
                </div>
              )}

              {slips.length > 0 && (
                <div className="portal-payment-history">
                  <small>SLIPS</small>
                  {slips.map((a) => (
                    <AttachmentLink key={a.id} attachment={a} onOpen={lightbox.open} className="secondary compact">
                      {a.fileName || "View slip"}
                    </AttachmentLink>
                  ))}
                </div>
              )}

              {outstanding > 0 && (
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const result = await save(
                      {
                        action: "billing-payment",
                        invoiceId: current.id,
                        ...formValues(e),
                        confirmSuspicious: confirmOverpay,
                      },
                      "Payment submitted for verification",
                    );
                    if (result) {
                      const file = (form.elements.namedItem("proof") as HTMLInputElement)
                        .files?.[0];
                      if (file && result.id) {
                        await uploadAttachment(file, "payment-proof", result.id, data.currentUser?.displayName);
                        await load(["attachments"]);
                      }
                      setInvoice(null);
                      setConfirmOverpay(false);
                    }
                  }}
                >
                  <label>
                    Amount
                    <input name="amount" type="number" min="0" step="0.01" required />
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
                      Submit payment
                    </button>
                  </div>
                </form>
              )}
            </Modal>
          );
        })()}
      <Lightbox attachment={lightbox.attachment} onClose={lightbox.close} />
    </div>
  );
}
