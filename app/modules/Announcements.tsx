"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { Empty, Modal, dateLabel, formValues, titleCase } from "./shared";
import type { Data, Row } from "./shared";

export function AnnouncementsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [modal, setModal] = useState(false);
  const [announcementHostel, setAnnouncementHostel] = useState("");
  const [announcementBlock, setAnnouncementBlock] = useState("");
  const [announcementUnit, setAnnouncementUnit] = useState("");
  const selectedAnnouncementHostel = data.hostels.find(
    (hostel) => String(hostel.id) === announcementHostel,
  );
  const blocksByHostel: Record<string, string[]> = {
    ATR: ["Atria"],
    DAM: ["D1", "D2", "D3"],
    NDY: ["NB", "NC", "NE"],
    SHP: [],
    SR: [],
  };
  const blocks = blocksByHostel[selectedAnnouncementHostel?.code] || [];
  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">RESIDENT COMMUNICATIONS</span>
          <h2>Send one notice to exactly the right residents.</h2>
          <p>
            Target all hostels, one hostel, a block such as D1, or one unit.
            Urgent and pinned notices remain prominent.
          </p>
        </div>
        {data.currentUser?.permissions?.some(
          (permission: Row) =>
            permission.moduleKey === "announcements" && permission.canCreate,
        ) && (
          <button className="primary" onClick={() => setModal(true)}>
            + New announcement
          </button>
        )}
      </section>
      <section className="announcement-list">
        {data.announcements.map((a) => (
          <article
            key={a.id}
            className={`${a.priority} ${a.pinned ? "pinned" : ""}`}
          >
            <div>
              <span className="announcement-priority">
                {a.pinned ? "PINNED · " : ""}
                {titleCase(a.priority)}
              </span>
              <small>{dateLabel(a.publishAt)}</small>
            </div>
            <span className={`unit-status ${a.status}`}>
              {titleCase(a.status)}
            </span>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
            <footer>
              Audience:{" "}
              <b>
                {a.audienceType === "all"
                  ? "All hostels"
                  : a.audienceType === "hostel"
                    ? a.hostelName
                    : a.audienceType === "block"
                      ? `${a.hostelName} · Block ${a.blockCode}`
                      : `${a.hostelName} · Unit ${a.unitCode}`}
              </b>
              {a.expiresAt && <> · Expires {dateLabel(a.expiresAt)}</>}
            </footer>
          </article>
        ))}
        {!data.announcements.length && (
          <Empty
            title="No announcements"
            text="Create a normal, urgent or pinned resident notice."
          />
        )}
      </section>
      {modal && (
        <Modal
          title="New announcement"
          kicker="AUDIENCE & PRIORITY"
          onClose={() => setModal(false)}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const values = formValues(e);
              const audienceType = values.unitId
                ? "unit"
                : values.blockCode
                  ? "block"
                  : values.hostelId
                    ? "hostel"
                    : "all";
              const ok = await save(
                { action: "announcement", audienceType, ...values },
                values.status === "draft"
                  ? "Announcement saved as draft"
                  : "Announcement published",
              );
              if (ok) setModal(false);
            }}
          >
            <label>
              Hostel
              <select
                name="hostelId"
                value={announcementHostel}
                onChange={(event) => {
                  setAnnouncementHostel(event.target.value);
                  setAnnouncementBlock("");
                  setAnnouncementUnit("");
                }}
              >
                <option value="">All hostels</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            {announcementHostel && blocks.length > 0 && (
              <label>
                Block
                <select
                  name="blockCode"
                  value={announcementBlock}
                  onChange={(event) => {
                    setAnnouncementBlock(event.target.value);
                    setAnnouncementUnit("");
                  }}
                >
                  <option value="">All blocks in hostel</option>
                  {blocks.map((block) => (
                    <option key={block} value={block}>
                      {block}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Unit
              <select
                name="unitId"
                value={announcementUnit}
                onChange={(event) => setAnnouncementUnit(event.target.value)}
              >
                <option value="">All units in selected hostel / block</option>
                {data.units
                  .filter(
                    (unit) =>
                      !announcementHostel ||
                      String(unit.hostelId) === announcementHostel,
                  )
                  .filter(
                    (unit) =>
                      !announcementBlock ||
                      String(unit.unitCode)
                        .toUpperCase()
                        .startsWith(announcementBlock),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.hostelName}/{u.unitCode}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <label>
              Status
              <select name="status">
                <option value="published">Publish</option>
                <option value="draft">Save as draft</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input name="pinned" type="checkbox" /> Pin announcement
            </label>
            <label>
              Publish date
              <input name="publishAt" type="datetime-local" />
            </label>
            <label>
              Expiry date
              <input name="expiresAt" type="date" />
            </label>
            <label className="wide">
              Title
              <input name="title" required />
            </label>
            <label className="wide">
              Message
              <textarea name="body" required />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Publish announcement
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
