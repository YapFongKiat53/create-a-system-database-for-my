"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentGrid,
  FileField,
  Modal,
  StatusPill,
  dateLabel,
  formValues,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

export function StudentMaintenanceModule({
  data,
  save,
  busy,
  load,
}: {
  data: Data;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
}) {
  const [modal, setModal] = useState(false);
  const [ticket, setTicket] = useState<Row | null>(null);
  const [category, setCategory] = useState("");
  const student = data.students[0];

  const tickets = [...data.tickets].sort((a, b) => Number(b.id) - Number(a.id));
  const openTicket = ticket && data.tickets.find((t) => t.id === ticket.id);

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">MAINTENANCE</span>
        <h1>Your tickets</h1>
        <button className="v2-btn-primary" onClick={() => setModal(true)}>
          + New ticket
        </button>
      </section>

      <section className="portal-stack">
        {tickets.map((t) => (
          <button key={t.id} className="portal-list-row" onClick={() => setTicket(t)}>
            <div>
              <strong>{t.category}</strong>
              <small>
                {t.ticketNo} · {dateLabel(t.createdAt)}
              </small>
            </div>
            <StatusPill status={t.status} />
          </button>
        ))}
        {!tickets.length && <p className="empty-copy">No tickets yet.</p>}
      </section>

      {openTicket && (
        <Modal
          title={openTicket.subject || openTicket.category}
          kicker={openTicket.ticketNo}
          onClose={() => setTicket(null)}
        >
          <p>{openTicket.description}</p>
          <AttachmentGrid
            attachments={data.attachments.filter(
              (a) => a.contextType === "ticket" && a.recordId === openTicket.id,
            )}
            onDeleted={() => load(["attachments"])}
            canDelete={(a) => a.uploadedBy === data.currentUser?.displayName}
            compact
          />
          <div className="conversation">
            {data.ticketMessages
              .filter((m) => m.ticketId === openTicket.id)
              .map((m) => (
                <article
                  key={m.id}
                  className={m.authorRole === "student" ? "student-message" : "staff-message"}
                >
                  <div>
                    <b>{m.authorName}</b>
                    <small>
                      {titleCase(m.authorRole)} · {dateLabel(m.createdAt)}
                    </small>
                  </div>
                  <p>{m.message}</p>
                  <AttachmentGrid
                    attachments={data.attachments.filter(
                      (a) => a.contextType === "ticket-update" && a.recordId === m.id,
                    )}
                    onDeleted={() => load(["attachments"])}
                    canDelete={(a) => a.uploadedBy === data.currentUser?.displayName}
                    compact
                  />
                </article>
              ))}
          </div>
          <form
            className="ticket-reply"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const result = await save(
                { action: "ticket-message", ticketId: openTicket.id, ...formValues(e) },
                "Message posted",
              );
              if (result) {
                const file = (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files?.[0];
                if (file && result.id) {
                  await uploadAttachment(file, "ticket-update", result.id, data.currentUser?.displayName);
                  await load(["attachments"]);
                }
                form.reset();
              }
            }}
          >
            <label className="wide">
              Reply
              <textarea name="message" required placeholder="Add an update" />
            </label>
            <label className="wide">
              Attach a photo (optional)
              <FileField name="attachment" accept={ATTACHMENT_ACCEPT} />
            </label>
            <button className="primary" disabled={busy}>
              Send
            </button>
          </form>
        </Modal>
      )}

      {modal && (
        <Modal title="New maintenance ticket" kicker="REPORT AN ISSUE" onClose={() => setModal(false)}>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const result = await save(
                {
                  action: "ticket-create",
                  hostelId: student?.hostelId,
                  unitId: student?.unitId,
                  roomId: student?.roomId,
                  ...formValues(e),
                },
                "Ticket submitted",
              );
              if (result) {
                const file = (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files?.[0];
                if (file && result.id) {
                  await uploadAttachment(file, "ticket", result.id, data.currentUser?.displayName);
                  await load(["attachments"]);
                }
                setModal(false);
                setCategory("");
              }
            }}
          >
            <label>
              Category
              <select
                name="category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Select category</option>
                {[...new Set(data.ticketCategories.filter((c) => c.status === "active").map((c) => c.category))].map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Subcategory
              <select name="subcategory" required>
                <option value="">Select subcategory</option>
                {data.ticketCategories
                  .filter((c) => c.status === "active" && c.category === category)
                  .map((c) => (
                    <option key={c.id} value={c.subcategory}>
                      {c.subcategory}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="average">Average</option>
                <option value="high">Urgent</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="wide">
              Description
              <textarea name="description" required placeholder="Describe the issue" />
            </label>
            <label className="wide">
              Photo or video (required)
              <FileField name="attachment" accept={ATTACHMENT_ACCEPT} required />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit ticket
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
