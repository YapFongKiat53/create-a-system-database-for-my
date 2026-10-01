"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  DateField,
  DateTimeField,
  Empty,
  Modal,
  dateLabel,
  formValues,
  titleCase,
} from "./shared";
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
  const [editing, setEditing] = useState<Row | null>(null);
  const [announcementHostel, setAnnouncementHostel] = useState("");
  const [announcementBlock, setAnnouncementBlock] = useState("");
  const [announcementUnit, setAnnouncementUnit] = useState("");
  const openCreate = () => {
    setEditing(null);
    setAnnouncementHostel("");
    setAnnouncementBlock("");
    setAnnouncementUnit("");
    setModal(true);
  };
  const openEdit = (announcement: Row) => {
    setEditing(announcement);
    setAnnouncementHostel(String(announcement.hostelId ?? ""));
    setAnnouncementBlock(String(announcement.blockCode || ""));
    setAnnouncementUnit(String(announcement.unitId ?? ""));
    setModal(true);
  };
  const closeModal = () => {
    setModal(false);
    setEditing(null);
  };
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
          <button className="primary" onClick={openCreate}>
            + New announcement
          </button>
        )}
      </section>
      <section className="announcement-list">
        {data.announcements.map((a) => {
          const canPin = data.currentUser?.permissions?.some(
            (permission: Row) =>
              permission.moduleKey === "announcements" && permission.canEdit,
          );
          return (
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
                {canPin && (
                  <>
                    <button
                      type="button"
                      className="link-button pin-toggle"
                      disabled={busy}
                      onClick={() => openEdit(a)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button pin-toggle"
                      disabled={busy}
                      onClick={() =>
                        save(
                          {
                            action: "announcement-pin",
                            announcementId: a.id,
                            pinned: !a.pinned,
                          },
                          a.pinned
                            ? "Announcement unpinned"
                            : "Announcement pinned to top",
                        )
                      }
                    >
                      {a.pinned ? "Unpin" : "Pin to top"}
                    </button>
                    <button
                      type="button"
                      className="link-button pin-toggle"
                      disabled={busy}
                      onClick={() => {
                        const takingDown = a.status === "published";
                        if (
                          takingDown &&
                          !confirm(
                            `Take down "${a.title}"? Residents will stop seeing it. You can put it back later.`,
                          )
                        )
                          return;
                        save(
                          {
                            action: "announcement-status",
                            announcementId: a.id,
                            status: takingDown ? "archived" : "published",
                          },
                          takingDown
                            ? "Announcement taken down"
                            : "Announcement published",
                        );
                      }}
                    >
                      {a.status === "published"
                        ? "Take down"
                        : a.status === "draft"
                          ? "Publish"
                          : "Put back"}
                    </button>
                  </>
                )}
              </footer>
            </article>
          );
        })}
        {!data.announcements.length && (
          <Empty
            title="No announcements"
            text="Create a normal, urgent or pinned resident notice."
          />
        )}
      </section>
      {modal && (
        <Modal
          title={editing ? "Edit announcement" : "New announcement"}
          kicker="AUDIENCE & PRIORITY"
          onClose={closeModal}
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
              // The publish date field only shows minutes, so an untouched
              // field is sent back as the stored value, not a truncated copy.
              const publishAt =
                editing &&
                (!values.publishAt ||
                  values.publishAt === String(editing.publishAt).slice(0, 16))
                  ? editing.publishAt
                  : values.publishAt;
              const ok = await save(
                editing
                  ? {
                      action: "announcement-update",
                      announcementId: editing.id,
                      audienceType,
                      ...values,
                      publishAt,
                    }
                  : { action: "announcement", audienceType, ...values },
                editing
                  ? "Announcement updated"
                  : values.status === "draft"
                    ? "Announcement saved as draft"
                    : "Announcement published",
              );
              if (ok) closeModal();
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
              <select name="priority" defaultValue={editing?.priority || "normal"}>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={editing?.status || "published"}>
                <option value="published">Publish</option>
                <option value="draft">Save as draft</option>
                {editing && <option value="archived">Taken down</option>}
              </select>
            </label>
            <label className="checkbox-field">
              <input
                name="pinned"
                type="checkbox"
                defaultChecked={Boolean(editing?.pinned)}
              />{" "}
              Pin announcement
            </label>
            <label>
              Publish date
              <DateTimeField
                name="publishAt"
                defaultValue={
                  editing ? String(editing.publishAt || "").slice(0, 16) : ""
                }
              />
            </label>
            <label>
              Expiry date
              <DateField
                name="expiresAt"
                type="date"
                defaultValue={
                  editing?.expiresAt ? String(editing.expiresAt).slice(0, 10) : ""
                }
              />
            </label>
            <label className="wide">
              Title
              <input name="title" required defaultValue={editing?.title || ""} />
            </label>
            <label className="wide">
              Message
              <textarea name="body" required defaultValue={editing?.body || ""} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editing ? "Save changes" : "Publish announcement"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
