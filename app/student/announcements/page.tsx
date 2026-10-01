"use client";

import { useSystem } from "../../SystemContext";
import { StudentAnnouncementsModule } from "../../modules/StudentAnnouncements";

export default function StudentAnnouncementsPage() {
  const { data } = useSystem();
  if (!data) return null;
  return <StudentAnnouncementsModule data={data} />;
}
