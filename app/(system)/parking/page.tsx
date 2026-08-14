"use client";

import { useSystem } from "../../SystemContext";
import { ParkingModule } from "../../modules/Parking";

export default function ParkingPage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <ParkingModule data={data} save={save} busy={busy} />;
}
