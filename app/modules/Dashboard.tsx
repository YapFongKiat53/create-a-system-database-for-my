"use client";

import { useMemo } from "react";
import { dateLabel, money, titleCase } from "./shared";
import type { Data, Row } from "./shared";

const OPEN_TICKET_STATUSES = [
  "submitted",
  "attended",
  "waiting-parts",
  "in-progress",
];

const monthKey = (value: unknown) => String(value || "").slice(0, 7);
const monthShort = (ym: string) =>
  ym
    ? new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-GB", {
        month: "short",
        timeZone: "UTC",
      })
    : "";

export function DashboardModule({
  data,
  onOpenModule,
}: {
  data: Data;
  onOpenModule: (view: string) => void;
}) {
  const stats = useMemo(() => {
    const beds = data.bedSpaces.length;
    const occupied = data.bedSpaces.filter(
      (bed) => bed.status === "occupied",
    ).length;
    const vacant = data.bedSpaces.filter(
      (bed) => bed.status === "vacant",
    ).length;
    const sellable = data.bedSpaces.filter(
      (bed) => bed.status !== "special-use",
    ).length;
    return {
      beds,
      occupied,
      vacant,
      occupancy: Math.round((occupied / Math.max(1, sellable)) * 100),
    };
  }, [data]);

  const outstandingRows = useMemo(() => {
    const grouped = new Map<string, number>();
    let total = 0;
    for (const invoice of data.invoices) {
      const balance =
        Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0);
      if (balance <= 0) continue;
      total += balance;
      const key = String(invoice.hostelName || "Unassigned");
      grouped.set(key, (grouped.get(key) || 0) + balance);
    }
    return {
      total,
      rows: [...grouped.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [data]);

  const openTickets = useMemo(
    () =>
      data.tickets
        .filter((ticket) => OPEN_TICKET_STATUSES.includes(ticket.status))
        .sort((left, right) =>
          String(right.createdAt || "").localeCompare(
            String(left.createdAt || ""),
          ),
        ),
    [data],
  );

  const upcoming = useMemo(
    () =>
      data.reservations
        .filter((row) => row.status === "reserved")
        .sort((left, right) =>
          String(left.targetMoveInDate || "").localeCompare(
            String(right.targetMoveInDate || ""),
          ),
        ),
    [data],
  );

  const notices = useMemo(
    () =>
      [...data.announcements].sort((left, right) => {
        if (Boolean(right.pinned) !== Boolean(left.pinned))
          return right.pinned ? 1 : -1;
        return String(right.publishAt || right.createdAt || "").localeCompare(
          String(left.publishAt || left.createdAt || ""),
        );
      }),
    [data],
  );

  const occupancy = useMemo(
    () =>
      data.hostels
        .map((hostel) => {
          const total = Number(hostel.bedSpaces || 0);
          const occupied = Number(hostel.occupied || 0);
          return {
            id: hostel.id,
            name: hostel.name as string,
            code: hostel.code as string,
            total,
            occupied,
            percent: total ? Math.round((occupied / total) * 100) : 0,
          };
        })
        .sort((a, b) => b.total - a.total),
    [data],
  );
  const busiestHostel = Math.max(1, ...occupancy.map((row) => row.total));

  // Last six months of movement, taken from tenancy check-in / check-out dates.
  const movement = useMemo(() => {
    const months: string[] = [];
    const cursor = new Date();
    cursor.setUTCDate(1);
    for (let step = 5; step >= 0; step -= 1) {
      const point = new Date(cursor);
      point.setUTCMonth(cursor.getUTCMonth() - step);
      months.push(point.toISOString().slice(0, 7));
    }
    const rows = months.map((ym) => ({
      ym,
      label: monthShort(ym),
      checkIn: data.students.filter(
        (student) => monthKey(student.checkInDate) === ym,
      ).length,
      checkOut: data.students.filter(
        (student) => monthKey(student.checkOutDate) === ym,
      ).length,
    }));
    return { rows, peak: Math.max(1, ...rows.flatMap((r) => [r.checkIn, r.checkOut])) };
  }, [data]);

  const firstName = String(data.currentUser?.displayName || "there").split(
    " ",
  )[0];

  return (
    <>
      <section className="dash-welcome">
        <div>
          <span className="section-kicker">TODAY AT A GLANCE</span>
          <h2>Welcome back, {firstName}!</h2>
          <p>
            Occupancy, money owed, open tickets and upcoming arrivals across all{" "}
            {data.hostels.length} hostels.
          </p>
        </div>
      </section>

      <section className="dash-stats">
        <article className="dash-stat feature">
          <div className="dash-stat-head">
            <small>TOTAL BEDS</small>
            <button onClick={() => onOpenModule("hostels")} aria-label="Open hostels">
              ↗
            </button>
          </div>
          <strong>{stats.beds}</strong>
          <span>{data.units.length} units across {data.hostels.length} hostels</span>
        </article>
        <article className="dash-stat">
          <div className="dash-stat-head">
            <small>OCCUPIED</small>
            <button onClick={() => onOpenModule("students")} aria-label="Open students">
              ↗
            </button>
          </div>
          <strong>{stats.occupied}</strong>
          <span>{stats.occupancy}% of sellable beds</span>
        </article>
        <article className="dash-stat">
          <div className="dash-stat-head">
            <small>VACANT NOW</small>
            <button onClick={() => onOpenModule("hostels")} aria-label="Open availability">
              ↗
            </button>
          </div>
          <strong>{stats.vacant}</strong>
          <span>Ready to sell</span>
        </article>
        <article className="dash-stat">
          <div className="dash-stat-head">
            <small>OUTSTANDING</small>
            <button onClick={() => onOpenModule("finance")} aria-label="Open finance">
              ↗
            </button>
          </div>
          <strong className="money">{money(outstandingRows.total)}</strong>
          <span>
            {data.invoices.filter(
              (i) => Number(i.totalAmount) - Number(i.amountPaid) > 0,
            ).length}{" "}
            unpaid bills
          </span>
        </article>
      </section>

      <section className="dash-row-a">
        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Occupancy by hostel</h3>
            <button className="link-button" onClick={() => onOpenModule("reports")}>
              Reports
            </button>
          </div>
          {occupancy.length ? (
            <>
              <div className="dash-bars">
                {occupancy.map((row) => (
                  <div className="dash-bar" key={row.id}>
                    <div className="dash-bar-track">
                      <div
                        className="dash-bar-total"
                        style={{ height: `${(row.total / busiestHostel) * 100}%` }}
                      >
                        <div
                          className="dash-bar-fill"
                          style={{ height: `${row.percent}%` }}
                        />
                      </div>
                      <b>{row.percent}%</b>
                    </div>
                    <small>{row.code}</small>
                  </div>
                ))}
              </div>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Hostel</th>
                    <th>Occupied</th>
                    <th>Total beds</th>
                  </tr>
                </thead>
                <tbody>
                  {occupancy.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        <strong>{row.occupied}</strong> ({row.percent}%)
                      </td>
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="empty-copy">No hostels yet.</p>
          )}
        </article>

        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Upcoming reservations</h3>
            <span className="dash-count">{upcoming.length}</span>
          </div>
          <div className="dash-list">
            {upcoming.slice(0, 5).map((row: Row) => (
              <button
                key={row.id}
                className="dash-list-row"
                onClick={() => onOpenModule("hostels")}
              >
                <span>
                  <b>{row.studentName || "Unnamed"}</b>
                  <small>
                    Move-in {dateLabel(row.targetMoveInDate)}
                    {row.salesPerson ? ` · ${row.salesPerson}` : ""}
                  </small>
                </span>
                <i>›</i>
              </button>
            ))}
            {!upcoming.length && (
              <p className="empty-copy">No reservations waiting.</p>
            )}
          </div>
        </article>

        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Latest announcements</h3>
            <span className="dash-count">{notices.length}</span>
          </div>
          <div className="dash-list">
            {notices.slice(0, 5).map((row: Row) => (
              <button
                key={row.id}
                className="dash-list-row"
                onClick={() => onOpenModule("announcements")}
              >
                <span>
                  <b>
                    {row.pinned ? "📌 " : ""}
                    {row.title}
                  </b>
                  <small>
                    {dateLabel(row.publishAt || row.createdAt)}
                    {row.hostelName ? ` · ${row.hostelName}` : " · All hostels"}
                  </small>
                </span>
                <i>›</i>
              </button>
            ))}
            {!notices.length && (
              <p className="empty-copy">No announcements posted.</p>
            )}
          </div>
        </article>
      </section>

      <section className="dash-row-b">
        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Open maintenance tickets</h3>
            <span className="dash-count warn">{openTickets.length}</span>
          </div>
          <div className="dash-list">
            {openTickets.slice(0, 5).map((row: Row) => (
              <button
                key={row.id}
                className="dash-list-row"
                onClick={() => onOpenModule("maintenance")}
              >
                <span>
                  <b>{row.subject}</b>
                  <small>
                    <code>{row.ticketNo}</code> · {row.hostelName || "—"}
                    {row.unitCode ? `/${row.unitCode}` : ""} ·{" "}
                    {titleCase(row.status)}
                  </small>
                </span>
                <i>›</i>
              </button>
            ))}
            {!openTickets.length && (
              <p className="empty-copy">No open tickets. All clear.</p>
            )}
          </div>
        </article>

        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Outstanding by hostel</h3>
            <button className="link-button" onClick={() => onOpenModule("finance")}>
              Finance
            </button>
          </div>
          <div className="dash-money-total">
            <small>TOTAL OUTSTANDING</small>
            <strong>{money(outstandingRows.total, true)}</strong>
          </div>
          <div className="dash-list tight">
            {outstandingRows.rows.map(([name, amount]) => (
              <div className="dash-money-row" key={name}>
                <span>{name}</span>
                <b>{money(amount, true)}</b>
              </div>
            ))}
            {!outstandingRows.rows.length && (
              <p className="empty-copy">Everything is paid up.</p>
            )}
          </div>
        </article>

        <article className="dash-card">
          <div className="dash-card-head">
            <h3>Check-in &amp; check-out</h3>
            <small className="dash-legend">
              <i className="in" /> In <i className="out" /> Out
            </small>
          </div>
          <div className="dash-grouped">
            {movement.rows.map((row) => (
              <div className="dash-group" key={row.ym}>
                <div className="dash-group-bars">
                  <div
                    className="gbar in"
                    style={{ height: `${(row.checkIn / movement.peak) * 100}%` }}
                    title={`${row.checkIn} check-in`}
                  />
                  <div
                    className="gbar out"
                    style={{ height: `${(row.checkOut / movement.peak) * 100}%` }}
                    title={`${row.checkOut} check-out`}
                  />
                </div>
                <small>{row.label}</small>
                <em>
                  {row.checkIn}/{row.checkOut}
                </em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}
