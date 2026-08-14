"use client";

import { useSystem } from "../../SystemContext";
import { StudentsModule } from "../../modules/StudentInformation";

export default function StudentsPage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <StudentsModule data={data} save={save} busy={busy} />;
}
