"use client";

import { useSystem } from "../SystemContext";
import { StudentHomeModule } from "../modules/StudentHome";

export default function StudentHomePage() {
  const { data } = useSystem();
  if (!data) return null;
  return <StudentHomeModule data={data} />;
}
