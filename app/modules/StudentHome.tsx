"use client";

import { effectiveRateOn, money, dateLabel } from "./shared";
import type { Data } from "./shared";

export function StudentHomeModule({ data }: { data: Data }) {
  const student = data.students[0];
  if (!student) {
    return (
      <section className="portal-card">
        <span className="section-kicker">MY ROOM</span>
        <h1>Not linked to a room yet</h1>
        <p>
          Your account isn&rsquo;t linked to a room yet — contact the hostel
          office.
        </p>
      </section>
    );
  }
  const rate = effectiveRateOn(data.studentRateChanges, student.assignmentId, student);
  const outstanding = data.invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce(
      (sum, invoice) =>
        sum + Number(invoice.totalAmount || 0) - Number(invoice.amountPaid || 0),
      0,
    );
  const openTickets = data.tickets.filter(
    (ticket) => !["completed", "closed"].includes(ticket.status),
  ).length;

  return (
    <div className="portal-stack">
      <section className="portal-card">
        <span className="section-kicker">MY ROOM</span>
        <h1>Hello, {student.fullName}</h1>
        <p>
          {student.roomCode ? `Room ${student.roomCode}` : "No room assigned"}
          {student.hostelName ? ` · ${student.hostelName}` : ""}
        </p>
      </section>

      <section className="portal-card">
        <span className="section-kicker">CURRENT STAY</span>
        <div className="portal-fact-grid">
          <div>
            <small>Room</small>
            <strong>{student.roomCode || "-"}</strong>
          </div>
          <div>
            <small>Since</small>
            <strong>{dateLabel(student.checkInDate)}</strong>
          </div>
          <div>
            <small>Monthly rent</small>
            <strong>{money(rate.monthlyRental, true)}</strong>
          </div>
          <div>
            <small>Deposit held</small>
            <strong>{money(rate.securityDeposit, true)}</strong>
          </div>
        </div>
      </section>

      {data.roommates.length > 0 && (
        <section className="portal-card">
          <span className="section-kicker">ROOMMATES</span>
          <ul className="portal-roommate-list">
            {data.roommates.map((roommate) => (
              <li key={roommate.studentId}>{roommate.fullName}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="portal-card portal-glance">
        <a href="/student/billing" className="portal-glance-tile">
          <strong>{money(outstanding, true)}</strong>
          <small>Outstanding balance</small>
        </a>
        <a href="/student/maintenance" className="portal-glance-tile">
          <strong>{openTickets}</strong>
          <small>Open ticket{openTickets === 1 ? "" : "s"}</small>
        </a>
      </section>
    </div>
  );
}
