"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BillingNav, StatusBadge, formatDate, formatMoney } from "@/lib/invoices/ui";

interface InvoiceLine {
  id: number;
  productName: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  tax: string;
  amount: string;
}

interface Payment {
  id: number;
  method: string;
  amount: string;
  paymentDate: string;
  note: string | null;
  voidedAt: string | null;
}

interface PortalInvoiceDetail {
  id: number;
  number: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  totalPaid: string;
  balance: string;
  overdue: boolean;
  customer: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    address: string | null;
  };
  subscription: {
    id: number;
    number: string;
  };
  lines: InvoiceLine[];
  payments: Payment[];
}

export default function PortalInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [invoice, setInvoice] = useState<PortalInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      setError("Invalid invoice ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/invoices/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setInvoice(data);
    } catch (e) {
      setError((e as Error).message || "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const appliedPayments = invoice ? invoice.payments.filter((p) => !p.voidedAt) : [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 print:min-h-0 print:bg-white">
      <BillingNav active="portal" />

      <main className="mx-auto max-w-4xl px-6 py-6 print:max-w-none print:p-0">
        {/* Top bar (hidden when printing) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href="/portal/invoices"
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            &larr; Back to My Invoices
          </Link>

          {invoice && (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Print / Save as PDF
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 print:hidden">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Loading invoice...
          </div>
        ) : !invoice ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Invoice not found.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-2 print:shadow-none">
            {/* Printable Document Header */}
            <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  TAX INVOICE
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-slate-900">{invoice.number}</h1>
                  <StatusBadge status={invoice.status} overdue={invoice.overdue} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  Subscription:{" "}
                  <span className="font-mono font-medium text-slate-700">
                    {invoice.subscription.number}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Billing Period: {formatDate(invoice.periodStart)} to{" "}
                  {formatDate(invoice.periodEnd)}
                </p>
              </div>

              <div className="text-right text-xs text-slate-600">
                <p className="text-base font-bold text-slate-900">Brightloop Software</p>
                <p>Recurring Billing &amp; Subscriptions</p>
                <p className="mt-2">Invoice Date: {formatDate(invoice.invoiceDate)}</p>
                <p className="font-semibold text-slate-900">
                  Due Date: {formatDate(invoice.dueDate)}
                </p>
              </div>
            </div>

            {/* Customer & Balance Box */}
            <div className="grid grid-cols-1 gap-6 border-b border-slate-200 py-5 sm:grid-cols-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Billed To
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {invoice.customer.name}
                </p>
                <p className="text-xs text-slate-600">{invoice.customer.email}</p>
                {invoice.customer.phone && (
                  <p className="text-xs text-slate-600">{invoice.customer.phone}</p>
                )}
                {invoice.customer.address && (
                  <p className="mt-1 text-xs text-slate-500">{invoice.customer.address}</p>
                )}
              </div>

              <div className="flex flex-col items-start justify-center sm:items-end">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-3 text-right print:bg-white">
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Amount Due
                  </span>
                  <div className="font-mono text-2xl font-bold text-slate-900">
                    {formatMoney(invoice.balance)}
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="py-6">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                    <th className="py-2 pr-4">Description</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Discount</th>
                    <th className="px-3 py-2 text-right">Tax</th>
                    <th className="py-2 pl-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {line.productName}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-slate-700">
                        {line.quantity}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-slate-700">
                        {formatMoney(line.unitPrice)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">
                        {formatMoney(line.discount)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">
                        {formatMoney(line.tax)}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono text-xs font-semibold text-slate-900">
                        {formatMoney(line.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="mt-5 flex justify-end border-t border-slate-200 pt-4">
                <dl className="w-full max-w-xs space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <dt>Subtotal</dt>
                    <dd className="font-mono">{formatMoney(invoice.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <dt>Discount</dt>
                    <dd className="font-mono">-{formatMoney(invoice.discountTotal)}</dd>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <dt>Tax</dt>
                    <dd className="font-mono">{formatMoney(invoice.taxTotal)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                    <dt>Invoice Total</dt>
                    <dd className="font-mono">{formatMoney(invoice.total)}</dd>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <dt>Total Paid</dt>
                    <dd className="font-mono">{formatMoney(invoice.totalPaid)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                    <dt>Balance Due</dt>
                    <dd className="font-mono">{formatMoney(invoice.balance)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Payments Received */}
            {appliedPayments.length > 0 && (
              <div className="border-t border-slate-200 pt-5">
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Payments Received
                </h2>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 font-semibold uppercase text-slate-500">
                      <th className="py-2 pr-3">Date</th>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Reference / Note</th>
                      <th className="py-2 pl-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {appliedPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 pr-3 text-slate-700">
                          {formatDate(p.paymentDate)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {p.method.replace("_", " ")}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{p.note || "—"}</td>
                        <td className="py-2 pl-3 text-right font-mono font-semibold text-emerald-700">
                          {formatMoney(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Print Footer */}
            <div className="mt-8 border-t border-slate-100 pt-4 text-center text-[11px] text-slate-400">
              Thank you for your business &middot; Brightloop Software Subscription Billing
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

