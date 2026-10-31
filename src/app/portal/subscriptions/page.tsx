"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { StatusBadge } from "@/components/subscriptions/StatusBadge";
import { SubscriptionDTO } from "@/lib/subscriptions/types";
import { ArrowRight, Calendar, ShieldAlert } from "lucide-react";

export default function CustomerPortalSubscriptionsPage() {
  const [items, setItems] = useState<SubscriptionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMySubscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/subscriptions");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to load your subscriptions");
        setItems([]);
        return;
      }
      setItems(data.items || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading subscriptions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMySubscriptions();
    const handler = () => loadMySubscriptions();
    window.addEventListener("brightloop-auth-changed", handler);
    return () => window.removeEventListener("brightloop-auth-changed", handler);
  }, [loadMySubscriptions]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <div>
          <span className="inline-block rounded-full bg-indigo-100 px-3 py-0.5 text-xs font-semibold text-indigo-800 mb-2">
            Customer Self-Service Portal
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            My Subscriptions
          </h1>
          <p className="text-sm text-slate-600">
            View and manage your active subscriptions and pending quotations.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{error}</p>
              <p className="mt-1 text-xs text-amber-800">
                Customer portal pages strictly enforce server-side customer authentication. Use the Active User selector in the top-right header to switch to a CUSTOMER account (e.g., Acme Traders or Zen Studio).
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading your subscriptions...
          </div>
        ) : !error && items.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            You do not have any subscriptions yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {items.map((sub) => (
              <div
                key={sub.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-200 transition flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold text-indigo-700">
                      {sub.number}
                    </span>
                    <StatusBadge
                      status={sub.status}
                      isPaused={sub.isPaused}
                      isQuotationExpired={sub.isQuotationExpired}
                    />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    {sub.plan?.name}{" "}
                    <span className="font-normal text-slate-500">
                      ({sub.plan?.billingPeriod})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {new Date(sub.startDate).toISOString().slice(0, 10)} →{" "}
                      {new Date(sub.expiryDate).toISOString().slice(0, 10)}
                    </span>
                    {sub.nextInvoiceDate && (
                      <span>
                        Next Billing:{" "}
                        <strong className="font-mono text-slate-700">
                          {new Date(sub.nextInvoiceDate).toISOString().slice(0, 10)}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Amount</div>
                    <div className="font-mono text-lg font-bold text-slate-900">
                      ₹{sub.totals?.grandTotal ?? "0.00"}
                    </div>
                  </div>

                  <Link
                    href={`/portal/subscriptions/${sub.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-600 transition"
                  >
                    Manage
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

