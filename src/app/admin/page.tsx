import React from "react";
import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { StaffManagementClient } from "@/components/staff-management-client";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const user = await requirePageAuth("ADMIN");

  const [totalCustomers, activeStaffCount, activeAdminCount, activeSubscriptionsCount] =
    await Promise.all([
      prisma.customer.count(),
      prisma.user.count({ where: { role: "STAFF", isActive: true } }),
      prisma.user.count({ where: { role: "ADMIN", isActive: true } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
    ]);

  return (
    <AppShell
      user={user}
      title="Administrator Dashboard"
      subtitle="Manage staff accounts, customer directory, and system-wide subscription operations."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/customers"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Manage Customers
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Finance Analytics &rarr;
          </Link>
        </div>
      }
    >
      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Customers
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {totalCustomers.toLocaleString()}
          </div>
          <Link
            href="/customers"
            className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            View customer directory &rarr;
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Active Staff Members
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-700">
            {activeStaffCount.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400">Authorized operational staff</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-purple-700">
            Active Administrators
          </div>
          <div className="mt-2 text-2xl font-bold text-purple-700">
            {activeAdminCount.toLocaleString()}
          </div>
          <div className="mt-2 text-xs text-slate-400">Protected system admins</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Active Subscriptions
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-700">
            {activeSubscriptionsCount.toLocaleString()}
          </div>
          <Link
            href="/invoices"
            className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            View billing &amp; invoices &rarr;
          </Link>
        </div>
      </div>

      {/* Staff Management Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Staff &amp; Identity Management</h2>
            <p className="text-xs text-slate-500">
              Create staff accounts, search by name or email, and manage active account status.
            </p>
          </div>
        </div>
        <StaffManagementClient currentUserId={user.id} />
      </div>
    </AppShell>
  );
}

