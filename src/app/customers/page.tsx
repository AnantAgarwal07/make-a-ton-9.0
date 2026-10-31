import React from "react";
import { requirePageAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { CustomerManagementClient } from "@/components/customer-management-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requirePageAuth("ADMIN", "STAFF");

  return (
    <AppShell
      user={user}
      title="Customer Management"
      subtitle="Search, paginate, create, and edit customer profiles and linked user account status."
    >
      <CustomerManagementClient />
    </AppShell>
  );
}

