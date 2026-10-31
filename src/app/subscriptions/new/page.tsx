import React from "react";
import Link from "next/link";
import { SubscriptionHeader } from "@/components/subscriptions/SubscriptionHeader";
import { SubscriptionForm } from "@/components/subscriptions/SubscriptionForm";
import { ArrowLeft } from "lucide-react";

export default function NewSubscriptionPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SubscriptionHeader />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Link
              href="/subscriptions"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Subscriptions
            </Link>
            <h1 className="text-xl font-bold text-slate-900">
              Create Draft Subscription
            </h1>
            <p className="text-sm text-slate-600">
              Prepare a customer-specific subscription or start from a quotation template.
            </p>
          </div>
        </div>

        <SubscriptionForm mode="create" />
      </main>
    </div>
  );
}

