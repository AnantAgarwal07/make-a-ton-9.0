"use client";

import React, { useCallback, useEffect, useState } from "react";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { CustomerDTO } from "@/lib/subscriptions/types";
import {
  CheckCircle2,
  Edit3,
  KeyRound,
  Plus,
  Search,
  UserCheck,
  UserX,
  X,
} from "lucide-react";

export default function CustomersManagementPage() {
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerDTO | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to load customers");
        return;
      }
      setCustomers(data.customers || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading customers");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadCustomers();
    const handler = () => loadCustomers();
    window.addEventListener("brightloop-auth-changed", handler);
    return () => window.removeEventListener("brightloop-auth-changed", handler);
  }, [loadCustomers]);

  function openCreateModal() {
    setEditingCustomer(null);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setModalError(null);
    setModalOpen(true);
  }

  function openEditModal(c: CustomerDTO) {
    setEditingCustomer(c);
    setName(c.name);
    setEmail(c.email);
    setPhone(c.phone || "");
    setAddress(c.address || "");
    setModalError(null);
    setModalOpen(true);
  }

  async function handleSaveCustomer(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);
    setSaving(true);
    try {
      const url = editingCustomer
        ? `/api/customers/${editingCustomer.id}`
        : "/api/customers";
      const method = editingCustomer ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phone || null,
          address: address || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error || "Failed to save customer");
        return;
      }
      setModalOpen(false);
      await loadCustomers();
    } catch (err: unknown) {
      setModalError(err instanceof Error ? err.message : "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCustomerLogin(customer: CustomerDTO, nextActive: boolean) {
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginIsActive: nextActive,
          linkLoginAccount: !customer.user,
        }),
      });
      if (res.ok) {
        await loadCustomers();
      }
    } catch {
      // Ignore error
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Customer Directory
            </h1>
            <p className="text-sm text-slate-600">
              Create and manage individual or business customer records stored in PostgreSQL and manage their linked portal login status.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Customer
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search customers by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3.5">ID</th>
                <th className="px-5 py-3.5">Customer Name</th>
                <th className="px-5 py-3.5">Email & Phone</th>
                <th className="px-5 py-3.5">Address</th>
                <th className="px-5 py-3.5">Portal Login (User.isActive)</th>
                <th className="px-5 py-3.5">Subscriptions</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    Loading customer records from PostgreSQL...
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    No customers found.
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-500">
                      #{c.id}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-slate-900">
                      {c.name}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="text-slate-900">{c.email}</div>
                      <div className="text-xs text-slate-500">{c.phone || "—"}</div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">
                      {c.address || "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      {c.user ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              c.user.isActive
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            {c.user.isActive ? (
                              <>
                                <UserCheck className="h-3 w-3" />
                                Login Enabled
                              </>
                            ) : (
                              <>
                                <UserX className="h-3 w-3" />
                                Login Disabled
                              </>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleCustomerLogin(c, !c.user?.isActive)}
                            className="text-xs font-medium text-indigo-600 hover:underline"
                          >
                            {c.user.isActive ? "Disable" : "Enable"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            No Linked User
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleCustomerLogin(c, true)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                          >
                            <KeyRound className="h-3 w-3" />
                            Provision Login
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      {c._count?.subscriptions ?? 0}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEditModal(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">
                  {editingCustomer ? `Edit Customer #${editingCustomer.id}` : "Create Customer"}
                </h3>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {modalError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                  {modalError}
                </div>
              )}

              <form onSubmit={handleSaveCustomer} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Name (Individual or Business) *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {saving ? "Saving..." : "Save Customer"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

