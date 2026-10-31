"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RecordPaymentModal } from "@/lib/invoices/record-payment-modal";
import { BillingNav, PaginationBar, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface MonthlyChartPoint {
  month: string;
  billed: string;
  collected: string;
}

interface StatusBreakdownPoint {
  status: string;
  count: number;
  amount: string;
}

interface SummaryData {
  activeSubscriptions: number;
  revenueCollected: string;
  outstanding: string;
  overdueCount: number;
  overdueAmount: string;
  byMonth: MonthlyChartPoint[];
  byStatus: StatusBreakdownPoint[];
}

interface OverdueDrillRow {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  subscriptionNumber: string;
  dueDate: string;
  total: string;
  paid: string;
  balance: string;
  daysOverdue: number;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#94a3b8",
  CONFIRMED: "#3b82f6",
  PAID: "#10b981",
  CANCELLED: "#a1a1aa",
};

export default function FinanceDashboardPage() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [overdueItems, setOverdueItems] = useState<OverdueDrillRow[]>([]);
  const [overdueTotal, setOverdueTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [customerId, setCustomerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<OverdueDrillRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (customerId.trim()) qs.set("customerId", customerId.trim());
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);

      const overdueQs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (customerId.trim()) overdueQs.set("customerId", customerId.trim());

      const [sumRes, odRes] = await Promise.all([
        fetch(`/api/reports/summary?${qs.toString()}`),
        fetch(`/api/invoices/overdue?${overdueQs.toString()}`),
      ]);

      const sumData = await sumRes.json().catch(() => ({}));
      const odData = await odRes.json().catch(() => ({}));

      if (!sumRes.ok) {
        setError(sumData?.issues?.[0]?.message || sumData?.error || `Error ${sumRes.status}`);
        return;
      }
      setSummary(sumData);
      if (odRes.ok) {
        setOverdueItems(odData.items ?? []);
        setOverdueTotal(odData.total ?? 0);
      }
    } catch (e) {
      setError((e as Error).message || "Failed to load finance dashboard");
    } finally {
      setLoading(false);
    }
  }, [customerId, dateFrom, dateTo, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setCustomerId("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const monthlyChartData = (summary?.byMonth ?? []).map((m) => ({
    month: m.month,
    Billed: Number(m.billed),
    Collected: Number(m.collected),
  }));

  const statusChartData = (summary?.byStatus ?? []).map((s) => ({
    name: s.status,
    count: s.count,
    amount: Number(s.amount),
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <BillingNav active="dashboard" />

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Title & Filter Bar */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Finance Dashboard</h1>
            <p className="text-xs text-slate-500">
              Real-time SQL-aggregated revenue, outstanding balances, and overdue tracking.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Customer ID</label>
              <input
                type="number"
                min="1"
                placeholder="All"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setPage(1);
                }}
                className="mt-0.5 w-24 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-xs text-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={resetFilters}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Active Subscriptions
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">
              {summary ? summary.activeSubscriptions.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">Currently active plans</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Revenue Collected
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-700">
              {summary ? formatMoney(summary.revenueCollected) : "—"}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">Non-voided payments</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-blue-700">
              Outstanding Balance
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-blue-700">
              {summary ? formatMoney(summary.outstanding) : "—"}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">Confirmed unpaid balance</div>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-red-700">
              Overdue Invoices
            </div>
            <div className="mt-2 text-2xl font-bold text-red-700">
              {summary ? summary.overdueCount.toLocaleString() : "—"}
            </div>
            <div className="mt-1 text-[11px] text-red-600/80">Past due date &amp; unpaid</div>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-red-700">
              Overdue Amount
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-red-700">
              {summary ? formatMoney(summary.overdueAmount) : "—"}
            </div>
            <div className="mt-1 text-[11px] text-red-600/80">Immediate follow-up required</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Chart 1: Monthly Billed vs Collected */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Monthly Billed vs. Revenue Collected
                </h2>
                <p className="text-xs text-slate-500">
                  Confirmed/Paid invoice totals compared against collected payments by month
                </p>
              </div>
            </div>

            {monthlyChartData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-xs text-slate-400">
                No monthly data available for the selected range.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => formatMoney(Number(value ?? 0))}
                      contentStyle={{ fontSize: "12px", borderRadius: "6px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="Billed" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Chart 2: Invoice Status Breakdown */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Invoices by Status</h2>
            <p className="mb-4 text-xs text-slate-500">Distribution of invoice counts &amp; totals</p>

            {statusChartData.length === 0 ? (
              <div className="flex h-52 items-center justify-center text-xs text-slate-400">
                No invoices in range.
              </div>
            ) : (
              <>
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChartData}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={38}
                        outerRadius={68}
                        paddingAngle={2}
                      >
                        {statusChartData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={STATUS_COLORS[entry.name] ?? "#64748b"}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "6px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-3 text-xs">
                  {statusChartData.map((s) => (
                    <div key={s.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium text-slate-700">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: STATUS_COLORS[s.name] ?? "#64748b" }}
                        />
                        {s.name} ({s.count})
                      </span>
                      <span className="font-mono text-slate-600">{formatMoney(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Drill-Down Table: Overdue Action Queue */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Overdue Invoices Drill-Down
              </h2>
              <p className="text-xs text-slate-500">
                Oldest past-due invoices requiring collection or payment entry
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <Link href="/invoices" className="font-medium text-blue-600 hover:underline">
                All Invoices &rarr;
              </Link>
              <Link href="/payments" className="font-medium text-blue-600 hover:underline">
                All Payments &rarr;
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Subscription</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Days Overdue</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                      Loading drill-down data...
                    </td>
                  </tr>
                ) : overdueItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs text-slate-500">
                      No overdue invoices right now.
                    </td>
                  </tr>
                ) : (
                  overdueItems.map((inv) => (
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
                        <div className="text-xs font-medium text-slate-900">
                          {inv.customerName}
                        </div>
                        <div className="text-[11px] text-slate-400">{inv.customerEmail}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {inv.subscriptionNumber}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-red-700">
                        {formatDate(inv.dueDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                          {inv.daysOverdue}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} overdue={true} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                        {formatMoney(inv.total)}
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
                            Inspect
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={overdueTotal}
            onPageChange={setPage}
          />
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

