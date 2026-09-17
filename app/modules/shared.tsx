"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { BASE_PATH } from "../basePath";

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
  depositAdjustments: Row[];
  pastTenancies: Row[];
  salesPeople: string[];
  parkingLots: Row[];
  parkingRentals: Row[];
  schools: Row[];
  courses: Row[];
  races: Row[];
  religions: Row[];
  categoryRates: Row[];
  tickets: Row[];
  ticketMessages: Row[];
  meterReadings: Row[];
  // The months a reading exists for. Sent whole even though meterReadings is
  // trimmed to the newest few per room, so the month picker still offers
  // every month rather than only the ones the trimmed set happens to cover.
  meterMonths: string[];
  // Rooms whose electricity would go unbilled if the next, not-yet-run
  // cycle were generated right now — see computeUnreadMeterRooms /
  // upcomingMeterCutoff in app/api/system/route.ts. Empty for tenants.
  overdueMeterRooms: { roomCode: string; lastReadingDate: string | null }[];
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
  settings: {
    roomTransferFee: number;
    autoBillingEnabled: boolean;
    autoBillingCutoffDay: number;
    // Day of the *following* month that rent falls due, not an offset from
    // the cut-off — see runScheduledBilling.
    autoBillingDueDay: number;
    // Where a figure stops looking like a normal month and starts looking
    // like a slipped digit — see app/api/system/money.ts.
    moneyGuardMeterJumpKwh: number;
    moneyGuardOverpayRm: number;
    moneyGuardOverpayPct: number;
    moneyGuardRentMax: number;
  };
};
export type HostelTab = "availability" | "reservations" | "pricing" | "occupancy";

export const today = new Date().toISOString().slice(0, 10);
// House rule: a student's security deposit is always this many months of
// their agreed room rent, so it has to be recomputed anywhere the rent
// changes (new reservation, room change) rather than typed in by hand.
export const DEPOSIT_MONTHS = 3;
export const depositFor = (monthlyRental: number) =>
  Number(monthlyRental || 0) * DEPOSIT_MONTHS;

// A rate change never rewrites the tenancy's own figures — it is an
// effective-dated override the monthly billing run reads at invoice time,
// which is what stops an already-issued invoice being rewritten
// retroactively. Anything that shows "what this student pays now" therefore
// has to apply the same rule, or the screen keeps showing the superseded
// rent long after billing has moved on.
//
// The precedence deliberately mirrors the billing query exactly (latest
// change on or before the date wins; a null figure on that change falls
// through to the tenancy, NOT to an older change) so the number on screen is
// always the number that will be billed.
export function effectiveRateOn(
  rateChanges: Row[],
  assignmentId: string | number | null | undefined,
  tenancy: { monthlyRental?: unknown; securityDeposit?: unknown },
  onDate: string = today,
) {
  const applicable = assignmentId
    ? rateChanges
        .filter(
          (change) =>
            String(change.assignmentId) === String(assignmentId) &&
            String(change.effectiveDate) <= onDate,
        )
        .sort((a, b) =>
          String(b.effectiveDate).localeCompare(String(a.effectiveDate)),
        )[0]
    : undefined;
  const base = {
    monthlyRental:
      tenancy.monthlyRental === null || tenancy.monthlyRental === undefined
        ? null
        : Number(tenancy.monthlyRental),
    securityDeposit:
      tenancy.securityDeposit === null || tenancy.securityDeposit === undefined
        ? null
        : Number(tenancy.securityDeposit),
  };
  if (!applicable)
    return { ...base, source: "tenancy" as const, effectiveDate: null };
  return {
    monthlyRental:
      applicable.monthlyRental === null || applicable.monthlyRental === undefined
        ? base.monthlyRental
        : Number(applicable.monthlyRental),
    securityDeposit:
      applicable.securityDeposit === null ||
      applicable.securityDeposit === undefined
        ? base.securityDeposit
        : Number(applicable.securityDeposit),
    source: "rate-change" as const,
    effectiveDate: String(applicable.effectiveDate),
  };
}

// Staff let rooms, not beds. A bed is an internal slot: 78% of rooms hold
// exactly one, so asking which bed is a question with a single possible
// answer, and for a sharing room it is the house that decides which space a
// new tenant takes. Pickers therefore offer rooms and this resolves the bed
// behind the scenes — the bed layer stays, because 90-odd rooms really do
// house several people on separate beds and the electricity split divides a
// room's usage between exactly those occupants.
export type RoomOption = {
  roomId: string | number;
  roomCode: string;
  unitCode: string;
  hostelId: string | number;
  hostelName: string;
  roomType: string;
  gender: string;
  // The bed a new tenant would be given — always the lowest free one, so the
  // choice is deterministic rather than whichever row the query happened to
  // return first.
  bed: Row;
  freeCount: number;
  totalCount: number;
  rate: number | null;
};

export function roomOptionsFrom(
  beds: Row[],
  isSelectable: (bed: Row) => boolean,
): RoomOption[] {
  const byRoom = new Map<string, Row[]>();
  for (const bed of beds) {
    const key = String(bed.roomId);
    const list = byRoom.get(key);
    if (list) list.push(bed);
    else byRoom.set(key, [bed]);
  }
  const options: RoomOption[] = [];
  for (const roomBeds of byRoom.values()) {
    const free = roomBeds
      .filter(isSelectable)
      .sort((a, b) =>
        String(a.bedLabel || "").localeCompare(String(b.bedLabel || ""), undefined, {
          numeric: true,
        }),
      );
    if (!free.length) continue;
    const bed = free[0];
    const rate = bed.salesRate ?? bed.monthlyRental;
    options.push({
      roomId: bed.roomId,
      roomCode: `${bed.unitCode}-${bed.roomLabel}`,
      unitCode: bed.unitCode,
      hostelId: bed.hostelId,
      hostelName: bed.hostelName,
      roomType: String(bed.configuredRoomType || bed.roomType || "single"),
      gender: String(bed.gender || "unspecified"),
      bed,
      freeCount: free.length,
      totalCount: roomBeds.length,
      rate: rate === null || rate === undefined ? null : Number(rate),
    });
  }
  return options.sort((a, b) =>
    a.roomCode.localeCompare(b.roomCode, undefined, { numeric: true }),
  );
}

// How a room reads in a dropdown. A single room says nothing extra; a shared
// one has to say how much of it is still free, or staff cannot tell they are
// putting someone into an occupied room.
export const roomOptionLabel = (option: RoomOption) =>
  option.totalCount > 1
    ? `${option.roomCode} — ${option.freeCount} of ${option.totalCount} spaces free`
    : option.roomCode;

// The next change that has not taken effect yet, so staff can see what is
// coming without digging through the history.
export function nextScheduledRate(
  rateChanges: Row[],
  assignmentId: string | number | null | undefined,
  afterDate: string = today,
) {
  if (!assignmentId) return undefined;
  return rateChanges
    .filter(
      (change) =>
        String(change.assignmentId) === String(assignmentId) &&
        String(change.effectiveDate) > afterDate,
    )
    .sort((a, b) =>
      String(a.effectiveDate).localeCompare(String(b.effectiveDate)),
    )[0];
}
// The charge types editable through the reservation Payment step's
// breakdown form — blankCharges (that form's initial state) is derived
// from exactly this list, so anything added to chargeLabels below without
// also going here stays display-only and can't be typed into that form.
export const RESERVATION_BREAKDOWN_CHARGE_TYPES = [
  "first-month-rental",
  "deposit",
  "admin-fee",
  "access-card-deposit",
  "access-card-handling",
  "stamping-fee",
  "cleaning-package",
  "bedding-set",
  "advance-rental",
  "advance-utility",
] as const;
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
  // Added only by reservation-room-change, never through the Payment step
  // breakdown — see RESERVATION_BREAKDOWN_CHARGE_TYPES above.
  "room-transfer-fee": "Room transfer fee",
};
export const blankCharges = Object.fromEntries(
  RESERVATION_BREAKDOWN_CHARGE_TYPES.map((key) => [key, 0]),
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
    // Splits camelCase object keys (e.g. Reports' raw column names,
    // "invoiceNo") into separate words before capitalizing — a no-op for
    // the hyphenated/lowercase enum values this is normally called with.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
export function paginationItems(currentPage: number, totalPages: number) {
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
export const dateLabel = (value: string | null | undefined, short = false) =>
  value
    ? new Intl.DateTimeFormat(
        "en-GB",
        short
          ? { day: "2-digit", month: "2-digit" }
          : { day: "2-digit", month: "short", year: "numeric" },
      ).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`))
    : "-";

/**
 * A date field that reads "01 Sept 2026" instead of "01/09/2026".
 *
 * The browser draws a native date input's own text from the OS locale and
 * offers no way to reformat it — so the real input stays exactly where it
 * was, keeping its value, name, required/min/max validation and its own
 * calendar, and only its *text* is made transparent. The month-name version
 * is painted over the top. Clicking anywhere on the field opens the same
 * native calendar it always did.
 *
 * Blur-on-pick is what makes this work: a date input keeps focus after the
 * calendar closes, and a focused one highlights the segment under the
 * (now invisible) numbers, which would show through as an empty blue block.
 * Dropping focus the moment a date is chosen leaves the formatted label
 * clean.
 */
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(`${value}-01T00:00:00Z`),
  );

// datetime-local's value has no timezone offset — it's the wall-clock time
// the user picked, so parsed as-is (no "Z") rather than forced to UTC the
// way dateLabel forces a pure date string to avoid a day-off-by-one shift.
const dateTimeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

/**
 * The engine behind DateField/MonthField/DateTimeField — one native
 * type="date"/"month"/"datetime-local" input with its own text made
 * transparent and a custom-formatted label painted over it (see DateField's
 * doc comment above for why: the browser won't let you reformat its own
 * locale text). type-specific pieces are just which native input type is
 * rendered and how its value is formatted; everything else — controlled vs
 * uncontrolled display, blur-on-pick, matching the label's metrics to the
 * real input — is identical across all three, so it lives here once.
 */
function TemporalField({
  type,
  formatValue,
  emptyLabel,
  value,
  defaultValue,
  onChange,
  className,
  ...rest
}: {
  type: "date" | "month" | "datetime-local";
  formatValue: (value: string) => string;
  emptyLabel: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const isControlled = value !== undefined;
  // A controlled field's display is just its prop, recomputed every render
  // — no state of its own needed. An uncontrolled one has no prop to read
  // after the first render, so its value lives only in this state, moved by
  // its own onChange below.
  const [uncontrolledDisplay, setUncontrolledDisplay] = useState(
    String(defaultValue ?? ""),
  );
  const display = isControlled ? String(value ?? "") : uncontrolledDisplay;
  const inputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  // The label has to sit exactly where the browser would have drawn the
  // numbers, and these fields are 39px/11px in a form and 48px/14px in the
  // reservation filters — among others. Reading the metrics off the input
  // itself lands it correctly in every one of them without this component
  // having to know which screen it is on.
  useEffect(() => {
    const input = inputRef.current;
    const label = labelRef.current;
    if (!input || !label) return;
    const style = getComputedStyle(input);
    label.style.paddingLeft = style.paddingLeft;
    label.style.paddingRight = style.paddingRight;
    label.style.fontSize = style.fontSize;
    label.style.fontWeight = style.fontWeight;
    label.style.fontFamily = style.fontFamily;
  });
  return (
    <span className="date-field">
      <input
        ref={inputRef}
        type={type}
        className={className ? `date-field-input ${className}` : "date-field-input"}
        onClick={(event) => {
          // Only the little calendar icon opens the picker by default, and
          // the rest of the field now has nothing visible to click into.
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Chrome throws if the picker is already open or the click
            // wasn't treated as a user gesture — either way the native
            // behaviour still applies, so there is nothing to recover.
          }
        }}
        onChange={(event) => {
          if (!isControlled) setUncontrolledDisplay(event.target.value);
          event.currentTarget.blur();
          onChange?.(event);
        }}
        {...(isControlled ? { value } : { defaultValue })}
        {...rest}
      />
      <span
        ref={labelRef}
        className={display ? "date-field-label" : "date-field-label is-empty"}
        aria-hidden="true"
      >
        {display ? formatValue(display) : emptyLabel}
      </span>
    </span>
  );
}

export function DateField({
  type: _ignoredType,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TemporalField
      type="date"
      formatValue={dateLabel}
      emptyLabel="Select date"
      {...rest}
    />
  );
}

export function MonthField({
  type: _ignoredType,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TemporalField
      type="month"
      formatValue={monthLabel}
      emptyLabel="Select month"
      {...rest}
    />
  );
}

export function DateTimeField({
  type: _ignoredType,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TemporalField
      type="datetime-local"
      formatValue={dateTimeLabel}
      emptyLabel="Select date & time"
      {...rest}
    />
  );
}

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
// Every attachment field accepts the same set: photos and video, plus the
// office formats staff actually hand over — PDF, Word, Excel, PowerPoint,
// CSV and plain text. Listed as both MIME types and extensions because
// Windows reports some Office files with an empty or generic type, which an
// extension-less accept list would silently reject. Kept in one place so a
// new format only has to be added once. (The Maintenance CSV importer sets
// its own narrower accept — it parses the file rather than storing it.)
export const ATTACHMENT_ACCEPT = [
  "image/*",
  "video/*",
  "application/pdf",
  ".pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc",
  ".docx",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls",
  ".xlsx",
  ".xlsm",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt",
  ".pptx",
  "text/csv",
  ".csv",
  "text/plain",
  ".txt",
].join(",");

export const isImageAttachment = (type?: string | null) =>
  String(type || "").startsWith("image/");
export const isVideoAttachment = (type?: string | null) =>
  String(type || "").startsWith("video/");

/**
 * Every upload field in the app used the browser's own "Choose File / No
 * file chosen" control — different on every OS, impossible to restyle, and
 * gives no feedback once a file is actually picked beyond that one grey
 * label. This puts a real (accessible, still-submits-with-the-form) file
 * input behind a click-or-drag box that shows what was picked and, via the
 * optional `hint`, what's accepted — so a form finally looks like the rest
 * of it instead of falling back to OS chrome.
 *
 * The box is a <span >, not a <label>, even though every call site already
 * wraps it in its own `<label>Field name<FileField /></label>` — nesting a
 * second label inside that would be invalid HTML and made click-to-focus
 * unreliable across browsers. A plain click handler that calls
 * inputRef.current.click() does the same job; the real input still sits
 * inside the outer label, so that label's implicit "click anywhere in me
 * activates my control" behaviour keeps working exactly as it did for the
 * native input this replaces.
 */
export function FileField({
  hint,
  multiple,
  disabled,
  onChange,
  ...rest
}: { hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <span className="file-field">
      <span
        className={
          dragOver ? "file-field-control is-dragover" : "file-field-control"
        }
        onClick={(event) => {
          // inputRef.current.click() below dispatches its own bubbling
          // click, which reaches this same span a second time with the
          // input itself as the target — return then, or this recurses.
          if (event.target === inputRef.current) return;
          // Every call site already wraps this in its own
          // `<label>Field name<FileField /></label>` for the field-caption
          // styling — without stopping the bubble here, the *first* click
          // would open the native dialog once via inputRef.click() below
          // and a second time via that outer label's own implicit
          // "click landed on me, forward it to my nested control" behaviour.
          event.stopPropagation();
          inputRef.current?.click();
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragOver(false);
          const dropped = event.dataTransfer.files;
          // Assigning to the real input's .files (rather than reading the
          // drop event directly) is what makes a dropped file submit with
          // the form exactly like a picked one — and dispatching "change"
          // on it is what tells this component (and any onChange the
          // caller passed in) that something changed, the same event a
          // click-to-browse pick fires natively.
          if (!dropped.length || !inputRef.current) return;
          inputRef.current.files = dropped;
          inputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      >
        <svg
          className="file-field-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <span
          className={
            fileNames.length ? "file-field-text" : "file-field-text is-empty"
          }
        >
          {fileNames.length ? fileNames.join(", ") : "Click to browse, or drag a file here"}
        </span>
        <span className="file-field-button">Browse</span>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          disabled={disabled}
          className="file-field-input"
          onChange={(event) => {
            setFileNames(Array.from(event.target.files || []).map((f) => f.name));
            onChange?.(event);
          }}
          {...rest}
        />
      </span>
      {hint && <small className="field-note">{hint}</small>}
    </span>
  );
}

// Short badge for a stored file. Reads the extension first because that is
// what staff recognise, and falls back to the MIME type for files saved
// without one.
export function fileKindLabel(type?: string | null, name?: string | null) {
  const extension = String(name || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  const byExtension: Record<string, string> = {
    pdf: "PDF",
    doc: "WORD",
    docx: "WORD",
    xls: "EXCEL",
    xlsx: "EXCEL",
    xlsm: "EXCEL",
    csv: "CSV",
    ppt: "SLIDES",
    pptx: "SLIDES",
    txt: "TEXT",
    zip: "ZIP",
  };
  if (extension && byExtension[extension]) return byExtension[extension];
  const mime = String(type || "");
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word")) return "WORD";
  if (mime.includes("sheet") || mime.includes("excel")) return "EXCEL";
  if (mime.includes("presentation") || mime.includes("powerpoint"))
    return "SLIDES";
  if (mime.startsWith("text/")) return "TEXT";
  if (isImageAttachment(mime)) return "IMAGE";
  if (isVideoAttachment(mime)) return "VIDEO";
  return "FILE";
}

export const fileSizeLabel = (bytes?: number | string | null) => {
  const size = Number(bytes || 0);
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

// Non-media attachments can't be previewed inline, so they render as a
// labelled tile that opens the file in a new tab instead.
export function DocumentTile({ attachment }: { attachment: Row }) {
  const size = fileSizeLabel(attachment.sizeBytes);
  return (
    <a
      className="document-tile"
      href={`${BASE_PATH}/api/files?id=${attachment.id}`}
      target="_blank"
      rel="noreferrer"
    >
      <span className="document-tile-kind">
        {fileKindLabel(attachment.contentType, attachment.fileName)}
      </span>
      <span className="document-tile-name">{attachment.fileName}</span>
      {size && <small>{size}</small>}
    </a>
  );
}

export const uploadAttachment = async (
  file: File,
  contextType: string,
  recordId: number,
  uploadedBy = "Administrator",
  fileName?: string,
) => {
  const upload = await compressImageFile(file);
  const form = new FormData();
  form.set("file", upload);
  form.set("contextType", contextType);
  form.set("recordId", String(recordId));
  form.set("uploadedBy", uploadedBy);
  if (fileName) form.set("fileName", fileName);
  const response = await fetch(`${BASE_PATH}/api/files`, { method: "POST", body: form });
  const result = (await response.json()) as { error?: string; id?: number };
  if (!response.ok) throw new Error(result.error || "Unable to upload file");
  return result;
};
// Reuses an already-uploaded file's storage object under a second
// context/record — e.g. mirroring a reservation payment slip onto its
// linked Finance invoice payment — without uploading the bytes twice.
export const linkAttachment = async (
  attachmentId: number,
  contextType: string,
  recordId: number,
  uploadedBy = "Administrator",
) => {
  const form = new FormData();
  form.set("linkAttachmentId", String(attachmentId));
  form.set("contextType", contextType);
  form.set("recordId", String(recordId));
  form.set("uploadedBy", uploadedBy);
  const response = await fetch(`${BASE_PATH}/api/files`, { method: "POST", body: form });
  const result = (await response.json()) as { error?: string; id?: number };
  if (!response.ok) throw new Error(result.error || "Unable to link file");
  return result;
};
export const renameAttachment = async (attachmentId: number, fileName: string) => {
  const response = await fetch(`${BASE_PATH}/api/files?id=${attachmentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName }),
  });
  const result = (await response.json()) as { error?: string; ok?: boolean };
  if (!response.ok) throw new Error(result.error || "Unable to rename file");
  return result;
};

// Small shared atoms for the table-v2 redesign (inline row-expand tables) —
// see globals.css's "TABLE-FORM REDESIGN (V2)" section for the styling.
export function SearchIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span className={`v2-chevron ${expanded ? "expanded" : ""}`} aria-hidden>
      ›
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill status-${status}`}>{titleCase(status)}</span>
  );
}

/**
 * Shown inside a form when the last save was refused only because a figure
 * looked wrong. A blocked figure with no way past it is worse than no check
 * at all — some months really do use 1,200 kWh — so this turns the refusal
 * into a decision the staff member makes on the record.
 */
export function SuspiciousConfirm({
  message,
  checked,
  onChange,
}: {
  message: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!message) return null;
  return (
    <label className="wide suspicious-confirm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <b>I have checked this — the figure is correct</b>
        <small>{message}</small>
      </span>
    </label>
  );
}

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
export const formatIC = (raw: string) => {
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
  religion: initialReligion = "",
  races,
  religions,
  save,
}: {
  identityNo?: string;
  nationality?: string;
  nationalityOther?: string;
  state?: string;
  hometown?: string;
  race?: string;
  religion?: string;
  races: Row[];
  religions: Row[];
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
}) {
  const [nationality, setNationality] = useState(initialNationality);
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
          pattern={isInternational ? undefined : "\\d{6}-\\d{2}-\\d{4}"}
          title={
            isInternational
              ? undefined
              : "Enter the full IC number in the format 010101-01-0101"
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
        <RaceSelect
          name="race"
          races={races}
          defaultValue={initialRace}
          save={save}
        />
      </label>
      <label>
        Religion
        <ReligionSelect
          name="religion"
          religions={religions}
          defaultValue={initialReligion}
          save={save}
        />
      </label>
    </>
  );
}

export const COURSE_LEVELS = ["foundation", "diploma", "degree", "other"] as const;
export const COURSE_LEVEL_LABELS: Record<string, string> = {
  foundation: "Foundation",
  diploma: "Diploma",
  degree: "Degree",
  other: "Other",
};

// Type-to-filter a small staff-editable reference list (course, race,
// religion, ...), with an inline "add new" row when nothing matches — so an
// entry only ever has to be typed out in full once. Backs
// CourseSelect/RaceSelect/ReligionSelect below; all three used to be a
// plain `<select>` (course's was grouped by level — see git history)
// before this replaced them.
//
// Deliberately drops typed text that was never confirmed by clicking a
// match or "Add new" — same rule SearchSelect already uses elsewhere in
// this file — so a half-typed entry can't slip into a save as a throwaway
// free-text value that never makes it into the table backing this list.
function SearchCreateSelect({
  name,
  items,
  defaultValue,
  save,
  createAction,
  entityLabel,
  placeholder,
  renderMeta,
}: {
  name: string;
  items: Row[];
  defaultValue?: string;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
  /** e.g. "course-create" */
  createAction: string;
  /** e.g. "course" — human-readable, used only in copy */
  entityLabel: string;
  placeholder: string;
  renderMeta?: (item: Row) => string;
}) {
  const [query, setQuery] = useState(defaultValue || "");
  // The value that will actually submit — starts as whatever the record
  // already had (even if that name no longer matches anything in the
  // list, e.g. legacy free text), and only changes when the user picks a
  // match or adds a new one.
  const [confirmed, setConfirmed] = useState(defaultValue || "");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickAway = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, [open]);

  const matches = items.filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const exactMatch = items.some(
    (item) => item.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const choose = (itemName: string) => {
    setQuery(itemName);
    setConfirmed(itemName);
    setOpen(false);
  };

  const addNew = async () => {
    const itemName = query.trim();
    if (!itemName) return;
    setCreating(true);
    const ok = await save(
      { action: createAction, name: itemName },
      `${titleCase(entityLabel)} added`,
    );
    setCreating(false);
    if (ok) choose(itemName);
  };

  return (
    <div className="search-create-select" ref={wrapRef}>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <input type="hidden" name={name} value={confirmed} />
      {open && (
        <div className="search-create-select-dropdown">
          {matches.length > 0 ? (
            matches.map((item) => (
              <button
                key={item.id}
                type="button"
                className="search-create-select-option"
                onClick={() => choose(item.name)}
              >
                {item.name}
                {renderMeta && <small>{renderMeta(item)}</small>}
              </button>
            ))
          ) : query.trim() ? null : (
            <p className="search-create-select-empty">Start typing to search.</p>
          )}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              className="search-create-select-add"
              disabled={creating}
              onClick={addNew}
            >
              {creating
                ? "Adding…"
                : `+ Add "${query.trim()}" as new ${entityLabel}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SchoolSelect({
  name,
  schools,
  defaultValue,
  save,
}: {
  name: string;
  schools: Row[];
  defaultValue?: string;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
}) {
  return (
    <SearchCreateSelect
      name={name}
      items={schools}
      defaultValue={defaultValue}
      save={save}
      createAction="school-create"
      entityLabel="school"
      placeholder="Type to search or add a school..."
    />
  );
}

export function CourseSelect({
  name,
  courses,
  defaultValue,
  save,
}: {
  name: string;
  courses: Row[];
  defaultValue?: string;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
}) {
  return (
    <SearchCreateSelect
      name={name}
      items={courses}
      defaultValue={defaultValue}
      save={save}
      createAction="course-create"
      entityLabel="course"
      placeholder="Type to search or add a course..."
      renderMeta={(course) => COURSE_LEVEL_LABELS[course.level] || course.level}
    />
  );
}

export function RaceSelect({
  name,
  races,
  defaultValue,
  save,
}: {
  name: string;
  races: Row[];
  defaultValue?: string;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
}) {
  return (
    <SearchCreateSelect
      name={name}
      items={races}
      defaultValue={defaultValue}
      save={save}
      createAction="race-create"
      entityLabel="race"
      placeholder="Type to search or add a race..."
    />
  );
}

export function ReligionSelect({
  name,
  religions,
  defaultValue,
  save,
}: {
  name: string;
  religions: Row[];
  defaultValue?: string;
  save: (payload: Record<string, unknown>, success?: string) => Promise<any>;
}) {
  return (
    <SearchCreateSelect
      name={name}
      items={religions}
      defaultValue={defaultValue}
      save={save}
      createAction="religion-create"
      entityLabel="religion"
      placeholder="Type to search or add a religion..."
    />
  );
}

// A converted booking holds its room without anyone living in it until
// staff confirm the student turned up. That confirmation is reachable from
// three places — the reservation card, the tenant list row, and the tenant
// profile — so the dialog itself lives here and they all open the same one.
// `tenancy` is a student row carrying assignmentId / roomCode / checkInDate.
export function CheckInModal({
  tenancy,
  data,
  save,
  busy,
  suspicious = "",
  onClose,
}: {
  tenancy: Row;
  data: Data;
  save: any;
  busy: boolean;
  /** Set when the opening reading was refused for being far above normal. */
  suspicious?: string;
  onClose: () => void;
}) {
  const [meterValue, setMeterValue] = useState("");
  const [confirmMeter, setConfirmMeter] = useState(false);
  // The room's last recorded reading. Shown so staff have something to check
  // the number they just read off the meter against — and so a typo that
  // would hand the new tenant the previous occupant's usage is visible
  // before it becomes a charge.
  const lastReading = data.meterReadings
    .filter((reading) => String(reading.roomId) === String(tenancy.roomId))
    .sort((left, right) =>
      String(left.readingDate) === String(right.readingDate)
        ? Number(right.id) - Number(left.id)
        : String(right.readingDate).localeCompare(String(left.readingDate)),
    )[0];
  const belowLastReading =
    lastReading &&
    meterValue !== "" &&
    Number(meterValue) < Number(lastReading.readingValue);
  return (
    <Modal
      title="Check in"
      kicker={tenancy.fullName}
      description="Confirms the student has arrived and taken the keys. The room moves from held to occupied, and the date below replaces the planned move-in date on the tenancy."
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await save(
            {
              action: "assignment-check-in",
              assignmentId: tenancy.assignmentId,
              ...formValues(event),
              confirmSuspicious: confirmMeter,
            },
            "Student checked in",
          );
          if (ok) onClose();
        }}
      >
        <label className="wide">
          Room
          <input value={tenancy.roomCode || ""} readOnly />
        </label>
        <label>
          Actual arrival date
          <DateField name="checkInDate" type="date" required defaultValue={today} />
          <small className="field-note">
            Planned move-in was {dateLabel(tenancy.checkInDate) || "not set"}.
          </small>
        </label>
        <label>
          Opening meter reading (required)
          <input
            name="checkInMeter"
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="e.g. 1000"
            value={meterValue}
            onChange={(event) => setMeterValue(event.target.value)}
          />
          {/* Without a baseline, billing charges this tenant from the room's
              previous reading — i.e. for electricity the last occupant used
              before they ever arrived. That is why it is not optional. */}
          <small className="field-note">
            {lastReading
              ? `Last reading on this room: ${lastReading.readingValue} (${dateLabel(lastReading.readingDate)}).`
              : "No previous reading on this room — this becomes its first."}{" "}
            Billing charges electricity from this number onwards, so the
            student is never billed for the previous occupant&apos;s usage.
          </small>
          {belowLastReading && (
            <small className="field-note field-note-warn">
              This is lower than the last recorded reading — check the number
              before saving.
            </small>
          )}
        </label>
        <SuspiciousConfirm
          message={suspicious}
          checked={confirmMeter}
          onChange={setConfirmMeter}
        />
        <label className="wide">
          Arrival notes
          <input
            name="remarks"
            placeholder="e.g. access card 00123 issued, room inspected"
          />
        </label>
        <div className="form-actions wide">
          <button className="primary" disabled={busy}>
            Confirm check-in
          </button>
        </div>
      </form>
    </Modal>
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
                label: `${student.fullName} · ${student.roomCode} · ${student.hostelName}`,
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
        <DateField name="startDate" type="date" required />
      </label>
      {tenantType === "outside" && (
        <>
          <label>
            Paid until
            <DateField name="paidUntil" type="date" />
          </label>
          <label>
            Next payment due
            <DateField name="nextDueDate" type="date" />
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
  // Money and other long values need a smaller size or they overflow the card.
  const isLong = String(value).length >= 8;
  return (
    <article>
      <strong className={isLong ? "is-long" : undefined}>{value}</strong>
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
