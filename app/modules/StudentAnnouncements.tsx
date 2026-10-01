"use client";

import { useState } from "react";
import { Modal, dateLabel, titleCase } from "./shared";
import type { Data, Row } from "./shared";

export function StudentAnnouncementsModule({ data }: { data: Data }) {
  const [open, setOpen] = useState<Row | null>(null);
  const announcements = [...data.announcements].sort((a, b) =>
    String(b.publishAt).localeCompare(String(a.publishAt)),
  );
  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">ANNOUNCEMENTS</span>
        <h1>Hostel notices</h1>
      </section>
      <section className="portal-stack">
        {announcements.map((a) => (
          <button key={a.id} className="portal-list-row" onClick={() => setOpen(a)}>
            <div>
              <strong>{a.title}</strong>
              <small>
                {a.pinned ? "PINNED · " : ""}
                {titleCase(a.priority)} · {dateLabel(a.publishAt)}
              </small>
            </div>
          </button>
        ))}
        {!announcements.length && <p className="empty-copy">No announcements yet.</p>}
      </section>
      {open && (
        <Modal title={open.title} kicker={dateLabel(open.publishAt)} onClose={() => setOpen(null)}>
          <p>{open.body}</p>
        </Modal>
      )}
    </div>
  );
}
