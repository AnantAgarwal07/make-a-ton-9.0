import React from "react";
import { SiteHeader } from "@/components/site-header";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-300",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-zinc-100 text-zinc-500 border-zinc-300 line-through",
  OVERDUE: "bg-red-50 text-red-700 border-red-200",
};

export function StatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
          STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
        }`}
      >
        {status}
      </span>
      {overdue && (
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES.OVERDUE}`}
        >
          OVERDUE
        </span>
      )}
    </span>
  );
}

export function formatMoney(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}

/** P4 billing header - now delegates to the shared app-wide navigation. */
export function BillingNav(props: {
  active: "dashboard" | "invoices" | "overdue" | "payments" | "portal";
}) {
  void props;
  return <SiteHeader />;
}

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (nextPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
      <div>
        Showing <span className="font-medium text-slate-900">{start}</span>–
        <span className="font-medium text-slate-900">{end}</span> of{" "}
        <span className="font-medium text-slate-900">{total}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-xs text-slate-500">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
