import type { Cents } from "./money";
import type { InvoiceStatus } from "./invoice-state";

/** Midnight UTC of the given instant. Overdue is evaluated at day granularity (UTC). */
export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const DAY_MS = 86_400_000;

/** Whole UTC calendar days past dueDate (0 if not yet past due). */
export function computeDaysOverdue(dueDate: Date, today: Date): number {
  const diff = startOfDayUTC(today).getTime() - startOfDayUTC(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / DAY_MS) : 0;
}

/**
 * Overdue is computed, never stored:
 * status = CONFIRMED AND balance > 0 AND dueDate < today.
 * `today` is injected so callers/tests are deterministic.
 */
export function isOverdue(
  invoice: { status: InvoiceStatus; dueDate: Date },
  balance: Cents,
  today: Date,
): boolean {
  return (
    invoice.status === "CONFIRMED" &&
    balance > BigInt(0) &&
    startOfDayUTC(invoice.dueDate).getTime() < startOfDayUTC(today).getTime()
  );
}
