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
  Calendar,
  Clock,
  Edit3,
  Eye,
  Info,
  Pause,
  Play,
  RefreshCw,
  Send,
  Tag,
  X,
  XCircle,
} from "lucide-react";

export default function SubscriptionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [sub, setSub] = useState<SubscriptionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [showQuotationPreview, setShowQuotationPreview] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load subscription");
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
    loadDetail();
    const handler = () => loadDetail();
    window.addEventListener("brightloop-auth-changed", handler);
    return () => window.removeEventListener("brightloop-auth-changed", handler);
  }, [loadDetail]);

  async function performAction(endpoint: string, payload: Record<string, unknown> = {}) {
    setActionError(null);
    setActionBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          note: actionNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "Action failed");
        return;
      }
      setSub(data);
      setActionNote("");
      setShowQuotationPreview(false);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  }

  const paymentTermsLabel =
    PAYMENT_TERMS_OPTIONS.find((o) => o.value === sub?.paymentTermsDays)?.label ??
    `${sub?.paymentTermsDays ?? 15} days`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/subscriptions"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Subscriptions List
          </Link>

          <div className="flex items-center gap-2.5">
            {sub && (
              <button
                type="button"
                onClick={() => setShowQuotationPreview(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview Customer Quotation
              </button>
            )}
            {sub?.permittedActions?.canEdit && (
              <Link
                href={`/subscriptions/${sub.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit {sub.status}
              </Link>
            )}
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading subscription details from PostgreSQL...
          </div>
        ) : error || !sub ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            {error || "Subscription not found"}
          </div>
        ) : (
          <>
            {/* Top Banner & Status Header */}
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
                    Customer:{" "}
                    <span className="font-semibold text-slate-900">
                      {sub.customer?.name}
                    </span>{" "}
                    ({sub.customer?.email}) • Plan:{" "}
                    <span className="font-semibold text-slate-900">
                      {sub.plan?.name}
                    </span>{" "}
                    ({sub.plan?.billingPeriod})
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    Grand Total (Incl. Tax & Eligible Offer)
                  </div>
                  <div className="font-mono text-2xl font-bold text-indigo-700">
                    ₹{sub.totals?.grandTotal ?? "0.00"}
                  </div>
                </div>
              </div>

              {/* Pause Duration Limit Warning Banner */}
              {sub.pauseEvaluation?.warningMessage && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Pause Limit Reached</p>
                    <p className="mt-0.5 text-xs">{sub.pauseEvaluation.warningMessage}</p>
                  </div>
                </div>
              )}

              {/* Expired Quotation Warning Banner */}
              {sub.isQuotationExpired && sub.quotationValidUntil && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Quotation Validity Expired</p>
                    <p className="mt-0.5 text-xs">
                      This quotation was valid until{" "}
                      {new Date(sub.quotationValidUntil).toISOString().slice(0, 10)}.
                      Its database status remains QUOTATION and it is flagged as Expired so customer acceptance is blocked.
                    </p>
                  </div>
                </div>
              )}

              {/* Status-Specific Workflow Banner (Strict BRD v2 Rules #4 & #5) */}
              {sub.status === "QUOTATION" && !sub.isQuotationExpired && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900">
                  <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Awaiting Customer Acceptance in Portal</p>
                    <p className="mt-0.5">
                      Per business rules, Staff and Admin cannot accept a quotation on a customer&apos;s behalf.{" "}
                      <strong>{sub.customer?.name}</strong> must sign in to the Customer Portal (
                      <Link href={`/portal/subscriptions/${sub.id}`} className="underline font-semibold">
                        /portal/subscriptions/{sub.id}
                      </Link>
                      ) to review and click <strong>Accept Quotation</strong>.
                      {!sub.customer?.user && (
                        <span className="ml-1 font-semibold text-amber-800">
                          (Note: This customer does not yet have a linked login account — enable/link their login on the Customers screen before they can sign in.)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {sub.status === "CONFIRMED" && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-900">
                  <Clock className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Customer Accepted — Scheduled for Automatic Activation on Start Date
                    </p>
                    <p className="mt-0.5">
                      The customer has accepted this quotation. The system automatically transitions CONFIRMED subscriptions to ACTIVE when their start date (
                      <span className="font-mono font-semibold">
                        {new Date(sub.startDate).toISOString().slice(0, 10)}
                      </span>
                      ) is reached. Staff/Admin do not manually activate subscriptions.
                    </p>
                  </div>
                </div>
              )}

              {/* Lifecycle Progress Bar */}
              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="grid grid-cols-5 gap-2 text-center text-xs font-semibold">
                  {(["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"] as const).map(
                    (step) => {
                      const isCurrent = sub.status === step;
                      return (
                        <div
                          key={step}
                          className={`rounded-lg border py-2 px-2 ${
                            isCurrent
                              ? "border-indigo-600 bg-indigo-50 text-indigo-800 shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-400"
                          }`}
                        >
                          {step}
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            </div>

            {/* Staff/Admin Permitted Actions Bar */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
                Staff / Admin Controls & Plan-Allowed Actions
              </h2>

              {actionError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                  {actionError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Optional note for status history..."
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                />

                {/* Step 2: Staff/Admin can ONLY send a DRAFT as a QUOTATION */}
                {sub.status === "DRAFT" && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() =>
                      performAction(`/api/subscriptions/${sub.id}/transition`, {
                        toStatus: "QUOTATION",
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Send Quotation to Customer (→ QUOTATION)
                  </button>
                )}

                {sub.permittedActions?.canPause && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => performAction(`/api/subscriptions/${sub.id}/pause`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause Subscription
                  </button>
                )}

                {sub.permittedActions?.canResume && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => performAction(`/api/subscriptions/${sub.id}/resume`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume Subscription
                  </button>
                )}

                {sub.permittedActions?.canRenew && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => performAction(`/api/subscriptions/${sub.id}/renew`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Renew (+1 {sub.plan?.billingPeriod} Cycle)
                  </button>
                )}

                {sub.permittedActions?.canClose && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => performAction(`/api/subscriptions/${sub.id}/close`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Close Subscription
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-slate-500 pt-1">
                <span>Plan Flags:</span>
                <span className="font-medium text-slate-700">
                  Pausable: {sub.plan?.pausable ? "Yes" : "No"}
                </span>
                <span>•</span>
                <span className="font-medium text-slate-700">
                  Closable: {sub.plan?.closable ? "Yes" : "No"}
                </span>
                <span>•</span>
                <span className="font-medium text-slate-700">
                  Renewable: {sub.plan?.renewable ? "Yes" : "No"}
                </span>
                <span>•</span>
                <span className="font-medium text-slate-700">
                  Auto-Close at Expiry: {sub.plan?.autoClose ? "Yes" : "No"}
                </span>
                <span>•</span>
                <span className="text-slate-400">
                  Portal delivery: Visible in Customer Portal (Email service not configured in P1)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Left 2 Columns: Schedule & Lines */}
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    Dates, Payment Terms & P4 Billing Hand-off
                  </h3>
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">Start Date</dt>
                      <dd className="mt-1 font-mono font-semibold text-slate-900">
                        {new Date(sub.startDate).toISOString().slice(0, 10)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">Expiry Date</dt>
                      <dd className="mt-1 font-mono font-semibold text-slate-900">
                        {new Date(sub.expiryDate).toISOString().slice(0, 10)}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-indigo-50/70 p-3 border border-indigo-100">
                      <dt className="text-xs text-indigo-700 font-medium">
                        Next Invoice Date (P4)
                      </dt>
                      <dd className="mt-1 font-mono font-bold text-indigo-900">
                        {sub.nextInvoiceDate
                          ? new Date(sub.nextInvoiceDate).toISOString().slice(0, 10)
                          : "Initialized on Activation"}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">Payment Terms</dt>
                      <dd className="mt-1 font-semibold text-slate-900">
                        {paymentTermsLabel} ({sub.paymentTermsDays}d)
                      </dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">Quotation Valid Until</dt>
                      <dd className="mt-1 font-mono font-semibold text-slate-900">
                        {sub.quotationValidUntil
                          ? new Date(sub.quotationValidUntil).toISOString().slice(0, 10)
                          : "—"}
                      </dd>
                    </div>
                    {sub.pauseEvaluation?.isPaused && (
                      <div className="rounded-lg bg-orange-50 p-3 border border-orange-200">
                        <dt className="text-xs text-orange-800 font-medium">
                          Max Pause Until ({sub.pauseEvaluation.maxAllowedCycles} cycles)
                        </dt>
                        <dd className="mt-1 font-mono font-semibold text-orange-900">
                          {sub.pauseEvaluation.maxPauseUntil
                            ? new Date(sub.pauseEvaluation.maxPauseUntil)
                                .toISOString()
                                .slice(0, 10)
                            : "—"}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Subscription Lines Table */}
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Subscription Product Lines
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-6 py-3">Product</th>
                          <th className="px-4 py-3">Variant</th>
                          <th className="px-4 py-3 text-right">Qty</th>
                          <th className="px-4 py-3 text-right">Agreed Unit Price</th>
                          <th className="px-4 py-3">Tax</th>
                          <th className="px-6 py-3 text-right">Line Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sub.lines?.map((line: SubscriptionLineDTO) => (
                          <tr key={line.id}>
                            <td className="px-6 py-3.5 font-medium text-slate-900">
                              {line.product?.name}
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              {line.variant
                                ? `${line.variant.attribute}: ${line.variant.value}`
                                : "—"}
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
                            <td className="px-6 py-3.5 text-right font-mono font-semibold text-slate-900">
                              ₹{Number(line.amount).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-4 flex flex-col items-end space-y-1.5 text-sm">
                    <div className="flex w-72 justify-between text-slate-600">
                      <span>Lines Subtotal:</span>
                      <span className="font-mono">₹{sub.totals?.linesSubtotal}</span>
                    </div>
                    {sub.totals?.eligibleDiscount && (
                      <div className="flex w-72 justify-between text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-xs">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Tag className="h-3 w-3" />
                          {sub.totals.eligibleDiscount.name}:
                        </span>
                        <span className="font-mono font-semibold">
                          -₹{sub.totals.discountTotal}
                        </span>
                      </div>
                    )}
                    <div className="flex w-72 justify-between text-slate-600">
                      <span>Tax Total:</span>
                      <span className="font-mono">₹{sub.totals?.taxTotal}</span>
                    </div>
                    <div className="flex w-72 justify-between text-xs text-slate-400">
                      <span>Plan Reference Price (Not double-counted):</span>
                      <span className="font-mono">₹{sub.totals?.planReferencePrice}</span>
                    </div>
                    <div className="flex w-72 justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
                      <span>Grand Total:</span>
                      <span className="font-mono text-indigo-700">
                        ₹{sub.totals?.grandTotal}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Status History Timeline */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-4 border-b border-slate-100 pb-3">
                  Status & Action History Timeline
                </h3>
                <StatusTimeline history={sub.history || []} />
              </div>
            </div>

            {/* Quotation Preview Modal */}
            {showQuotationPreview && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                    <div>
                      <span className="inline-block rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        Quotation Offer Preview
                      </span>
                      <h3 className="mt-1 text-xl font-bold text-slate-900">
                        {sub.number} — Prepared for {sub.customer?.name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {sub.customer?.email} {sub.customer?.phone ? `• ${sub.customer.phone}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowQuotationPreview(false)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-slate-500 block">Plan</span>
                      <strong className="text-slate-900">
                        {sub.plan?.name} ({sub.plan?.billingPeriod})
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Service Period</span>
                      <strong className="font-mono text-slate-900">
                        {new Date(sub.startDate).toISOString().slice(0, 10)} →{" "}
                        {new Date(sub.expiryDate).toISOString().slice(0, 10)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Payment Terms</span>
                      <strong className="text-slate-900">{paymentTermsLabel}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Offer Valid Until</span>
                      <strong className="font-mono text-slate-900">
                        {sub.quotationValidUntil
                          ? new Date(sub.quotationValidUntil).toISOString().slice(0, 10)
                          : "30 days from send"}
                      </strong>
                    </div>
                  </div>

                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 font-semibold uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Agreed Unit Price</th>
                        <th className="px-3 py-2">Tax</th>
                        <th className="px-3 py-2 text-right">Line Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sub.lines?.map((line) => (
                        <tr key={line.id}>
                          <td className="px-3 py-2.5 font-medium text-slate-900">
                            {line.product?.name}
                            {line.variant && (
                              <span className="block text-[11px] text-slate-500">
                                {line.variant.attribute}: {line.variant.value}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">{line.quantity}</td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            ₹{Number(line.unitPrice).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {line.tax ? line.tax.name : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold">
                            ₹{Number(line.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="border-t border-slate-100 pt-3 flex flex-col items-end space-y-1 text-xs">
                    <div className="flex w-60 justify-between">
                      <span className="text-slate-600">Subtotal:</span>
                      <span className="font-mono">₹{sub.totals?.linesSubtotal}</span>
                    </div>
                    {sub.totals?.eligibleDiscount && (
                      <div className="flex w-60 justify-between text-emerald-700 font-medium">
                        <span>Discount ({sub.totals.eligibleDiscount.name}):</span>
                        <span className="font-mono">-₹{sub.totals.discountTotal}</span>
                      </div>
                    )}
                    <div className="flex w-60 justify-between">
                      <span className="text-slate-600">Tax:</span>
                      <span className="font-mono">₹{sub.totals?.taxTotal}</span>
                    </div>
                    <div className="flex w-60 justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900">
                      <span>Total Payable:</span>
                      <span className="font-mono text-indigo-700">₹{sub.totals?.grandTotal}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                    <span className="text-xs text-slate-500">
                      Portal delivery: Offer becomes immediately visible in the Customer Portal upon sending.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowQuotationPreview(false)}
                        className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700"
                      >
                        Close Preview
                      </button>
                      {sub.status === "DRAFT" && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() =>
                            performAction(`/api/subscriptions/${sub.id}/transition`, {
                              toStatus: "QUOTATION",
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Send Quotation Now
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
