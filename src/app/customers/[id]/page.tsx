import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAuth } from "@/lib/auth";
import { getCustomerById } from "@/lib/customers";
import { AppShell } from "@/components/app-shell";
import { CustomerDetailClient } from "@/components/customer-detail-client";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requirePageAuth("ADMIN", "STAFF");

  const customerId = Number(params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    notFound();
  }

  const customer = await getCustomerById(user, customerId).catch(() => null);
  if (!customer) {
    notFound();
  }

  const serialized = {
    ...customer,
    createdAt: customer.createdAt.toISOString(),
    subscriptions: customer.subscriptions.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString(),
      expiryDate: s.expiryDate.toISOString(),
    })),
    invoices: customer.invoices.map((i) => ({
      ...i,
      invoiceDate: i.invoiceDate.toISOString(),
      dueDate: i.dueDate.toISOString(),
    })),
  };

  return (
    <AppShell
      user={user}
      title={`Customer #${customer.id}: ${customer.name}`}
      subtitle="Detailed customer record, linked portal status, subscriptions, and invoices."
      actions={
        <Link
          href="/customers"
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          &larr; Back to Customers
        </Link>
      }
    >
      <CustomerDetailClient initialCustomer={serialized} />
    </AppShell>
  );
}

