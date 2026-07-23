import React from "react";
import { createRoot } from "react-dom/client";
import SystemApp from "../app/SystemApp";
import "../app/globals.css";
import { createPreviewData } from "./mockData";

let previewData = createPreviewData();
const realFetch = globalThis.fetch.bind(globalThis);

function jsonResponse(value:unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers:{ "content-type":"application/json" } });
}

globalThis.fetch = async (input:RequestInfo | URL, init?:RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/api/system")) return realFetch(input, init);
  if (!init?.method || init.method === "GET") return jsonResponse(previewData);

  const body = JSON.parse(String(init.body || "{}"));
  if (body.action === "reservation") {
    const hostel = previewData.hostels.find((row:any) => row.id === Number(body.preferredHostelId));
    const paymentStatus = String(body.paymentStatus || "unpaid");
    previewData.reservations.unshift({
      id:Date.now(),
      referenceNo:`RSV-${String(Date.now()).slice(-9)}`,
      studentName:String(body.studentName),
      preferredHostelId:body.preferredHostelId ? Number(body.preferredHostelId) : null,
      preferredHostelName:hostel?.name || "Any hostel",
      preferredGender:String(body.preferredGender || "unspecified"),
      roomCategory:String(body.roomCategory || "any"),
      roomType:String(body.roomType || "any"),
      bathroomType:String(body.bathroomType || "any"),
      targetMoveInDate:String(body.targetMoveInDate),
      expectedEndDate:body.expectedEndDate || null,
      budgetMax:body.budgetMax ? Number(body.budgetMax) : null,
      provisionalBedSpaceId:body.provisionalBedSpaceId ? Number(body.provisionalBedSpaceId) : null,
      provisionalCode:body.provisionalBedSpaceId ? previewData.bedSpaces.find((bed:any) => bed.id === Number(body.provisionalBedSpaceId))?.legacyCode || "" : "",
      holdExpiresAt:body.holdExpiresAt || null,
      paymentStatus,
      amountPaid:Number(body.amountPaid || 0),
      totalPayable:body.totalPayable ? Number(body.totalPayable) : null,
      paymentReference:String(body.paymentReference || ""),
      inventoryCommitted:["admin-fee", "partial", "full"].includes(paymentStatus),
      paymentUpdatedAt:"2026-07-16",
      status:"reserved",
      notes:String(body.notes || ""),
      createdAt:"2026-07-16",
    });
  } else if (body.action === "reservation-payment") {
    const reservation = previewData.reservations.find((row:any) => row.id === Number(body.reservationId));
    if (reservation) {
      reservation.paymentStatus = String(body.paymentStatus);
      reservation.amountPaid = Number(body.amountPaid || 0);
      reservation.totalPayable = body.totalPayable ? Number(body.totalPayable) : null;
      reservation.paymentReference = String(body.paymentReference || "");
      reservation.inventoryCommitted = ["admin-fee", "partial", "full"].includes(reservation.paymentStatus);
    }
  } else if (body.action === "bulk-room-price") {
    const roomIds = (body.roomIds || []).map(Number);
    previewData.bedSpaces.forEach((bed:any) => {
      if (roomIds.includes(bed.roomId)) {
        bed.salesRate = Number(body.salesRate);
        bed.currentRental = Number(body.salesRate);
        bed.rateSource = "sales-rate";
      }
    });
  } else if (body.action === "bed-status") {
    const bed = previewData.bedSpaces.find((row:any) => row.id === Number(body.bedId));
    if (bed) bed.status = String(body.status);
  } else if (body.action === "bed-type") {
    const bed = previewData.bedSpaces.find((row:any) => row.id === Number(body.bedId));
    if (bed) bed.bedType = String(body.bedType);
  } else if (body.action === "room-details") {
    previewData.bedSpaces.filter((bed:any) => bed.roomId === Number(body.roomId)).forEach((bed:any) => { bed.bathroomType = String(body.bathroomType); });
  } else if (body.action === "unit-update") {
    const unit = previewData.units.find((row:any) => row.id === Number(body.unitId));
    if (unit) Object.assign(unit, { gender:body.gender, status:body.unitStatus, surrenderDate:body.surrenderDate || null, surrenderNotes:body.surrenderNotes || "" });
  } else if (body.action === "unit-owner") {
    let owner = previewData.owners.find((row:any) => row.unitId === Number(body.unitId));
    if (!owner) {
      owner = { id:Date.now(), unitId:Number(body.unitId) };
      previewData.owners.push(owner);
    }
    Object.assign(owner, {
      ownerName:body.ownerName || "",
      primaryContactName:body.primaryContactName || "",
      primaryContactPhone:body.primaryContactPhone || "",
      secondaryContactName:body.secondaryContactName || "",
      secondaryContactPhone:body.secondaryContactPhone || "",
      leaseStartDate:body.leaseStartDate || null,
      leaseEndDate:body.leaseEndDate || null,
      monthlyLeaseRental:body.monthlyLeaseRental ? Number(body.monthlyLeaseRental) : null,
      securityDeposit:body.securityDeposit ? Number(body.securityDeposit) : null,
      notes:body.ownerNotes || "",
    });
  } else if (body.action === "access-card") {
    const unit = previewData.units.find((row:any) => row.id === Number(body.unitId));
    previewData.accessCards.push({ id:Date.now(), unitId:unit.id, cardCode:body.cardCode, depositAmount:Number(body.depositAmount || 0), status:body.status, notes:body.notes || "", unitCode:unit.unitCode, hostelName:unit.hostelName });
  } else if (body.action === "unit-service") {
    previewData.services.push({ id:Date.now(), unitId:Number(body.unitId), serviceType:body.serviceType, accountHolderName:body.accountHolderName || "", provider:body.provider || "", accountReference:body.accountReference || "", lineType:body.lineType || "not-applicable", contractEndDate:body.contractEndDate || null, servicePackage:body.servicePackage || "", username:body.username || "", hasPassword:Boolean(body.password), remarks:body.remarks || "", status:"active", surrenderAction:body.surrenderAction || "review", notes:"" });
  }
  return jsonResponse({ ok:true }, 201);
};

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><SystemApp /></React.StrictMode>,
);
