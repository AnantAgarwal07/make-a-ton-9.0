"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { StatusBadge, StatusTimeline } from "@/components/subscriptions/StatusBadge";
import { SubscriptionDTO, SubscriptionLineDTO } from "@/lib/subscriptions/types";
import { PAYMENT_TERMS_OPTIONS } from "@/lib/subscriptions/validation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Pause,
  Play,
  RefreshCw,
  Tag,
  XCircle,
} from "lucide-react";

export default function CustomerPortalSubscriptionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [sub, setSub] = useState<SubscriptionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSubscription = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/subscriptions/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not load subscription");
        setSub(null);
        return;
      }
      setSub(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading subscription");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadSubscription();
    const handler = () => loadSubscription();
    window.addEventListener("brightloop-auth-changed", handler);
    return () => window.removeEventListener("brightloop-auth-changed", handler);
  }, [loadSubscription]);

  async function triggerCustomerAction(endpoint: string, body: Record<string, unknown> = {}) {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Action not permitted");
        return;
      }
      setSub(data);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  const hasCustomerActions =
    sub &&
    ((sub.status === "QUOTATION" && !sub.isQuotationExpired) ||
      sub.permittedActions?.canPause ||
      sub.permittedActions?.canResume ||
      sub.permittedActions?.canRenew ||
      sub.permittedActions?.canClose);

  const paymentTermsLabel =
    PAYMENT_TERMS_OPTIONS.find((o) => o.value === sub?.paymentTermsDays)?.label ??
    `${sub?.paymentTermsDays ?? 15} days`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <Link
          href="/portal/subscriptions"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to My Quotations & Subscriptions
        </Link>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading subscription details...
          </div>
        ) : error || !sub ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            <p className="font-semibold">{error || "Subscription not found"}</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="font-mono text-2xl font-bold text-slate-900">
                      {sub.number}
                    </h1>
                    <StatusBadge
                      status={sub.status}
                      isPaused={sub.isPaused}
                      isQuotationExpired={sub.isQuotationExpired}
                    />
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    Plan: <strong className="text-slate-900">{sub.plan?.name}</strong> (
                    {sub.plan?.billingPeriod}) • Payment Terms:{" "}
                    <strong className="text-slate-900">{paymentTermsLabel}</strong>
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-xs text-slate-500">Grand Total</div>
                  <div className="font-mono text-2xl font-bold text-slate-800">
                    ₹{sub.totals?.grandTotal ?? "0.00"}
                  </div>
                </div>
              </div>

              {sub.isQuotationExpired && sub.quotationValidUntil && (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>
                    This quotation expired on{" "}
                    {new Date(sub.quotationValidUntil).toISOString().slice(0, 10)} and can no longer be accepted. Please contact our team for a revised quotation.
                  </span>
                </div>
              )}

              {sub.pauseEvaluation?.warningMessage && (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{sub.pauseEvaluation.warningMessage}</span>
                </div>
              )}

              {/* Customer Permitted Actions Bar */}
              {hasCustomerActions && (
                <div className="mt-6 border-t border-slate-100 pt-4 space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Customer Actions
                  </h2>

                  {actionError && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                      {actionError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {sub.status === "QUOTATION" && !sub.isQuotationExpired && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerCustomerAction(
                            `/api/portal/subscriptions/${sub.id}/accept`,
                            {
                              note: "Customer accepted quotation via portal",
                            }
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Accept Quotation
                      </button>
                    )}

                    {sub.permittedActions?.canPause && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerCustomerAction(`/api/subscriptions/${sub.id}/pause`, {
                            note: "Paused by customer via portal",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause Subscription
                      </button>
                    )}

                    {sub.permittedActions?.canResume && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerCustomerAction(`/api/subscriptions/${sub.id}/resume`, {
                            note: "Resumed by customer via portal",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume Subscription
                      </button>
                    )}

                    {sub.permittedActions?.canRenew && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerCustomerAction(`/api/subscriptions/${sub.id}/renew`, {
                            note: "Renewed by customer via portal",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Renew Subscription
                      </button>
                    )}

                    {sub.permittedActions?.canClose && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerCustomerAction(`/api/subscriptions/${sub.id}/close`, {
                            note: "Closed by customer via portal",
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel / Close Subscription
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">
                    Subscription Schedule & Terms
                  </h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="block text-xs text-slate-500">Start Date</span>
                      <strong className="font-mono">
                        {new Date(sub.startDate).toISOString().slice(0, 10)}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="block text-xs text-slate-500">Expiry Date</span>
                      <strong className="font-mono">
                        {new Date(sub.expiryDate).toISOString().slice(0, 10)}
                      </strong>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="block text-xs text-slate-500">Payment Terms</span>
                      <strong>{paymentTermsLabel}</strong>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="block text-xs text-slate-500">Next Billing Date</span>
                      <strong className="font-mono">
                        {sub.nextInvoiceDate
                          ? new Date(sub.nextInvoiceDate).toISOString().slice(0, 10)
                          : "—"}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Included Products & Services
                    </h3>
                  </div>
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Item</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Agreed Unit Price</th>
                        <th className="px-4 py-3">Tax</th>
                        <th className="px-6 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sub.lines?.map((line: SubscriptionLineDTO) => (
                        <tr key={line.id}>
                          <td className="px-6 py-3.5">
                            <div className="font-medium text-slate-900">
                              {line.product?.name}
                            </div>
                            {line.variant && (
                              <div className="text-xs text-slate-500">
                                {line.variant.attribute}: {line.variant.value}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono">
                            {line.quantity}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono">
                            ₹{Number(line.unitPrice).toFixed(2)}
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-600">
                            {line.tax
                              ? `${line.tax.name} (${
                                  line.tax.type === "PERCENT"
                                    ? `${Number(line.tax.rate)}%`
                                    : `₹${Number(line.tax.rate)}`
                                })`
                              : "—"}
                          </td>
                          <td className="px-6 py-3.5 text-right font-mono font-semibold">
                            ₹{Number(line.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4 flex flex-col items-end space-y-1 text-sm">
                    <div className="flex w-64 justify-between text-slate-600">
                      <span>Subtotal:</span>
                      <span className="font-mono">₹{sub.totals?.linesSubtotal}</span>
                    </div>
                    {sub.totals?.eligibleDiscount && (
                      <div className="flex w-64 justify-between text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-xs">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Tag className="h-3 w-3" />
                          {sub.totals.eligibleDiscount.name}:
                        </span>
                        <span className="font-mono font-semibold">
                          -₹{sub.totals.discountTotal}
                        </span>
                      </div>
                    )}
                    <div className="flex w-64 justify-between text-slate-600">
                      <span>Tax Total:</span>
                      <span className="font-mono">₹{sub.totals?.taxTotal}</span>
                    </div>
                    <div className="flex w-64 justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
                      <span>Grand Total:</span>
                      <span className="font-mono text-slate-800">
                        ₹{sub.totals?.grandTotal}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-4 border-b border-slate-100 pb-3">
                  Subscription Activity History
                </h3>
                <StatusTimeline history={sub.history || []} />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
