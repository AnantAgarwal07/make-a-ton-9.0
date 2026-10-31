"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { StatusBadge } from "@/components/subscriptions/StatusBadge";
import { SubscriptionDTO } from "@/lib/subscriptions/types";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  Plus,
  Search,
} from "lucide-react";

export default function StaffSubscriptionsPage() {
  const [items, setItems] = useState<SubscriptionDTO[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pausedFilter, setPausedFilter] = useState("");

  const fetchSubscriptions = useCallback(
    async (pageNumber: number = 1) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(pageNumber));
        params.set("pageSize", "10");
        if (search.trim()) params.set("search", search.trim());
        if (statusFilter) params.set("status", statusFilter);
        if (pausedFilter) params.set("isPaused", pausedFilter);

        const res = await fetch(`/api/subscriptions?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Unable to load subscriptions");
          return;
        }
        setItems(data.items || []);
        setPagination(data.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Error loading subscriptions");
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, pausedFilter]
  );

  useEffect(() => {
    fetchSubscriptions(1);
    const handler = () => fetchSubscriptions(1);
    window.addEventListener("brightloop-auth-changed", handler);
    return () => window.removeEventListener("brightloop-auth-changed", handler);
  }, [fetchSubscriptions]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Subscriptions Management
            </h1>
            <p className="text-sm text-slate-600">
              Create customer-specific subscriptions, manage quotations, track status history, and control pause/resume/close/renew actions.
            </p>
          </div>
          <Link
            href="/subscriptions/new"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <Plus className="h-4 w-4" />
            Create Subscription
          </Link>
        </div>

        {/* Search & Filters */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-center">
            <div className="relative sm:col-span-5">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by SUB-number, customer name, email, or plan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3 flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="">All Statuses</option>
                <option value="DRAFT">DRAFT</option>
                <option value="QUOTATION">QUOTATION</option>
                <option value="CONFIRMED">CONFIRMED</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <select
                value={pausedFilter}
                onChange={(e) => setPausedFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="">Any Pause State</option>
                <option value="true">Paused Only</option>
                <option value="false">Unpaused Only</option>
              </select>
            </div>

            <div className="sm:col-span-2 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setPausedFilter("");
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Reset Filters
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">{error}</p>
            <p className="mt-1 text-xs text-amber-700">
              Tip: Use the Active User selector in the top-right header to switch to an ADMIN or STAFF account when viewing Staff pages.
            </p>
          </div>
        )}

        {/* Subscriptions Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3.5">Number</th>
                  <th className="px-4 py-3.5">Customer</th>
                  <th className="px-4 py-3.5">Plan</th>
                  <th className="px-4 py-3.5">Start / Expiry</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Next Invoice Date</th>
                  <th className="px-4 py-3.5 text-right">Total</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      Loading subscriptions...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      No subscriptions found matching the current filters.
                    </td>
                  </tr>
                ) : (
                  items.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3.5 font-mono font-semibold text-indigo-700">
                        <Link href={`/subscriptions/${sub.id}`} className="hover:underline">
                          {sub.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900">{sub.customer?.name}</div>
                        <div className="text-xs text-slate-500">{sub.customer?.email}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900">{sub.plan?.name}</div>
                        <div className="text-xs text-slate-500">{sub.plan?.billingPeriod}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        <div>Start: {new Date(sub.startDate).toISOString().slice(0, 10)}</div>
                        <div>Exp: {new Date(sub.expiryDate).toISOString().slice(0, 10)}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge
                          status={sub.status}
                          isPaused={sub.isPaused}
                          isQuotationExpired={sub.isQuotationExpired}
                        />
                        {sub.pauseEvaluation?.limitReached && (
                          <div className="mt-1 text-xs font-medium text-rose-600">
                            Pause limit reached
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs font-mono text-slate-700">
                        {sub.nextInvoiceDate
                          ? new Date(sub.nextInvoiceDate).toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900">
                        ₹{sub.totals?.grandTotal ?? "0.00"}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/subscriptions/${sub.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Bar */}
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div>
              Showing page <span className="font-semibold">{pagination.page}</span> of{" "}
              <span className="font-semibold">{pagination.totalPages}</span> (
              <span className="font-semibold">{pagination.total}</span> total subscriptions)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => fetchSubscriptions(pagination.page - 1)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchSubscriptions(pagination.page + 1)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

