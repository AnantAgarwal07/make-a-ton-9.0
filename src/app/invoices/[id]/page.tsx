"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { canTransition, type InvoiceStatus } from "@/lib/invoices/invoice-state";
import { RecordPaymentModal } from "@/lib/invoices/record-payment-modal";
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

interface InvoiceDetail {
  id: number;
  number: string;
  status: InvoiceStatus;
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

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      setError("Invalid invoice ID");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${id}`);
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

  async function runAction(action: "confirm" | "cancel") {
    if (!invoice) return;
    setActionBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Failed to ${action} invoice`);
        return;
      }
      setInvoice(data);
    } catch (e) {
      setError((e as Error).message || "Action failed");
    } finally {
      setActionBusy(false);
    }
  }

  const activePaymentsCount = invoice
    ? invoice.payments.filter((p) => !p.voidedAt).length
    : 0;
  const allowConfirm = invoice ? canTransition(invoice.status, "CONFIRMED") : false;
  const allowCancel =
    invoice && canTransition(invoice.status, "CANCELLED") && activePaymentsCount === 0;
  const allowPayment =
    invoice && invoice.status === "CONFIRMED" && Number(invoice.balance) > 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 print:bg-white">
      <BillingNav active="invoices" />

      <main className="mx-auto max-w-5xl px-6 py-6 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href="/invoices"
            className="text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            &larr; Back to Invoices
          </Link>

          {invoice && (
            <div className="flex flex-wrap items-center gap-2">
              {allowConfirm && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => runAction("confirm")}
                  className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Confirm Invoice
                </button>
              )}

              {allowPayment && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setPayOpen(true)}
                  className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Record Payment
                </button>
              )}

              {allowCancel && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => runAction("cancel")}
                  className="rounded-md border border-red-300 bg-white px-3.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel Invoice
                </button>
              )}

              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Print
              </button>
            </div>
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
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-slate-900">{invoice.number}</h1>
                  <StatusBadge status={invoice.status} overdue={invoice.overdue} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Subscription{" "}
                  <span className="font-mono font-medium text-slate-700">
                    {invoice.subscription.number}
                  </span>{" "}
                  &middot; Billing Period: {formatDate(invoice.periodStart)} to{" "}
                  {formatDate(invoice.periodEnd)}
                </p>
              </div>

              <div className="text-right text-xs text-slate-600">
                <p className="font-semibold text-slate-900">Brightloop Software</p>
                <p>Invoice Date: {formatDate(invoice.invoiceDate)}</p>
                <p className="font-medium text-slate-900">
                  Due Date: {formatDate(invoice.dueDate)}
                </p>
              </div>
            </div>

            {/* Customer & Summary */}
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
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    Balance Due
                  </span>
                  <div className="text-xl font-bold font-mono text-slate-900">
                    {formatMoney(invoice.balance)}
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice Lines */}
            <div className="py-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Line Items
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold uppercase text-slate-500">
                      <th className="py-2 pr-4">Product</th>
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
              </div>

              {/* Totals block */}
              <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
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
                    <dt>Total</dt>
                    <dd className="font-mono">{formatMoney(invoice.total)}</dd>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <dt>Paid</dt>
                    <dd className="font-mono">{formatMoney(invoice.totalPaid)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
                    <dt>Balance Due</dt>
                    <dd className="font-mono">{formatMoney(invoice.balance)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Payments history */}
            <div className="border-t border-slate-200 pt-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payments ({invoice.payments.length})
              </h2>
              {invoice.payments.length === 0 ? (
                <p className="text-xs text-slate-500">No payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 font-semibold uppercase text-slate-500">
                        <th className="py-2 pr-3">Date</th>
                        <th className="px-3 py-2">Method</th>
                        <th className="px-3 py-2">Note</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="py-2 pl-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoice.payments.map((p) => {
                        const voided = Boolean(p.voidedAt);
                        return (
                          <tr key={p.id} className={voided ? "text-slate-400" : "text-slate-800"}>
                            <td className="py-2.5 pr-3">{formatDate(p.paymentDate)}</td>
                            <td className="px-3 py-2.5 font-medium">
                              {p.method.replace("_", " ")}
                            </td>
                            <td className="px-3 py-2.5">{p.note || "—"}</td>
                            <td className="px-3 py-2.5">
                              {voided ? (
                                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                                  VOIDED
                                </span>
                              ) : (
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                  APPLIED
                                </span>
                              )}
                            </td>
                            <td
                              className={`py-2.5 pl-3 text-right font-mono font-semibold ${
                                voided ? "line-through" : ""
                              }`}
                            >
                              {formatMoney(p.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {invoice && (
        <RecordPaymentModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.number}
          balance={invoice.balance}
          open={payOpen}
          onClose={() => setPayOpen(false)}
          onSuccess={load}
        />
      )}
    </div>
  );
}

