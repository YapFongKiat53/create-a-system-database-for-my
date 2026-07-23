type HostelSeed = {
  id:number;
  code:string;
  name:string;
  address:string;
  units:number;
  occupied:number;
  vacant:number;
  specialUse:number;
  femaleVacant:number;
  maleVacant:number;
};

const hostelSeeds:HostelSeed[] = [
  { id:1, code:"ATR", name:"Atria", address:"Jalan Nova U5/71A, Subang Bestari, 40150 Shah Alam, Selangor", units:5, occupied:17, vacant:4, specialUse:1, femaleVacant:0, maleVacant:0 },
  { id:2, code:"DAM", name:"Damai", address:"Jalan Tasik Raja Lumu U4/17, Taman Subang Delima, 40150 Shah Alam, Selangor", units:38, occupied:109, vacant:51, specialUse:5, femaleVacant:10, maleVacant:12 },
  { id:3, code:"NDY", name:"Nadayu 801", address:"1, Jalan Zuhrah U5/163, Subang Murni, Seksyen U5, 40150 Shah Alam, Selangor", units:74, occupied:281, vacant:70, specialUse:14, femaleVacant:22, maleVacant:18 },
  { id:4, code:"SHP", name:"Shop Hostel", address:"16-2 & 16-3, Jalan Nova U5/N, Subang Bestari, 40150 Shah Alam, Selangor", units:2, occupied:7, vacant:13, specialUse:1, femaleVacant:0, maleVacant:13 },
  { id:5, code:"SR", name:"Subang Residences", address:"Jalan Dalwu U5/98, 40150 Shah Alam, Selangor", units:6, occupied:71, vacant:23, specialUse:2, femaleVacant:8, maleVacant:7 },
];

const roomRates:Record<string, number> = { A:399, B:799, C:499, D:599 };
const bedTypes = ["single", "bunk-upper", "bunk-lower", "queen"];
const roomLabels = ["A", "B", "C", "D"];

export function createPreviewData() {
  const units:any[] = [];
  const bedSpaces:any[] = [];
  let unitId = 1;
  let roomId = 1;
  let bedId = 1;

  for (const hostel of hostelSeeds) {
    const hostelUnits:any[] = [];
    for (let index = 0; index < hostel.units; index += 1) {
      const unitCode = hostel.code === "ATR" && index === 0
        ? "1201"
        : `${hostel.code}-${String(index + 1).padStart(3, "0")}`;
      const femaleCutoff = Math.ceil(hostel.units * .34);
      const maleCutoff = Math.ceil(hostel.units * .68);
      const gender = index < femaleCutoff ? "female" : index < maleCutoff ? "male" : "mixed";
      const unit = {
        id:unitId++,
        hostelId:hostel.id,
        hostelCode:hostel.code,
        hostelName:hostel.name,
        unitCode,
        address:hostel.address,
        gender,
        status:"active",
        notes:"",
        ownerName:"",
        leaseEndDate:null,
        surrenderDate:null,
        surrenderNotes:"",
      };
      units.push(unit);
      hostelUnits.push(unit);
    }

    const totalBeds = hostel.occupied + hostel.vacant + hostel.specialUse;
    for (let index = 0; index < totalBeds; index += 1) {
      const unit = hostelUnits[index % hostelUnits.length];
      const roomLabel = roomLabels[Math.floor(index / hostelUnits.length) % roomLabels.length];
      const bedNumber = Math.floor(index / (hostelUnits.length * roomLabels.length)) + 1;
      const status = index < hostel.occupied ? "occupied" : index < hostel.occupied + hostel.vacant ? "vacant" : "special-use";
      const sharing = bedNumber > 1 || index % 5 === 0;
      const agreementEndDate = status === "occupied" ? (index % 4 === 0 ? "2026-08-31" : "2027-06-30") : null;
      const availableFrom = status === "vacant" ? "2026-07-16" : agreementEndDate === "2026-08-31" ? "2026-09-01" : agreementEndDate === "2027-06-30" ? "2027-07-01" : null;
      const previewRoomId = roomId++;
      bedSpaces.push({
        id:bedId++,
        roomId:previewRoomId,
        hostelId:hostel.id,
        hostelName:hostel.name,
        hostelCode:hostel.code,
        unitId:unit.id,
        unitCode:unit.unitCode,
        unitStatus:unit.status,
        unitSurrenderDate:unit.surrenderDate,
        gender:unit.gender,
        roomLabel,
        bathroomType:roomLabel === "B" ? "attached" : "non-attached",
        roomType:sharing ? "sharing" : "single",
        bedLabel:String(bedNumber),
        bedType:bedTypes[index % bedTypes.length],
        legacyCode:`${unit.unitCode}-${roomLabel}${bedNumber}`,
        status,
        specialUse:status === "special-use" ? "Store / operational use" : null,
        monthlyRental:roomRates[roomLabel],
        salesRate:roomRates[roomLabel],
        currentRental:roomRates[roomLabel],
        rateSource:"sales-rate",
        legacyAccessCardDeposit:50,
        occupantName:status === "occupied" ? `Student ${hostel.code}-${String(index + 1).padStart(3, "0")}` : null,
        occupantCode:status === "occupied" ? `STU-${hostel.id}${String(index + 1).padStart(4, "0")}` : null,
        agreementEndDate,
        availableFrom,
        availabilityState:status === "vacant" ? "available-now" : status === "occupied" ? "upcoming" : "unavailable",
      });
    }
  }

  const hostels = hostelSeeds.map((hostel) => ({
    id:hostel.id,
    code:hostel.code,
    name:hostel.name,
    address:hostel.address,
    status:"active",
    units:hostel.units,
    bedSpaces:hostel.occupied + hostel.vacant + hostel.specialUse,
    occupied:hostel.occupied,
    vacant:hostel.vacant,
    vacantFemale:hostel.femaleVacant,
    vacantMale:hostel.maleVacant,
    vacantUnassigned:Math.max(0, hostel.vacant - hostel.femaleVacant - hostel.maleVacant),
    specialUse:hostel.specialUse,
  }));

  const atriaUnit = units.find((unit) => unit.hostelCode === "ATR");
  const nadayuUnit = units.find((unit) => unit.hostelCode === "NDY");
  const subangUnit = units.find((unit) => unit.hostelCode === "SR");

  return {
    hostels,
    units,
    owners:[
      { id:1, unitId:atriaUnit.id, ownerName:"Sample Property Owner", primaryContactName:"Owner Representative", primaryContactPhone:"+60 12-345 6789", secondaryContactName:"Property Agent", secondaryContactPhone:"+60 16-234 5678", leaseStartDate:"2025-09-01", leaseEndDate:"2027-08-31", monthlyLeaseRental:3200, securityDeposit:6400, notes:"Preview record for owner and lease information.", updatedAt:"2026-07-16" },
    ],
    bedSpaces,
    accessCards:[
      { id:1, unitId:atriaUnit.id, cardCode:"ATR-1201-AC01", depositAmount:50, status:"available", notes:"Main entrance", unitCode:atriaUnit.unitCode, hostelName:atriaUnit.hostelName },
      { id:2, unitId:atriaUnit.id, cardCode:"ATR-1201-AC02", depositAmount:50, status:"issued", notes:"Student card", unitCode:atriaUnit.unitCode, hostelName:atriaUnit.hostelName },
      { id:3, unitId:nadayuUnit.id, cardCode:"NDY-001-AC01", depositAmount:50, status:"available", notes:"", unitCode:nadayuUnit.unitCode, hostelName:nadayuUnit.hostelName },
    ],
    services:[
      { id:1, unitId:atriaUnit.id, serviceType:"wifi", accountHolderName:"HostelPro Operations", provider:"TIME", accountReference:"TIME-1201-001", lineType:"main", contractEndDate:"2027-08-31", servicePackage:"500 Mbps", username:"atria1201", hasPassword:true, remarks:"Transfer to replacement unit if this unit is surrendered.", status:"active", surrenderAction:"transfer", notes:"" },
      { id:2, unitId:subangUnit.id, serviceType:"electricity", accountHolderName:"Sample Property Owner", provider:"TNB", accountReference:"TNB-SR-001", lineType:"not-applicable", contractEndDate:null, servicePackage:"", username:"", hasPassword:false, remarks:"Final meter reading required.", status:"active", surrenderAction:"terminate", notes:"" },
    ],
    reservations:[
      { id:1, referenceNo:"RSV-260716001", studentName:"Student A", preferredHostelId:3, preferredHostelName:"Nadayu 801", preferredGender:"female", roomCategory:"A", roomType:"sharing", bathroomType:"non-attached", targetMoveInDate:"2026-09-01", expectedEndDate:"2027-08-31", budgetMax:450, provisionalBedSpaceId:null, provisionalCode:"", holdExpiresAt:"2026-07-20", paymentStatus:"admin-fee", amountPaid:500, totalPayable:1800, paymentReference:"BANK-REF-001", inventoryCommitted:true, paymentUpdatedAt:"2026-07-16", status:"reserved", notes:"Actual room to be assigned closer to check-in.", createdAt:"2026-07-16" },
      { id:2, referenceNo:"RSV-260716002", studentName:"Nur Aisyah", preferredHostelId:5, preferredHostelName:"Subang Residences", preferredGender:"female", roomCategory:"B", roomType:"single", bathroomType:"attached", targetMoveInDate:"2026-08-15", expectedEndDate:"2027-07-31", budgetMax:850, provisionalBedSpaceId:null, provisionalCode:"", holdExpiresAt:null, paymentStatus:"partial", amountPaid:1200, totalPayable:2400, paymentReference:"FPX-220045", inventoryCommitted:true, paymentUpdatedAt:"2026-07-16", status:"reserved", notes:"", createdAt:"2026-07-16" },
      { id:3, referenceNo:"RSV-260716003", studentName:"Daniel Lim", preferredHostelId:2, preferredHostelName:"Damai", preferredGender:"male", roomCategory:"C", roomType:"single", bathroomType:"any", targetMoveInDate:"2026-09-01", expectedEndDate:null, budgetMax:550, provisionalBedSpaceId:null, provisionalCode:"", holdExpiresAt:null, paymentStatus:"unpaid", amountPaid:0, totalPayable:null, paymentReference:"", inventoryCommitted:false, paymentUpdatedAt:"2026-07-16", status:"reserved", notes:"Sales enquiry only.", createdAt:"2026-07-16" },
    ],
    importProgress:{ assignments:485, expected:485 },
  };
}
