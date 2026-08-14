"use client";

import { useRouter } from "next/navigation";
import { useSystem } from "../../SystemContext";
import { DashboardModule } from "../../modules/Dashboard";

export default function DashboardPage() {
  const { data } = useSystem();
  const router = useRouter();
  if (!data) return null;
  return (
    <DashboardModule
      data={data}
      onOpenModule={(next) => router.push(`/${next}`)}
    />
  );
}
