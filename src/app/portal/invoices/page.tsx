"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INVOICE_STATUS_VALUES } from "@/lib/invoices/schemas";
import { BillingNav, PaginationBar, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface PortalInvoiceRow {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  subscriptionNumber: string;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  paid: string;
  balance: string;
  overdue: boolean;
}

export default function PortalInvoicesPage() {
  const [items, setItems] = useState<PortalInvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (status) qs.set("status", status);
      if (overdueOnly) qs.set("overdue", "true");

      const res = await fetch(`/api/portal/invoices?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message || data?.error || `Error ${res.status}`);
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError((e as Error).message || "Failed to load your invoices");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, overdueOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const customerName = items[0]?.customerName ?? "Customer Portal";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BillingNav active="portal" />

      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-block rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Customer Self-Service
            </span>
            <h1 className="mt-1 text-xl font-bold text-slate-900">My Invoices</h1>
            <p className="text-xs text-slate-500">
              Viewing billing history and downloadable/printable invoices for{" "}
              <span className="font-medium text-slate-700">{customerName}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900"
            >
              <option value="">All statuses</option>
              {INVOICE_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => {
                  setOverdueOnly(e.target.checked);
                  setPage(1);
                }}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              Overdue only
            </label>
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
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Billing Period</th>
                  <th className="px-4 py-3">Invoice Date</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                      Loading your invoices...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                      No invoices found for your account.
                    </td>
                  </tr>
                ) : (
                  items.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/portal/invoices/${inv.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {inv.subscriptionNumber}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDate(inv.periodStart)} &ndash; {formatDate(inv.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatDate(inv.invoiceDate)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} overdue={inv.overdue} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-800">
                        {formatMoney(inv.total)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-emerald-700">
                        {formatMoney(inv.paid)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-900">
                        {formatMoney(inv.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/portal/invoices/${inv.id}`}
                          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          View / Print
                        </Link>
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
    </div>
  );
}

