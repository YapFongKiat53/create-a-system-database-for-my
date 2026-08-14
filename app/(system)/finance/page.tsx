"use client";

import { useSystem } from "../../SystemContext";
import { FinanceModule } from "../../modules/Finance";

export default function FinancePage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <FinanceModule data={data} save={save} busy={busy} />;
}
