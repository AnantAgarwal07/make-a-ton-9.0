"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RecordPaymentModal } from "@/lib/invoices/record-payment-modal";
import { BillingNav, PaginationBar, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface OverdueRow {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  subscriptionId: number;
  subscriptionNumber: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  paid: string;
  balance: string;
  daysOverdue: number;
}

export default function OverdueInvoicesPage() {
  const [items, setItems] = useState<OverdueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<OverdueRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (customerId.trim()) qs.set("customerId", customerId.trim());

      const res = await fetch(`/api/invoices/overdue?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.issues?.[0]?.message || data?.error || `Error ${res.status}`);
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError((e as Error).message || "Failed to load overdue invoices");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, customerId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BillingNav active="overdue" />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Overdue Invoices</h1>
            <p className="text-xs text-slate-500">
              Confirmed invoices past their due date with an outstanding balance.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              placeholder="Filter Customer ID..."
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
            />
            {customerId && (
              <button
                type="button"
                onClick={() => {
                  setCustomerId("");
                  setPage(1);
                }}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
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
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Days Overdue</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                      Loading overdue invoices...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                      No overdue invoices found.
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
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-900">
                          {inv.customerName}
                        </div>
                        <div className="text-xs text-slate-500">{inv.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-red-700">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                          {inv.daysOverdue} {inv.daysOverdue === 1 ? "day" : "days"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} overdue={true} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                        {formatMoney(inv.total)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                        {formatMoney(inv.paid)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-red-700">
                        {formatMoney(inv.balance)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPayModal(inv)}
                            className="rounded border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            Record Payment
                          </button>
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

