import { prisma } from "@/lib/db";
import { validatePayment } from "./payments";
import type { RecordPaymentBody } from "./schemas";
import { lockInvoice, TX_OPTIONS } from "./transition-invoice";

/**
 * Record a payment against a CONFIRMED invoice.
 * Locks the invoice row, validates amount <= balance, inserts the Payment,
 * and if balance reaches 0 transitions the invoice to PAID in the same DB transaction.
 */
export async function recordPayment(
  invoiceId: number,
  input: RecordPaymentBody,
  createdById: number,
) {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    const existingPayments = await tx.payment.findMany({
      where: { invoiceId },
      select: { amount: true, voidedAt: true },
    });

    const result = validatePayment(
      { status: inv.status, total: inv.total, payments: existingPayments },
      input.amount,
    );

    const payment = await tx.payment.create({
      data: {
        invoiceId,
        method: input.method,
        amount: result.amount,
        ...(input.paymentDate ? { paymentDate: input.paymentDate } : {}),
        note: input.note ?? null,
        createdById,
      },
    });

    if (result.becamePaid) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: result.newStatus },
      });
    }

    // TODO (next steps): send payment receipt email / webhook.

    return {
      payment,
      invoiceStatus: result.newStatus,
      totalPaid: result.totalPaid,
      balance: result.balance,
      becamePaid: result.becamePaid,
    };
  }, TX_OPTIONS);
}

