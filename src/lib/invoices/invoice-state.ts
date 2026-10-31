import { InvoiceError } from "./errors";

// Mirrors the Prisma `InvoiceStatus` enum (string-compatible with it).
export type InvoiceStatus = "DRAFT" | "CONFIRMED" | "PAID" | "CANCELLED";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "PAID",
  "CANCELLED",
];

// The single source of truth for allowed invoice status changes.
const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "PAID"],
  PAID: [],
  CANCELLED: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Throws InvoiceError("INVALID_TRANSITION") if the change is not allowed. */
export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new InvoiceError(
      "INVALID_TRANSITION",
      `Cannot change invoice status from ${from} to ${to}`,
    );
  }
}

