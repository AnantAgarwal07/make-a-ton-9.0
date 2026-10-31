import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startOfDayUTC } from "./overdue";
import type { OverdueListQuery } from "./schemas";
import { overdueSql } from "./sql";

export interface OverdueInvoiceItem {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  subscriptionId: number;
  subscriptionNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  daysOverdue: number;
}

/**
 * Paginated list of overdue invoices (status = CONFIRMED, balance > 0, dueDate < today),
 * ordered oldest dueDate first, with computed `balance` and `daysOverdue`.
 */
export async function listOverdueInvoices(q: OverdueListQuery, now = new Date()) {
  const today = startOfDayUTC(now);
  const conds: Prisma.Sql[] = [overdueSql(today)];
  if (q.customerId) conds.push(Prisma.sql`i."customerId" = ${q.customerId}`);
  const where = Prisma.join(conds, " AND ");
  const offset = (q.page - 1) * q.pageSize;

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<OverdueInvoiceItem[]>`
      SELECT i.id, i.number, i.status, i."customerId", c.name AS "customerName", c.email AS "customerEmail",
             i."subscriptionId", s.number AS "subscriptionNumber",
             i."invoiceDate", i."dueDate", i.total,
             pg.paid, (i.total - pg.paid) AS balance,
             ((${today}::date - i."dueDate"::date))::int AS "daysOverdue"
      FROM (
        SELECT i.* FROM "Invoice" i
        WHERE ${where}
        ORDER BY i."dueDate" ASC, i.id ASC
        LIMIT ${q.pageSize} OFFSET ${offset}
      ) i
      JOIN "Customer" c ON c.id = i."customerId"
      JOIN "Subscription" s ON s.id = i."subscriptionId"
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(p.amount), 0) AS paid
        FROM "Payment" p WHERE p."invoiceId" = i.id AND p."voidedAt" IS NULL
      ) pg
      ORDER BY i."dueDate" ASC, i.id ASC`,
    prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM "Invoice" i WHERE ${where}`,
  ]);

  return { items, total: countRows[0]?.count ?? 0, page: q.page, pageSize: q.pageSize };
}

