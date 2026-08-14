"use client";

import { useSystem } from "../../SystemContext";
import { MaintenanceModule } from "../../modules/Maintenance";

export default function MaintenancePage() {
  const { data, save, busy, load } = useSystem();
  if (!data) return null;
  return <MaintenanceModule data={data} save={save} busy={busy} load={load} />;
}
