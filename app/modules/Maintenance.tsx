"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Empty,
  Modal,
  ReportCard,
  SearchSelect,
  blockOf,
  dateLabel,
  formValues,
  money,
  titleCase,
  today,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";

// Pictures and videos render inline (no click-through needed) and split
// into their own sections since they're viewed differently. Deleting calls
// the file store directly rather than going through save()/action dispatch
// since attachments aren't part of the /api/system action set.
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
    String(attachment.contentType || "").startsWith("image/"),
  );
  const videos = attachments.filter((attachment) =>
    String(attachment.contentType || "").startsWith("video/"),
  );
  if (!pictures.length && !videos.length) return null;

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

  const content = (
    <>
      {!compact && <strong>Pictures &amp; videos</strong>}
      {group(pictures, "PICTURE")}
      {group(videos, "VIDEO")}
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
  const meterMonths = [
    ...new Set(
      data.meterReadings
        .map((reading) => String(reading.readingDate || "").slice(0, 7))
        .filter(Boolean),
    ),
  ].sort((a, b) => b.localeCompare(a));
  const [meterMonth, setMeterMonth] = useState(meterMonths[0] || "all");
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
    <>
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
          <button className="primary" onClick={() => setModal("ticket")}>
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
            <div className="filters">
              <label className="search">
                Hostel, room, student or issue
                <input
                  value={ticketQuery}
                  onChange={(event) => setTicketQuery(event.target.value)}
                  placeholder="Search hostel/room code, student, category or issue"
                />
              </label>
              <label>
                Hostel
                <select
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
              </label>
              <button
                className="secondary reset-button"
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
                        <span className={`ticket-status ${t.status}`}>
                          {titleCase(t.status)}
                        </span>
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
      {tab === "meters" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>MONTHLY / CHECK-IN / CHECK-OUT</small>
              <h3>Electricity meter readings</h3>
              <p>
                Sharing-room calculations can use check-in, check-out or special
                semester-break readings.
              </p>
            </div>
            <div className="button-row">
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
              <button
                className="primary compact"
                onClick={() => {
                  setEditingMeter(null);
                  setMeterRoomId("");
                  setModal("meter");
                }}
              >
                + Add reading
              </button>
            </div>
          </div>
          <div className="filters">
            <label className="search">
              Unit / room code
              <input
                value={meterQuery}
                onChange={(event) => setMeterQuery(event.target.value)}
                placeholder="Type unit or room code"
              />
            </label>
            <label>
              Month
              <select
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
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room code</th>
                  <th>Hostel / unit</th>
                  <th>Date</th>
                  <th>Reading</th>
                  <th>Type</th>
                  <th>Submitted by</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredReadings.map((r) => (
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
                    <td>{titleCase(r.readingType)}</td>
                    <td>{r.submittedBy}</td>
                    <td>{r.notes || "-"}</td>
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setEditingMeter(r);
                          setMeterRoomId(String(r.roomId));
                          setModal("meter");
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                className="primary compact"
                onClick={() => setModal("general-cost")}
              >
                + Add general costing
              </button>
            </div>
            <div className="filters">
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
                className="secondary reset-button"
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
                    Update photo (optional)
                    <input
                      name="updateAttachment"
                      type="file"
                      accept="image/*"
                    />
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
              Picture / video
              <input
                name="attachment"
                type="file"
                accept="image/*,video/*"
                multiple
                required={data.currentUser?.roleKey === "tenant"}
              />
              <small className="field-note">
                Maximum 3 pictures and 1 video. Required for tenant submissions.
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
            <label className="wide">
              Room code
              <SearchSelect
                name="roomId"
                required={!editingMeter}
                defaultValue={editingMeter?.roomId}
                options={meterRooms.map((room) => ({
                  value: room.roomId,
                  label: `${room.unitCode}-${room.roomLabel} · ${room.hostelName}/${room.unitCode}`,
                }))}
                placeholder="Type room code, unit or hostel"
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
    </>
  );
}
