import React from "react";
import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { CustomerManagementClient } from "@/components/customer-management-client";

export const dynamic = "force-dynamic";

export default async function StaffDashboardPage() {
  const user = await requirePageAuth("STAFF");

  const [totalCustomers, activeSubscriptions, confirmedInvoicesCount] = await Promise.all([
    prisma.customer.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.invoice.count({ where: { status: "CONFIRMED" } }),
  ]);

  return (
    <AppShell
      user={user}
      title="Staff Operations Dashboard"
      subtitle="Manage customer accounts, subscriptions, and billing operations."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/invoices"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Invoices
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Finance Dashboard &rarr;
          </Link>
        </div>
      }
    >
      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Customers
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {totalCustomers.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">Managed customer accounts</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Active Subscriptions
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-700">
            {activeSubscriptions.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">Currently running plans</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Confirmed Open Invoices
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-700">
            {confirmedInvoicesCount.toLocaleString()}
          </div>
          <Link
            href="/invoices"
            className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            Review invoices &rarr;
          </Link>
        </div>
      </div>

      {/* Customer Directory & Management */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Customer Directory</h2>
          <p className="text-xs text-slate-500">
            Search, create, and update customer profiles and portal login status.
          </p>
        </div>
        <CustomerManagementClient />
      </div>
    </AppShell>
  );
}

