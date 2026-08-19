"use client";

import { useState } from "react";
import { useSystem } from "../../SystemContext";
import { HostelModule } from "../../modules/HostelInformation";
import type { HostelTab } from "../../modules/shared";

export default function HostelsPage() {
  const { data, save, busy, load } = useSystem();
  const [tab, setTab] = useState<HostelTab>("reservations");
  if (!data) return null;
  return (
    <HostelModule
      data={data}
      save={save}
      busy={busy}
      tab={tab}
      setTab={setTab}
      load={load}
    />
  );
}
