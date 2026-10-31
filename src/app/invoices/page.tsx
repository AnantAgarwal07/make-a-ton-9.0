"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INVOICE_STATUS_VALUES } from "@/lib/invoices/schemas";
import { RecordPaymentModal } from "@/lib/invoices/record-payment-modal";
import { BillingNav, PaginationBar, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface InvoiceRow {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  subscriptionId: number;
  subscriptionNumber: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  paid: string;
  balance: string;
  overdue: boolean;
}

export default function InvoicesPage() {
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [payModal, setPayModal] = useState<InvoiceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status) qs.set("status", status);
      if (customerId.trim()) qs.set("customerId", customerId.trim());
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (overdueOnly) qs.set("overdue", "true");

      const res = await fetch(`/api/invoices?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message || data?.error || `Error ${res.status}`);
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError((e as Error).message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, customerId, dateFrom, dateTo, overdueOnly]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setStatus("");
    setCustomerId("");
    setDateFrom("");
    setDateTo("");
    setOverdueOnly(false);
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BillingNav active="invoices" />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Invoices</h1>
            <p className="text-xs text-slate-500">
              Manage draft, confirmed, paid, and cancelled subscription invoices.
            </p>
          </div>
          <Link
            href="/invoices/overdue"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            View Overdue Invoices &rarr;
          </Link>
        </div>

        {/* Filters bar */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-6">
            <div>
              <label className="block text-xs font-medium text-slate-600">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="">All statuses</option>
                {INVOICE_STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s}
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
                  checked={overdueOnly}
                  onChange={(e) => {
                    setOverdueOnly(e.target.checked);
                    setPage(1);
                  }}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Overdue only
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
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Invoice Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                      Loading invoices...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                      No invoices match the selected filters.
                    </td>
                  </tr>
                ) : (
                  items.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {inv.customerName}{" "}
                        <span className="text-xs text-slate-400">(#{inv.customerId})</span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">
                        {inv.subscriptionNumber}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDate(inv.invoiceDate)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} overdue={inv.overdue} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-800">
                        {formatMoney(inv.total)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                        {formatMoney(inv.paid)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900">
                        {formatMoney(inv.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {inv.status === "CONFIRMED" && Number(inv.balance) > 0 && (
                            <button
                              type="button"
                              onClick={() => setPayModal(inv)}
                              className="rounded border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                            >
                              Pay
                            </button>
                          )}
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </div>
      </main>

      {payModal && (
        <RecordPaymentModal
          invoiceId={payModal.id}
          invoiceNumber={payModal.number}
          balance={payModal.balance}
          open={true}
          onClose={() => setPayModal(null)}
          onSuccess={load}
        />
      )}
    </div>
  );
}

