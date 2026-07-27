"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import {
  Modal,
  NATIONALITIES,
  SearchSelect,
  Stat,
  dateLabel,
  formValues,
  money,
  titleCase,
} from "./shared";
import type { Data, Row } from "./shared";

export function StudentsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [student, setStudent] = useState<Row | null>(null);
  const [modal, setModal] = useState("");
  const [hostelFilter, setHostelFilter] = useState("all");
  const [directoryTab, setDirectoryTab] = useState<
    "active" | "moved-out" | "agency"
  >("active");
  const [sortKey, setSortKey] = useState("roomCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [addAssignRoom, setAddAssignRoom] = useState(false);
  const [editSchool, setEditSchool] = useState<Row | null>(null);

  const tenantRole = data.roles.find((role) => role.roleKey === "tenant");
  const loginFor = (studentId: number | string) =>
    data.users.find((user) => String(user.studentId) === String(studentId));
  const schoolNames = data.schools.map((school) => school.name as string);
  const withCurrent = (list: string[], current?: string) =>
    current && !list.includes(current) ? [current, ...list] : list;

  const sortStudents = (key: string) => {
    if (sortKey === key)
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };
  const filtered = data.students
    .filter((student) => {
      const active =
        student.profileStatus === "active" &&
        student.assignmentStatus === "active";
      const statusMatch =
        directoryTab === "agency"
          ? Boolean(student.agency)
          : directoryTab === "active"
            ? active
            : !active;
      const hostelMatch =
        hostelFilter === "all" ||
        String(student.hostelId || "") === hostelFilter;
      const search = query.trim().toLowerCase();
      const text =
        `${student.fullName} ${student.studentCode} ${student.identityNo} ${student.roomCode} ${student.unitCode} ${student.hostelName} ${student.school} ${student.nationality} ${student.agency}`.toLowerCase();
      return statusMatch && hostelMatch && (!search || text.includes(search));
    })
    .sort((left, right) => {
      const a = String(left[sortKey] ?? "");
      const b = String(right[sortKey] ?? "");
      const result = a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });

  // Summary cards follow the selected hostel so the whole view is scoped together.
  const hostelStudents =
    hostelFilter === "all"
      ? data.students
      : data.students.filter(
          (s) => String(s.hostelId || "") === hostelFilter,
        );

  const sortHeader = (key: string, label: string) => (
    <th>
      <button className="sort-button" onClick={() => sortStudents(key)}>
        {label}{" "}
        {sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );

  const vacantBedOptions = data.bedSpaces
    .filter((bed) => bed.status === "vacant")
    .map((bed) => ({
      value: bed.id,
      label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode}`,
    }));

  return (
    <>
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">STUDENT & SUB-TENANT DIRECTORY</span>
          <h2>Complete resident information tied to the actual room code.</h2>
          <p>
            Includes individual students and sub-tenants added after a group
            reservation is confirmed.
          </p>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={() => setModal("schools")}>
            Manage schools
          </button>
          <button className="primary" onClick={() => setModal("add")}>
            + Add student
          </button>
        </div>
      </section>
      <section className="module-metrics">
        <Stat
          value={
            hostelStudents.filter((s) => s.assignmentStatus === "active").length
          }
          label="Current occupants"
        />
        <Stat
          value={
            hostelStudents.filter((s) => s.profileStatus !== "active").length
          }
          label="Moved out / inactive"
        />
        <Stat
          value={hostelStudents.filter((s) => s.agency).length}
          label="Agency-linked"
        />
        <Stat
          value={
            hostelStudents.filter((s) => !s.identityNo || !s.contactNumber)
              .length
          }
          label="Profiles to complete"
        />
      </section>
      <section className="panel">
        <div className="workspace-tabs">
          <button
            className={directoryTab === "active" ? "active" : ""}
            onClick={() => setDirectoryTab("active")}
          >
            Active students
          </button>
          <button
            className={directoryTab === "moved-out" ? "active" : ""}
            onClick={() => setDirectoryTab("moved-out")}
          >
            Moved-out / inactive
          </button>
          <button
            className={directoryTab === "agency" ? "active" : ""}
            onClick={() => setDirectoryTab("agency")}
          >
            Agency-linked
          </button>
        </div>
        <div className="filters">
          <label className="search">
            <span>Search students</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, IC/passport, room, school or country"
            />
          </label>
          <label>
            Hostel
            <select
              value={hostelFilter}
              onChange={(event) => setHostelFilter(event.target.value)}
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
              setQuery("");
              setHostelFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {sortHeader("fullName", "Name")}
                {sortHeader("roomCode", "Room")}
                {sortHeader("contactNumber", "Contact")}
                {sortHeader("school", "School / course")}
                {sortHeader("monthlyRental", "Rental")}
                {sortHeader("leaseEndDate", "Lease end")}
                {sortHeader("salesperson", "Sales / agency")}
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 250).map((s) => (
                <tr key={`${s.id}-${s.assignmentId || 0}`}>
                  <td>
                    <strong>{s.fullName}</strong>
                    <small>{s.identityNo || "IC / passport not set"}</small>
                  </td>
                  <td>
                    {s.roomCode ? (
                      <>
                        <code>{s.roomCode}</code>
                        <small>
                          {s.hostelName} / {s.unitCode}
                        </small>
                      </>
                    ) : (
                      <span className="muted">Not assigned</span>
                    )}
                  </td>
                  <td>
                    {s.contactNumber || "-"}
                    <small>{s.email || "Email not set"}</small>
                  </td>
                  <td>
                    {s.school || "-"}
                    <small>
                      {s.course || "Course not set"} ·{" "}
                      {s.nationality || "Nationality not set"}
                    </small>
                  </td>
                  <td>{money(s.monthlyRental)}</td>
                  <td>
                    <strong className="lease-end">
                      {dateLabel(s.leaseEndDate)}
                    </strong>
                    <small>Starts {dateLabel(s.leaseStartDate)}</small>
                  </td>
                  <td>
                    {s.salesperson || "-"}
                    <small>{s.agency || "Direct"}</small>
                  </td>
                  <td>
                    <span
                      className={`unit-status ${s.assignmentStatus || s.profileStatus}`}
                    >
                      {titleCase(s.assignmentStatus || s.profileStatus)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => setStudent(s)}
                    >
                      Open profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {student && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setStudent(null)}
        >
          <aside className="unit-drawer student-drawer">
            <div className="drawer-head">
              <div>
                <small>{student.studentCode || "STUDENT PROFILE"}</small>
                <h2>{student.fullName}</h2>
                <p>
                  {student.roomCode
                    ? `${student.hostelName} / ${student.roomCode}`
                    : "Room not assigned"}
                </p>
              </div>
              <button onClick={() => setStudent(null)}>×</button>
            </div>
            <form
              className="drawer-section"
              onSubmit={(e) => {
                e.preventDefault();
                save(
                  {
                    action: "student-update",
                    studentId: student.id,
                    assignmentId: student.assignmentId,
                    ...formValues(e),
                  },
                  "Student profile updated",
                );
              }}
            >
              <div className="section-title">
                <div>
                  <small>PERSONAL & TENANCY</small>
                  <h3>Complete student information</h3>
                </div>
                <button className="primary compact" disabled={busy}>
                  Save profile
                </button>
              </div>

              <div className="drawer-subsection">
                <h4>Student information</h4>
                <div className="form-grid">
                  <label>
                    Full name
                    <input name="fullName" defaultValue={student.fullName} />
                  </label>
                  <label>
                    Student code
                    <input
                      name="studentCode"
                      defaultValue={student.studentCode}
                    />
                  </label>
                  <label>
                    IC / passport
                    <input
                      name="identityNo"
                      defaultValue={student.identityNo}
                    />
                  </label>
                  <label>
                    Date of birth
                    <input
                      name="dateOfBirth"
                      type="date"
                      defaultValue={student.dateOfBirth || ""}
                    />
                  </label>
                  <label>
                    Gender
                    <select name="gender" defaultValue={student.gender}>
                      <option value="unspecified">Not set</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </label>
                  <label>
                    Nationality
                    <select
                      name="nationality"
                      defaultValue={student.nationality || ""}
                    >
                      <option value="">Not set</option>
                      {withCurrent(NATIONALITIES, student.nationality).map(
                        (n) => (
                          <option key={n}>{n}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Hometown
                    <input name="hometown" defaultValue={student.hometown} />
                  </label>
                  <label>
                    Race
                    <input name="race" defaultValue={student.race} />
                  </label>
                  <label>
                    Religion
                    <input name="religion" defaultValue={student.religion} />
                  </label>
                </div>
              </div>

              <div className="drawer-subsection">
                <h4>Contacts</h4>
                <div className="form-grid">
                  <label>
                    Contact number
                    <input
                      name="contactNumber"
                      defaultValue={student.contactNumber}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      defaultValue={student.email}
                    />
                  </label>
                </div>
              </div>

              <div className="drawer-subsection">
                <div className="subsection-head">
                  <h4>Room details</h4>
                  {student.assignmentId && (
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setModal("moveout")}
                    >
                      Move out / deactivate
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
                  <div className="form-grid">
                    <label>
                      Room code
                      <input value={student.roomCode || ""} readOnly />
                    </label>
                    <label>
                      Monthly rental
                      <input
                        name="monthlyRental"
                        type="number"
                        defaultValue={student.monthlyRental ?? ""}
                      />
                    </label>
                    <label>
                      Security deposit
                      <input
                        name="securityDeposit"
                        type="number"
                        defaultValue={student.securityDeposit ?? ""}
                      />
                    </label>
                    <label>
                      Access card deposit
                      <input
                        name="accessCardDeposit"
                        type="number"
                        defaultValue={student.accessCardDeposit ?? ""}
                      />
                    </label>
                    <label>
                      Parking deposit
                      <input
                        name="parkingDeposit"
                        type="number"
                        defaultValue={student.parkingDeposit ?? ""}
                      />
                    </label>
                    <label>
                      Check-in
                      <input
                        name="checkInDate"
                        type="date"
                        defaultValue={student.checkInDate || ""}
                      />
                    </label>
                    <label>
                      Check-out
                      <input
                        name="checkOutDate"
                        type="date"
                        defaultValue={student.checkOutDate || ""}
                      />
                    </label>
                    <label>
                      Lease start
                      <input
                        name="leaseStartDate"
                        type="date"
                        defaultValue={student.leaseStartDate || ""}
                      />
                    </label>
                    <label>
                      Lease end
                      <input
                        name="leaseEndDate"
                        type="date"
                        defaultValue={student.leaseEndDate || ""}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No active room assignment. Use &ldquo;Add student&rdquo; with
                    a room, or convert a reservation, to assign a room.
                  </p>
                )}
              </div>

              <div className="drawer-subsection">
                <div className="subsection-head">
                  <h4>Academic information</h4>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => setModal("schools")}
                  >
                    Manage schools
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    School
                    <select name="school" defaultValue={student.school || ""}>
                      <option value="">Not set</option>
                      {withCurrent(schoolNames, student.school).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                  </label>
                  <label>
                    Course enrolled
                    <input name="course" defaultValue={student.course} />
                  </label>
                  <label>
                    Application form no.
                    <input
                      name="applicationFormNo"
                      defaultValue={student.applicationFormNo}
                    />
                  </label>
                </div>
              </div>

              <div className="drawer-subsection">
                <h4>Other information</h4>
                <div className="form-grid">
                  <label>
                    Sales person
                    <input
                      name="salesperson"
                      defaultValue={student.salesperson}
                    />
                  </label>
                  <label>
                    Agency
                    <input name="agency" defaultValue={student.agency} />
                  </label>
                  <label>
                    Receipt serial no.
                    <input name="receiptNo" defaultValue={student.receiptNo} />
                  </label>
                  <label>
                    Status
                    <select
                      name="profileStatus"
                      defaultValue={student.profileStatus}
                    >
                      <option value="active">Active</option>
                      <option value="moved-out">Moved out</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="wide">
                    Remarks
                    <input name="remarks" defaultValue={student.remarks} />
                  </label>
                </div>
              </div>
            </form>

            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>LOGIN ACCESS</small>
                  <h3>Tenant login credentials</h3>
                </div>
              </div>
              {loginFor(student.id) ? (
                <div className="compact-list">
                  <span>
                    <b>{loginFor(student.id)?.email}</b>
                    <small>
                      Tenant login active ·{" "}
                      {loginFor(student.id)?.lastLoginAt
                        ? `Last login ${dateLabel(loginFor(student.id)?.lastLoginAt)}`
                        : "Never signed in"}
                    </small>
                  </span>
                </div>
              ) : (
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!tenantRole) return;
                    await save(
                      {
                        action: "user-save",
                        roleId: tenantRole.id,
                        studentId: student.id,
                        displayName: student.fullName,
                        ...formValues(e),
                      },
                      "Tenant login enabled",
                    );
                  }}
                >
                  <label className="wide">
                    Login email
                    <input
                      name="email"
                      type="email"
                      required
                      defaultValue={student.email || ""}
                      placeholder="student@email.com"
                    />
                  </label>
                  <div className="form-actions wide">
                    <button
                      className="secondary compact"
                      disabled={busy || !tenantRole}
                    >
                      Enable tenant login
                    </button>
                  </div>
                  <p className="empty-copy wide">
                    The student signs in with this email through the platform. No
                    password is stored in this system.
                  </p>
                </form>
              )}
            </section>

            <section className="drawer-section">
              <div className="section-title">
                <div>
                  <small>BILLING INFORMATION</small>
                  <h3>Current outstanding and payment breakdown</h3>
                </div>
              </div>
              <div className="compact-list">
                {data.invoices
                  .filter((invoice) => invoice.studentId === student.id)
                  .slice(0, 12)
                  .map((invoice) => (
                    <span key={invoice.id}>
                      <code>{invoice.invoiceNo}</code>
                      <b>
                        {invoice.items
                          .map((item: Row) => item.description)
                          .join(", ") || "No items"}
                      </b>
                      <small>
                        {money(
                          Number(invoice.totalAmount) -
                            Number(invoice.amountPaid),
                          true,
                        )}{" "}
                        outstanding
                      </small>
                    </span>
                  ))}
                {!data.invoices.some(
                  (invoice) => invoice.studentId === student.id,
                ) && (
                  <p className="empty-copy">
                    No billing records for this student yet.
                  </p>
                )}
              </div>
            </section>
            {student.assignmentId && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>RATE & ROOM HISTORY</small>
                    <h3>Effective-dated changes</h3>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary compact"
                      onClick={() => setModal("rate")}
                    >
                      + Rate change
                    </button>
                    <button
                      className="secondary compact"
                      onClick={() => setModal("move")}
                    >
                      Change room
                    </button>
                  </div>
                </div>
                <div className="compact-list">
                  {data.studentRateChanges
                    .filter((r) => r.assignmentId === student.assignmentId)
                    .map((r) => (
                      <span key={r.id}>
                        <b>Effective {dateLabel(r.effectiveDate)}</b>
                        <small>
                          Rental {money(r.monthlyRental)} · Deposit{" "}
                          {money(r.securityDeposit)} · {r.reason}
                        </small>
                      </span>
                    ))}
                  {!data.studentRateChanges.some(
                    (r) => r.assignmentId === student.assignmentId,
                  ) && <p className="empty-copy">No scheduled rate changes.</p>}
                </div>
              </section>
            )}
          </aside>
        </div>
      )}

      {modal === "add" && (
        <Modal
          title="Add new student"
          kicker="NEW RESIDENT PROFILE"
          onClose={() => setModal("")}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "student-create", ...formValues(e) },
                "Student added",
              );
              if (ok) {
                setModal("");
                setAddAssignRoom(false);
              }
            }}
          >
            <div className="drawer-subsection wide">
              <h4>Student information</h4>
              <div className="form-grid">
                <label>
                  Full name
                  <input name="fullName" required />
                </label>
                <label>
                  Student code
                  <input name="studentCode" />
                </label>
                <label>
                  IC / passport
                  <input name="identityNo" />
                </label>
                <label>
                  Date of birth
                  <input name="dateOfBirth" type="date" />
                </label>
                <label>
                  Gender
                  <select name="gender" defaultValue="unspecified">
                    <option value="unspecified">Not set</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label>
                  Nationality
                  <select name="nationality" defaultValue="">
                    <option value="">Not set</option>
                    {NATIONALITIES.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Hometown
                  <input name="hometown" />
                </label>
                <label>
                  Race
                  <input name="race" />
                </label>
                <label>
                  Religion
                  <input name="religion" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Contacts</h4>
              <div className="form-grid">
                <label>
                  Contact number
                  <input name="contactNumber" />
                </label>
                <label>
                  Email
                  <input name="email" type="email" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Academic information</h4>
              <div className="form-grid">
                <label>
                  School
                  <select name="school" defaultValue="">
                    <option value="">Not set</option>
                    {schoolNames.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label>
                  Course enrolled
                  <input name="course" />
                </label>
                <label>
                  Application form no.
                  <input name="applicationFormNo" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Other information</h4>
              <div className="form-grid">
                <label>
                  Sales person
                  <input name="salesperson" />
                </label>
                <label>
                  Agency
                  <input name="agency" />
                </label>
                <label>
                  Receipt serial no.
                  <input name="receiptNo" />
                </label>
                <label className="wide">
                  Remarks
                  <input name="remarks" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <div className="subsection-head">
                <h4>Room details</h4>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={addAssignRoom}
                    onChange={(e) => setAddAssignRoom(e.target.checked)}
                  />
                  Assign a room now
                </label>
              </div>
              {addAssignRoom && (
                <div className="form-grid">
                  <label className="wide">
                    Room code
                    <SearchSelect
                      name="bedSpaceId"
                      required
                      options={vacantBedOptions}
                      placeholder="Type room code, unit or hostel"
                    />
                  </label>
                  <label>
                    Monthly rental
                    <input name="monthlyRental" type="number" min="0" />
                  </label>
                  <label>
                    Security deposit
                    <input name="securityDeposit" type="number" min="0" />
                  </label>
                  <label>
                    Access card deposit
                    <input name="accessCardDeposit" type="number" min="0" />
                  </label>
                  <label>
                    Parking deposit
                    <input name="parkingDeposit" type="number" min="0" />
                  </label>
                  <label>
                    Check-in
                    <input name="checkInDate" type="date" />
                  </label>
                  <label>
                    Lease start
                    <input name="leaseStartDate" type="date" />
                  </label>
                  <label>
                    Lease end
                    <input name="leaseEndDate" type="date" />
                  </label>
                </div>
              )}
            </div>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Create student
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "moveout" && student && (
        <Modal
          title="Move out / deactivate"
          kicker={student.fullName}
          description="Ends the room assignment, frees the bed space, releases any active parking, and marks the profile as moved out."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-move-out",
                  studentId: student.id,
                  assignmentId: student.assignmentId,
                  ...formValues(e),
                },
                "Student moved out",
              );
              if (ok) {
                setModal("");
                setStudent(null);
              }
            }}
          >
            <label>
              Check-out date
              <input name="checkOutDate" type="date" required />
            </label>
            <label>
              Check-out meter
              <input name="checkOutMeter" type="number" step="0.01" />
            </label>
            <label>
              Set profile status
              <select name="profileStatus" defaultValue="moved-out">
                <option value="moved-out">Moved out</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Confirm move out
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "schools" && (
        <Modal
          title="Manage schools"
          kicker="ACADEMIC LIST"
          onClose={() => {
            setModal("");
            setEditSchool(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                editSchool
                  ? {
                      action: "school-update",
                      schoolId: editSchool.id,
                      ...formValues(e),
                    }
                  : { action: "school-create", ...formValues(e) },
                editSchool ? "School updated" : "School added",
              );
              if (ok) {
                setEditSchool(null);
                (e.target as HTMLFormElement).reset();
              }
            }}
          >
            <label className="wide">
              {editSchool ? "Rename school" : "New school name"}
              <input
                name="name"
                required
                key={editSchool?.id || "new"}
                defaultValue={editSchool?.name || ""}
              />
            </label>
            <div className="form-actions wide">
              {editSchool && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setEditSchool(null)}
                >
                  Cancel edit
                </button>
              )}
              <button className="primary compact" disabled={busy}>
                {editSchool ? "Save school" : "Add school"}
              </button>
            </div>
          </form>
          <div className="compact-list">
            {data.schools.map((school) => (
              <span key={school.id}>
                <b>{school.name}</b>
                <div className="button-row">
                  <button
                    className="secondary compact"
                    onClick={() => setEditSchool(school)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      save(
                        { action: "school-delete", schoolId: school.id },
                        "School removed",
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </span>
            ))}
            {data.schools.length === 0 && (
              <p className="empty-copy">No schools yet. Add one above.</p>
            )}
          </div>
        </Modal>
      )}

      {modal === "rate" && student && (
        <Modal
          title="Effective-dated rate change"
          kicker={student.fullName}
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-rate-change",
                  assignmentId: student.assignmentId,
                  ...formValues(e),
                },
                "Rate change scheduled",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Effective date
              <input name="effectiveDate" type="date" required />
            </label>
            <label>
              Monthly rental
              <input name="monthlyRental" type="number" min="0" />
            </label>
            <label>
              Security deposit
              <input name="securityDeposit" type="number" min="0" />
            </label>
            <label className="wide">
              Reason
              <input
                name="reason"
                placeholder="Short-term renewal, promotion ended..."
              />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Schedule change
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "move" && student && (
        <Modal
          title="Manual room change"
          kicker={student.fullName}
          description="The old room becomes vacant and the selected room becomes occupied from the effective date."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "student-room-change",
                  studentId: student.id,
                  assignmentId: student.assignmentId,
                  salesperson: student.salesperson,
                  ...formValues(e),
                },
                "Student moved to new room",
              );
              if (ok) {
                setModal("");
                setStudent(null);
              }
            }}
          >
            <label className="wide">
              New room code
              <SearchSelect
                name="bedSpaceId"
                required
                options={vacantBedOptions}
                placeholder="Type room code, unit or hostel"
              />
            </label>
            <label>
              Effective date
              <input name="effectiveDate" type="date" required />
            </label>
            <label>
              New monthly rental
              <input name="monthlyRental" type="number" min="0" />
            </label>
            <label>
              New security deposit
              <input name="securityDeposit" type="number" min="0" />
            </label>
            <label>
              Access card deposit
              <input name="accessCardDeposit" type="number" min="0" />
            </label>
            <label>
              Old room check-out meter
              <input name="checkOutMeter" type="number" step="0.01" />
            </label>
            <label>
              New room check-in meter
              <input name="checkInMeter" type="number" step="0.01" />
            </label>
            <label>
              New lease end
              <input name="leaseEndDate" type="date" />
            </label>
            <label className="wide">
              Reason / remarks
              <input name="reason" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Confirm room change
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
