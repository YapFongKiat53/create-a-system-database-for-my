"use client";

import { useSystem } from "../../SystemContext";
import { StudentMaintenanceModule } from "../../modules/StudentMaintenance";

export default function StudentMaintenancePage() {
  const { data, save, busy, load } = useSystem();
  if (!data) return null;
  return <StudentMaintenanceModule data={data} save={save} busy={busy} load={load} />;
}
