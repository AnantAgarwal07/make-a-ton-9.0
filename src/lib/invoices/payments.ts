import { InvoiceError } from "./errors";
import { type Cents, type MoneyInput, fromCents, sumCents, toCents } from "./money";
import { type InvoiceStatus, assertTransition } from "./invoice-state";

export interface PaymentLike {
  amount: MoneyInput;
  voidedAt?: Date | null;
}

export interface PayableInvoice {
  status: InvoiceStatus;
  total: MoneyInput;
  payments: PaymentLike[];
}

/** Sum of non-voided payments, in cents. */
export function totalPaidCents(payments: PaymentLike[]): Cents {
  return sumCents(payments.filter((p) => !p.voidedAt).map((p) => toCents(p.amount)));
}

/** balance = total - sum(non-voided payments), in cents. */
export function balanceCents(invoice: Pick<PayableInvoice, "total" | "payments">): Cents {
  return toCents(invoice.total) - totalPaidCents(invoice.payments);
}

/** balance = total - sum(non-voided payments), as a 2-decimal string (e.g. "59.75"). */
export function computeBalance(total: MoneyInput, payments: PaymentLike[]): string {
  return fromCents(balanceCents({ total, payments }));
}

export interface PaymentResult {
  amount: string; // rounded, 2-decimal string to persist
  totalPaid: string;
  balance: string;
  newStatus: InvoiceStatus; // CONFIRMED, or PAID when balance reaches 0
  becamePaid: boolean;
}

/**
 * Validate a payment against an invoice and compute the resulting state.
 * Pure: the caller persists the payment and (if becamePaid) the status, in one DB transaction.
 * Throws InvoiceError: INVOICE_NOT_PAYABLE | INVALID_AMOUNT | OVERPAYMENT.
 */
export function validatePayment(invoice: PayableInvoice, amountInput: MoneyInput): PaymentResult {
  if (invoice.status !== "CONFIRMED") {
    throw new InvoiceError(
      "INVOICE_NOT_PAYABLE",
      `Payments are only allowed on CONFIRMED invoices (current: ${invoice.status})`,
    );
  }

  const amount = toCents(amountInput);
  if (amount <= BigInt(0)) {
    throw new InvoiceError("INVALID_AMOUNT", "Payment amount must be greater than 0");
  }

  const balanceBefore = balanceCents(invoice);
  if (amount > balanceBefore) {
    throw new InvoiceError(
      "OVERPAYMENT",
      `Payment ${fromCents(amount)} exceeds outstanding balance ${fromCents(balanceBefore)}`,
    );
  }

  const paid = totalPaidCents(invoice.payments) + amount;
  const balance = toCents(invoice.total) - paid;
  const becamePaid = balance <= BigInt(0);
  if (becamePaid) assertTransition(invoice.status, "PAID");

  return {
    amount: fromCents(amount),
    totalPaid: fromCents(paid),
    balance: fromCents(balance),
    newStatus: becamePaid ? "PAID" : invoice.status,
    becamePaid,
  };
}
