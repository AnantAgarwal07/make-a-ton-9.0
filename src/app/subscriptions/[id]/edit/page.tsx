"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { SubscriptionForm } from "@/components/subscriptions/SubscriptionForm";
import { SubscriptionDTO } from "@/lib/subscriptions/types";
import { ArrowLeft, Lock } from "lucide-react";

export default function EditSubscriptionPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [sub, setSub] = useState<SubscriptionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/subscriptions/${id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data.error || "Failed to load subscription");
        }
        setSub(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
        <div className="space-y-1">
          <Link
            href={`/subscriptions/${id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Subscription Details
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Edit Subscription {sub?.number ?? ""}
          </h1>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading subscription...
          </div>
        ) : error || !sub ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            {error || "Subscription not found"}
          </div>
        ) : !sub.permittedActions?.canEdit ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold">Editing Locked ({sub.status})</h3>
              <p className="mt-1 text-xs">
                Direct edits are only permitted while a subscription is in DRAFT or QUOTATION status.
                Active or Closed subscriptions cannot be modified directly.
              </p>
              <Link
                href={`/subscriptions/${sub.id}`}
                className="mt-3 inline-block rounded-lg bg-amber-800 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                Return to Subscription Detail
              </Link>
            </div>
          </div>
        ) : (
          <SubscriptionForm mode="edit" initialSubscription={sub} />
        )}
      </main>
    </div>
  );
}

