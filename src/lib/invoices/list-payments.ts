import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PaymentListQuery } from "./schemas";

export interface PaymentListItem {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  customerId: number;
  customerName: string;
  method: string;
  amount: Prisma.Decimal;
  paymentDate: Date;
  note: string | null;
  voidedAt: Date | null;
  createdById: number | null;
  createdAt: Date;
}

const DAY_MS = 86_400_000;

function buildPaymentWhere(q: PaymentListQuery): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (!q.includeVoided) conds.push(Prisma.sql`p."voidedAt" IS NULL`);
  if (q.invoiceId) conds.push(Prisma.sql`p."invoiceId" = ${q.invoiceId}`);
  if (q.customerId) conds.push(Prisma.sql`i."customerId" = ${q.customerId}`);
  if (q.method) conds.push(Prisma.sql`p.method = ${q.method}::"PaymentMethod"`);
  if (q.dateFrom) conds.push(Prisma.sql`p."paymentDate" >= ${q.dateFrom}`);
  if (q.dateTo) conds.push(Prisma.sql`p."paymentDate" < ${new Date(q.dateTo.getTime() + DAY_MS)}`);
  return Prisma.join(conds, " AND ");
}

/** Server-side paginated payments list with invoice & customer details. */
export async function listPayments(q: PaymentListQuery) {
  const where = buildPaymentWhere(q);
  const offset = (q.page - 1) * q.pageSize;

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<PaymentListItem[]>`
      SELECT p.id, p."invoiceId", i.number AS "invoiceNumber", i.status AS "invoiceStatus",
             i."customerId", c.name AS "customerName",
             p.method, p.amount, p."paymentDate", p.note, p."voidedAt", p."createdById", p."createdAt"
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      JOIN "Customer" c ON c.id = i."customerId"
      WHERE ${where}
      ORDER BY p."paymentDate" DESC, p.id DESC
      LIMIT ${q.pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Payment" p
      JOIN "Invoice" i ON i.id = p."invoiceId"
      WHERE ${where}`,
  ]);

  return { items, total: countRows[0]?.count ?? 0, page: q.page, pageSize: q.pageSize };
}

