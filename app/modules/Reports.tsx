"use client";

import { useState } from "react";
import {
  Empty,
  SearchIcon,
  Stat,
  commitsInventory,
  money,
  titleCase,
} from "./shared";
import type { Data, Row } from "./shared";

export function ReportsModule({ data }: { data: Data }) {
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [reportQuery, setReportQuery] = useState("");
  const [reportHostel, setReportHostel] = useState("all");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportStatus, setReportStatus] = useState("all");
  const ticketCost = data.tickets.reduce(
    (sum, t) => sum + Number(t.actualCost || 0),
    0,
  );
  const outstanding = data.invoices.reduce(
    (sum, i) => sum + Number(i.totalAmount) - Number(i.amountPaid),
    0,
  );
  const reports = [
    {
      key: "tickets",
      name: "Ticketing report",
      value: `${data.tickets.length} cases`,
      note: `${data.tickets.filter((t) => ["completed", "closed"].includes(t.status)).length} completed · ${money(ticketCost)} cost`,
    },
    {
      key: "meters",
      name: "Meter reading",
      value: `${data.meterReadings.length} readings`,
      note: "Monthly, check-in, check-out and special split",
    },
    {
      key: "cards",
      name: "Access card list",
      value: `${data.accessCards.length} cards`,
      note: `${data.accessCards.filter((c) => ["lost", "replaced"].includes(c.status)).length} lost / replaced`,
    },
    {
      key: "wifi",
      name: "Wi-Fi list",
      value: `${data.services.filter((s) => s.serviceType === "wifi").length} accounts`,
      note: `${data.services.filter((s) => s.status === "relocated").length} relocated`,
    },
    {
      key: "parking",
      name: "Parking history",
      value: `${data.parkingRentals.length} rentals`,
      note: `${data.parkingRentals.filter((r) => r.status !== "active").length} previous tenants`,
    },
    {
      key: "students",
      name: "Student information",
      value: `${data.students.length} profiles`,
      note: `${data.students.filter((s) => s.profileStatus !== "active").length} moved out / inactive`,
    },
    {
      key: "outstanding",
      name: "Outstanding payment",
      value: money(outstanding, true),
      note: `Across ${data.invoices.filter((i) => i.status !== "paid").length} unpaid / partial bills`,
    },
    {
      key: "costing",
      name: "Costing report",
      value: money(
        data.generalCosts.reduce(
          (sum, item) => sum + Number(item.amount || 0),
          ticketCost,
        ),
        true,
      ),
      note: "Detailed maintenance and general costs by month",
    },
    {
      key: "rate-changes",
      name: "Scheduled rate changes",
      value: `${data.studentRateChanges.length} changes`,
      note: "Effective-dated rental and deposit changes per student",
    },
  ];
  const reportRows = (index: number | null): Row[] => {
    if (index === null) return [];
    if (index === 0) return data.tickets;
    if (index === 1) {
      const grouped = new Map<string, Row[]>();
      for (const reading of data.meterReadings)
        grouped.set(reading.roomCode, [
          ...(grouped.get(reading.roomCode) || []),
          reading,
        ]);
      return [...grouped.values()].flatMap((rows) =>
        rows
          .sort((left, right) =>
            String(right.readingDate).localeCompare(String(left.readingDate)),
          )
          .slice(0, 8),
      );
    }
    if (index === 2) return data.accessCards;
    if (index === 3)
      return data.services
        .filter((service) => service.serviceType === "wifi")
        .map((service) => ({
          ...service,
          ...data.units.find((unit) => unit.id === service.unitId),
        }));
    if (index === 4) return data.parkingRentals;
    if (index === 5) return data.students;
    if (index === 6)
      return data.invoices.map((invoice) => ({
        ...invoice,
        outstanding: Number(invoice.totalAmount) - Number(invoice.amountPaid),
      }));
    if (index === 7)
      return [
        ...data.generalCosts,
        ...data.tickets
          .filter((ticket) => Number(ticket.actualCost || 0) > 0)
          .map((ticket) => ({
            id: `ticket-${ticket.id}`,
            costDate: String(
              ticket.completedAt || ticket.updatedAt || ticket.createdAt,
            ).slice(0, 10),
            hostelName: ticket.hostelName,
            unitCode: ticket.unitCode,
            description: ticket.subject,
            responsibility: ticket.costResponsibility,
            amount: ticket.actualCost,
            reference: ticket.ticketNo,
          })),
      ] as Row[];
    if (index === 8) return data.studentRateChanges;
    return [];
  };
  const detailRows = reportRows(selectedReport).filter((row) => {
    const search = reportQuery.trim().toLowerCase();
    const text =
      `${row.studentName || row.fullName || row.tenantName || ""} ${row.hostelName || ""} ${row.roomCode || row.unitCode || ""} ${row.description || row.subject || ""}`.toLowerCase();
    const hostelMatch =
      reportHostel === "all" ||
      String(row.hostelId || "") === reportHostel ||
      row.hostelName ===
        data.hostels.find((hostel) => String(hostel.id) === reportHostel)?.name;
    const date = String(
      row.createdAt ||
        row.readingDate ||
        row.startDate ||
        row.leaseEndDate ||
        row.dueDate ||
        row.costDate ||
        "",
    ).slice(0, 10);
    const statusMatch =
      reportStatus === "all" ||
      row.status === reportStatus ||
      row.profileStatus === reportStatus ||
      row.assignmentStatus === reportStatus;
    return (
      (!search || text.includes(search)) &&
      hostelMatch &&
      (!reportFrom || date >= reportFrom) &&
      (!reportTo || date <= reportTo) &&
      statusMatch
    );
  });
  const download = (name: string, rows: Row[]) => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]).filter(
      (k) => !["payments", "items", "charges"].includes(k),
    );
    const csv = [
      keys.join(","),
      ...rows.map((r) =>
        keys
          .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const selectReport = (index: number) => {
    setSelectedReport(index);
    setReportQuery("");
    setReportHostel("all");
    setReportFrom("");
    setReportTo("");
    setReportStatus("all");
  };
  return (
    <div className="table-v2">
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">MANAGEMENT REPORTS</span>
          <h2>Operational lists and monthly statistics in one place.</h2>
          <p>
            Export the detailed registers for checking, reconciliation or
            management review.
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="workspace-tabs">
          {reports.map((r, index) => (
            <button
              key={r.key}
              type="button"
              className={selectedReport === index ? "active" : ""}
              onClick={() => selectReport(index)}
            >
              {r.name}
            </button>
          ))}
        </div>
      </section>

      {selectedReport !== null ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>REPORT</small>
              <h3>{reports[selectedReport].name}</h3>
              <p>{reports[selectedReport].note}</p>
            </div>
            <span>{reports[selectedReport].value}</span>
          </div>

          {selectedReport === 5 && (
            <section className="module-metrics report-modal-metrics">
              <Stat
                value={`${Math.round((data.bedSpaces.filter((bed) => bed.status === "occupied").length / Math.max(1, data.bedSpaces.filter((bed) => bed.status !== "special-use").length)) * 100)}%`}
                label="Occupancy"
              />
              <Stat
                value={data.reservations.filter(commitsInventory).length}
                label="Paid reservations"
              />
            </section>
          )}

          <div className="v2-toolbar">
            <label className="v2-search">
              <SearchIcon />
              <input
                value={reportQuery}
                onChange={(event) => setReportQuery(event.target.value)}
                placeholder="Student, room or description"
              />
            </label>
            <select
              className="v2-pill-select"
              value={reportHostel}
              onChange={(event) => setReportHostel(event.target.value)}
            >
              <option value="all">All hostels</option>
              {data.hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
            <label className="v2-date-field">
              From
              <input
                type="date"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
              />
            </label>
            <label className="v2-date-field">
              To
              <input
                type="date"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
              />
            </label>
            {(selectedReport === 0 ||
              selectedReport === 5 ||
              selectedReport === 6) && (
              <select
                className="v2-pill-select"
                value={reportStatus}
                onChange={(event) => setReportStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="moved-out">Moved out</option>
                <option value="submitted">Submitted</option>
                <option value="in-progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="closed">Closed</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="unpaid">Unpaid</option>
              </select>
            )}
            <button
              className="v2-reset"
              onClick={() => {
                setReportQuery("");
                setReportHostel("all");
                setReportFrom("");
                setReportTo("");
                setReportStatus("all");
              }}
            >
              Reset filters
            </button>
            <button
              className="v2-btn-primary"
              onClick={() => download(reports[selectedReport].key, detailRows)}
            >
              Export visible CSV
            </button>
          </div>

          <div className="table-wrap report-detail-table">
            <table>
              <thead>
                <tr>
                  {detailRows.length > 0 &&
                    Object.keys(detailRows[0])
                      .filter(
                        (key) =>
                          !["payments", "items", "charges"].includes(key),
                      )
                      .slice(0, 9)
                      .map((key) => <th key={key}>{titleCase(key)}</th>)}
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row, index) => (
                  <tr key={`${row.id || "row"}-${index}`}>
                    {Object.keys(detailRows[0] || {})
                      .filter(
                        (key) =>
                          !["payments", "items", "charges"].includes(key),
                      )
                      .slice(0, 9)
                      .map((key) => (
                        <td key={key}>{String(row[key] ?? "-")}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!detailRows.length && (
              <Empty
                title="No rows match"
                text="Change the report filters to view records."
              />
            )}
          </div>
        </section>
      ) : (
        <section className="panel">
          <em>Select a report above to view its details.</em>
        </section>
      )}
    </div>
  );
}
