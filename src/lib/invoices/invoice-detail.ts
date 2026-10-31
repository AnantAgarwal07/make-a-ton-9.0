import { prisma } from "@/lib/db";
import { HttpError } from "./http-error";
import { fromCents } from "./money";
import { isOverdue } from "./overdue";
import { balanceCents, totalPaidCents } from "./payments";

/**
 * Invoice with lines, payments (incl. voided, for audit), totals and computed overdue flag.
 * Pass `customerId` to scope (rule 5): another customer's invoice => 404, not 403.
 */
export async function getInvoiceDetail(id: number, customerId?: number, now = new Date()) {
  const inv = await prisma.invoice.findFirst({
    where: { id, ...(customerId !== undefined ? { customerId } : {}) },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, address: true } },
      subscription: { select: { id: true, number: true } },
      lines: { orderBy: { id: "asc" } },
      payments: { orderBy: [{ paymentDate: "asc" }, { id: "asc" }] },
    },
  });
  if (!inv) throw new HttpError(404, "Invoice not found");

  const balance = balanceCents(inv);
  return {
    ...inv,
    totalPaid: fromCents(totalPaidCents(inv.payments)),
    balance: fromCents(balance),
    overdue: isOverdue(inv, balance, now),
  };
}

