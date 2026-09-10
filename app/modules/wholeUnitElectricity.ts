import type { Data, Row } from "./shared";

// Some units are taken as a whole by one party — CENTEX for the Subang
// Residences flats, Weststar Aviation for a handful of NDY ones. One tenancy
// carries the unit's rent, the students living there are recorded at zero,
// and the unit's entire electricity bill lands on that payer, empty rooms
// included. Their invoice is necessarily one lump sum, so Reports uses this
// to tell them what each room actually used.
//
// Same rule and same arithmetic as the block-let branch of
// computeCycleInvoices() in app/api/system/route.ts: a unit where somebody
// pays and somebody pays nothing, the latest two readings of every room, and
// the unit's total rounded up once at the hostel's rate. Kept out of the
// component so the two can be checked against each other.

export type WholeUnitRoom = {
  roomId: number;
  roomCode: string;
  meterSerial: string;
  previousDate: string;
  previousReading: number | null;
  currentDate: string;
  currentReading: number | null;
  usage: number;
  amount: number;
};

export type WholeUnitLet = {
  unitId: number;
  unitCode: string;
  hostelId: number;
  hostelName: string;
  billedTo: string;
  covered: number;
  roomsRead: number;
  rate: number;
  rooms: WholeUnitRoom[];
  usage: number;
  amount: number;
  /**
   * True where TNB invoices the unit directly and there are no room meters.
   * Its usage is genuinely zero here, not missing — saying so stops the unit
   * reading as a unit nobody has got round to metering.
   */
  tnbDirect: boolean;
};

/**
 * Every unit currently let as a whole, with its electricity worked out per
 * room. `upTo` caps the readings at a date, so the report can be run for a
 * past round rather than always the latest one.
 */
export function wholeUnitElectricity(data: Data, upTo = ""): WholeUnitLet[] {
  const byUnit = new Map<number, { payers: Row[]; covered: Row[] }>();
  for (const student of data.students) {
    if (student.assignmentStatus !== "active" || !student.unitId) continue;
    const unitId = Number(student.unitId);
    if (!byUnit.has(unitId)) byUnit.set(unitId, { payers: [], covered: [] });
    const entry = byUnit.get(unitId)!;
    if (Number(student.monthlyRental || 0) > 0) entry.payers.push(student);
    else entry.covered.push(student);
  }

  const readingsByRoom = new Map<number, Row[]>();
  for (const reading of data.meterReadings) {
    const roomId = Number(reading.roomId);
    if (!readingsByRoom.has(roomId)) readingsByRoom.set(roomId, []);
    readingsByRoom.get(roomId)!.push(reading);
  }

  // Every room of the unit, not only the ones somebody lives in — an empty
  // room's meter still runs and the payer is still charged for it.
  const roomsByUnit = new Map<number, Row[]>();
  for (const bed of data.bedSpaces) {
    const unitId = Number(bed.unitId);
    if (!roomsByUnit.has(unitId)) roomsByUnit.set(unitId, []);
    const rooms = roomsByUnit.get(unitId)!;
    if (!rooms.some((room) => room.roomId === bed.roomId)) rooms.push(bed);
  }

  const units: WholeUnitLet[] = [];
  for (const [unitId, { payers, covered }] of byUnit) {
    // A normal shared flat, where every occupant pays their own rent, keeps
    // the per-room split and does not belong in this report.
    if (!payers.length || !covered.length) continue;

    const unitRooms = (roomsByUnit.get(unitId) || [])
      .slice()
      .sort((left, right) =>
        String(left.roomLabel).localeCompare(String(right.roomLabel), undefined, {
          numeric: true,
        }),
      );
    const rate = Number(
      data.hostels.find(
        (hostel) => hostel.id === (unitRooms[0]?.hostelId ?? payers[0].hostelId),
      )?.electricityRate || 0,
    );

    const rooms: WholeUnitRoom[] = unitRooms.map((room) => {
      const readings = (readingsByRoom.get(Number(room.roomId)) || [])
        .filter((reading) => !upTo || String(reading.readingDate) <= upTo)
        .slice()
        .sort(
          (left, right) =>
            String(right.readingDate).localeCompare(String(left.readingDate)) ||
            Number(right.id) - Number(left.id),
        );
      const [current, previous] = readings;
      // One reading alone measures nothing — usage is the movement between
      // two, so a newly metered room waits for its next round.
      const usage =
        current &&
        previous &&
        Number(current.readingValue) > Number(previous.readingValue)
          ? Number(current.readingValue) - Number(previous.readingValue)
          : 0;
      return {
        roomId: Number(room.roomId),
        roomCode: `${room.unitCode}-${room.roomLabel}`,
        meterSerial: room.meterSerial || "",
        previousDate: previous ? String(previous.readingDate) : "",
        previousReading: previous ? Number(previous.readingValue) : null,
        currentDate: current ? String(current.readingDate) : "",
        currentReading: current ? Number(current.readingValue) : null,
        usage,
        amount: 0,
      };
    });

    const usage = rooms.reduce((sum, room) => sum + room.usage, 0);
    const amount = Math.ceil(usage * rate);
    // Carve the unit's bill up by usage, rounding on the running total so the
    // rooms add back up to exactly what the payer is billed.
    let carved = 0;
    let allocated = 0;
    for (const room of rooms) {
      carved += room.usage;
      const upToHere = usage ? Math.round((amount * carved) / usage) : 0;
      room.amount = upToHere - allocated;
      allocated = upToHere;
    }

    units.push({
      unitId,
      unitCode: String(unitRooms[0]?.unitCode ?? payers[0].unitCode ?? ""),
      hostelId: Number(unitRooms[0]?.hostelId ?? payers[0].hostelId ?? 0),
      hostelName: String(unitRooms[0]?.hostelName ?? payers[0].hostelName ?? ""),
      billedTo: payers.map((payer) => payer.fullName).join(" / "),
      covered: covered.length,
      tnbDirect: unitRooms[0]?.electricityBilling === "tnb-direct",
      roomsRead: rooms.filter((room) => room.currentReading !== null).length,
      rate,
      rooms,
      usage,
      amount,
    });
  }

  return units.sort((left, right) =>
    left.unitCode.localeCompare(right.unitCode, undefined, { numeric: true }),
  );
}
