"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  DocumentTile,
  Empty,
  Modal,
  ReportCard,
  SearchIcon,
  SearchSelect,
  StatusPill,
  blockOf,
  dateLabel,
  formValues,
  isImageAttachment,
  isVideoAttachment,
  money,
  titleCase,
  today,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

// Pictures and videos render inline (no click-through needed) and split
// into their own sections since they're viewed differently. Anything else —
// PDF quotations, Excel costings, signed forms — can't be previewed, so it
// falls into a documents group of click-through tiles rather than being
// dropped from the list. Deleting calls the file store directly rather than
// going through save()/action dispatch since attachments aren't part of the
// /api/system action set.
function TicketAttachments({
  attachments,
  onDeleted,
  compact = false,
}: {
  attachments: Row[];
  onDeleted: () => void;
  compact?: boolean;
}) {
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const pictures = attachments.filter((attachment) =>
    isImageAttachment(attachment.contentType),
  );
  const videos = attachments.filter((attachment) =>
    isVideoAttachment(attachment.contentType),
  );
  const documents = attachments.filter(
    (attachment) =>
      !isImageAttachment(attachment.contentType) &&
      !isVideoAttachment(attachment.contentType),
  );
  if (!pictures.length && !videos.length && !documents.length) return null;

  const handleDelete = async (id: string | number) => {
    if (!window.confirm("Delete this file? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const response = await fetch(`/api/files?id=${id}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        window.alert(result.error || "Unable to delete file");
        return;
      }
      await onDeleted();
    } finally {
      setDeletingId(null);
    }
  };

  const group = (items: Row[], label: string) =>
    items.length > 0 && (
      <div className="attachment-thumb-grid">
        <small className="attachment-group-label">{label}</small>
        {items.map((attachment) => (
          <figure key={attachment.id} className="attachment-thumb">
            {attachment.contentType?.startsWith("video/") ? (
              <video
                src={`/api/files?id=${attachment.id}`}
                controls
                preload="metadata"
              />
            ) : (
              <a
                href={`/api/files?id=${attachment.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/files?id=${attachment.id}`}
                  alt={attachment.fileName}
                  loading="lazy"
                />
              </a>
            )}
            <button
              type="button"
              className="secondary compact attachment-delete"
              disabled={deletingId === attachment.id}
              onClick={() => handleDelete(attachment.id)}
            >
              Delete
            </button>
          </figure>
        ))}
      </div>
    );

  const documentGroup = documents.length > 0 && (
    <div className="attachment-thumb-grid">
      <small className="attachment-group-label">DOCUMENT</small>
      {documents.map((attachment) => (
        <figure key={attachment.id} className="attachment-thumb">
          <DocumentTile attachment={attachment} />
          <button
            type="button"
            className="secondary compact attachment-delete"
            disabled={deletingId === attachment.id}
            onClick={() => handleDelete(attachment.id)}
          >
            Delete
          </button>
        </figure>
      ))}
    </div>
  );

  const content = (
    <>
      {!compact && <strong>Pictures, videos &amp; documents</strong>}
      {group(pictures, "PICTURE")}
      {group(videos, "VIDEO")}
      {documentGroup}
    </>
  );
  return compact ? (
    <div className="attachment-list attachment-list-compact">{content}</div>
  ) : (
    <section className="drawer-section attachment-list">{content}</section>
  );
}

export function MaintenanceModule({
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
  const [tab, setTab] = useState("tickets");
  const [modal, setModal] = useState("");
  const [ticket, setTicket] = useState<Row | null>(null);
  const [ticketStatusFilter, setTicketStatusFilter] = useState("all");
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketHostel, setTicketHostel] = useState("all");
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketHostelId, setTicketHostelId] = useState("");
  const [ticketBlock, setTicketBlock] = useState("");
  const [ticketUnitId, setTicketUnitId] = useState("");
  const [ticketStudentId, setTicketStudentId] = useState("");
  const [ticketRoomId, setTicketRoomId] = useState("");
  const [meterQuery, setMeterQuery] = useState("");
  const [costFrom, setCostFrom] = useState("");
  const [costTo, setCostTo] = useState("");
  const [editingMeter, setEditingMeter] = useState<Row | null>(null);
  const [meterRoomId, setMeterRoomId] = useState("");
  const [meterHostelId, setMeterHostelId] = useState("");
  const [meterRoomType, setMeterRoomType] = useState("");
  const meterMonths = [
    ...new Set(
      data.meterReadings
        .map((reading) => String(reading.readingDate || "").slice(0, 7))
        .filter(Boolean),
    ),
  ].sort((a, b) => b.localeCompare(a));
  const [meterMonth, setMeterMonth] = useState(meterMonths[0] || "all");
  // The meter tab is split in two: an entry grid for the month being keyed in
  // right now, and the full historical log. Staff key one hostel at a time,
  // so the grid carries its own hostel selection and draft values.
  const [meterView, setMeterView] = useState<"entry" | "history">("entry");
  const [entryHostelId, setEntryHostelId] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [entryQuery, setEntryQuery] = useState("");
  const [entryHideDone, setEntryHideDone] = useState(false);
  const [entryDraft, setEntryDraft] = useState<Record<string, string>>({});
  const monthLabel = (ym: string) =>
    ym === "all"
      ? "All months"
      : new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
  const openStatuses = [
    "submitted",
    "attended",
    "waiting-parts",
    "in-progress",
  ];
  const closedStatuses = ["completed", "closed"];
  const filteredTickets = data.tickets.filter((item) => {
    const search = ticketQuery.trim().toLowerCase();
    const text =
      `${item.ticketNo} ${item.hostelName} ${item.unitCode} ${item.roomLabel} ${item.studentName} ${item.category} ${item.subcategory} ${item.description}`.toLowerCase();
    const statusMatch =
      ticketStatusFilter === "open"
        ? openStatuses.includes(item.status)
        : ticketStatusFilter === "completed"
          ? closedStatuses.includes(item.status)
          : true;
    return (
      statusMatch &&
      (ticketHostel === "all" ||
        String(item.hostelId || "") === ticketHostel) &&
      (!search || text.includes(search))
    );
  });
  const filteredReadings = data.meterReadings.filter((reading) => {
    const monthMatch =
      meterMonth === "all" ||
      String(reading.readingDate || "").slice(0, 7) === meterMonth;
    const searchMatch = `${reading.roomCode} ${reading.unitCode} ${reading.hostelName}`
      .toLowerCase()
      .includes(meterQuery.toLowerCase());
    return monthMatch && searchMatch;
  });
  // Same pairing/rounding as the billing-cycle calculation (current minus
  // the room's immediately preceding reading, billed at the hostel's
  // per-kWh rate) — shown here so staff can see, at the moment they record
  // a reading, what it will actually bill out to once shared among the
  // room's students.
  const readingUsage = (reading: Row) => {
    const previous = data.meterReadings
      .filter(
        (candidate: Row) =>
          candidate.roomId === reading.roomId &&
          (candidate.readingDate < reading.readingDate ||
            (candidate.readingDate === reading.readingDate &&
              Number(candidate.id) < Number(reading.id))),
      )
      .sort((a: Row, b: Row) =>
        a.readingDate === b.readingDate
          ? Number(b.id) - Number(a.id)
          : String(b.readingDate).localeCompare(String(a.readingDate)),
      )[0];
    if (!previous) return null;
    const usage = Number(reading.readingValue) - Number(previous.readingValue);
    if (!(usage > 0)) return { usage: 0, amount: 0 };
    const amount = Math.ceil(usage * Number(reading.electricityRate || 0));
    return { usage, amount };
  };
  const filteredCosts = [
    ...data.tickets
      .filter(
        (item) =>
          Number(item.actualCost || 0) || Number(item.studentCharge || 0),
      )
      .map((item) => ({
        id: `ticket-${item.id}`,
        date: String(
          item.completedAt || item.updatedAt || item.createdAt,
        ).slice(0, 10),
        reference: item.ticketNo,
        description: item.subject,
        responsibility: item.costResponsibility,
        cost: Number(item.actualCost || 0),
        penalty: Number(item.studentCharge || 0),
      })),
    ...data.generalCosts.map((item) => ({
      id: `general-${item.id}`,
      date: item.costDate,
      reference: "GENERAL",
      description: item.description,
      responsibility: item.responsibility,
      cost: Number(item.amount || 0),
      penalty: 0,
    })),
  ].filter(
    (item) =>
      (!costFrom || item.date >= costFrom) && (!costTo || item.date <= costTo),
  );
  const meterRooms = [
    ...new Map(data.bedSpaces.map((bed) => [bed.roomId, bed])).values(),
  ];

  // ---- Month-entry grid -------------------------------------------------
  const meterHostels = data.hostels.filter((hostel: Row) =>
    meterRooms.some((room) => String(room.hostelId) === String(hostel.id)),
  );
  const activeEntryHostelId =
    entryHostelId && meterHostels.some((h: Row) => String(h.id) === entryHostelId)
      ? entryHostelId
      : String(meterHostels[0]?.id || "");
  const activeEntryHostel = meterHostels.find(
    (h: Row) => String(h.id) === activeEntryHostelId,
  );
  const entryRooms = meterRooms
    .filter((room) => String(room.hostelId) === activeEntryHostelId)
    .sort((a, b) =>
      `${a.unitCode}-${a.roomLabel}`.localeCompare(
        `${b.unitCode}-${b.roomLabel}`,
        undefined,
        { numeric: true },
      ),
    );
  // Readings for this hostel keyed by room, newest first — the grid reads the
  // two most recent columns from here and the usage baseline from the newest.
  const hostelReadings = data.meterReadings.filter(
    (reading: Row) => String(reading.hostelId) === activeEntryHostelId,
  );
  const readingsByRoom = new Map<string, Row[]>();
  for (const reading of hostelReadings) {
    const key = String(reading.roomId);
    const list = readingsByRoom.get(key);
    if (list) list.push(reading);
    else readingsByRoom.set(key, [reading]);
  }
  for (const list of readingsByRoom.values())
    list.sort((a, b) =>
      a.readingDate === b.readingDate
        ? Number(b.id) - Number(a.id)
        : String(b.readingDate).localeCompare(String(a.readingDate)),
    );
  // Column dates: the two most recent reading dates before the one being
  // keyed in, exactly like the previous-two-months columns on the paper sheet.
  const priorDates = [
    ...new Set(
      hostelReadings
        .map((reading: Row) => String(reading.readingDate))
        .filter((date: string) => date && date !== entryDate),
    ),
  ]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 2)
    .reverse();
  const entryRate = Number(activeEntryHostel?.electricityRate || 0);
  const readingOn = (roomId: string | number, date: string) => {
    const list = readingsByRoom.get(String(roomId)) || [];
    return list.find((reading) => reading.readingDate === date);
  };
  // Baseline for usage is the newest reading strictly before the entry date,
  // matching how the billing cycle pairs consecutive readings.
  const baselineFor = (roomId: string | number) =>
    (readingsByRoom.get(String(roomId)) || []).find(
      (reading) => String(reading.readingDate) < entryDate,
    );
  const draftValueFor = (room: Row) => {
    const key = String(room.roomId);
    if (key in entryDraft) return entryDraft[key];
    const saved = readingOn(room.roomId, entryDate);
    return saved ? String(saved.readingValue) : "";
  };
  const entryRowsAll = entryRooms.map((room) => {
    const value = draftValueFor(room);
    const baseline = baselineFor(room.roomId);
    const usage =
      value === "" || !baseline
        ? null
        : Number(value) - Number(baseline.readingValue);
    return {
      room,
      code: `${room.unitCode}-${room.roomLabel}`,
      value,
      baseline,
      usage,
      amount: usage && usage > 0 ? Math.ceil(usage * entryRate) : 0,
      saved: Boolean(readingOn(room.roomId, entryDate)),
    };
  });
  const entryRows = entryRowsAll.filter((row) => {
    const search = entryQuery.trim().toLowerCase();
    if (search && !row.code.toLowerCase().includes(search)) return false;
    if (entryHideDone && row.value !== "") return false;
    return true;
  });
  const entryFilled = entryRowsAll.filter((row) => row.value !== "").length;
  const entryDirty = entryRowsAll.filter(
    (row) =>
      String(row.room.roomId) in entryDraft &&
      entryDraft[String(row.room.roomId)] !== "",
  );
  const entryTotalAmount = entryRowsAll.reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  const pendingCountFor = (hostelId: string | number) => {
    const rooms = meterRooms.filter(
      (room) => String(room.hostelId) === String(hostelId),
    );
    const done = new Set(
      data.meterReadings
        .filter(
          (reading: Row) =>
            String(reading.hostelId) === String(hostelId) &&
            reading.readingDate === entryDate,
        )
        .map((reading: Row) => String(reading.roomId)),
    );
    return rooms.filter((room) => !done.has(String(room.roomId))).length;
  };
  const saveEntryGrid = async () => {
    if (!entryDirty.length) return;
    const ok = await save(
      {
        action: "meter-reading-batch",
        readingDate: entryDate,
        readingType: "monthly",
        rows: entryDirty.map((row) => ({
          roomId: row.room.roomId,
          readingValue: row.value,
        })),
      },
      `${entryDirty.length} meter reading${entryDirty.length === 1 ? "" : "s"} saved`,
    );
    if (ok) setEntryDraft({});
  };
  const downloadMeterTemplate = () => {
    const csv = [
      "roomCode,readingDate,readingValue,readingType,notes",
      ...meterRooms.map(
        (room) => `${room.unitCode}-${room.roomLabel},${today},,monthly,`,
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `meter-reading-template-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importMeterCsv = async (file?: File) => {
    if (!file) return;
    const lines = (await file.text()).split(/\r?\n/).filter(Boolean);
    const headers =
      lines
        .shift()
        ?.split(",")
        .map((value) => value.trim()) || [];
    const rows = lines.map((line) =>
      Object.fromEntries(
        line.split(",").map((value, index) => [headers[index], value.trim()]),
      ),
    );
    await save(
      { action: "meter-reading-bulk", rows },
      `${rows.length} meter rows imported`,
    );
  };
  const ticketHostelUnits = data.units.filter(
    (unit) =>
      !ticketHostelId || String(unit.hostelId) === ticketHostelId,
  );
  const ticketBlockOptions = [
    ...new Set(ticketHostelUnits.map((unit) => blockOf(unit.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const ticketBlockedUnits = ticketHostelUnits.filter(
    (unit) => !ticketBlock || blockOf(unit.unitCode) === ticketBlock,
  );
  return (
    <div className="table-v2">
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MAINTENANCE & RESIDENT SUPPORT</span>
          <h2>
            Tickets behave like a conversation, not a static complaint form.
          </h2>
          <p>
            Track attendance, waiting parts, completion, responsibility, student
            charges and monthly costs.
          </p>
        </div>
        <div className="button-row">
          {data.currentUser?.roleKey === "tenant" && (
            <button className="secondary" onClick={() => setModal("unlock")}>
              Door unlock request
            </button>
          )}
          {data.currentUser?.roleKey !== "tenant" && (
            <button
              className="secondary"
              onClick={() => setModal("categories")}
            >
              Manage categories
            </button>
          )}
          <button className="v2-btn-primary" onClick={() => setModal("ticket")}>
            + Submit ticket
          </button>
        </div>
      </section>
      <div className="workspace-tabs module-tabs">
        <button
          className={tab === "tickets" ? "active" : ""}
          onClick={() => setTab("tickets")}
        >
          Tickets
        </button>
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "meters" ? "active" : ""}
            onClick={() => setTab("meters")}
          >
            Meter readings
          </button>
        )}
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "costs" ? "active" : ""}
            onClick={() => setTab("costs")}
          >
            Costing & penalties
          </button>
        )}
        {data.currentUser?.roleKey !== "tenant" && (
          <button
            className={tab === "rates" ? "active" : ""}
            onClick={() => setTab("rates")}
          >
            Property & utility rates
          </button>
        )}
      </div>
      {tab === "tickets" && (
        <>
          <section className="module-metrics">
            <button
              className={
                ticketStatusFilter === "all"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("all")}
            >
              <strong>{data.tickets.length}</strong>
              <small>Reported</small>
            </button>
            <button
              className={
                ticketStatusFilter === "open"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("open")}
            >
              <strong>
                {
                  data.tickets.filter((item) =>
                    openStatuses.includes(item.status),
                  ).length
                }
              </strong>
              <small>Open / pending / in progress</small>
            </button>
            <button
              className={
                ticketStatusFilter === "completed"
                  ? "active stat-filter"
                  : "stat-filter"
              }
              onClick={() => setTicketStatusFilter("completed")}
            >
              <strong>
                {
                  data.tickets.filter((item) =>
                    closedStatuses.includes(item.status),
                  ).length
                }
              </strong>
              <small>Completed / closed</small>
            </button>
            {data.currentUser?.roleKey !== "tenant" && (
              <button className="stat-filter" onClick={() => setTab("costs")}>
                <strong>
                  {money(
                    data.tickets.reduce(
                      (sum, item) => sum + Number(item.actualCost || 0),
                      0,
                    ),
                  )}
                </strong>
                <small>Recorded cost</small>
              </button>
            )}
          </section>
          <section className="panel">
            <div className="v2-toolbar">
              <label className="v2-search">
                <SearchIcon />
                <input
                  value={ticketQuery}
                  onChange={(event) => setTicketQuery(event.target.value)}
                  placeholder="Search hostel/room code, student, category or issue"
                />
              </label>
              <select
                className="v2-pill-select"
                value={ticketHostel}
                onChange={(event) => setTicketHostel(event.target.value)}
              >
                <option value="all">All hostels</option>
                {data.hostels.map((hostel) => (
                  <option key={hostel.id} value={hostel.id}>
                    {hostel.name}
                  </option>
                ))}
              </select>
              <button
                className="v2-reset"
                onClick={() => {
                  setTicketQuery("");
                  setTicketHostel("all");
                  setTicketStatusFilter("all");
                }}
              >
                Reset filters
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Location</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Status / priority</th>
                    <th>Created</th>
                    <th>Attended</th>
                    <th>Completed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <code>{t.ticketNo}</code>
                        <small>
                          {t.studentName || titleCase(t.submittedByType)}
                        </small>
                      </td>
                      <td>
                        {t.hostelName || "-"}
                        <small>
                          {t.unitCode || "-"}{" "}
                          {t.roomLabel ? `/ Room ${t.roomLabel}` : ""}
                        </small>
                      </td>
                      <td>
                        {titleCase(t.category)}
                        <small>{titleCase(t.subcategory)}</small>
                      </td>
                      <td>
                        <strong>{t.subject}</strong>
                        <small>{t.description}</small>
                      </td>
                      <td>
                        <StatusPill status={t.status} />
                        <small>{titleCase(t.priority)}</small>
                      </td>
                      <td>{dateLabel(t.createdAt)}</td>
                      <td>{dateLabel(t.attendedAt)}</td>
                      <td>{dateLabel(t.completedAt)}</td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => setTicket(t)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filteredTickets.length && (
              <Empty
                title="No maintenance tickets"
                text="Submit the first staff or student ticket."
              />
            )}
          </section>
        </>
      )}
      {tab === "meters" && meterView === "entry" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>MONTHLY METER ENTRY</small>
              <h3>Key in this month&apos;s readings</h3>
              <p>
                One row per room with the previous two readings alongside, so a
                whole hostel can be keyed in and saved in one go.
              </p>
            </div>
            <div className="button-row">
              <button
                className="secondary compact"
                onClick={() => setMeterView("history")}
              >
                Past records
              </button>
              <button
                className="secondary compact"
                onClick={downloadMeterTemplate}
              >
                Download CSV template
              </button>
              <label className="secondary compact file-button">
                Upload updated CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => importMeterCsv(event.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          <div className="workspace-tabs meter-hostel-tabs">
            {meterHostels.map((hostel: Row) => {
              const pending = pendingCountFor(hostel.id);
              return (
                <button
                  key={hostel.id}
                  type="button"
                  className={
                    String(hostel.id) === activeEntryHostelId ? "active" : ""
                  }
                  onClick={() => {
                    setEntryHostelId(String(hostel.id));
                    setEntryDraft({});
                    setEntryQuery("");
                  }}
                >
                  {hostel.name}
                  <span className="tab-count">
                    {pending ? `${pending} left` : "done"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="v2-toolbar meter-toolbar">
            <label className="v2-search">
              <SearchIcon />
              <input
                value={entryQuery}
                onChange={(event) => setEntryQuery(event.target.value)}
                placeholder="Jump to a room code"
              />
            </label>
            <label className="inline-field">
              Reading date
              <input
                type="date"
                value={entryDate}
                onChange={(event) => {
                  setEntryDate(event.target.value);
                  setEntryDraft({});
                }}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={entryHideDone}
                onChange={(event) => setEntryHideDone(event.target.checked)}
              />
              Only rooms still blank
            </label>
          </div>

          {entryRooms.length ? (
            <>
              <div className="table-wrap meter-entry-wrap">
                <table className="meter-entry-table">
                  <thead>
                    <tr>
                      <th>Room code</th>
                      {priorDates.map((date) => (
                        <th key={date}>{dateLabel(date)}</th>
                      ))}
                      <th className="entry-col">{dateLabel(entryDate)}</th>
                      <th>Usage</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryRows.map((row) => (
                      <tr
                        key={row.room.roomId}
                        className={row.saved ? "reading-saved" : ""}
                      >
                        <td>
                          <code>{row.code}</code>
                        </td>
                        {priorDates.map((date) => {
                          const previous = readingOn(row.room.roomId, date);
                          return (
                            <td key={date} className="reading-past">
                              {previous ? previous.readingValue : "-"}
                            </td>
                          );
                        })}
                        <td className="entry-col">
                          <input
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            value={row.value}
                            placeholder={
                              row.baseline
                                ? String(row.baseline.readingValue)
                                : "0"
                            }
                            onChange={(event) =>
                              setEntryDraft((draft) => ({
                                ...draft,
                                [String(row.room.roomId)]: event.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>
                          {row.usage === null ? (
                            <small>
                              {row.baseline ? "-" : "No previous reading"}
                            </small>
                          ) : row.usage < 0 ? (
                            <strong className="reading-warn">
                              {row.usage.toFixed(2)} kWh
                            </strong>
                          ) : (
                            `${row.usage.toFixed(2)} kWh`
                          )}
                        </td>
                        <td>
                          <strong>{row.amount ? money(row.amount, true) : "-"}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="meter-entry-footer">
                <div>
                  <strong>
                    {entryFilled} of {entryRooms.length} rooms
                  </strong>
                  <small>
                    {entryDirty.length
                      ? `${entryDirty.length} unsaved · estimated ${money(entryTotalAmount, true)} for this hostel`
                      : `Estimated ${money(entryTotalAmount, true)} for this hostel`}
                  </small>
                </div>
                <div className="button-row">
                  <button
                    className="secondary compact"
                    disabled={!entryDirty.length}
                    onClick={() => setEntryDraft({})}
                  >
                    Discard changes
                  </button>
                  <button
                    className="primary compact"
                    disabled={busy || !entryDirty.length}
                    onClick={saveEntryGrid}
                  >
                    Save {entryDirty.length || ""} reading
                    {entryDirty.length === 1 ? "" : "s"}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <Empty
              title="No rooms in this hostel"
              text="Add units and rooms before recording meter readings."
            />
          )}
        </section>
      )}
      {tab === "meters" && meterView === "history" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>PAST RECORDS</small>
              <h3>Meter reading history</h3>
              <p>
                Every reading ever recorded — monthly, check-in, check-out and
                semester-break — with the usage and amount it billed out at.
              </p>
            </div>
            <div className="button-row">
              <button
                className="secondary compact"
                onClick={() => setMeterView("entry")}
              >
                Back to monthly entry
              </button>
              <button
                className="primary compact"
                onClick={() => {
                  setEditingMeter(null);
                  setMeterRoomId("");
                  setMeterHostelId("");
                  setMeterRoomType("");
                  setModal("meter");
                }}
              >
                + Add reading
              </button>
            </div>
          </div>
          <div className="v2-toolbar meter-toolbar">
            <label className="v2-search">
              <SearchIcon />
              <input
                value={meterQuery}
                onChange={(event) => setMeterQuery(event.target.value)}
                placeholder="Type unit or room code"
              />
            </label>
            <select
              className="v2-pill-select"
              value={meterMonth}
              onChange={(event) => setMeterMonth(event.target.value)}
            >
              <option value="all">All months</option>
              {meterMonths.map((ym) => (
                <option key={ym} value={ym}>
                  {monthLabel(ym)}
                </option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room code</th>
                  <th>Hostel / unit</th>
                  <th>Date</th>
                  <th>Reading</th>
                  <th>Usage</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Submitted by</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredReadings.map((r) => {
                  const usage = readingUsage(r);
                  return (
                  <tr key={r.id}>
                    <td>
                      <code>{r.roomCode}</code>
                    </td>
                    <td>
                      {r.hostelName} / {r.unitCode}
                    </td>
                    <td>{dateLabel(r.readingDate)}</td>
                    <td>
                      <strong>{r.readingValue}</strong>
                    </td>
                    <td>
                      {usage ? `${usage.usage.toFixed(2)} kWh` : "First reading"}
                    </td>
                    <td>
                      <strong>{usage ? money(usage.amount, true) : "-"}</strong>
                      {usage && (
                        <small>total for room, split by occupants</small>
                      )}
                    </td>
                    <td>{titleCase(r.readingType)}</td>
                    <td>{r.submittedBy}</td>
                    <td>{r.notes || "-"}</td>
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setEditingMeter(r);
                          setMeterRoomId(String(r.roomId));
                          const room = meterRooms.find(
                            (rm) => String(rm.roomId) === String(r.roomId),
                          );
                          setMeterHostelId(
                            room ? String(room.hostelId) : "",
                          );
                          setMeterRoomType(room ? room.roomType : "");
                          setModal("meter");
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "rates" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>HOSTEL PROPERTY &amp; UTILITY RATES</small>
              <h3>Address, owner charges and student electricity/water rates</h3>
              <p>
                Electricity uses three decimal places and the final student
                charge is rounded up to the next Ringgit. Cleaning and
                water-dispenser fees feed the monthly owner P&amp;L.
              </p>
            </div>
          </div>
          <div className="rate-card-grid">
            {data.hostels.map((h) => (
              <form
                key={h.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  save(
                    { action: "meter-rates", hostelId: h.id, ...formValues(e) },
                    `${h.name} rates updated`,
                  );
                }}
              >
                <h4>{h.name}</h4>
                <label>
                  Property address
                  <textarea
                    name="address"
                    required
                    defaultValue={h.address || ""}
                  />
                </label>
                <label>
                  Owner cleaning fee / month
                  <input
                    name="monthlyCleaningFee"
                    type="number"
                    min="0"
                    defaultValue={h.monthlyCleaningFee}
                  />
                </label>
                <label>
                  Student electricity / kWh
                  <input
                    name="electricityRate"
                    type="number"
                    min="0"
                    step="0.001"
                    required
                    defaultValue={Number(h.electricityRate || 0).toFixed(3)}
                  />
                </label>
                <small className="field-note">
                  Example: 33 kWh × {Number(h.electricityRate || 0).toFixed(3)}{" "}
                  is billed as{" "}
                  {money(Math.ceil(33 * Number(h.electricityRate || 0)))}
                </small>
                <label>
                  Owner water dispenser / month
                  <input
                    name="monthlyWaterDispenserFee"
                    type="number"
                    min="0"
                    defaultValue={h.monthlyWaterDispenserFee}
                  />
                </label>
                <button className="secondary compact" disabled={busy}>
                  Save rates
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
      {tab === "costs" && (
        <>
          <section className="report-grid">
            <ReportCard
              title="Maintenance costing"
              value={money(
                data.tickets.reduce(
                  (sum, t) => sum + Number(t.actualCost || 0),
                  0,
                ),
              )}
              note="Management, owner and student responsibility"
            />
            <ReportCard
              title="Student penalties"
              value={money(
                data.tickets.reduce(
                  (sum, t) => sum + Number(t.studentCharge || 0),
                  0,
                ),
              )}
              note="Includes door unlocking and additional requests"
            />
            <ReportCard
              title="Owner responsibility"
              value={String(
                data.tickets.filter((t) => t.costResponsibility === "owner")
                  .length,
              )}
              note="Tickets assigned to house owner"
            />
            <article className="panel fee-reference">
              <h3>Door unlocking fee</h3>
              <p>
                <b>{money(50)}</b> during office hours
              </p>
              <p>
                <b>{money(100)}</b> outside office hours
              </p>
            </article>
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <small>DETAILED COST & PENALTY REGISTER</small>
                <h3>
                  {money(
                    filteredCosts.reduce(
                      (sum, item) => sum + item.cost + item.penalty,
                      0,
                    ),
                    true,
                  )}{" "}
                  in selected period
                </h3>
              </div>
              <button
                className="v2-btn-primary"
                onClick={() => setModal("general-cost")}
              >
                + Add general costing
              </button>
            </div>
            <div className="v2-toolbar">
              <label>
                From
                <input
                  type="date"
                  value={costFrom}
                  onChange={(event) => setCostFrom(event.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={costTo}
                  onChange={(event) => setCostTo(event.target.value)}
                />
              </label>
              <button
                className="v2-reset"
                onClick={() => {
                  setCostFrom("");
                  setCostTo("");
                }}
              >
                Reset dates
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Responsibility</th>
                    <th>Cost</th>
                    <th>Student penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCosts
                    .sort((left, right) => right.date.localeCompare(left.date))
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{dateLabel(item.date)}</td>
                        <td>
                          <code>{item.reference}</code>
                        </td>
                        <td>{item.description}</td>
                        <td>{titleCase(item.responsibility)}</td>
                        <td>{money(item.cost, true)}</td>
                        <td>{money(item.penalty, true)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {ticket && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setTicket(null)}
        >
          <aside className="unit-drawer ticket-drawer">
            <div className="drawer-head">
              <div>
                <small>{ticket.ticketNo}</small>
                <h2>{ticket.subject}</h2>
                <p>
                  {ticket.hostelName} / {ticket.unitCode} ·{" "}
                  {titleCase(ticket.status)}
                </p>
              </div>
              <button onClick={() => setTicket(null)}>×</button>
            </div>
            <section className="drawer-section ticket-summary">
              <div>
                <span>Assigned to</span>
                <b>{ticket.assignedTo || "Not assigned"}</b>
              </div>
              <div>
                <span>Responsibility</span>
                <b>{titleCase(ticket.costResponsibility)}</b>
              </div>
              <div>
                <span>Actual cost</span>
                <b>{money(ticket.actualCost)}</b>
              </div>
              <div>
                <span>Student charge</span>
                <b>{money(ticket.studentCharge)}</b>
              </div>
            </section>
            <TicketAttachments
              attachments={data.attachments.filter(
                (attachment) =>
                  attachment.contextType === "ticket" &&
                  attachment.recordId === ticket.id,
              )}
              onDeleted={() => load(["attachments"])}
            />
            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>CONVERSATION</small>
                  <h3>Ticket updates</h3>
                </div>
              </div>
              <div className="conversation">
                {data.ticketMessages
                  .filter((m) => m.ticketId === ticket.id)
                  .map((m) => (
                    <article
                      key={m.id}
                      className={
                        m.authorRole === "student"
                          ? "student-message"
                          : "staff-message"
                      }
                    >
                      <div>
                        <b>{m.authorName}</b>
                        <small>
                          {titleCase(m.authorRole)} · {dateLabel(m.createdAt)}
                        </small>
                      </div>
                      <p>{m.message}</p>
                      {m.statusAfter && (
                        <span>Status: {titleCase(m.statusAfter)}</span>
                      )}
                      <TicketAttachments
                        attachments={data.attachments.filter(
                          (attachment) =>
                            attachment.contextType === "ticket-update" &&
                            attachment.recordId === m.id,
                        )}
                        onDeleted={() => load(["attachments"])}
                        compact
                      />
                    </article>
                  ))}
              </div>
              <form
                className="ticket-reply"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = e.currentTarget;
                  const result = await save(
                    {
                      action: "ticket-message",
                      ticketId: ticket.id,
                      ...formValues(e),
                    },
                    "Ticket update posted",
                  );
                  const file = (
                    f.elements.namedItem("updateAttachment") as HTMLInputElement
                  ).files?.[0];
                  if (result?.id && file)
                    await uploadAttachment(
                      file,
                      "ticket-update",
                      result.id,
                      data.currentUser?.displayName,
                    );
                  if (result) {
                    f.reset();
                    setTicket(null);
                  }
                }}
              >
                <label>
                  Update message
                  <textarea
                    name="message"
                    required={data.currentUser?.roleKey === "tenant"}
                    placeholder="Inspection result, parts required, appointment or completion note"
                  />
                </label>
                <div className="form-grid">
                  {data.currentUser?.roleKey !== "tenant" && (
                    <>
                      <label>
                        New status
                        <select name="statusAfter">
                          <option value="">Keep current</option>
                          <option value="attended">Attended</option>
                          <option value="waiting-parts">
                            Waiting for parts
                          </option>
                          <option value="in-progress">In progress</option>
                          <option value="completed">Completed</option>
                          <option value="closed">Closed</option>
                        </select>
                      </label>
                      <label>
                        Assigned to
                        <input
                          name="assignedTo"
                          defaultValue={ticket.assignedTo}
                        />
                      </label>
                      <label>
                        Cost responsibility
                        <select
                          name="costResponsibility"
                          defaultValue={ticket.costResponsibility}
                        >
                          <option value="management">Management</option>
                          <option value="owner">House owner</option>
                          <option value="student">Student</option>
                        </select>
                      </label>
                      <label>
                        Actual cost
                        <input
                          name="actualCost"
                          type="number"
                          min="0"
                          defaultValue={ticket.actualCost ?? ""}
                        />
                      </label>
                      <label>
                        Student charge / penalty
                        <input
                          name="studentCharge"
                          type="number"
                          min="0"
                          defaultValue={ticket.studentCharge ?? ""}
                        />
                      </label>
                    </>
                  )}
                  <label className="wide">
                    Attach file (optional)
                    <input
                      name="updateAttachment"
                      type="file"
                      accept={ATTACHMENT_ACCEPT}
                    />
                    <small className="field-note">
                      Photo, video, PDF, Word, Excel or CSV — up to 25 MB.
                    </small>
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  Post update
                </button>
              </form>
            </section>
          </aside>
        </div>
      )}
      {modal === "categories" && (
        <Modal
          title="Maintenance categories"
          kicker="EDITABLE TICKET LIST"
          description="These categories and subcategories appear in the staff and tenant ticket forms."
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid compact-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                { action: "ticket-category-save", ...formValues(event) },
                "Ticket category added",
              );
              if (ok) event.currentTarget.reset();
            }}
          >
            <label>
              Category
              <input name="category" required placeholder="e.g. Electrical" />
            </label>
            <label>
              Subcategory
              <input name="subcategory" required placeholder="e.g. Light" />
            </label>
            <label>
              Sort order
              <input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={data.ticketCategories.length}
              />
            </label>
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                Add category
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Subcategory</th>
                  <th>Status</th>
                  <th>Order</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.ticketCategories.map((item) => (
                  <tr key={item.id}>
                    <td>{item.category}</td>
                    <td>{item.subcategory}</td>
                    <td>{titleCase(item.status)}</td>
                    <td>{item.sortOrder}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="secondary compact"
                          onClick={() => {
                            const category = window.prompt(
                              "Category",
                              item.category,
                            );
                            if (category === null) return;
                            const subcategory = window.prompt(
                              "Subcategory",
                              item.subcategory,
                            );
                            if (subcategory === null) return;
                            save(
                              {
                                action: "ticket-category-save",
                                categoryId: item.id,
                                category,
                                subcategory,
                                status: item.status,
                                sortOrder: item.sortOrder,
                              },
                              "Ticket category updated",
                            );
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="danger compact"
                          onClick={() =>
                            save(
                              {
                                action: "ticket-category-delete",
                                categoryId: item.id,
                              },
                              "Ticket category deleted",
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {modal === "general-cost" && (
        <Modal
          title="Add general maintenance costing"
          kicker="MONTHLY COST REGISTER"
          description="Use this for costs that are not tied to a maintenance ticket."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await save(
                { action: "general-cost", ...formValues(event) },
                "General cost added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Date
              <input
                name="costDate"
                type="date"
                required
                defaultValue={today}
              />
            </label>
            <label>
              Hostel
              <select name="hostelId">
                <option value="">General / all hostels</option>
                {data.hostels.map((hostel) => (
                  <option key={hostel.id} value={hostel.id}>
                    {hostel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cost type
              <select name="costType">
                <option value="maintenance">Maintenance</option>
                <option value="supplies">Supplies</option>
                <option value="service">Service</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Responsibility
              <select name="responsibility">
                <option value="management">Management</option>
                <option value="owner">House owner</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="wide">
              Description
              <input name="description" required />
            </label>
            <label>
              Amount
              <input name="amount" type="number" min="0" step="0.01" required />
            </label>
            <label>
              Student charge (if any)
              <input name="studentCharge" type="number" min="0" step="0.01" />
            </label>
            <label className="wide">
              Notes
              <input name="notes" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add costing
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "ticket" && (
        <Modal
          title="Submit maintenance ticket"
          kicker="TICKET DETAILS"
          description="Students must attach a picture or video. Staff attachments are optional."
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const values = formValues(e);
              const files = Array.from(
                (form.elements.namedItem("attachment") as HTMLInputElement)
                  .files || [],
              );
              const imageCount = files.filter((file) =>
                file.type.startsWith("image/"),
              ).length;
              const videoCount = files.filter((file) =>
                file.type.startsWith("video/"),
              ).length;
              if (imageCount > 3 || videoCount > 1) {
                window.alert(
                  "Attach a maximum of 3 pictures and 1 video per ticket.",
                );
                return;
              }
              const result = await save(
                { action: "ticket-create", ...values },
                "Ticket submitted",
              );
              if (result?.id)
                for (const file of files)
                  await uploadAttachment(
                    file,
                    "ticket",
                    result.id,
                    data.currentUser?.displayName,
                  );
              if (result) setModal("");
            }}
          >
            <label>
              Submitted by
              <input
                value={`${data.currentUser?.displayName} · ${data.currentUser?.roleName}`}
                readOnly
              />
              <input
                type="hidden"
                name="submittedByType"
                value={
                  data.currentUser?.roleKey === "tenant" ? "student" : "staff"
                }
              />
            </label>
            <label>
              1. Hostel
              <select
                name="hostelId"
                required
                value={ticketHostelId}
                onChange={(event) => {
                  setTicketHostelId(event.target.value);
                  setTicketBlock("");
                  setTicketUnitId("");
                  setTicketStudentId("");
                  setTicketRoomId("");
                }}
              >
                <option value="">Select hostel</option>
                {data.hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            {ticketBlockOptions.length > 0 && (
              <label>
                2. Block
                <select
                  value={ticketBlock}
                  disabled={!ticketHostelId}
                  onChange={(event) => {
                    setTicketBlock(event.target.value);
                    setTicketUnitId("");
                    setTicketStudentId("");
                    setTicketRoomId("");
                  }}
                >
                  <option value="">All blocks in this hostel</option>
                  {ticketBlockOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              3. Unit
              <select
                name="unitId"
                required
                value={ticketUnitId}
                disabled={!ticketHostelId}
                onChange={(event) => {
                  setTicketUnitId(event.target.value);
                  setTicketStudentId("");
                  setTicketRoomId("");
                }}
              >
                <option value="">
                  {ticketHostelId ? "Select unit" : "Select a hostel first"}
                </option>
                {ticketBlockedUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.hostelName}/{u.unitCode}
                  </option>
                ))}
              </select>
            </label>
            {data.currentUser?.roleKey !== "tenant" && (
              <label>
                4. Student
                <select
                  name="studentId"
                  value={ticketStudentId}
                  disabled={!ticketUnitId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTicketStudentId(value);
                    // Pre-fill the room from the chosen student; staff can
                    // still change it (e.g. a common-area complaint).
                    const student = data.students.find(
                      (item) => String(item.id) === value,
                    );
                    setTicketRoomId(student?.roomId ? String(student.roomId) : "");
                  }}
                >
                  <option value="">
                    {ticketUnitId
                      ? "Select student (optional)"
                      : "Select a unit first"}
                  </option>
                  {data.students
                    .filter(
                      (student) =>
                        student.assignmentStatus === "active" &&
                        String(student.unitId) === ticketUnitId,
                    )
                    .map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.fullName} · {student.roomCode}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              5. Room / complaint location
              <select
                name="roomId"
                value={ticketRoomId}
                disabled={!ticketUnitId}
                onChange={(event) => setTicketRoomId(event.target.value)}
              >
                <option value="">
                  {ticketUnitId
                    ? "Common area / common toilet"
                    : "Select a unit first"}
                </option>
                {[...new Map(data.bedSpaces.map((b) => [b.roomId, b])).values()]
                  .filter(
                    (room) =>
                      !ticketUnitId || String(room.unitId) === ticketUnitId,
                  )
                  .map((b) => (
                    <option key={b.roomId} value={b.roomId}>
                      {b.hostelName}/{b.unitCode} · Room {b.roomLabel}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Category
              <select
                name="category"
                required
                value={ticketCategory}
                onChange={(event) => setTicketCategory(event.target.value)}
              >
                <option value="">Select category</option>
                {[
                  ...new Set(
                    data.ticketCategories
                      .filter((item) => item.status === "active")
                      .map((item) => item.category),
                  ),
                ].map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subcategory
              <select name="subcategory" required>
                <option value="">Select subcategory</option>
                {data.ticketCategories
                  .filter(
                    (item) =>
                      item.status === "active" &&
                      item.category === ticketCategory,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.subcategory}>
                      {item.subcategory}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority">
                <option value="average">P2 · Average</option>
                <option value="high">P1 · High</option>
                <option value="low">P3 · Low</option>
              </select>
            </label>
            <label className="wide">
              Description
              <textarea name="description" required placeholder="Describe the issue or request" />
            </label>
            <label>
              Estimated cost
              <input name="estimatedCost" type="number" min="0" placeholder="Estimated cost in RM" />
            </label>
            <label>
              Responsibility
              <select name="costResponsibility">
                <option value="management">Management</option>
                <option value="owner">House owner</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="wide">
              Picture / video / document
              <input
                name="attachment"
                type="file"
                accept={ATTACHMENT_ACCEPT}
                multiple
                required={data.currentUser?.roleKey === "tenant"}
              />
              <small className="field-note">
                Maximum 3 pictures and 1 video, plus any number of PDF, Word,
                Excel or CSV files. Required for tenant submissions.
              </small>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit ticket
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "unlock" && (
        <Modal
          title="Door unlocking request"
          kicker="QUICK REQUEST"
          description="The applicable charge is added to the student billing record."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const values = formValues(e);
              const charge = values.subcategory === "office-hours" ? 50 : 100;
              const ok = await save(
                {
                  action: "ticket-create",
                  category: "access-card-key",
                  subject: "Door unlocking request",
                  description: `Unlock request (${titleCase(String(values.subcategory))})`,
                  studentCharge: charge,
                  costResponsibility: "student",
                  ...values,
                },
                "Unlock request submitted",
              );
              if (ok) setModal("");
            }}
          >
            <input
              type="hidden"
              name="studentId"
              value={data.currentUser?.studentId || ""}
            />
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
              Unit
              <select name="unitId" required>
                <option value="">Select unit</option>
                {data.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.hostelName}/{u.unitCode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Time
              <select name="subcategory">
                <option value="office-hours">Office hours · RM50</option>
                <option value="non-office-hours">
                  Outside office hours · RM100
                </option>
              </select>
            </label>
            <label>
              Submitted by
              <input
                value={data.currentUser?.displayName || "Tenant"}
                readOnly
              />
            </label>
            <input type="hidden" name="submittedByType" value="student" />
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Submit unlock request
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "meter" && (
        <Modal
          title={
            editingMeter
              ? "Edit electricity meter reading"
              : "Add electricity meter reading"
          }
          kicker="MONTHLY BILLING INPUT"
          onClose={() => {
            setModal("");
            setEditingMeter(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingMeter
                    ? "meter-reading-update"
                    : "meter-reading",
                  readingId: editingMeter?.id,
                  ...formValues(e),
                },
                editingMeter ? "Meter reading updated" : "Meter reading added",
              );
              if (ok) {
                setModal("");
                setEditingMeter(null);
              }
            }}
          >
            <label>
              Hostel
              <select
                value={meterHostelId}
                onChange={(event) => {
                  setMeterHostelId(event.target.value);
                  setMeterRoomId("");
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
                value={meterRoomType}
                disabled={!meterHostelId}
                onChange={(event) => {
                  setMeterRoomType(event.target.value);
                  setMeterRoomId("");
                }}
              >
                <option value="">Select room type</option>
                <option value="single">Single room</option>
                <option value="sharing">Sharing room</option>
              </select>
            </label>
            <label className="wide">
              Room code
              <SearchSelect
                key={`${meterHostelId}:${meterRoomType}`}
                name="roomId"
                required={!editingMeter}
                defaultValue={editingMeter?.roomId}
                options={meterRooms
                  .filter(
                    (room) =>
                      (!meterHostelId ||
                        String(room.hostelId) === meterHostelId) &&
                      (!meterRoomType || room.roomType === meterRoomType),
                  )
                  .map((room) => ({
                    value: room.roomId,
                    label: `${room.unitCode}-${room.roomLabel} · ${room.hostelName}/${room.unitCode}`,
                  }))}
                placeholder={
                  meterHostelId && meterRoomType
                    ? "Type room code or unit"
                    : "Select a hostel and room type first"
                }
                onValueChange={setMeterRoomId}
              />
            </label>
            <label className="wide">
              Room meter serial
              <input
                key={meterRoomId || editingMeter?.roomId || "new"}
                name="meterSerial"
                defaultValue={
                  meterRooms.find(
                    (room) =>
                      String(room.roomId) ===
                      (meterRoomId || String(editingMeter?.roomId || "")),
                  )?.meterSerial ||
                  editingMeter?.meterSerial ||
                  ""
                }
                placeholder="One meter serial per room"
              />
            </label>
            <label>
              Reading date
              <input
                name="readingDate"
                type="date"
                required
                defaultValue={editingMeter?.readingDate || today}
              />
            </label>
            <label>
              Reading value
              <input
                name="readingValue"
                type="number"
                step="0.01"
                required
                defaultValue={editingMeter?.readingValue ?? ""}
              />
            </label>
            <label>
              Reading type
              <select
                name="readingType"
                defaultValue={editingMeter?.readingType || "monthly"}
              >
                <option value="monthly">Monthly</option>
                <option value="check-in">Check-in</option>
                <option value="check-out">Check-out</option>
                <option value="semester-break">
                  Semester break / special split
                </option>
              </select>
            </label>
            <label>
              Submitted by
              <input
                name="submittedBy"
                defaultValue={
                  editingMeter?.submittedBy ||
                  data.currentUser?.displayName ||
                  "Maintenance Team"
                }
              />
            </label>
            <label className="wide">
              Notes
              <input name="notes" defaultValue={editingMeter?.notes || ""} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingMeter ? "Update reading" : "Save reading"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
