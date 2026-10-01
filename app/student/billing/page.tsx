"use client";

import { useSystem } from "../../SystemContext";
import { StudentBillingModule } from "../../modules/StudentBilling";

export default function StudentBillingPage() {
  const { data, save, busy, load, suspicious } = useSystem();
  if (!data) return null;
  return (
    <StudentBillingModule
      data={data}
      save={save}
      busy={busy}
      load={load}
      suspicious={suspicious}
    />
  );
}
