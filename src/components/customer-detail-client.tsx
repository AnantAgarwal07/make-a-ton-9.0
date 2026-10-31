"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

export interface CustomerDetailData {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  createdAt: string;
  userId: number | null;
  isActive: boolean;
  subscriptionsCount: number;
  invoicesCount: number;
  subscriptions: {
    id: number;
    number: string;
    status: string;
    planName: string;
    startDate: string;
    expiryDate: string;
  }[];
  invoices: {
    id: number;
    number: string;
    status: string;
    invoiceDate: string;
    dueDate: string;
    total: string;
  }[];
}

export function CustomerDetailClient({ initialCustomer }: { initialCustomer: CustomerDetailData }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetailData>(initialCustomer);
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState(initialCustomer.name);
  const [email, setEmail] = useState(initialCustomer.email);
  const [phone, setPhone] = useState(initialCustomer.phone ?? "");
  const [address, setAddress] = useState(initialCustomer.address ?? "");
  const [isActive, setIsActive] = useState(initialCustomer.isActive);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phone.trim() || null,
          address: address.trim() || null,
          isActive,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message || data?.error || "Failed to update customer");
        return;
      }

      setCustomer((prev) => ({
        ...prev,
        ...data.customer,
      }));
      setEditing(false);
      setSuccessMsg("Customer profile updated successfully.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "Network error occurred");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {successMsg}
        </div>
      )}

      {/* Profile Overview Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-900">{customer.name}</h2>
              <span className="font-mono text-xs text-slate-400">#{customer.id}</span>
              {customer.isActive ? (
                <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  Active Account
                </span>
              ) : (
                <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                  Inactive Account
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Registered on {formatDate(customer.createdAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setName(customer.name);
              setEmail(customer.email);
              setPhone(customer.phone ?? "");
              setAddress(customer.address ?? "");
              setIsActive(customer.isActive);
              setEditing((v) => !v);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {editing ? "Cancel Editing" : "Edit Customer"}
          </button>
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Phone</label>
                <input
                  type="tel"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Account Status</label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="customer-active"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="customer-active" className="text-xs font-medium text-slate-700">
                    Active portal login
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Address</label>
              <textarea
                rows={2}
                maxLength={500}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Customer"}
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
            <div>
              <dt className="font-medium text-slate-400">Customer ID</dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900">#{customer.id}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-400">Email Address</dt>
              <dd className="mt-1 font-medium text-slate-900">{customer.email}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-400">Phone Number</dt>
              <dd className="mt-1 font-medium text-slate-900">{customer.phone || "Not provided"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-400">Billing Address</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {customer.address || "Not provided"}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-400">Total Activity</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {customer.subscriptionsCount} Subscriptions &middot; {customer.invoicesCount} Invoices
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Subscriptions & Invoices Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Subscriptions */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-3.5">
            <h3 className="text-sm font-bold text-slate-900">Recent Subscriptions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-500">
                  <th className="px-4 py-2.5">Subscription #</th>
                  <th className="px-4 py-2.5">Plan</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customer.subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No subscriptions found.
                    </td>
                  </tr>
                ) : (
                  customer.subscriptions.map((sub) => (
                    <tr key={sub.id}>
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-900">
                        {sub.number}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{sub.planName}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{formatDate(sub.expiryDate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h3 className="text-sm font-bold text-slate-900">Recent Invoices</h3>
            <Link
              href={`/invoices`}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              View All &rarr;
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
                      No invoices found.
                    </td>
                  </tr>
                ) : (
                  customer.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-2.5 font-medium">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{formatDate(inv.dueDate)}</td>
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
  );
}

