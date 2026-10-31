import React from "react";
import Link from "next/link";
import { requirePageAuth } from "@/lib/auth";
import { getCustomerById } from "@/lib/customers";
import { AppShell } from "@/components/app-shell";
import { CustomerProfileEditor } from "@/components/customer-profile-editor";
import { StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

export const dynamic = "force-dynamic";

export default async function CustomerDashboardPage() {
  const user = await requirePageAuth("CUSTOMER");

  const customer = user.customerId
    ? await getCustomerById(user, user.customerId).catch(() => null)
    : null;

  return (
    <AppShell
      user={user}
      title="Customer Self-Service Dashboard"
      subtitle="Manage your profile details, active subscriptions, and billing history."
      actions={
        <Link
          href="/portal/invoices"
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          View All My Invoices &rarr;
        </Link>
      }
    >
      {!customer ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-xs text-amber-800">
          No customer profile is linked to this user account yet. Please contact support.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Customer Account ID
              </div>
              <div className="mt-2 font-mono text-2xl font-bold text-slate-900">
                #{customer.id}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Registered {formatDate(customer.createdAt)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Subscriptions
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-700">
                {customer.subscriptionsCount}
              </div>
              <div className="mt-1 text-xs text-slate-400">Total linked subscriptions</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Total Invoices
              </div>
              <div className="mt-2 text-2xl font-bold text-blue-700">
                {customer.invoicesCount}
              </div>
              <Link
                href="/portal/invoices"
                className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline"
              >
                Open invoice portal &rarr;
              </Link>
            </div>
          </div>

          {/* Profile Editor */}
          <CustomerProfileEditor
            customerId={customer.id}
            initialName={customer.name}
            initialEmail={customer.email}
            initialPhone={customer.phone}
            initialAddress={customer.address}
          />

          {/* Subscriptions & Invoices */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3.5">
                <h3 className="text-sm font-bold text-slate-900">My Subscriptions</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-500">
                      <th className="px-4 py-2.5">Subscription #</th>
                      <th className="px-4 py-2.5">Plan</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Expiry Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customer.subscriptions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                          No subscriptions on your account yet.
                        </td>
                      </tr>
                    ) : (
                      customer.subscriptions.map((sub) => (
                        <tr key={sub.id}>
                          <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                            {sub.number}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">{sub.planName}</td>
                          <td className="px-4 py-2.5">
                            <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {sub.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {formatDate(sub.expiryDate)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                <h3 className="text-sm font-bold text-slate-900">Recent Invoices</h3>
                <Link
                  href="/portal/invoices"
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  All My Invoices &rarr;
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-500">
                      <th className="px-4 py-2.5">Invoice #</th>
                      <th className="px-4 py-2.5">Due Date</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customer.invoices.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                          No invoices found for your account.
                        </td>
                      </tr>
                    ) : (
                      customer.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-4 py-2.5 font-medium">
                            <Link
                              href={`/portal/invoices/${inv.id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {inv.number}
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {formatDate(inv.dueDate)}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge status={inv.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-medium text-slate-900">
                            {formatMoney(inv.total)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

