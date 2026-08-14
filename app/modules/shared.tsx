"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";

export type Row = Record<string, any>;
export type Data = {
  hostels: Row[];
  units: Row[];
  owners: Row[];
  bedSpaces: Row[];
  accessCards: Row[];
  services: Row[];
  reservations: Row[];
  students: Row[];
  studentRateChanges: Row[];
  salesPeople: string[];
  parkingLots: Row[];
  parkingRentals: Row[];
  schools: Row[];
  courses: Row[];
  tickets: Row[];
  ticketMessages: Row[];
  meterReadings: Row[];
  billingCycles: Row[];
  invoices: Row[];
  announcements: Row[];
  attachments: Row[];
  ticketCategories: Row[];
  generalCosts: Row[];
  billingAdjustments: Row[];
  roles: Row[];
  users: Row[];
  rolePermissions: Row[];
  reminderTemplates: Row[];
  currentUser: Row;
  importProgress: { assignments: number; expected: number };
};
export type HostelTab = "availability" | "reservations" | "pricing" | "occupancy";

export const today = new Date().toISOString().slice(0, 10);
export const chargeLabels: Record<string, string> = {
  "first-month-rental": "First month advance rental",
  deposit: "Deposit",
  "admin-fee": "Admin fee",
  "access-card-deposit": "Access card deposit",
  "access-card-handling": "Access card handling fee",
  "stamping-fee": "Stamping fee",
  "cleaning-package": "Cleaning package",
  "bedding-set": "Bedding set",
  "advance-rental": "Advance rental",
  "advance-utility": "Advance utility fee",
};
export const blankCharges = Object.fromEntries(
  Object.keys(chargeLabels).map((key) => [key, 0]),
) as Record<string, number>;
export const NATIONALITIES = [
  "Malaysian",
  "International",
];
export const RACES = ["Chinese", "Malay", "Indian", "Others"];
export const RELIGIONS = [
  "Hinduism",
  "Buddhism",
  "Islam",
  "Christianity",
  "Others",
];
export const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Kuala Lumpur",
  "Labuan",
  "Malacca",
  "Negeri Sembilan",
  "Pahang",
  "Penang",
  "Perak",
  "Perlis",
  "Putrajaya",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
];
export const money = (value: number | null | undefined, cents = false) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "Not set"
    : new Intl.NumberFormat("en-MY", {
        style: "currency",
        currency: "MYR",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      }).format(Number(value));
export const titleCase = (value: string) =>
  String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
export const dateLabel = (value: string | null | undefined, short = false) =>
  value
    ? new Intl.DateTimeFormat(
        "en-GB",
        short
          ? { day: "2-digit", month: "2-digit" }
          : { day: "2-digit", month: "short", year: "numeric" },
      ).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`))
    : "-";
export const genderLabel = (value: string) =>
  value === "unspecified"
    ? "To confirm"
    : value === "mixed"
      ? "Special / mixed"
      : titleCase(value);
export const bedTypeLabel = (value: string) =>
  value === "unknown"
    ? "Bed type not set"
    : value === "two-single"
      ? "2 single beds"
      : titleCase(value);
/** "D1-0614" -> "D1"; "16-3" -> "16"; "1201" / "SR23" (no dash) -> "" (no block). */
export const blockOf = (unitCode: unknown) => {
  const code = String(unitCode || "");
  const lastDash = code.lastIndexOf("-");
  return lastDash > 0 ? code.slice(0, lastDash) : "";
};
export const commitsInventory = (row: Row) =>
  row.status === "reserved" && row.inventoryCommitted;
export const reservationWeight = (row: Row, data: Data) =>
  row.reservationType === "group"
    ? row.preferredUnitId
      ? Math.max(
          1,
          data.bedSpaces.filter((bed) => bed.unitId === row.preferredUnitId)
            .length,
        )
      : Math.max(1, Number(row.groupSize || 1))
    : 1;
export const formValues = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget).entries());
// Shrinks a photo to a max 1600px edge and re-encodes it as JPEG at 75%
// quality before it ever reaches the network — most phone photos land at
// a fraction of their original size. Animated GIFs are left untouched
// (re-encoding would collapse them to a single frame), and any decode
// failure (e.g. an unsupported format) just falls back to the original
// file rather than blocking the upload.
async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif")
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.75),
    );
    if (!blob || blob.size >= file.size) return file;
    const compressedName = file.name.replace(/\.[^./]+$/, "") + ".jpg";
    return new File([blob], compressedName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
export const uploadAttachment = async (
  file: File,
  contextType: string,
  recordId: number,
  uploadedBy = "Administrator",
) => {
  const upload = await compressImageFile(file);
  const form = new FormData();
  form.set("file", upload);
  form.set("contextType", contextType);
  form.set("recordId", String(recordId));
  form.set("uploadedBy", uploadedBy);
  const response = await fetch("/api/files", { method: "POST", body: form });
  const result = (await response.json()) as { error?: string; id?: number };
  if (!response.ok) throw new Error(result.error || "Unable to upload file");
  return result;
};

export function Modal({
  title,
  kicker,
  description,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  kicker: string;
  description?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`modal ${wide ? "wide-modal" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <small>{kicker}</small>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SearchSelect({
  name,
  options,
  defaultValue,
  placeholder = "Type to search...",
  required = false,
  onValueChange,
}: {
  name: string;
  options: { value: string | number; label: string }[];
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  onValueChange?: (
    value: string,
    option?: { value: string | number; label: string },
  ) => void;
}) {
  const listId = useId();
  const labelFor = (value: string | number | null | undefined) =>
    options.find((option) => String(option.value) === String(value ?? ""))
      ?.label || "";
  const [text, setText] = useState(() => labelFor(defaultValue));
  const selected = options.find(
    (option) => option.label === text || String(option.value) === text,
  );
  return (
    <>
      <input
        list={listId}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const option = options.find(
            (item) =>
              item.label === nextText || String(item.value) === nextText,
          );
          onValueChange?.(option ? String(option.value) : "", option);
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      <input
        type="hidden"
        name={name}
        value={selected ? String(selected.value) : ""}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={String(option.value)} value={option.label} />
        ))}
      </datalist>
    </>
  );
}

// Digits typed into an IC field auto-format as 010101-01-0101 (YYMMDD-PB-NNNN)
// as the user types; passport numbers are left as free text since they have
// no fixed shape.
const formatIC = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  return [digits.slice(0, 6), digits.slice(6, 8), digits.slice(8, 12)]
    .filter(Boolean)
    .join("-");
};

// Identity number / nationality / hometown / race / religion fields shared
// by the reservation form and both student create/edit forms. Renders
// inline inside the caller's own <form> (it has no <form> or submit of its
// own) — the extra "specify" inputs only exist in the DOM while
// International/Others/Malaysian is selected, so `formValues()` naturally
// omits them otherwise. Pass a `key` that changes with the record being
// edited (e.g. `key={student.id}`) so the internal show/hide state resets
// when switching records; a freshly-mounted create form needs no key since
// mounting already starts state fresh.
export function DemographicFields({
  identityNo: initialIdentityNo = "",
  nationality: initialNationality = "",
  nationalityOther: initialNationalityOther = "",
  state: initialState = "",
  hometown: initialHometown = "",
  race: initialRace = "",
  raceOther: initialRaceOther = "",
  religion: initialReligion = "",
  religionOther: initialReligionOther = "",
}: {
  identityNo?: string;
  nationality?: string;
  nationalityOther?: string;
  state?: string;
  hometown?: string;
  race?: string;
  raceOther?: string;
  religion?: string;
  religionOther?: string;
}) {
  const [nationality, setNationality] = useState(initialNationality);
  const [race, setRace] = useState(initialRace);
  const [religion, setReligion] = useState(initialReligion);
  const [identityNo, setIdentityNo] = useState(
    nationality === "International" ? initialIdentityNo : formatIC(initialIdentityNo),
  );
  const isInternational = nationality === "International";
  return (
    <>
      <label>
        Nationality
        <select
          name="nationality"
          value={nationality}
          onChange={(event) => setNationality(event.target.value)}
        >
          <option value="">Not set</option>
          {NATIONALITIES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label>
        {isInternational ? "Passport" : "IC"}
        <input
          name="identityNo"
          placeholder={isInternational ? "e.g. A1234567" : "e.g. 010101-01-0101"}
          value={identityNo}
          onChange={(event) =>
            setIdentityNo(
              isInternational
                ? event.target.value
                : formatIC(event.target.value),
            )
          }
        />
      </label>
      {nationality === "Malaysian" && (
        <label>
          State
          <select name="state" defaultValue={initialState}>
            <option value="">Select state</option>
            {MALAYSIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {isInternational && (
        <>
          <label>
            Specify country
            <input
              name="nationalityOther"
              placeholder="e.g. Indonesia"
              defaultValue={initialNationalityOther}
            />
          </label>
          <label>
            Hometown
            <input
              name="hometown"
              placeholder="e.g. Jakarta"
              defaultValue={initialHometown}
            />
          </label>
        </>
      )}
      <label>
        Race
        <select
          name="race"
          value={race}
          onChange={(event) => setRace(event.target.value)}
        >
          <option value="">Select race</option>
          {RACES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      {race === "Others" && (
        <label>
          Specify race
          <input
            name="raceOther"
            placeholder="e.g. Eurasian"
            defaultValue={initialRaceOther}
          />
        </label>
      )}
      <label>
        Religion
        <select
          name="religion"
          value={religion}
          onChange={(event) => setReligion(event.target.value)}
        >
          <option value="">Select religion</option>
          {RELIGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      {religion === "Others" && (
        <label>
          Specify religion
          <input
            name="religionOther"
            placeholder="e.g. Sikhism"
            defaultValue={initialReligionOther}
          />
        </label>
      )}
    </>
  );
}

// Shared by the Parking module's "New parking rental" modal and Unit
// Information's "Record parking" button, so a rental created from either
// place uses the identical fields/logic and shows up correctly in both.
// Pass `lockedLotId` to fix the lot (hides the lot picker) when the caller
// already knows which lot the rental is for.
export function ParkingRentalForm({
  data,
  save,
  busy,
  lockedLotId,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  lockedLotId?: string | number;
  onDone: () => void;
}) {
  const [tenantType, setTenantType] = useState("in-house");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [billingFrequency, setBillingFrequency] = useState("monthly");
  const [selectedLotId, setSelectedLotId] = useState(
    lockedLotId !== undefined ? String(lockedLotId) : "",
  );
  const selectedStudent = data.students.find(
    (student) => String(student.id) === selectedStudentId,
  );
  const lockedLot =
    lockedLotId !== undefined
      ? data.parkingLots.find((lot) => String(lot.id) === String(lockedLotId))
      : undefined;
  const activeLot =
    lockedLotId !== undefined
      ? lockedLot
      : data.parkingLots.find((lot) => String(lot.id) === selectedLotId);

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(
          { action: "parking-rental", ...formValues(e) },
          "Parking rental created",
        );
        if (ok) onDone();
      }}
    >
      {lockedLotId !== undefined ? (
        <>
          <input
            type="hidden"
            name="parkingLotId"
            defaultValue={String(lockedLotId)}
          />
          <label className="wide">
            Parking lot
            <input
              value={
                lockedLot
                  ? `${lockedLot.hostelName} · ${lockedLot.lotNumber} · ${lockedLot.unitCode || "Common"}`
                  : ""
              }
              readOnly
              disabled
            />
          </label>
        </>
      ) : (
        <label>
          Parking lot
          <SearchSelect
            name="parkingLotId"
            required
            defaultValue={selectedLotId}
            onValueChange={(val) => {
              setSelectedLotId(val);
              setSelectedStudentId("");
            }}
            options={data.parkingLots
              .filter((lot) => lot.status === "available")
              .map((lot) => ({
                value: lot.id,
                label: `${lot.hostelName} · ${lot.lotNumber} · ${lot.unitCode || "Common"}`,
              }))}
            placeholder="Type hostel, lot or unit"
          />
        </label>
      )}

      <label>
        Tenant type
        <select
          name="tenantType"
          value={tenantType}
          onChange={(event) => {
            setTenantType(event.target.value);
            setSelectedStudentId("");
            setBillingFrequency("monthly");
          }}
        >
          <option value="in-house">In-house student</option>
          <option value="outside">Outside tenant</option>
        </select>
      </label>

      {tenantType === "in-house" && (
        <label className="wide">
          Link student
          <SearchSelect
            name="studentId"
            required
            options={data.students
              .filter((student) => student.assignmentStatus === "active")
              .filter((student) => {
                if (!activeLot) return true;
                return student.hostelName === activeLot.hostelName;
              })
              .map((student) => ({
                value: student.id,
                label: `${student.fullName} · ${student.roomCode} · ${student.hostelName}/${student.unitCode}`,
              }))}
            onValueChange={setSelectedStudentId}
            placeholder="Type student name or room code"
          />
        </label>
      )}
      <label>
        Tenant name
        <input
          name="tenantName"
          required
          value={
            tenantType === "in-house"
              ? selectedStudent?.fullName || ""
              : undefined
          }
          readOnly={tenantType === "in-house"}
        />
      </label>
      <label>
        Contact number
        <input
          name="contactNumber"
          value={
            tenantType === "in-house"
              ? selectedStudent?.contactNumber || ""
              : undefined
          }
          readOnly={tenantType === "in-house"}
        />
      </label>
      <label>
        Unit number
        <input
          name="unitNumber"
          value={
            tenantType === "in-house"
              ? selectedStudent?.unitCode || ""
              : undefined
          }
          readOnly={tenantType === "in-house"}
        />
      </label>
      <label>
        Car plate
        <input name="carPlateNumber" required />
      </label>
      <label>
        Car model
        <input name="carModel" />
      </label>
      <label>
        Rental frequency
        <select
          name="billingFrequency"
          value={billingFrequency}
          onChange={(event) => setBillingFrequency(event.target.value)}
        >
          <option value="monthly">Monthly</option>
          <option value="annually">Annually</option>
        </select>
      </label>
      <label>
        Deposit
        <input name="depositAmount" type="number" min="0" />
      </label>
      <label>
        {billingFrequency === "annually" ? "Annual rental" : "Monthly rental"}
        <input name="monthlyRental" type="number" min="0" required />
      </label>
      <label>
        Start date
        <input name="startDate" type="date" required />
      </label>
      {tenantType === "outside" && (
        <>
          <label>
            Paid until
            <input name="paidUntil" type="date" />
          </label>
          <label>
            Next payment due
            <input name="nextDueDate" type="date" />
          </label>
          <label>
            Payment status
            <select name="paymentStatus">
              <option value="current">Current</option>
              <option value="due">Due</option>
              <option value="advance">Paid in advance</option>
            </select>
          </label>
        </>
      )}
      <label className="wide">
        Remarks
        <input name="notes" />
      </label>
      <div className="form-actions wide">
        <button className="primary" disabled={busy}>
          Create rental
        </button>
      </div>
    </form>
  );
}

export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
}) {
  return (
    <article className={`metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <article>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

export function ReportCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="panel report-card">
      <small>{title}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>HO</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
