"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  DemographicFields,
  Modal,
  SearchIcon,
  Stat,
  StatusPill,
  blockOf,
  dateLabel,
  formValues,
  genderLabel,
  money,
  paginationItems,
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

const COURSE_LEVELS = ["foundation", "diploma", "degree", "other"] as const;
const COURSE_LEVEL_LABELS: Record<string, string> = {
  foundation: "Foundation",
  diploma: "Diploma",
  degree: "Degree",
  other: "Other",
};

// Courses grouped by programme level so staff pick from a list instead of
// retyping the full course name each time. Falls back to showing whatever
// free-text value a student already has, in case it predates this list.
function CourseOptions({ courses, current }: { courses: Row[]; current?: string }) {
  return (
    <>
      <option value="">Not set</option>
      {COURSE_LEVELS.map((level) => {
        const levelCourses = courses.filter((c) => c.level === level);
        if (!levelCourses.length) return null;
        return (
          <optgroup key={level} label={COURSE_LEVEL_LABELS[level]}>
            {levelCourses.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
      {current && !courses.some((c) => c.name === current) && (
        <option value={current}>{current}</option>
      )}
    </>
  );
}

// Cascading hostel → unit → type/category/bathroom room picker for the
// "Assign a room" flow. A fresh instance mounts every time the modal opens
// (the caller only renders it while `modal === "assign"`), so its filter
// state always starts empty without needing a reset effect.
// Hostel -> room type -> block -> category -> room cascade, matching Hostel
// Information's "Housing information" step exactly (no separate Unit
// step, no Bathroom filter). Renders inline — no <form>/submit of its own —
// so it can drop into any caller's form; only the final `bedSpaceId` select
// carries a `name`, everything above it is a pure narrowing filter.
function RoomPickerFields({
  data,
  gender,
}: {
  data: Data;
  gender?: string;
}) {
  const [hostelId, setHostelId] = useState("");
  const [roomType, setRoomType] = useState("any");
  const [block, setBlock] = useState("");
  const [category, setCategory] = useState("any");
  const [bedSpaceId, setBedSpaceId] = useState("");

  // Beds an active sales reservation already holds — never offer these.
  const heldBedIds = new Set(
    data.reservations
      .filter((row) => row.status === "reserved")
      .flatMap((row) => [row.provisionalBedSpaceId, row.assignedBedSpaceId])
      .filter(Boolean)
      .map(String),
  );
  const genderFits = (bedGender: string) =>
    !gender ||
    ["mixed", "unspecified"].includes(gender) ||
    ["mixed", "unspecified"].includes(String(bedGender)) ||
    bedGender === gender;
  const isSelectable = (bed: Row) =>
    bed.status === "vacant" &&
    !heldBedIds.has(String(bed.id)) &&
    genderFits(bed.gender);

  // Each step only offers what the step before it allows.
  const hostelBeds = data.bedSpaces.filter(
    (bed) =>
      isSelectable(bed) && (!hostelId || String(bed.hostelId) === hostelId),
  );
  const blockOptions = [
    ...new Set(hostelBeds.map((bed) => blockOf(bed.unitCode))),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const blockedBeds = hostelBeds.filter(
    (bed) => !block || blockOf(bed.unitCode) === block,
  );
  const categories = [
    ...new Set(blockedBeds.map((bed) => String(bed.roomLabel))),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const options = blockedBeds.filter(
    (bed) =>
      (roomType === "any" || bed.roomType === roomType) &&
      (category === "any" || bed.roomLabel === category),
  );

  return (
    <>
      <label>
        1. Hostel
        <select
          required
          value={hostelId}
          onChange={(event) => {
            setHostelId(event.target.value);
            setBlock("");
            setCategory("any");
            setBedSpaceId("");
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
          value={roomType}
          disabled={!hostelId}
          onChange={(event) => {
            setRoomType(event.target.value);
            setBedSpaceId("");
          }}
        >
          <option value="any">Any room type</option>
          <option value="single">Single</option>
          <option value="sharing">Twin</option>
        </select>
      </label>
      {blockOptions.length > 0 && (
        <label>
          2. Block
          <select
            value={block}
            disabled={!hostelId}
            onChange={(event) => {
              setBlock(event.target.value);
              setCategory("any");
              setBedSpaceId("");
            }}
          >
            <option value="">All blocks in this hostel</option>
            {blockOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Room category
        <select
          value={category}
          disabled={!hostelId}
          onChange={(event) => {
            setCategory(event.target.value);
            setBedSpaceId("");
          }}
        >
          <option value="any">Any category</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              Room {value}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        3. Room available {hostelId && `— ${options.length} available`}
        <select
          name="bedSpaceId"
          required
          disabled={!hostelId}
          value={bedSpaceId}
          onChange={(event) => setBedSpaceId(event.target.value)}
        >
          <option value="">
            {!hostelId
              ? "Select a hostel first"
              : options.length
                ? "Select an available room"
                : "No free rooms match these choices"}
          </option>
          {options.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {`${bed.legacyCode} · ${bed.unitCode} · ${genderLabel(bed.gender)} · ${money(bed.currentRental)}`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function AssignRoomForm({
  data,
  save,
  busy,
  studentId,
  studentGender,
  salesperson,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  studentId: string | number;
  studentGender?: string;
  salesperson?: string;
  onDone: () => void;
}) {
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          {
            action: "student-assign",
            studentId,
            salesperson,
            ...formValues(e),
          },
          "Room assigned",
        );
        if (ok) onDone();
      }}
    >
      <RoomPickerFields data={data} gender={studentGender} />
      <label>
        Check-in date
        <input name="checkInDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <label>
        Monthly rental
        <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Security deposit
        <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Access card deposit
        <input name="accessCardDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Parking deposit
        <input name="parkingDeposit" type="number" min="0" placeholder="e.g. 1000" />
      </label>
      <label>
        Lease start
        <input name="leaseStartDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <label>
        Lease end
        <input name="leaseEndDate" type="date" placeholder="e.g. 2026-01-01" />
      </label>
      <div className="form-actions wide">
        <button className="primary" disabled={busy}>
          Confirm assignment
        </button>
      </div>
    </form>
  );
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
  const [editCourse, setEditCourse] = useState<Row | null>(null);
  const [drawerRecordsTab, setDrawerRecordsTab] = useState("login");
  // Jump back to the first records tab whenever a different student's
  // drawer opens, without the extra render a useEffect would cost here.
  const [drawerRecordsStudentId, setDrawerRecordsStudentId] = useState(
    selectedStudentRef?.studentId,
  );
  if (selectedStudentRef?.studentId !== drawerRecordsStudentId) {
    setDrawerRecordsStudentId(selectedStudentRef?.studentId);
    setDrawerRecordsTab("login");
  }

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
        const text = `${item.fullName || ""} ${item.studentCode || ""} ${item.identityNo || ""
          } ${item.roomCode || ""} ${item.unitCode || ""} ${item.hostelName || ""
          } ${item.school || ""} ${item.course || ""} ${item.nationality || ""
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
    <div className="table-v2">
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
              className="v2-btn-ghost"
              onClick={() => setModal("schools")}
            >
              Manage schools
            </button>
            <button
              type="button"
              className="v2-btn-primary"
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

        <section className="panel student-filter-panel">
          <div className="workspace-tabs">
            {hostelDirectory.map(({ key, hostel, students }) => (
              <button
                key={key}
                type="button"
                className={selectedHostelKey === key ? "active" : ""}
                onClick={() => selectHostel(key)}
              >
                {hostel?.name || "Unassigned profiles"} ({students.length})
              </button>
            ))}
            {!hostelDirectory.length && <em>No hostels added yet.</em>}
          </div>
        </section>

        {selectedHostelKey ? (
          <>
            <section className="student-selected-hostel">
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

              <div className="v2-toolbar">
                <label className="v2-search">
                  <SearchIcon />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Name, IC/passport, room, school or country"
                  />
                </label>

                <select
                  className="v2-pill-select"
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

                <select
                  className="v2-pill-select"
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

                <select
                  className="v2-pill-select"
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

                <button
                  type="button"
                  className="v2-reset"
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
                            <StatusPill
                              status={
                                item.assignmentStatus || item.profileStatus
                              }
                            />
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
                          className={`student-page-button ${item === currentPage ? "active" : ""
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
        ) : (
          <section className="panel student-results-panel">
            <em>Select a hostel above to view its students.</em>
          </section>
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
                      placeholder="e.g. B200000000"
                      defaultValue={student.studentCode}
                    />
                  </label>
                  <label>
                    Gender
                    <select name="gender" defaultValue={student.gender}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                  <label>
                    Date of birth
                    <input
                      name="dateOfBirth"
                      type="date"
                      defaultValue={student.dateOfBirth || ""}
                    />
                  </label>
                  <DemographicFields
                    key={student.id}
                    identityNo={student.identityNo || ""}
                    nationality={student.nationality || ""}
                    nationalityOther={student.nationalityOther || ""}
                    state={student.state || ""}
                    hometown={student.hometown || ""}
                    race={student.race || ""}
                    raceOther={student.raceOther || ""}
                    religion={student.religion || ""}
                    religionOther={student.religionOther || ""}
                  />
                </div>
              </div>

              <div className="drawer-subsection">
                <h4>Contacts</h4>
                <div className="form-grid">
                  <label>
                    Contact number
                    <input
                      name="contactNumber"
                      placeholder="e.g. 0123456789"
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
                  {student.assignmentId ? (
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setModal("moveout")}
                    >
                      Move out / deactivate
                    </button>
                  ) : (
                    // 新增：如果还没有 assignmentId，则显示分配房间的按钮
                    <button
                      type="button"
                      className="primary compact"
                      onClick={() => setModal("assign")}
                    >
                      Assign a room
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
                  <>
                    <div className="form-grid">
                      <label className="wide">
                        Room code
                        <input value={student.roomCode || ""} readOnly />
                      </label>
                    </div>
                    <p className="section-kicker room-details-group">FINANCIAL</p>
                    <div className="form-grid">
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
                    </div>
                    <p className="section-kicker room-details-group">TENANCY DATES</p>
                    <div className="form-grid">
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
                    <p className="section-kicker room-details-group">RENEWAL</p>
                    <div className="form-grid">
                      <label className="wide">
                        Renewal status
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {student.renewalAppliedAt ? (
                            <span>
                              Applied on {dateLabel(student.renewalAppliedAt)}
                            </span>
                          ) : (
                            <>
                              <span style={{ color: '#6b7280' }}>
                                Not yet applied
                              </span>
                              <button
                                type="button"
                                className="secondary compact"
                                onClick={() =>
                                  save(
                                    {
                                      action: "assignment-renewal-apply",
                                      assignmentId: student.assignmentId,
                                    },
                                    "Renewal marked as applied",
                                  )
                                }
                              >
                                Mark renewal applied
                              </button>
                            </>
                          )}
                        </div>
                      </label>
                    </div>
                  </>
                ) : (
                  // 更新提示文案
                  <p className="empty-copy">
                    No active room assignment. Click &ldquo;Assign a room&rdquo; above to place this student in a vacant bed space.
                  </p>
                )}
              </div>

              <div className="drawer-subsection">
                <div className="subsection-head">
                  <h4>Academic information</h4>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setModal("schools")}
                    >
                      Manage schools
                    </button>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => setModal("courses")}
                    >
                      Manage courses
                    </button>
                  </div>
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
                    <select name="course" defaultValue={student.course || ""}>
                      <CourseOptions courses={data.courses} current={student.course} />
                    </select>
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
                    <select name="salesperson" defaultValue={student.salesperson || ""}>
                      <option value="">Select Sales Team</option>
                      {data.salesPeople.map((name: string) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <input type="hidden" name="agency" value={student.agency || ""} />
                  <label>
                    Receipt serial no.
                    <input name="receiptNo" placeholder="e.g. 1234567890" defaultValue={student.receiptNo} />
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
                    <input name="remarks" placeholder="e.g. Student is relocating to a different unit" defaultValue={student.remarks} />
                  </label>
                </div>
              </div>
            </form>

            <div className="workspace-tabs sticky-tabs drawer-records-tabs">
              <button
                type="button"
                className={drawerRecordsTab === "login" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("login")}
              >
                Tenant login credentials
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "billing" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("billing")}
              >
                Billing information
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "rate" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("rate")}
              >
                Rate change
              </button>
              <button
                type="button"
                className={drawerRecordsTab === "room" ? "active" : ""}
                onClick={() => setDrawerRecordsTab("room")}
              >
                Change room
              </button>
            </div>

            {drawerRecordsTab === "login" && (
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
            )}

            {drawerRecordsTab === "billing" && (
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
            )}

            {drawerRecordsTab === "rate" && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>RATE CHANGE</small>
                    <h3>Effective-dated rental adjustments</h3>
                  </div>
                  {student.assignmentId && (
                    <button
                      className="secondary compact"
                      onClick={() => setModal("rate")}
                    >
                      + Rate change
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
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
                ) : (
                  <p className="empty-copy">
                    No active room assignment yet — assign a room first.
                  </p>
                )}
              </section>
            )}

            {drawerRecordsTab === "room" && (
              <section className="drawer-section">
                <div className="section-title">
                  <div>
                    <small>CHANGE ROOM</small>
                    <h3>Move to a different room</h3>
                  </div>
                  {student.assignmentId && (
                    <button
                      className="secondary compact"
                      onClick={() => setModal("move")}
                    >
                      Change room
                    </button>
                  )}
                </div>
                {student.assignmentId ? (
                  <div className="compact-list">
                    <span>
                      <b>{student.roomCode || "-"}</b>
                      <small>
                        {student.hostelName} · Since{" "}
                        {dateLabel(student.checkInDate)}
                      </small>
                    </span>
                  </div>
                ) : (
                  <p className="empty-copy">
                    No active room assignment yet — assign a room first.
                  </p>
                )}
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
              const { loginEmail, ...values } = formValues(e);
              const ok = await save(
                { action: "student-create", ...values },
                "Student added",
              );
              if (ok && loginEmail && tenantRole) {
                await save(
                  {
                    action: "user-save",
                    roleId: tenantRole.id,
                    studentId: ok.id,
                    displayName: String(values.fullName || ""),
                    email: loginEmail,
                  },
                  "Student added and tenant login enabled",
                );
              }
              if (ok) closeAddStudentModal();
            }}
          >
            <div className="drawer-subsection wide">
              <h4>Student information</h4>
              <div className="form-grid">
                <label>
                  Full name
                  <input name="fullName" required placeholder="e.g. John Doe" />

                </label>
                <label>
                  Student code
                  <input name="studentCode"
                    placeholder="e.g. B200000000"
                  />
                </label>
                <label>
                  Gender
                  <select name="gender" defaultValue="unspecified">
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label>
                  Date of birth
                  <input name="dateOfBirth" type="date" />
                </label>
                <DemographicFields />
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Contacts</h4>
              <div className="form-grid">
                <label>
                  Contact number
                  <input name="contactNumber" placeholder="e.g. 0123456789" />
                </label>
                <label>
                  Email
                  <input name="email" type="email" placeholder="e.g. john.doe@example.com" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <div className="subsection-head">
                <h4>Academic information</h4>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setModal("courses")}
                >
                  Manage courses
                </button>
              </div>
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
                  <select name="course" defaultValue="">
                    <CourseOptions courses={data.courses} />
                  </select>
                </label>
                <label>
                  Application form no.
                  <input name="applicationFormNo" placeholder="e.g. A200000000" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Other information</h4>
              <div className="form-grid">
                <label>
                  Sales person
                  <select name="salesperson" defaultValue="">
                    <option value="">Select Sales Team</option>
                    {data.salesPeople.map((name: string) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Receipt serial no.
                  <input name="receiptNo" placeholder="e.g. 1234567890" />
                </label>
                <label className="wide">
                  Remarks
                  <input name="remarks" placeholder="e.g. Student is relocating to a different unit" />
                </label>
              </div>
            </div>
            <div className="drawer-subsection wide">
              <h4>Tenant login credentials</h4>
              <div className="form-grid">
                <label className="wide">
                  Login email
                  <input
                    name="loginEmail"
                    type="email"
                    placeholder="student@email.com"
                  />
                </label>
              </div>
              <p className="auto-address-note">
                Optional — if filled in, a tenant login is created for this
                email once the profile is saved. No password is stored in
                this system.
              </p>
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
                  <RoomPickerFields data={data} />
                  <label>
                    Monthly rental
                    <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Security deposit
                    <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Access card deposit
                    <input name="accessCardDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Parking deposit
                    <input name="parkingDeposit" type="number" min="0" placeholder="e.g. 1000" />
                  </label>
                  <label>
                    Check-in
                    <input name="checkInDate" type="date" placeholder="e.g. 2026-01-01" />
                  </label>
                  <label>
                    Lease start
                    <input name="leaseStartDate" type="date" placeholder="e.g. 2026-01-01"  />
                  </label>
                  <label>
                    Lease end
                    <input name="leaseEndDate" type="date" placeholder="e.g. 2026-01-01" />
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
              <input name="checkOutDate" type="date" required placeholder="e.g. 2026-01-01" />
            </label>
            <label>
              Check-out meter
              <input name="checkOutMeter" type="number" step="0.01" placeholder="e.g. 1000" />
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

      {modal === "courses" && (
        <Modal
          title="Manage courses"
          kicker="ACADEMIC LIST"
          onClose={() => {
            setModal("");
            setEditCourse(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                editCourse
                  ? {
                    action: "course-update",
                    courseId: editCourse.id,
                    ...formValues(e),
                  }
                  : { action: "course-create", ...formValues(e) },
                editCourse ? "Course updated" : "Course added",
              );
              if (ok) {
                setEditCourse(null);
                (e.target as HTMLFormElement).reset();
              }
            }}
          >
            <label className="wide">
              {editCourse ? "Rename course" : "New course name"}
              <input
                name="name"
                required
                key={editCourse?.id || "new"}
                defaultValue={editCourse?.name || ""}
              />
            </label>
            <label>
              Level
              <select
                name="level"
                key={editCourse?.id || "new-level"}
                defaultValue={editCourse?.level || "other"}
              >
                {COURSE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {COURSE_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions wide">
              {editCourse && (
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setEditCourse(null)}
                >
                  Cancel edit
                </button>
              )}
              <button className="primary compact" disabled={busy}>
                {editCourse ? "Save course" : "Add course"}
              </button>
            </div>
          </form>
          <div className="compact-list">
            {data.courses.map((course) => (
              <span key={course.id}>
                <b>{course.name}</b>
                <small>{COURSE_LEVEL_LABELS[course.level] || course.level}</small>
                <div className="button-row">
                  <button
                    className="secondary compact"
                    onClick={() => setEditCourse(course)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      save(
                        { action: "course-delete", courseId: course.id },
                        "Course removed",
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              </span>
            ))}
            {data.courses.length === 0 && (
              <p className="empty-copy">No courses yet. Add one above.</p>
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
              <input name="effectiveDate" type="date" required placeholder="e.g. 2026-01-01" />
            </label>
            <label>
              Monthly rental
              <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
            </label>
            <label>
              Security deposit
              <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
            </label>
            <label className="wide">
              Reason
              <input
                name="reason"
                placeholder="e.g. Short-term renewal, promotion ended..."
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
      {modal === "assign" && student && (
        <Modal
          title="Assign a room"
          kicker={student.fullName}
          description="Narrow down by hostel, block and category to find a currently vacant room."
          onClose={() => setModal("")}
          wide
        >
          <AssignRoomForm
            data={data}
            save={save}
            busy={busy}
            studentId={student.id}
            studentGender={student.gender}
            salesperson={student.salesperson}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "move" && student && (
        <Modal
          title="Manual room change"
          kicker={student.fullName}
          description="Narrow down by hostel, block and category to find a currently vacant room. The old room becomes vacant and the selected room becomes occupied from the effective date."
          onClose={() => setModal("")}
          wide
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
            <RoomPickerFields data={data} gender={student.gender} />
            <label>
              Effective date
              <input name="effectiveDate" type="date" required placeholder="e.g. 2026-01-01" />
            </label>
            <label>
              New monthly rental
              <input name="monthlyRental" type="number" min="0" placeholder="e.g. 1000" />
            </label>
            <label>
              New security deposit
              <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
            </label>
            <label>
              Access card deposit
              <input name="accessCardDeposit" type="number" min="0" placeholder="e.g. 1000" />
            </label>
            <label>
              Old room check-out meter
              <input name="checkOutMeter" type="number" step="0.01" placeholder="e.g. 1000"   />
            </label>
            <label>
              New room check-in meter
              <input name="checkInMeter" type="number" step="0.01" placeholder="e.g. 1000" />
            </label>
            <label>
              New lease end
              <input name="leaseEndDate" type="date" placeholder="e.g. 2026-01-01" />
            </label>
            <label className="wide">
              Reason / remarks
              <input name="reason" placeholder="e.g. Short-term renewal, promotion ended..." />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Confirm room change
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}