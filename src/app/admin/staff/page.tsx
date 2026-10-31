import React from "react";
import { requirePageAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { StaffManagementClient } from "@/components/staff-management-client";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  const user = await requirePageAuth("ADMIN");

  return (
    <AppShell
      user={user}
      title="Staff Management"
      subtitle="View, search, create, and activate/deactivate staff and administrator accounts."
    >
      <StaffManagementClient currentUserId={user.id} />
    </AppShell>
  );
}

