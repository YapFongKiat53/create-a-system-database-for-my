"use client";

import { useSystem } from "../../SystemContext";
import { AnnouncementsModule } from "../../modules/Announcements";

export default function AnnouncementsPage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <AnnouncementsModule data={data} save={save} busy={busy} />;
}
