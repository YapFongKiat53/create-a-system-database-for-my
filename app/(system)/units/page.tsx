"use client";

import { useSystem } from "../../SystemContext";
import { UnitsModule } from "../../modules/UnitInformation";

export default function UnitsPage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <UnitsModule data={data} save={save} busy={busy} />;
}
