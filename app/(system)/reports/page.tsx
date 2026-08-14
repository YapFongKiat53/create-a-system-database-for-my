"use client";

import { useSystem } from "../../SystemContext";
import { ReportsModule } from "../../modules/Reports";

export default function ReportsPage() {
  const { data } = useSystem();
  if (!data) return null;
  return <ReportsModule data={data} />;
}
