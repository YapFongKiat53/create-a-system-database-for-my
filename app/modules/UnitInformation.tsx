"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  AttachmentGrid,
  DateField,
  FileField,
  Modal,
  ParkingRentalForm,
  SearchIcon,
  Stat,
  StatusPill,
  dateLabel,
  formValues,
  formatIC,
  genderLabel,
  titleCase,
  uploadAttachment,
} from "./shared";
import type { Data, Row } from "./shared";
import { BASE_PATH } from "../basePath";

// Line icons for the Rooms section of the unit drawer. Stroke-only and drawn
// in currentColor, so each takes the colour of the button or badge it is in.
const UNIT_ROOM_ICON_PATHS: Record<string, string> = {
  door: "M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01",
  plus: "M12 5v14M5 12h14",
  save: "M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3",
  bath: "M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2",
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
  key: "M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM10.8 12.2 20 3M17 6l3 3M14.5 8.5l2 2",
  bed: "M3 19v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 19v2M21 19v2M3 14h18M6 10V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4",
};

function UnitRoomIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={UNIT_ROOM_ICON_PATHS[name]} />
    </svg>
  );
}

const UNIT_ROOM_TONES = 5;

// bed_spaces.bed_type options surfaced in the room forms. Set once per room
// (not per bed code) and applied to every bed code under it — see
// "room-details"/"room-add" in app/api/system/route.ts. bunk-upper/
// bunk-lower exist in the backend enum for a future per-bed split but have
// no UI yet, so they are left out here.
const BED_TYPE_OPTIONS: [string, string][] = [
  ["unknown", "Not set"],
  ["single", "Single bed"],
  ["bunk", "Double decker"],
  ["queen", "Queen bed"],
  ["two-single", "Single bed × 2"],
];

const BED_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  BED_TYPE_OPTIONS,
);

function bedTypeLabel(value?: string | null) {
  return BED_TYPE_LABELS[value || "unknown"] || "Not set";
}

// One room in the unit drawer: settings up top, its codes on a shelf
// inside the same card. A component of its own only so the icon beside
// "Room type" can follow the dropdown as it changes — the form still reads
// the select itself when saved.
function UnitRoomCard({
  room,
  save,
  onView,
}: {
  room: Row;
  save: (payload: Record<string, unknown>, success?: string) => unknown;
  onView: () => void;
}) {
  const [roomType, setRoomType] = useState(String(room.type || "single"));
  const label = String(room.label || "");
  const beds: Row[] = room.beds || [];
  // The mockup's "4 room(s)" line was the same on every card; what staff
  // editing a room actually need to know is whether anyone is in it.
  const occupied = beds.filter((bed) => bed.status === "occupied").length;
  const reserved = beds.filter((bed) => bed.status === "reserved").length;
  const occupancy = !beds.length
    ? "No room codes yet"
    : occupied || reserved
      ? `${occupied} of ${beds.length} occupied${reserved ? ` · ${reserved} reserved` : ""}`
      : "Vacant";
  // Keyed on the letter, not the position, so Room B keeps its colour when
  // Room A is deleted.
  const tone = (label.charCodeAt(0) || 0) % UNIT_ROOM_TONES;

  return (
    <article className="unit-room">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(
            { action: "room-details", roomId: room.id, ...formValues(e) },
            "Room updated",
          );
        }}
      >
        {/* room-details rewrites the label on every save, and the card no
            longer has a field for it — renaming lives in View room. Sending
            the current label (controlled, so it follows a rename made
            there) keeps Save room from blanking it. */}
        <input type="hidden" name="roomLabel" value={label} readOnly />
        <div className="unit-room-head">
          <span className={`unit-room-avatar tone-${tone}`} aria-hidden="true">
            {label.slice(0, 2).toUpperCase() || "?"}
          </span>
          <div className="unit-room-title">
            <h4>Room {label}</h4>
            <small>{occupancy}</small>
          </div>
          <div className="unit-room-actions">
            <button className="secondary unit-room-btn">
              <UnitRoomIcon name="save" />
              Save room
            </button>
            <button
              type="button"
              className="primary unit-room-btn"
              onClick={onView}
            >
              <UnitRoomIcon name="eye" />
              View room
            </button>
            <button
              type="button"
              className="danger unit-room-btn"
              onClick={() =>
                save({ action: "room-delete", roomId: room.id }, "Room deleted")
              }
            >
              <UnitRoomIcon name="trash" />
              Delete room
            </button>
          </div>
        </div>
        <div className="unit-room-fields">
          <label className="unit-room-field">
            <span>Room type</span>
            <span className="unit-room-select">
              <UnitRoomIcon name={roomType === "sharing" ? "users" : "user"} />
              <select
                name="roomType"
                value={roomType}
                onChange={(event) => setRoomType(event.target.value)}
              >
                <option value="single">Single room</option>
                <option value="sharing">Sharing room</option>
              </select>
            </span>
          </label>
          <label className="unit-room-field">
            <span>Bathroom</span>
            <span className="unit-room-select">
              <UnitRoomIcon name="bath" />
              <select name="bathroomType" defaultValue={room.bathroomType}>
                <option value="unknown">Bathroom not set</option>
                <option value="attached">Attached</option>
                <option value="non-attached">Non-attached</option>
              </select>
            </span>
          </label>
          <label className="unit-room-field">
            <span>Bed type</span>
            <span className="unit-room-select">
              <UnitRoomIcon name="bed" />
              <select name="bedType" defaultValue={room.bedType || "unknown"}>
                {BED_TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </form>
      <div className="unit-room-codes">
        <div className="unit-room-codes-head">
          <UnitRoomIcon name="code" />
          <strong>Room Codes</strong>
          <span className="unit-room-codes-count">
            {beds.length} code{beds.length === 1 ? "" : "s"}
          </span>
        </div>
        {beds.length ? (
          <div className="unit-room-code-list">
            {beds.map((bed) => (
              <form
                key={bed.id}
                className="unit-room-code"
                onSubmit={(e) => {
                  e.preventDefault();
                  save(
                    { action: "bed-code", bedId: bed.id, ...formValues(e) },
                    "Room code updated",
                  );
                }}
              >
                <span className="unit-room-code-icon" aria-hidden="true">
                  <UnitRoomIcon name="key" />
                </span>
                <input
                  name="legacyCode"
                  defaultValue={bed.legacyCode}
                  aria-label="Room code"
                />
                <button className="secondary unit-room-btn">
                  <UnitRoomIcon name="save" />
                  Save code
                </button>
                <button
                  type="button"
                  className="danger unit-room-btn"
                  onClick={() =>
                    save(
                      { action: "bed-delete", bedId: bed.id },
                      "Room code deleted",
                    )
                  }
                >
                  <UnitRoomIcon name="trash" />
                  Delete
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="unit-room-code-empty">No codes in this room yet.</p>
        )}
      </div>
    </article>
  );
}

// Hostels that organise units into lettered/numbered blocks (e.g. Damai's
// D1/D2/D3, Nadayu's NB/NC/NE). Hostels not listed here have no block
// structure — their unit codes are plain numbers (Atria's "1201") or
// hostel-specific strings (Subang Residences' "SR23"), so the block step is
// skipped and staff type the whole unit code by hand, as before.
const UNIT_BLOCKS_BY_HOSTEL: Record<string, string[]> = {
  DAM: ["D1", "D2", "D3"],
  NDY: ["NB", "NC", "NE"],
};

// A fresh instance mounts every time the "Add unit" modal opens (the caller
// only renders it while `modal === "unit"`), so its hostel/block/suffix
// state always starts clean without needing a reset effect.
function AddUnitForm({
  data,
  save,
  busy,
  defaultHostelId,
  onDone,
}: {
  data: Data;
  save: any;
  busy: boolean;
  defaultHostelId?: string | number;
  onDone: () => void;
}) {
  const [hostelId, setHostelId] = useState(String(defaultHostelId || ""));
  const [block, setBlock] = useState("");
  const [unitSuffix, setUnitSuffix] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [includeOwner, setIncludeOwner] = useState(false);
  const [agreementType, setAgreementType] = useState("rental");
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [ownerIdentityNo, setOwnerIdentityNo] = useState("");

  const hostel = data.hostels.find((h) => String(h.id) === hostelId);
  const blockOptions = UNIT_BLOCKS_BY_HOSTEL[String(hostel?.code || "")] || [];
  const canViewOwner = data.currentUser?.permissions?.some(
    (permission: Row) =>
      permission.moduleKey === "units-owner" && permission.canView,
  );

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = block ? `${block}-${unitSuffix.trim()}` : unitCode.trim();
        const values = formValues(e);
        const unitResult = await save(
          { action: "unit-create", ...values, unitCode: code },
          "Unit added",
        );
        if (!unitResult?.id) return;
        if (includeOwner) {
          await save(
            { action: "unit-owner", unitId: unitResult.id, ...values },
            "Owner agreement saved",
          );
          if (agreementFile)
            await uploadAttachment(
              agreementFile,
              "agreement",
              unitResult.id,
              data.currentUser?.displayName,
            );
        }
        onDone();
      }}
    >
      <label>
        Hostel
        <select
          name="hostelId"
          required
          value={hostelId}
          onChange={(event) => {
            setHostelId(event.target.value);
            setBlock("");
            setUnitSuffix("");
            setUnitCode("");
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
      {blockOptions.length > 0 ? (
        <>
          <label>
            Block
            <select
              value={block}
              disabled={!hostelId}
              onChange={(event) => setBlock(event.target.value)}
            >
              <option value="">Select block</option>
              {blockOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unit number
            <div className="unit-code-input">
              {block && <span className="unit-code-prefix">{block}-</span>}
              <input
                required
                disabled={!block}
                value={unitSuffix}
                onChange={(event) => setUnitSuffix(event.target.value)}
                placeholder={block ? "e.g. 1301" : "Select a block first"}
              />
            </div>
          </label>
        </>
      ) : (
        <label>
          Unit number
          <input
            required
            disabled={!hostelId}
            value={unitCode}
            onChange={(event) => setUnitCode(event.target.value)}
            placeholder="e.g. NB-0801"
          />
        </label>
      )}
      <label>
        Gender
        <select name="gender">
          <option value="unspecified">Not set</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="mixed">Special / mixed</option>
        </select>
      </label>
      <p className="wide auto-address-note">
        Address is generated automatically from the selected hostel&apos;s
        address and the unit number.
      </p>
      {canViewOwner && (
        <label className="checkbox-field wide">
          <input
            type="checkbox"
            checked={includeOwner}
            onChange={(event) => setIncludeOwner(event.target.checked)}
          />{" "}
          Add owner &amp; agreement details now
        </label>
      )}
      {canViewOwner && includeOwner && (
        <>
          <div className="wide form-divider">
            <strong>Owner information</strong>
          </div>
          <label>
            Owner name
            <input name="ownerName" placeholder="e.g. John Doe" />
          </label>
          <label>
            IC
            <input
              name="ownerIdentityNo"
              placeholder="e.g. 010101-01-0101"
              value={ownerIdentityNo}
              onChange={(event) =>
                setOwnerIdentityNo(formatIC(event.target.value))
              }
              pattern="\d{6}-\d{2}-\d{4}"
              title="Enter the full IC number in the format 010101-01-0101"
            />
          </label>
          <label>
            Owner email
            <input name="ownerEmail" type="email" placeholder="e.g. john.doe@example.com" />
          </label>
          <label className="wide">
            Registered residential address
            <textarea
              name="registeredAddress"
              placeholder="e.g. 123, Jalan Merdeka, 50000 Kuala Lumpur"
            />
          </label>
          <label>
            Agreement type
            <select
              name="agreementType"
              value={agreementType}
              onChange={(event) => setAgreementType(event.target.value)}
            >
              <option value="rental">Rental basis</option>
              <option value="service">Service agreement</option>
            </select>
          </label>
          <label>
            Primary contact name
            <input name="primaryContactName" placeholder="e.g. John Doe" />
          </label>
          <label>
            Primary contact number
            <input name="primaryContactPhone" placeholder="e.g. 0123456789" />
          </label>
          <label>
            Secondary contact name
            <input name="secondaryContactName" placeholder="e.g. Jane Doe" />
          </label>
          <label>
            Secondary contact number
            <input name="secondaryContactPhone" placeholder="e.g. 0123456789" />
          </label>
          <div className="wide form-divider">
            <strong>Designated bank account</strong>
          </div>
          <label>
            Bank account number
            <input name="bankAccountNumber" placeholder="e.g. 1234567890" />
          </label>
          <label>
            Account holder
            <input name="bankAccountHolder" placeholder="e.g. John Doe" />
          </label>
          <label>
            Bank name
            <input name="bankName" placeholder="e.g. Maybank" />
          </label>
          <div className="wide form-divider">
            <strong>Lease information</strong>
          </div>
          <label>
            Lease start
            <DateField name="leaseStartDate" type="date" />
          </label>
          <label>
            Lease end
            <DateField name="leaseEndDate" type="date" />
          </label>
          {agreementType === "rental" ? (
            <>
              <label>
                Monthly owner rental
                <input name="monthlyLeaseRental" type="number" min="0" placeholder="e.g. 1000" />
              </label>
              <label>
                Security deposit
                <input name="securityDeposit" type="number" min="0" placeholder="e.g. 1000" />
              </label>
              <label>
                Utility deposit
                <input name="utilityDeposit" type="number" min="0" placeholder="e.g. 1000" />
              </label>
            </>
          ) : (
            <>
              <label>
                Monthly service percentage
                <input
                  name="servicePercentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 10"
                />
              </label>
              <label>
                New student commission
                <input name="commissionAmount" type="number" min="0" placeholder="e.g. 100" />
              </label>
              <label>
                Monthly cleaning fee
                <input name="monthlyCleaningFee" type="number" min="0" placeholder="e.g. 100" />
              </label>
              <label>
                Monthly water dispenser fee
                <input
                  name="monthlyWaterDispenserFee"
                  type="number"
                  min="0"
                  placeholder="e.g. 100"
                />
              </label>
            </>
          )}
          <div className="wide form-divider">
            <strong>Utility accounts</strong>
          </div>
          <label>
            TNB account
            <input name="tnbAccount" placeholder="e.g. 1234567890" />
          </label>
          <label>
            Air Selangor account
            <input name="airSelangorAccount" placeholder="e.g. 1234567890" />
          </label>
          <label>
            Indah Water account
            <input name="indahWaterAccount" placeholder="e.g. 1234567890" />
          </label>
          <label className="wide">
            Agreement notes
            <input name="ownerNotes" placeholder="e.g. Agreement notes" />
          </label>
          <label className="wide">
            Upload signed agreement
            <FileField
              accept={ATTACHMENT_ACCEPT}
              hint="Photo, PDF, Word, Excel or CSV."
              onChange={(event) =>
                setAgreementFile(event.target.files?.[0] || null)
              }
            />
          </label>
        </>
      )}
      <div className="form-actions wide">
        <button className="primary" disabled={busy}>
          Add unit
        </button>
      </div>
    </form>
  );
}

export function UnitsModule({
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
  const [query, setQuery] = useState("");
  const [activeHostelCode, setActiveHostelCode] = useState<string | null>(
    "all",
  );
  const [genderFilter, setGenderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unit, setUnit] = useState<Row | null>(null);
  const [drawerTab, setDrawerTab] = useState("general");
  const [modal, setModal] = useState("");
  const [editingAsset, setEditingAsset] = useState<Row | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Row | null>(null);
  const [recordingLotId, setRecordingLotId] = useState<
    string | number | null
  >(null);

  const ownerByUnit = useMemo(
    () =>
      new Map(
        data.owners.map((item) => [item.unitId, item] as const),
      ),
    [data.owners],
  );
  const owner = unit ? ownerByUnit.get(unit.id) : undefined;
  const cards = data.accessCards.filter((c) => c.unitId === unit?.id);
  const services = data.services.filter((s) => s.unitId === unit?.id);
  const beds = data.bedSpaces.filter((b) => b.unitId === unit?.id);

  const rooms = useMemo(() => {
    const map = new Map<number, Row>();
    for (const b of beds) {
      if (!map.has(b.roomId))
        map.set(b.roomId, {
          ...b,
          id: b.roomId,
          label: b.roomLabel,
          type: b.roomType,
          bathroomType: b.bathroomType,
          bedType: b.bedType,
          beds: [],
        });
      map.get(b.roomId)!.beds.push(b);
    }
    return [...map.values()];
  }, [beds]);

  const filtered = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    return data.units.filter((item) => {
      const itemOwner = ownerByUnit.get(item.id);
      const matchesQuery =
        !normalisedQuery ||
        `${item.unitCode} ${item.address || ""} ${itemOwner?.ownerName || ""}`
          .toLowerCase()
          .includes(normalisedQuery);
      const matchesGender =
        genderFilter === "all" || item.gender === genderFilter;
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;

      return matchesQuery && matchesGender && matchesStatus;
    });
  }, [data.units, ownerByUnit, query, genderFilter, statusFilter]);

  // One tab per hostel, in the order hostels were created — a new hostel
  // automatically gets its own tab without any code change.
  const unitsByHostel = useMemo(
    () =>
      data.hostels.map((hostel) => ({
        hostel,
        units: filtered.filter((item) => item.hostelCode === hostel.code),
      })),
    [data.hostels, filtered],
  );

  const activeGroup = unitsByHostel.find(
    (group) => group.hostel.code === activeHostelCode,
  );
  const isAllUnitHostels = activeHostelCode === "all";
  const activeUnits = isAllUnitHostels ? filtered : (activeGroup?.units ?? []);

  const canViewOwner = data.currentUser?.permissions?.some(
    (permission: Row) =>
      permission.moduleKey === "units-owner" && permission.canView,
  );
  return (
    <div className="table-v2">
      <section className="intro compact-intro">
        <div>
          <span className="section-kicker">PROPERTY & OWNER CONTROL</span>
          <h2>One record for every rented or managed unit.</h2>
          <p>
            General operational information is separate from owner agreements,
            banking and P&amp;L charges.
          </p>
        </div>
        <button className="v2-btn-primary" onClick={() => setModal("unit")}>
          + Add unit
        </button>
      </section>
      <section className="module-metrics">
        <Stat value={data.units.length} label="Units" />
        <Stat value={data.accessCards.length} label="Access cards" />
        <Stat value={data.services.length} label="Wi-Fi accounts" />
        <Stat value={data.parkingLots.length} label="Parking lots" />
      </section>
      <section className="panel">
        <div className="workspace-tabs">
          <button
            className={isAllUnitHostels ? "active" : ""}
            onClick={() => setActiveHostelCode("all")}
          >
            All ({filtered.length})
          </button>
          {unitsByHostel.map(({ hostel, units: hostelUnits }) => (
            <button
              key={hostel.id}
              className={activeHostelCode === hostel.code ? "active" : ""}
              onClick={() => setActiveHostelCode(hostel.code)}
            >
              {hostel.name} ({hostelUnits.length})
            </button>
          ))}
          {!unitsByHostel.length && <em>No hostels added yet.</em>}
        </div>
        <div className="v2-toolbar">
          <label className="v2-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Unit, owner or address"
            />
          </label>
          <select
            className="v2-pill-select"
            value={genderFilter}
            onChange={(event) => setGenderFilter(event.target.value)}
          >
            <option value="all">All genders</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="mixed">Special / mixed</option>
            <option value="unspecified">Not set</option>
          </select>
          <select
            className="v2-pill-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="return-planned">To surrender</option>
            <option value="surrendered">Surrendered</option>
          </select>
          <button
            className="v2-reset"
            onClick={() => {
              setQuery("");
              setGenderFilter("all");
              setStatusFilter("all");
            }}
          >
            Reset filters
          </button>
        </div>
      </section>

      {(activeGroup || isAllUnitHostels) && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <small>HOSTEL</small>
              <h3>{isAllUnitHostels ? "All hostels" : activeGroup!.hostel.name}</h3>
              <p>
                {isAllUnitHostels
                  ? "Every property combined."
                  : activeGroup!.hostel.address || "Address not set"}
              </p>
            </div>
            <span>
              {activeUnits.length} unit
              {activeUnits.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isAllUnitHostels && <th>Hostel</th>}
                  <th>Unit</th>
                  <th>Agreement / owner</th>
                  <th>Gender</th>
                  <th>Status</th>
                  <th>Access / Wi-Fi</th>
                  <th>Surrender</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {activeUnits.map((u) => {
                  const o = ownerByUnit.get(u.id);
                  const accessCardCount = data.accessCards.filter(
                    (c) => c.unitId === u.id,
                  ).length;
                  const wifiCount = data.services.filter(
                    (s) => s.unitId === u.id && s.serviceType === "wifi",
                  ).length;

                  return (
                    <tr key={u.id}>
                      {isAllUnitHostels && <td>{u.hostelName}</td>}
                      <td>
                        <strong>{u.unitCode}</strong>
                        <small>{u.address || "Address not set"}</small>
                      </td>
                      <td>
                        {o ? (
                          <>
                            <strong>{o.ownerName || "Owner not set"}</strong>
                            <small>
                              {titleCase(
                                o.agreementType || "Agreement not set",
                              )}
                            </small>
                          </>
                        ) : (
                          <>
                            <strong>Owner not set</strong>
                            <small>No agreement record</small>
                          </>
                        )}
                      </td>
                      <td>
                        <span className={`gender-pill ${u.gender}`}>
                          {genderLabel(u.gender)}
                        </span>
                      </td>
                      <td>
                        <StatusPill status={u.status} />
                      </td>
                      <td>
                        <strong>{accessCardCount}</strong>
                        <small>
                          {wifiCount} Wi-Fi account{wifiCount === 1 ? "" : "s"}
                        </small>
                      </td>
                      <td>
                        {u.surrenderDate ? dateLabel(u.surrenderDate) : "-"}
                        <small>
                          {u.surrenderDate ? "Surrender date" : "Not planned"}
                        </small>
                      </td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            setUnit(u);
                            setSelectedRoom(null);
                            setDrawerTab("general");
                          }}
                        >
                          Open unit
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!activeUnits.length && (
                  <tr>
                    <td colSpan={isAllUnitHostels ? 8 : 7}>
                      <em>
                        No units match this view
                        {activeGroup ? ` in ${activeGroup.hostel.name}` : ""}.
                      </em>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!activeGroup && !isAllUnitHostels && unitsByHostel.length > 0 && (
        <section className="panel">
          <em>Select a hostel above to view its units.</em>
        </section>
      )}
      {unit && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedRoom(null);
              setUnit(null);
            }
          }}
        >
          <aside className="unit-drawer">
            <div className="drawer-head">
              <div>
                <small>{unit.hostelName}</small>
                <h2>{unit.unitCode}</h2>
                <p>{unit.address}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedRoom(null);
                  setUnit(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="drawer-tabs">
              <button
                className={drawerTab === "general" ? "active" : ""}
                onClick={() => setDrawerTab("general")}
              >
                General information
              </button>
              {canViewOwner && (
                <button
                  className={drawerTab === "owner" ? "active" : ""}
                  onClick={() => setDrawerTab("owner")}
                >
                  Unit & owner agreement
                </button>
              )}
            </div>
            {drawerTab === "general" ? (
              <>
                <form
                  className="drawer-section unit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(
                      {
                        action: "unit-update",
                        unitId: unit.id,
                        ...formValues(e),
                      },
                      "General unit information saved",
                    );
                  }}
                >
                  <div className="section-title">
                    <div>
                      <small>EDIT UNIT</small>
                      <h3>Unit name, gender and status</h3>
                    </div>
                    <button className="primary compact" disabled={busy}>
                      Save
                    </button>
                  </div>
                  <div className="form-grid">
                    <label>
                      Unit name / code
                      <input
                        name="unitCode"
                        defaultValue={unit.unitCode}
                        required
                      />
                      <small className="field-note">
                        Edit the name here, then press Save. Renaming also
                        renames this unit&apos;s room codes (e.g.{" "}
                        {unit.unitCode}-A1).
                      </small>
                    </label>
                    <label>
                      Unit gender
                      <select name="gender" defaultValue={unit.gender}>
                        <option value="unspecified">Not set</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="mixed">Special / mixed</option>
                      </select>
                    </label>
                    <label>
                      Unit status
                      <select name="unitStatus" defaultValue={unit.status}>
                        <option value="active">Active</option>
                        <option value="return-planned">To surrender</option>
                        <option value="surrendered">Surrendered</option>
                      </select>
                    </label>
                    <label className="wide">
                      Address
                      <input name="address" defaultValue={unit.address} />
                    </label>
                    {unit.status !== "active" && (
                      <label>
                        Surrender date
                        <DateField
                          name="surrenderDate"
                          type="date"
                          defaultValue={unit.surrenderDate || ""}
                        />
                      </label>
                    )}
                    <label className="wide">
                      Surrender notes
                      <input
                        name="surrenderNotes"
                        placeholder="e.g. Student is relocating to a different unit"
                        defaultValue={unit.surrenderNotes}
                      />
                    </label>
                  </div>
                </form>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>DELETE UNIT</small>
                      <h3>Remove {unit.unitCode}</h3>
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
                        For units added by mistake. A unit with tenants,
                        reservations, tickets or meter readings can&apos;t be
                        deleted — surrender it instead.
                      </p>
                    </div>
                    <button
                      className="secondary compact"
                      disabled={busy}
                      style={{ color: '#991b1b', borderColor: '#fecaca' }}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Delete unit ${unit.unitCode}? This also removes its rooms, room codes, access cards and services. This cannot be undone.`,
                          )
                        )
                          return;
                        const ok = await save(
                          { action: "unit-delete", unitId: unit.id },
                          `Unit ${unit.unitCode} deleted`,
                        );
                        if (ok) setUnit(null);
                      }}
                    >
                      Delete unit
                    </button>
                  </div>
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>ACCESS CARDS</small>
                      <h3>{cards.length} cards</h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditingAsset(null);
                        setModal("card");
                      }}
                    >
                      + Add card
                    </button>
                  </div>
                  <div className="asset-list">
                    {cards.map((c) => (
                      <article key={c.id}>
                        <span className="asset-icon">AC</span>
                        <div>
                          <strong>{c.cardCode}</strong>
                          <small>
                            {titleCase(c.status)} · {c.notes || "No notes"}
                          </small>
                        </div>
                        <div className="asset-actions">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditingAsset(c);
                              setModal("card");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="danger compact"
                            onClick={() =>
                              save(
                                { action: "access-card-delete", cardId: c.id },
                                "Access card deleted",
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!cards.length && (
                    <p className="empty-copy">No access cards registered.</p>
                  )}
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>PARKING LOTS</small>
                      <h3>
                        {
                          data.parkingLots.filter(
                            (lot) => lot.unitId === unit.id,
                          ).length
                        }{" "}
                        lots under this unit
                      </h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => setModal("add-parking-lot")}
                    >
                      + Add parking lot
                    </button>
                  </div>
                  <div className="compact-list">
                    {data.parkingLots
                      .filter((lot) => lot.unitId === unit.id)
                      .map((lot) => {
                        const rental = data.parkingRentals.find(
                          (item) =>
                            item.parkingLotId === lot.id &&
                            item.status === "active",
                        );
                        return (
                          <span
                            key={lot.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <code>{lot.lotNumber}</code>
                            <b>{rental?.tenantName || "Available"}</b>
                            <small>
                              {titleCase(rental ? "rented" : lot.status)}
                            </small>
                            {!rental && lot.status === "available" && (
                              <button
                                type="button"
                                className="secondary compact"
                                style={{ marginLeft: "auto" }}
                                onClick={() => {
                                  setRecordingLotId(lot.id);
                                  setModal("parking");
                                }}
                              >
                                Record parking
                              </button>
                            )}
                          </span>
                        );
                      })}
                  </div>
                  {!data.parkingLots.filter((lot) => lot.unitId === unit.id)
                    .length && (
                    <p className="empty-copy">
                      No parking lots registered for this unit yet.
                    </p>
                  )}
                </section>
                <section className="drawer-section">
                  <div className="section-title">
                    <div>
                      <small>WI-FI SERVICE</small>
                      <h3>{services.length} service records</h3>
                    </div>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditingAsset(null);
                        setModal("wifi");
                      }}
                    >
                      + Add Wi-Fi
                    </button>
                  </div>
                  <div className="service-list">
                    {services.map((s) => (
                      <article key={s.id}>
                        <span className="asset-icon">WI</span>
                        <div>
                          <strong>
                            {s.provider || "Wi-Fi provider not set"} ·{" "}
                            {titleCase(s.status)}
                          </strong>
                          <small>
                            {s.accountHolderName || "Account holder not set"} ·{" "}
                            {s.accountReference || "No account number"}
                          </small>
                          <small>
                            {titleCase(s.lineType)} ·{" "}
                            {s.servicePackage || "Package not set"} · Contract{" "}
                            {dateLabel(s.contractEndDate)}
                          </small>
                          <small>
                            {s.surrenderAction === "relocate"
                              ? `Relocate · ${s.remarks || "Destination not set"}`
                              : `${titleCase(s.surrenderAction)} · ${s.remarks || "No remarks"}`}
                          </small>
                        </div>
                        <div className="asset-actions">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              setEditingAsset(s);
                              setModal("wifi");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="danger compact"
                            onClick={() =>
                              save(
                                { action: "service-delete", serviceId: s.id },
                                "Wi-Fi record deleted",
                              )
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!services.length && (
                    <p className="empty-copy">
                      No Wi-Fi service added. Use Add Wi-Fi to enter details.
                    </p>
                  )}
                </section>
                <section className="drawer-section">
                  <div className="unit-rooms-head">
                    <span className="unit-rooms-head-icon" aria-hidden="true">
                      <UnitRoomIcon name="door" />
                    </span>
                    <div>
                      <h3>Rooms</h3>
                      <p>
                        {rooms.length} room{rooms.length === 1 ? "" : "s"} ·
                        room settings and codes
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary unit-room-btn"
                      onClick={() => setModal("room")}
                    >
                      <UnitRoomIcon name="plus" />
                      Add room
                    </button>
                  </div>
                  <div className="unit-rooms">
                    {rooms.map((room) => (
                      <UnitRoomCard
                        key={room.id}
                        room={room}
                        save={save}
                        onView={() => setSelectedRoom(room)}
                      />
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <OwnerAgreement
                unit={unit}
                owner={owner}
                attachments={data.attachments.filter(
                  (attachment) =>
                    attachment.contextType === "agreement" &&
                    attachment.recordId === unit.id,
                )}
                uploadedBy={data.currentUser?.displayName}
                save={save}
                busy={busy}
                load={load}
              />
            )}
          </aside>
        </div>
      )}
      {selectedRoom && unit && (
        <RoomOverviewPanel
          unit={unit}
          room={selectedRoom}
          attachments={data.attachments.filter(
            (attachment) =>
              attachment.contextType === "room" &&
              attachment.recordId === selectedRoom.id,
          )}
          uploadedBy={data.currentUser?.displayName}
          save={save}
          busy={busy}
          load={load}
          onClose={() => setSelectedRoom(null)}
        />
      )}
      {modal === "unit" && (
        <Modal
          title="Add unit"
          kicker="UNIT REGISTER"
          onClose={() => setModal("")}
          wide
        >
          <AddUnitForm
            data={data}
            save={save}
            busy={busy}
            defaultHostelId={activeGroup?.hostel.id}
            onDone={() => setModal("")}
          />
        </Modal>
      )}
      {modal === "card" && unit && (
        <Modal
          title={editingAsset ? "Edit access card" : "Add access card"}
          kicker={unit.unitCode}
          onClose={() => {
            setModal("");
            setEditingAsset(null);
          }}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingAsset ? "access-card-update" : "access-card",
                  cardId: editingAsset?.id,
                  unitId: unit.id,
                  ...formValues(e),
                },
                editingAsset ? "Access card updated" : "Access card added",
              );
              if (ok) {
                setModal("");
                setEditingAsset(null);
              }
            }}
          >
            <label>
              Card number
              <input
                name="cardCode"
                required
                defaultValue={editingAsset?.cardCode || ""}
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingAsset?.status || "available"}
              >
                <option value="available">Available</option>
                <option value="issued">Issued</option>
                <option value="lost">Lost</option>
                <option value="replaced">Replaced</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label>
              Notes
              <input name="notes" defaultValue={editingAsset?.notes || ""} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingAsset ? "Update card" : "Save card"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "wifi" && unit && (
        <Modal
          title={editingAsset ? "Edit Wi-Fi service" : "Add Wi-Fi service"}
          kicker={unit.unitCode}
          onClose={() => {
            setModal("");
            setEditingAsset(null);
          }}
          wide
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: editingAsset ? "service-update" : "unit-service",
                  serviceId: editingAsset?.id,
                  unitId: unit.id,
                  ...formValues(e),
                },
                editingAsset ? "Wi-Fi service updated" : "Wi-Fi service added",
              );
              if (ok) {
                setModal("");
                setEditingAsset(null);
              }
            }}
          >
            <label>
              Account holder
              <input
                name="accountHolderName"
                defaultValue={editingAsset?.accountHolderName || ""}
              />
            </label>
            <label>
              Account number
              <input
                name="accountReference"
                defaultValue={editingAsset?.accountReference || ""}
              />
            </label>
            <label>
              Provider
              <input
                name="provider"
                defaultValue={editingAsset?.provider || ""}
                placeholder="TIME, Unifi..."
              />
            </label>
            <label>
              Main / sub line
              <select
                name="lineType"
                defaultValue={editingAsset?.lineType || "main"}
              >
                <option value="main">Main line</option>
                <option value="sub">Sub line</option>
              </select>
            </label>
            <label>
              Contract end
              <DateField
                name="contractEndDate"
                type="date"
                defaultValue={editingAsset?.contractEndDate || ""}
              />
            </label>
            <label>
              Service package
              <input
                name="servicePackage"
                defaultValue={editingAsset?.servicePackage || ""}
              />
            </label>
            <label>
              Username
              <input
                name="username"
                defaultValue={editingAsset?.username || ""}
                autoComplete="off"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              Status
              <select
                name="status"
                defaultValue={editingAsset?.status || "active"}
              >
                <option value="active">Active</option>
                <option value="to-surrender">To surrender</option>
                <option value="surrendered">Surrendered</option>
                <option value="relocated">Relocated</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label>
              On surrender
              <select
                name="surrenderAction"
                defaultValue={editingAsset?.surrenderAction || "review"}
              >
                <option value="review">Review</option>
                <option value="terminate">Terminate</option>
                <option value="transfer">Transfer ownership</option>
                <option value="relocate">Relocate to another unit</option>
              </select>
            </label>
            <label className="wide">
              Remarks / relocated to
              <input
                name="remarks"
                defaultValue={editingAsset?.remarks || ""}
                placeholder="Destination unit or termination note"
              />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                {editingAsset ? "Update Wi-Fi" : "Add Wi-Fi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "parking" && recordingLotId !== null && (
        <Modal
          title="Record parking"
          kicker={unit?.unitCode || ""}
          onClose={() => {
            setModal("");
            setRecordingLotId(null);
          }}
          wide
        >
          <ParkingRentalForm
            data={data}
            save={save}
            busy={busy}
            lockedLotId={recordingLotId}
            onDone={() => {
              setModal("");
              setRecordingLotId(null);
            }}
          />
        </Modal>
      )}
      {modal === "add-parking-lot" && unit && (
        <Modal
          title="Add parking lot"
          kicker={unit.unitCode}
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                {
                  action: "parking-lot",
                  hostelId: unit.hostelId,
                  unitId: unit.id,
                  ...formValues(e),
                },
                "Parking lot added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Lot number
              <input name="lotNumber" required placeholder="e.g. NB-0801"/>
            </label>
            <label>
              Status
              <select name="status" defaultValue="available">
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="wide">
              Notes
              <input name="notes" />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Save lot
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "room" && unit && (
        <Modal
          title="Add room"
          kicker={unit.unitCode}
          description="Sharing rooms can have up to five room codes / occupants."
          onClose={() => setModal("")}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await save(
                { action: "room-add", unitId: unit.id, ...formValues(e) },
                "Room added",
              );
              if (ok) setModal("");
            }}
          >
            <label>
              Room category / label
              <input name="roomLabel" required placeholder="A, B, C..." />
            </label>
            <label>
              Room type
              <select name="roomType">
                <option value="single">Single room</option>
                <option value="sharing">Sharing room</option>
              </select>
            </label>
            <label>
              Bathroom
              <select name="bathroomType">
                <option value="unknown">Not set</option>
                <option value="attached">Attached</option>
                <option value="non-attached">Non-attached</option>
              </select>
            </label>
            <label>
              Bed type
              <select name="bedType">
                {BED_TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Number of room codes / beds
              <input
                name="bedCount"
                type="number"
                min="1"
                max="5"
                defaultValue="1"
              />
            </label>
            <label>
              Room code prefix
              <input name="codePrefix" placeholder={`${unit.unitCode}-A`} />
            </label>
            <div className="form-actions wide">
              <button className="primary" disabled={busy}>
                Add room
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}


const ROOM_AMENITIES = [
  { key: "bed", label: "Bed" },
  { key: "mattress", label: "Mattress" },
  { key: "study-table", label: "Study table" },
  { key: "chair", label: "Chair" },
  { key: "wardrobe", label: "Wardrobe" },
  { key: "air-conditioner", label: "Air-conditioner" },
  { key: "ceiling-fan", label: "Ceiling fan" },
  { key: "curtain-blind", label: "Curtain / blind" },
  { key: "power-sockets", label: "Power sockets" },
  { key: "wifi", label: "Wi-Fi coverage" },
];

function normaliseAmenities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Older records may store comma-separated values.
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function roomValue(room: Row, key: string, fallback: any = "") {
  const direct = room?.[key];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  const firstBed = room?.beds?.[0];
  const bedValue = firstBed?.[key];
  return bedValue !== undefined && bedValue !== null && bedValue !== ""
    ? bedValue
    : fallback;
}

function RoomOverviewPanel({
  unit,
  room,
  attachments,
  uploadedBy,
  save,
  busy,
  load,
  onClose,
}: {
  unit: Row;
  room: Row;
  attachments: Row[];
  uploadedBy?: string;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [fileFieldKey, setFileFieldKey] = useState(0);
  const [amenities, setAmenities] = useState<string[]>(
    normaliseAmenities(roomValue(room, "amenities", [])),
  );

  const beds: Row[] = room.beds || [];
  const primaryBed = beds[0] || {};
  const roomCode =
    primaryBed.legacyCode || `${unit.unitCode}-${String(room.label || "Room")}`;
  const occupiedBeds = beds.filter(
    (bed) =>
      bed.status === "occupied" ||
      bed.occupantId ||
      bed.tenantId ||
      bed.studentId,
  ).length;
  const capacity = Math.max(beds.length, 1);
  const isOccupied = occupiedBeds > 0;
  const monthlyRate = roomValue(
    room,
    "monthlyRate",
    roomValue(room, "salesRate", roomValue(room, "rent", "")),
  );
  // Used for the small preview thumbnail in the header only — the full
  // photo/document list below renders through AttachmentGrid instead.
  const roomPhotos = attachments.filter((attachment) =>
    String(attachment.contentType || attachment.fileType || "").startsWith(
      "image/",
    ),
  );

  const toggleAmenity = (key: string) => {
    setAmenities((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  return (
    <div
      className="room-overview-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="room-overview-panel">
        <header className="room-overview-header">
          <div>
            <button type="button" className="text-button" onClick={onClose}>
              ← Back to {unit.unitCode}
            </button>
            <small>
              {unit.hostelName} / {unit.unitCode}
            </small>
            <h2>Room {room.label}</h2>
            <p>Room information, contents, photos and inspection condition.</p>
          </div>
          <button type="button" className="room-close" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="room-hero-card">
          <div className="room-photo-cover">
            {roomPhotos[0] ? (
              <img
                src={`${BASE_PATH}/api/files?id=${roomPhotos[0].id}`}
                alt={`${roomCode} cover`}
              />
            ) : (
              <div className="room-photo-placeholder">
                <span>ROOM</span>
                <small>No photo uploaded</small>
              </div>
            )}
            <span className="photo-count">▧ {roomPhotos.length}</span>
          </div>
          <div className="room-hero-main">
            <div className="room-title-line">
              <div>
                <h3>{roomCode}</h3>
                <span className="room-type-pill">
                  Room {room.label} · {titleCase(room.type || "single")}
                </span>
              </div>
              <span className={`room-availability ${isOccupied ? "occupied" : "vacant"}`}>
                {isOccupied ? "Occupied" : "Vacant"}
              </span>
            </div>
            <div className="room-hero-facts">
              <span>
                <small>Hostel</small>
                <strong>{unit.hostelName}</strong>
              </span>
              <span>
                <small>Unit</small>
                <strong>{unit.unitCode}</strong>
              </span>
              <span>
                <small>Bathroom</small>
                <strong>{titleCase(room.bathroomType || "not set")}</strong>
              </span>
              <span>
                <small>Monthly rate</small>
                <strong>{monthlyRate ? `RM ${monthlyRate}` : "Not set"}</strong>
              </span>
              <span>
                <small>Availability</small>
                <strong>{isOccupied ? "Currently occupied" : "Available now"}</strong>
              </span>
            </div>
          </div>
        </section>

        <section className="room-stat-grid">
          <article>
            <span className="room-stat-icon">✓</span>
            <div>
              <small>Room status</small>
              <strong>{isOccupied ? "Occupied" : "Vacant"}</strong>
              <p>{isOccupied ? "Tenant assigned" : "Ready to assign"}</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">RM</span>
            <div>
              <small>Monthly rent</small>
              <strong>{monthlyRate ? `RM ${monthlyRate}` : "Not set"}</strong>
              <p>Sales rate per month</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">◎</span>
            <div>
              <small>Occupancy</small>
              <strong>
                {occupiedBeds} / {capacity}
              </strong>
              <p>{Math.round((occupiedBeds / capacity) * 100)}% occupied</p>
            </div>
          </article>
          <article>
            <span className="room-stat-icon">▰</span>
            <div>
              <small>Bed type</small>
              <strong>{bedTypeLabel(room.bedType)}</strong>
              <p>{titleCase(room.bathroomType || "Bathroom not set")}</p>
            </div>
          </article>
        </section>

        <form
          className="room-overview-layout"
          onSubmit={async (event) => {
            event.preventDefault();
            await save(
              {
                action: "room-details",
                roomId: room.id,
                ...formValues(event),
                amenities: JSON.stringify(amenities),
              },
              "Room overview updated",
            );
          }}
        >
          <div className="room-main-column">
            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM CONFIGURATION</small>
                  <h3>Basic room information</h3>
                </div>
              </div>
              <div className="form-grid room-edit-grid">
                <label>
                  Room label
                  <input name="roomLabel" defaultValue={room.label} />
                </label>
                <label>
                  Room type
                  <select name="roomType" defaultValue={room.type}>
                    <option value="single">Single room</option>
                    <option value="sharing">Sharing room</option>
                  </select>
                </label>
                <label>
                  Bathroom
                  <select name="bathroomType" defaultValue={room.bathroomType}>
                    <option value="unknown">Bathroom not set</option>
                    <option value="attached">Attached</option>
                    <option value="non-attached">Non-attached</option>
                  </select>
                </label>
                <label>
                  Bed type
                  <select name="bedType" defaultValue={room.bedType || "unknown"}>
                    {BED_TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Monthly sales rate
                  <input
                    name="monthlyRate"
                    type="number"
                    min="0"
                    defaultValue={monthlyRate}
                    placeholder="800"
                  />
                </label>
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>INCLUDED IN THIS ROOM</small>
                  <h3>Furniture and facilities</h3>
                </div>
                <span>{amenities.length} selected</span>
              </div>
              <div className="amenity-grid">
                {ROOM_AMENITIES.map((item) => {
                  const included = amenities.includes(item.key);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`amenity-tile ${included ? "included" : ""}`}
                      onClick={() => toggleAmenity(item.key)}
                    >
                      <span>{included ? "✓" : "+"}</span>
                      <b>{item.label}</b>
                      <small>{included ? "Included" : "Not included"}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM CODES & BEDS</small>
                  <h3>{beds.length} bed space record(s)</h3>
                </div>
              </div>
              <div className="room-bed-table">
                {beds.map((bed) => (
                  <div key={bed.id}>
                    <code>{bed.legacyCode || "Code not set"}</code>
                    <span>{bedTypeLabel(bed.bedType)}</span>
                    <span>{titleCase(bed.status || "Vacant")}</span>
                  </div>
                ))}
                {!beds.length && <p className="empty-copy">No bed spaces added.</p>}
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>NOTES & REMARKS</small>
                  <h3>Operational notes</h3>
                </div>
              </div>
              <label className="room-notes-field">
                Notes
                <textarea
                  name="roomNotes"
                  defaultValue={roomValue(room, "roomNotes", roomValue(room, "notes", ""))}
                  placeholder="Add room-specific notes, defects or instructions"
                />
              </label>
            </section>
          </div>

          <div className="room-side-column">
            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>BATHROOM & UTILITIES</small>
                  <h3>Facilities status</h3>
                </div>
              </div>
              <div className="utility-fields">
                <label>
                  Water heater
                  <select name="waterHeater" defaultValue={roomValue(room, "waterHeater", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Sink / basin
                  <select name="sinkBasin" defaultValue={roomValue(room, "sinkBasin", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Lighting
                  <select name="lighting" defaultValue={roomValue(room, "lighting", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
                <label>
                  Ventilation
                  <select name="ventilation" defaultValue={roomValue(room, "ventilation", "unknown")}>
                    <option value="unknown">Not set</option>
                    <option value="available">Available</option>
                    <option value="not-available">Not available</option>
                    <option value="repair">Needs repair</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>ROOM PHOTOS &amp; FILES</small>
                  <h3>{attachments.length} uploaded</h3>
                </div>
              </div>
              {attachments.length > 0 ? (
                <AttachmentGrid
                  attachments={attachments}
                  onDeleted={() => load(["attachments"])}
                  compact
                />
              ) : (
                <div className="room-photo-empty">
                  No room photos or files yet
                </div>
              )}
              <label className="room-photo-upload">
                Add photo or file
                <FileField
                  key={fileFieldKey}
                  accept={ATTACHMENT_ACCEPT}
                  disabled={uploadingPhoto}
                  hint={
                    uploadingPhoto
                      ? "Uploading…"
                      : "Photo, PDF, Word, Excel or CSV. Uploads immediately."
                  }
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploadingPhoto(true);
                    try {
                      await uploadAttachment(file, "room", room.id, uploadedBy);
                      await load(["attachments"]);
                      setFileFieldKey((key) => key + 1);
                    } finally {
                      setUploadingPhoto(false);
                    }
                  }}
                />
              </label>
            </section>

            <section className="room-content-card">
              <div className="room-card-heading">
                <div>
                  <small>CONDITION / INSPECTION</small>
                  <h3>Latest room condition</h3>
                </div>
              </div>
              <div className="inspection-fields">
                {[
                  ["cleanliness", "Cleanliness"],
                  ["furnitureCondition", "Furniture condition"],
                  ["electricalCondition", "Electrical & sockets"],
                  ["wallCondition", "Wall & paint"],
                ].map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <select name={name} defaultValue={roomValue(room, name, "not-set")}>
                      <option value="not-set">Not set</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="repair">Needs repair</option>
                    </select>
                  </label>
                ))}
                <label>
                  Last inspected on
                  <DateField
                    name="lastInspectedOn"
                    type="date"
                    defaultValue={roomValue(room, "lastInspectedOn", "")}
                  />
                </label>
              </div>
            </section>

            <div className="room-save-bar">
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Save room overview
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}

function OwnerAgreement({
  unit,
  owner,
  attachments,
  uploadedBy,
  save,
  busy,
  load,
}: {
  unit: Row;
  owner: Row | undefined;
  attachments: Row[];
  uploadedBy?: string;
  save: any;
  busy: boolean;
  load: (modules?: string[]) => Promise<void>;
}) {
  const [type, setType] = useState(owner?.agreementType || "rental");
  const [uploadingAgreement, setUploadingAgreement] = useState(false);
  const [fileFieldKey, setFileFieldKey] = useState(0);
  return (
    <form
      className="drawer-section owner-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await save(
          { action: "unit-owner", unitId: unit.id, ...formValues(e) },
          "Owner agreement saved",
        );
      }}
    >
      <div className="section-title">
        <div>
          <small>UNIT & OWNER INFORMATION</small>
          <h3>Agreement, banking and charges</h3>
        </div>
        <button className="primary compact" disabled={busy}>
          Save owner
        </button>
      </div>
      <div className="form-grid">
        <div className="wide form-divider">
          <strong>Owner information</strong>
        </div>
        <label>
          Owner name
          <input name="ownerName" placeholder="e.g. John Doe" defaultValue={owner?.ownerName || ""} />
        </label>
        <label>
          IC
          <input
            name="ownerIdentityNo"
            placeholder="e.g. 010101-01-0101"
            defaultValue={formatIC(owner?.ownerIdentityNo || "")}
            onChange={(event) => {
              event.currentTarget.value = formatIC(event.currentTarget.value);
            }}
            pattern="\d{6}-\d{2}-\d{4}"
            title="Enter the full IC number in the format 010101-01-0101"
          />
        </label>
        <label>
          Owner email
          <input
            name="ownerEmail"
            placeholder="e.g. john.doe@example.com"
            type="email"
            defaultValue={owner?.ownerEmail || ""}
          />
        </label>
        <label className="wide">
          Registered residential address
          <textarea
            name="registeredAddress"
            placeholder="e.g. 123, Jalan Merdeka, 50000 Kuala Lumpur"
            defaultValue={owner?.registeredAddress || ""}
          />
        </label>
        <label>
          Agreement type
          <select
            name="agreementType"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="rental">Rental basis</option>
            <option value="service">Service agreement</option>
          </select>
        </label>
        <label>
          Primary contact name
          <input
            name="primaryContactName"
            placeholder="e.g. John Doe"
            defaultValue={owner?.primaryContactName || ""}
          />
        </label>
        <label>
          Primary contact number
          <input
            name="primaryContactPhone"
            placeholder="e.g. 0123456789"
            defaultValue={owner?.primaryContactPhone || ""}
          />
        </label>
        <label>
          Secondary contact name
          <input
            name="secondaryContactName"
            placeholder="e.g. Jane Doe"
            defaultValue={owner?.secondaryContactName || ""}
          />
        </label>
        <label>
          Secondary contact number
          <input
            name="secondaryContactPhone"
            placeholder="e.g. 0123456789"
            defaultValue={owner?.secondaryContactPhone || ""}
          />
        </label>
        <div className="wide form-divider">
          <strong>Designated bank account</strong>
        </div>
        <label>
          Bank account number
          <input
            name="bankAccountNumber"
            placeholder="e.g. 1234567890"
            defaultValue={owner?.bankAccountNumber || ""}
          />
        </label>
        <label>
          Account holder
          <input
            name="bankAccountHolder"
            placeholder="e.g. John Doe"
            defaultValue={owner?.bankAccountHolder || ""}
          />
        </label>
        <label>
          Bank name
          <input name="bankName" placeholder="e.g. Maybank" defaultValue={owner?.bankName || ""} />
        </label>
        <div className="wide form-divider">
          <strong>Lease information</strong>
        </div>
        <label>
          Lease start
          <DateField
            name="leaseStartDate"
            type="date"
            placeholder="e.g. 2026-01-01"
            defaultValue={owner?.leaseStartDate || ""}
          />
        </label>
        <label>
          Lease end
          <DateField
            name="leaseEndDate"
            type="date"
            placeholder="e.g. 2026-01-01"
            defaultValue={owner?.leaseEndDate || ""}
          />
        </label>
        {type === "rental" ? (
          <>
            <label>
              Monthly owner rental
              <input
                name="monthlyLeaseRental"
                type="number"
                min="0"
                placeholder="e.g. 1000"
                defaultValue={owner?.monthlyLeaseRental ?? ""}
              />
            </label>
            <label>
              Security deposit
              <input
                name="securityDeposit"
                type="number"
                min="0"
                placeholder="e.g. 1000"
                defaultValue={owner?.securityDeposit ?? ""}
              />
            </label>
            <label>
              Utility deposit
              <input
                name="utilityDeposit"
                type="number"
                min="0"
                placeholder="e.g. 1000"
                defaultValue={owner?.utilityDeposit ?? ""}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Monthly service percentage
              <input
                name="servicePercentage"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="e.g. 10"
                defaultValue={owner?.servicePercentage ?? ""}
              />
            </label>
            <label>
              New student commission
              <input
                name="commissionAmount"
                type="number"
                min="0"
                placeholder="e.g. 100"
                defaultValue={owner?.commissionAmount ?? ""}
              />
            </label>
            <label>
              Monthly cleaning fee
              <input
                name="monthlyCleaningFee"
                type="number"
                min="0"
                placeholder="e.g. 100"
                defaultValue={owner?.monthlyCleaningFee ?? ""}
              />
            </label>
            <label>
              Monthly water dispenser fee
              <input
                name="monthlyWaterDispenserFee"
                type="number"
                min="0"
                placeholder="e.g. 100"
                defaultValue={owner?.monthlyWaterDispenserFee ?? ""}
              />
            </label>
          </>
        )}
        <div className="wide form-divider">
          <strong>Utility accounts</strong>
        </div>
        <label>
          TNB account
          <input name="tnbAccount" placeholder="e.g. 1234567890" defaultValue={owner?.tnbAccount || ""} />
        </label>
        <label>
          Air Selangor account
          <input
            name="airSelangorAccount"
            placeholder="e.g. 1234567890"
            defaultValue={owner?.airSelangorAccount || ""}
          />
        </label>
        <label>
          Indah Water account
          <input
            name="indahWaterAccount"
            placeholder="e.g. 1234567890"
            defaultValue={owner?.indahWaterAccount || ""}
          />
        </label>
        <label className="wide">
          Agreement notes
          <input name="ownerNotes" placeholder="e.g. Agreement notes" defaultValue={owner?.notes || ""} />
        </label>
        <label className="wide">
          Upload signed agreement
          <FileField
            key={fileFieldKey}
            accept={ATTACHMENT_ACCEPT}
            disabled={uploadingAgreement}
            hint={
              uploadingAgreement
                ? "Uploading…"
                : "Photo, PDF, Word, Excel or CSV. Uploads immediately."
            }
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setUploadingAgreement(true);
              try {
                await uploadAttachment(file, "agreement", unit.id, uploadedBy);
                await load(["attachments"]);
                setFileFieldKey((key) => key + 1);
              } finally {
                setUploadingAgreement(false);
              }
            }}
          />
        </label>
        {attachments.length > 0 && (
          <div className="wide">
            <strong>Stored agreements</strong>
            <AttachmentGrid
              attachments={attachments}
              onDeleted={() => load(["attachments"])}
              compact
            />
          </div>
        )}
      </div>
    </form>
  );
}