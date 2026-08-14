"use client";

import { useSystem } from "../../SystemContext";
import { UserManagementModule } from "../../modules/UserManagement";

export default function UsersPage() {
  const { data, save, busy } = useSystem();
  if (!data) return null;
  return <UserManagementModule data={data} save={save} busy={busy} />;
}
