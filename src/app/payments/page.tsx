"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PAYMENT_METHOD_VALUES } from "@/lib/invoices/schemas";
import { BillingNav, PaginationBar, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface PaymentRow {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  customerId: number;
  customerName: string;
  method: string;
  amount: string;
  paymentDate: string;
  note: string | null;
  voidedAt: string | null;
}

export default function PaymentsPage() {
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [method, setMethod] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (method) qs.set("method", method);
      if (customerId.trim()) qs.set("customerId", customerId.trim());
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (includeVoided) qs.set("includeVoided", "true");

      const res = await fetch(`/api/payments?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message || data?.error || `Error ${res.status}`);
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError((e as Error).message || "Failed to load payments");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, method, customerId, dateFrom, dateTo, includeVoided]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setMethod("");
    setCustomerId("");
    setDateFrom("");
    setDateTo("");
    setIncludeVoided(false);
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BillingNav active="payments" />

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900">Payments</h1>
          <p className="text-xs text-slate-500">
            All recorded customer payments across subscription invoices.
          </p>
        </div>

        {/* Filters */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-6">
            <div>
              <label className="block text-xs font-medium text-slate-600">Method</label>
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="">All methods</option>
                {PAYMENT_METHOD_VALUES.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">Customer ID</label>
              <input
                type="number"
                min="1"
                placeholder="e.g. 1"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div className="flex items-end pb-1">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeVoided}
                  onChange={(e) => {
                    setIncludeVoided(e.target.checked);
                    setPage(1);
                  }}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Include voided
              </label>
            </div>

            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset Filters
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Payment ID</th>
                  <th className="px-4 py-3">Payment Date</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Invoice Status</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      Loading payments...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                      No payments found.
                    </td>
                  </tr>
                ) : (
                  items.map((p) => {
                    const voided = Boolean(p.voidedAt);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">#{p.id}</td>
                        <td className="px-4 py-3 text-xs text-slate-700">
                          {formatDate(p.paymentDate)}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/invoices/${p.invoiceId}`}
                            className="text-blue-600 hover:underline"
                          >
                            {p.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.invoiceStatus} />
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {p.customerName}{" "}
                          <span className="text-xs text-slate-400">(#{p.customerId})</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-700">
                          {p.method.replace("_", " ")}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{p.note || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold">
                          {voided ? (
                            <span className="text-slate-400 line-through">
                              {formatMoney(p.amount)} (VOID)
                            </span>
                          ) : (
                            <span className="text-emerald-700">{formatMoney(p.amount)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </div>
      </main>
    </div>
  );
}

