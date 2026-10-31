import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { InvoiceError } from "./errors";
import { HttpError } from "./http-error";
import { type InvoiceStatus, assertTransition } from "./invoice-state";
import { toCents } from "./money";

export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 }; // Neon cold starts can be slow

/** Lock the invoice row for the rest of the transaction (serialises confirm/cancel/payments). */
export async function lockInvoice(tx: Prisma.TransactionClient, id: number) {
  const rows = await tx.$queryRaw<{ id: number; status: InvoiceStatus; total: Prisma.Decimal }[]>`
    SELECT id, status, total FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw new HttpError(404, "Invoice not found");
  return rows[0];
}

/** The only way confirm/cancel change status. Every change goes through canTransition. */
export async function transitionInvoice(id: number, to: "CONFIRMED" | "CANCELLED") {
  return prisma.$transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    assertTransition(inv.status, to);
    let status: InvoiceStatus = to;

    if (to === "CANCELLED") {
      const active = await tx.payment.count({ where: { invoiceId: id, voidedAt: null } });
      if (active > 0) {
        throw new InvoiceError("HAS_PAYMENTS", `Invoice has ${active} active payment(s); void them before cancelling`);
      }
    }

    if (to === "CONFIRMED") {
      const total = toCents(inv.total);
      if (total < BigInt(0)) throw new InvoiceError("INVALID_AMOUNT", "Invoice total cannot be negative");
      if (total === BigInt(0)) {
        // Nothing to collect (e.g. 100% discount): settle immediately so it never shows as outstanding.
        assertTransition("CONFIRMED", "PAID");
        status = "PAID";
      }
      // TODO (next steps): email the invoice to the customer and set sentAt.
    }

    return tx.invoice.update({ where: { id }, data: { status } });
  }, TX_OPTIONS);
}

