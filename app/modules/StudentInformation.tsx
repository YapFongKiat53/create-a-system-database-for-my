"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
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

type DirectoryTab = "active" | "moved-out" | "agency";
type CompletionFilter = "all" | "complete" | "incomplete";
type SelectedStudentRef = {
  studentId: string | number;
  assignmentId?: string | number | null;
};

const UNASSIGNED_HOSTEL_KEY = "__unassigned__";
const PAGE_SIZE = 20;

function normaliseStatus(value: unknown, fallback = "") {
  const status = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return status || fallback;
}

function isCurrentOccupant(student: Row) {
  return (
    normaliseStatus(student.profileStatus, "active") === "active" &&
    normaliseStatus(student.assignmentStatus) === "active"
  );
}

function isMovedOutOrInactive(student: Row) {
  const inactiveStatuses = new Set([
    "moved-out",
    "inactive",
    "ended",
    "terminated",
  ]);

  return (
    inactiveStatuses.has(normaliseStatus(student.profileStatus)) ||
    inactiveStatuses.has(normaliseStatus(student.assignmentStatus))
  );
}

function isActiveProfile(student: Row) {
  return (
    normaliseStatus(student.profileStatus, "active") === "active" &&
    !isMovedOutOrInactive(student)
  );
}

function isAgencyLinked(student: Row) {
  return Boolean(String(student.agency || "").trim());
}

function isProfileIncomplete(student: Row) {
  return (
    !String(student.identityNo || "").trim() ||
    !String(student.contactNumber || "").trim() ||
    !String(student.email || "").trim() ||
    !String(student.nationality || "").trim()
  );
}

function hostelInitials(name: unknown) {
  const text = String(name || "Hostel").trim();
  const number = text.match(/\d/);
  const firstLetter = text.match(/[A-Za-z]/)?.[0]?.toUpperCase() || "H";

  if (number) return `${firstLetter}${number[0]}`;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
}

function hostelAddress(hostel: Row | null) {
  if (!hostel) return "Profiles not yet tied to a hostel or room.";
  return (
    hostel.address ||
    hostel.propertyAddress ||
    hostel.fullAddress ||
    "Property address not set"
  );
}

function studentMatchesHostel(student: Row, hostel: Row) {
  const studentHostelId = String(student.hostelId ?? "").trim();
  if (studentHostelId) return studentHostelId === String(hostel.id);

  const studentHostelName = String(student.hostelName || "")
    .trim()
    .toLowerCase();
  const hostelName = String(hostel.name || "").trim().toLowerCase();

  return Boolean(studentHostelName && studentHostelName === hostelName);
}

function isUnassignedStudent(student: Row, hostels: Row[]) {
  return !hostels.some((hostel) => studentMatchesHostel(student, hostel));
}

function paginationItems(currentPage: number, totalPages: number) {
  const pages: Array<number | "ellipsis"> = [];

  if (totalPages <= 7) {
    for (let page = 1; page <= totalPages; page += 1) pages.push(page);
    return pages;
  }

  pages.push(1);

  if (currentPage > 4) pages.push("ellipsis");

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);
  for (let page = start; page <= end; page += 1) pages.push(page);

  if (currentPage < totalPages - 3) pages.push("ellipsis");

  pages.push(totalPages);
  return pages;
}

export function StudentsModule({
  data,
  save,
  busy,
}: {
  data: Data;
  save: any;
  busy: boolean;
}) {
  const [selectedHostelKey, setSelectedHostelKey] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");
  const [selectedStudentRef, setSelectedStudentRef] =
    useState<SelectedStudentRef | null>(null);
  const [modal, setModal] = useState("");
  const [directoryTab, setDirectoryTab] =
    useState<DirectoryTab>("active");
  const [sortKey, setSortKey] = useState("roomCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [addAssignRoom, setAddAssignRoom] = useState(false);
  const [editSchool, setEditSchool] = useState<Row | null>(null);

  const tenantRole = data.roles.find((role) => role.roleKey === "tenant");
  const loginFor = (studentId: number | string) =>
    data.users.find((user) => String(user.studentId) === String(studentId));
  const schoolNames = data.schools.map((school) => school.name as string);
  const withCurrent = (list: string[], current?: string) =>
    current && !list.includes(current) ? [current, ...list] : list;

  const student = useMemo(() => {
    if (!selectedStudentRef) return null;

    const assignmentId = selectedStudentRef.assignmentId ?? "";
    const exact = data.students.find(
      (item) =>
        String(item.id) === String(selectedStudentRef.studentId) &&
        String(item.assignmentId ?? "") === String(assignmentId),
    );

    return (
      exact ||
      data.students.find(
        (item) => String(item.id) === String(selectedStudentRef.studentId),
      ) ||
      null
    );
  }, [data.students, selectedStudentRef]);

  const hostelDirectory = useMemo(() => {
    const rows: Array<{
      key: string;
      hostel: Row | null;
      students: Row[];
    }> = data.hostels.map((hostel) => ({
      key: String(hostel.id),
      hostel,
      students: data.students.filter((item) =>
        studentMatchesHostel(item, hostel),
      ),
    }));

    const unassignedStudents = data.students.filter((item) =>
      isUnassignedStudent(item, data.hostels),
    );

    if (unassignedStudents.length) {
      rows.push({
        key: UNASSIGNED_HOSTEL_KEY,
        hostel: null,
        students: unassignedStudents,
      });
    }

    return rows;
  }, [data.hostels, data.students]);

  const selectedHostel = useMemo(() => {
    if (!selectedHostelKey || selectedHostelKey === UNASSIGNED_HOSTEL_KEY)
      return null;

    return (
      data.hostels.find(
        (hostel) => String(hostel.id) === String(selectedHostelKey),
      ) || null
    );
  }, [data.hostels, selectedHostelKey]);

  const selectedHostelStudents = useMemo(() => {
    if (!selectedHostelKey) return [];

    if (selectedHostelKey === UNASSIGNED_HOSTEL_KEY) {
      return data.students.filter((item) =>
        isUnassignedStudent(item, data.hostels),
      );
    }

    if (!selectedHostel) return [];
    return data.students.filter((item) =>
      studentMatchesHostel(item, selectedHostel),
    );
  }, [data.hostels, data.students, selectedHostel, selectedHostelKey]);

  const scopeStudents = selectedHostelKey
    ? selectedHostelStudents
    : data.students;

  const unitOptions = useMemo(
    () =>
      [...new Set(
        selectedHostelStudents
          .map((item) => String(item.unitCode || "").trim())
          .filter(Boolean),
      )].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [selectedHostelStudents],
  );

  const scopedSchoolOptions = useMemo(
    () =>
      [...new Set(
        selectedHostelStudents
          .map((item) => String(item.school || "").trim())
          .filter(Boolean),
      )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [selectedHostelStudents],
  );

  const filteredStudents = useMemo(() => {
    const search = query.trim().toLowerCase();

    return selectedHostelStudents
      .filter((item) => {
        const tabMatch =
          directoryTab === "agency"
            ? isAgencyLinked(item)
            : directoryTab === "active"
              ? isActiveProfile(item)
              : isMovedOutOrInactive(item);

        const unitMatch =
          unitFilter === "all" || String(item.unitCode || "") === unitFilter;
        const schoolMatch =
          schoolFilter === "all" || String(item.school || "") === schoolFilter;
        const completionMatch =
          completionFilter === "all" ||
          (completionFilter === "incomplete"
            ? isProfileIncomplete(item)
            : !isProfileIncomplete(item));
        const text = `${item.fullName || ""} ${item.studentCode || ""} ${
          item.identityNo || ""
        } ${item.roomCode || ""} ${item.unitCode || ""} ${
          item.hostelName || ""
        } ${item.school || ""} ${item.course || ""} ${
          item.nationality || ""
        } ${item.agency || ""}`.toLowerCase();

        return (
          tabMatch &&
          unitMatch &&
          schoolMatch &&
          completionMatch &&
          (!search || text.includes(search))
        );
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
  }, [
    completionFilter,
    directoryTab,
    query,
    schoolFilter,
    selectedHostelStudents,
    sortDirection,
    sortKey,
    unitFilter,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredStudents.length / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const paginatedStudents = filteredStudents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const rangeStart = filteredStudents.length
    ? (currentPage - 1) * PAGE_SIZE + 1
    : 0;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredStudents.length);

  const allVacantBedOptions = useMemo(
    () =>
      data.bedSpaces
        .filter((bed) => bed.status === "vacant")
        .map((bed) => ({
          value: bed.id,
          label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode}`,
        })),
    [data.bedSpaces],
  );

  const addStudentBedOptions = useMemo(() => {
    if (!selectedHostel) return allVacantBedOptions;

    return data.bedSpaces
      .filter(
        (bed) =>
          bed.status === "vacant" &&
          (String(bed.hostelId || "") === String(selectedHostel.id) ||
            (!bed.hostelId &&
              String(bed.hostelName || "").toLowerCase() ===
                String(selectedHostel.name || "").toLowerCase())),
      )
      .map((bed) => ({
        value: bed.id,
        label: `${bed.legacyCode} · ${bed.hostelName}/${bed.unitCode}`,
      }));
  }, [allVacantBedOptions, data.bedSpaces, selectedHostel]);

  const resetDirectoryFilters = (resetTab = false) => {
    setQuery("");
    setUnitFilter("all");
    setSchoolFilter("all");
    setCompletionFilter("all");
    setPage(1);
    if (resetTab) setDirectoryTab("active");
  };

  const selectHostel = (key: string) => {
    setSelectedHostelKey(key);
    resetDirectoryFilters(true);
  };

  const backToHostels = () => {
    setSelectedHostelKey(null);
    resetDirectoryFilters(true);
  };

  const closeAddStudentModal = () => {
    setModal("");
    setAddAssignRoom(false);
  };

  const sortStudents = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc",
      );
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const sortHeader = (key: string, label: string) => (
    <th>
      <button
        type="button"
        className="sort-button"
        onClick={() => sortStudents(key)}
      >
        {label}{" "}
        {sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );

  const selectedHostelName =
    selectedHostelKey === UNASSIGNED_HOSTEL_KEY
      ? "Unassigned profiles"
      : selectedHostel?.name || "Student directory";

  return (
    <>
      <div className="student-hostel-page">
        <section className="intro compact-intro student-directory-intro">
          <div>
            <span className="section-kicker">
              STUDENT &amp; SUB-TENANT DIRECTORY
            </span>
            <h2>
              {selectedHostelKey
                ? `${selectedHostelName} resident information.`
                : "Choose a hostel before viewing resident profiles."}
            </h2>
            <p>
              {selectedHostelKey
                ? "Search, filter and manage students under the selected hostel."
                : "Each hostel opens into its own student directory, filters and room-linked records."}
            </p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setModal("schools")}
            >
              Manage schools
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setModal("add")}
            >
              + Add student
            </button>
          </div>
        </section>

        <section className="module-metrics student-directory-metrics">
          <Stat
            value={scopeStudents.filter(isCurrentOccupant).length}
            label="Current occupants"
          />
          <Stat
            value={scopeStudents.filter(isMovedOutOrInactive).length}
            label="Moved out / inactive"
          />
          <Stat
            value={scopeStudents.filter(isAgencyLinked).length}
            label="Agency-linked"
          />
          <Stat
            value={scopeStudents.filter(isProfileIncomplete).length}
            label="Profiles to complete"
          />
        </section>

        {!selectedHostelKey ? (
          <section className="panel student-hostel-directory-panel">
            <div className="student-hostel-list-header">
              <span>Property</span>
              <span>Current</span>
              <span>Moved out</span>
              <span>Agency</span>
              <span>Incomplete</span>
              <span>Action</span>
            </div>

            <div className="student-hostel-list">
              {hostelDirectory.map(({ key, hostel, students }) => {
                const name = hostel?.name || "Unassigned profiles";
                const currentCount = students.filter(isCurrentOccupant).length;
                const movedCount = students.filter(isMovedOutOrInactive).length;
                const agencyCount = students.filter(isAgencyLinked).length;
                const incompleteCount = students.filter(
                  isProfileIncomplete,
                ).length;

                return (
                  <article className="student-hostel-row" key={key}>
                    <div className="student-hostel-property">
                      <span className="student-hostel-avatar">
                        {hostel ? hostelInitials(hostel.name) : "--"}
                      </span>
                      <div>
                        <strong>{name}</strong>
                        <p>{hostelAddress(hostel)}</p>
                        <small>
                          {students.length} student profile
                          {students.length === 1 ? "" : "s"}
                        </small>
                      </div>
                    </div>

                    <div className="student-hostel-stat">
                      <strong>{currentCount}</strong>
                      <small>occupants</small>
                    </div>
                    <div className="student-hostel-stat">
                      <strong>{movedCount}</strong>
                      <small>inactive</small>
                    </div>
                    <div className="student-hostel-stat">
                      <strong>{agencyCount}</strong>
                      <small>linked</small>
                    </div>
                    <div className="student-hostel-stat">
                      <strong>{incompleteCount}</strong>
                      <small>to complete</small>
                    </div>

                    <div className="student-hostel-action">
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => selectHostel(key)}
                      >
                        View students
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <>
            <section className="student-selected-hostel">
              <button
                type="button"
                className="student-back-button"
                onClick={backToHostels}
              >
                ← All hostels
              </button>

              <div className="student-selected-hostel-card">
                <span className="student-hostel-avatar large">
                  {selectedHostel
                    ? hostelInitials(selectedHostel.name)
                    : "--"}
                </span>
                <div className="student-selected-hostel-copy">
                  <small>SELECTED HOSTEL</small>
                  <h3>{selectedHostelName}</h3>
                  <p>{hostelAddress(selectedHostel)}</p>
                </div>
                <div className="student-selected-hostel-total">
                  <small>Total profiles</small>
                  <strong>{selectedHostelStudents.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel student-filter-panel">
              <div className="workspace-tabs">
                <button
                  type="button"
                  className={directoryTab === "active" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("active");
                    setPage(1);
                  }}
                >
                  Active students
                </button>
                <button
                  type="button"
                  className={directoryTab === "moved-out" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("moved-out");
                    setPage(1);
                  }}
                >
                  Moved-out / inactive
                </button>
                <button
                  type="button"
                  className={directoryTab === "agency" ? "active" : ""}
                  onClick={() => {
                    setDirectoryTab("agency");
                    setPage(1);
                  }}
                >
                  Agency-linked
                </button>
              </div>

              <div className="student-second-level-filters">
                <label className="search student-search-field">
                  <span>Search students</span>
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Name, IC/passport, room, school or country"
                  />
                </label>

                <label>
                  Unit
                  <select
                    value={unitFilter}
                    onChange={(event) => {
                      setUnitFilter(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">All units</option>
                    {unitOptions.map((unitCode) => (
                      <option key={unitCode} value={unitCode}>
                        {unitCode}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  School
                  <select
                    value={schoolFilter}
                    onChange={(event) => {
                      setSchoolFilter(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">All schools</option>
                    {scopedSchoolOptions.map((school) => (
                      <option key={school} value={school}>
                        {school}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Profile details
                  <select
                    value={completionFilter}
                    onChange={(event) => {
                      setCompletionFilter(
                        event.target.value as CompletionFilter,
                      );
                      setPage(1);
                    }}
                  >
                    <option value="all">All profiles</option>
                    <option value="complete">Complete profiles</option>
                    <option value="incomplete">Needs completion</option>
                  </select>
                </label>

                <button
                  type="button"
                  className="secondary reset-button student-reset-button"
                  onClick={() => resetDirectoryFilters(false)}
                >
                  Reset filters
                </button>
              </div>
            </section>

            <section className="panel student-results-panel">
              <div className="student-results-heading">
                <div>
                  <small>STUDENT INFORMATION</small>
                  <h3>
                    {filteredStudents.length} matching student
                    {filteredStudents.length === 1 ? "" : "s"}
                  </h3>
                </div>
                <span>
                  {selectedHostelName} · {titleCase(directoryTab)}
                </span>
              </div>

              <div className="table-wrap student-table-wrap">
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
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedStudents.length ? (
                      paginatedStudents.map((item) => (
                        <tr key={`${item.id}-${item.assignmentId || 0}`}>
                          <td>
                            <strong>{item.fullName}</strong>
                            <small>
                              {item.identityNo || "IC / passport not set"}
                            </small>
                          </td>
                          <td>
                            {item.roomCode ? (
                              <>
                                <code>{item.roomCode}</code>
                                <small>
                                  {item.hostelName} / {item.unitCode}
                                </small>
                              </>
                            ) : (
                              <span className="muted">Not assigned</span>
                            )}
                          </td>
                          <td>
                            {item.contactNumber || "-"}
                            <small>{item.email || "Email not set"}</small>
                          </td>
                          <td>
                            {item.school || "-"}
                            <small>
                              {item.course || "Course not set"} ·{" "}
                              {item.nationality || "Nationality not set"}
                            </small>
                          </td>
                          <td>{money(item.monthlyRental)}</td>
                          <td>
                            <strong className="lease-end">
                              {dateLabel(item.leaseEndDate)}
                            </strong>
                            <small>
                              Starts {dateLabel(item.leaseStartDate)}
                            </small>
                          </td>
                          <td>
                            {item.salesperson || "-"}
                            <small>{item.agency || "Direct"}</small>
                          </td>
                          <td>
                            <span
                              className={`unit-status ${
                                item.assignmentStatus || item.profileStatus
                              }`}
                            >
                              {titleCase(
                                item.assignmentStatus || item.profileStatus,
                              )}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="secondary compact"
                              onClick={() =>
                                setSelectedStudentRef({
                                  studentId: item.id,
                                  assignmentId: item.assignmentId,
                                })
                              }
                            >
                              Open profile
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>
                          <div className="student-empty-state">
                            <strong>No students found</strong>
                            <span>
                              Try changing the tab, search or second-level
                              filters.
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="student-pagination">
                <span>
                  Showing {rangeStart} to {rangeEnd} of {filteredStudents.length}{" "}
                  students
                </span>

                <div className="student-pagination-buttons">
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>

                  {paginationItems(currentPage, totalPages).map(
                    (item, index) =>
                      item === "ellipsis" ? (
                        <span
                          className="student-pagination-ellipsis"
                          key={`ellipsis-${index}`}
                        >
                          …
                        </span>
                      ) : (
                        <button
                          type="button"
                          key={item}
                          className={`student-page-button ${
                            item === currentPage ? "active" : ""
                          }`}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </button>
                      ),
                  )}

                  <button
                    type="button"
                    className="secondary compact"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setPage(Math.min(totalPages, currentPage + 1))
                    }
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </footer>
            </section>
          </>
        )}
      </div>
      {student && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setSelectedStudentRef(null)}
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
              <button onClick={() => setSelectedStudentRef(null)}>×</button>
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
                    <select name="race" defaultValue={student.race || ""}>
                      <option value="">Select race</option>
                      <option value="Chinese">Chinese</option>
                      <option value="Malay">Malay</option>
                      <option value="Indian">Indian</option>
                      <option value="Others">Others</option>
                    </select>
                  </label>
                  <label>
                    Religion
                    <select name="religion" defaultValue={student.religion || ""}>
                      <option value="">Select religion</option>
                      <option value="Hinduism">Hinduism</option>
                      <option value="Buddhism">Buddhism</option>
                      <option value="Islam">Islam</option>
                      <option value="Christianity">Christianity</option>
                      <option value="Others">Others</option>
                    </select>
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
                  .filter((invoice) => String(invoice.studentId) === String(student.id))
                  .slice(0, 12)
                  .map((invoice) => (
                    <span key={invoice.id}>
                      <code>{invoice.invoiceNo}</code>
                      <b>
                        {(invoice.items || [])
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
                  (invoice) => String(invoice.studentId) === String(student.id),
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
          onClose={closeAddStudentModal}
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
              if (ok) closeAddStudentModal();
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
                  <select name="race" defaultValue="">
                    <option value="">Select race</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Malay">Malay</option>
                    <option value="Indian">Indian</option>
                    <option value="Others">Others</option>
                  </select>
                </label>
                <label>
                  Religion
                  <select name="religion" defaultValue="">
                    <option value="">Select religion</option>
                    <option value="Hinduism">Hinduism</option>
                    <option value="Buddhism">Buddhism</option>
                    <option value="Islam">Islam</option>
                    <option value="Christianity">Christianity</option>
                    <option value="Others">Others</option>
                  </select>
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
                      options={addStudentBedOptions}
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
                setSelectedStudentRef(null);
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
                setSelectedStudentRef(null);
              }
            }}
          >
            <label className="wide">
              New room code
              <SearchSelect
                name="bedSpaceId"
                required
                options={allVacantBedOptions}
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