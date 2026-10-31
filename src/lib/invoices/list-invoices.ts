import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startOfDayUTC } from "./overdue";
import type { InvoiceListQuery } from "./schemas";
import { overdueSql } from "./sql";

export interface InvoiceListItem {
  id: number;
  number: string;
  status: string;
  customerId: number;
  customerName: string;
  subscriptionId: number;
  subscriptionNumber: string;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
  dueDate: Date;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  balance: Prisma.Decimal;
  overdue: boolean;
}

const DAY_MS = 86_400_000;

function buildWhere(q: InvoiceListQuery, today: Date): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.status) conds.push(Prisma.sql`i.status = ${q.status}::"InvoiceStatus"`);
  if (q.customerId) conds.push(Prisma.sql`i."customerId" = ${q.customerId}`);
  if (q.dateFrom) conds.push(Prisma.sql`i."invoiceDate" >= ${q.dateFrom}`);
  if (q.dateTo) conds.push(Prisma.sql`i."invoiceDate" < ${new Date(q.dateTo.getTime() + DAY_MS)}`);
  if (q.overdue) conds.push(overdueSql(today));
  return Prisma.join(conds, " AND ");
}

/**
 * Paginated invoice list. Pages first (cheap, index-friendly), then joins
 * customer/subscription and sums payments only for the rows on this page.
 */
export async function listInvoices(q: InvoiceListQuery, now = new Date()) {
  const today = startOfDayUTC(now);
  const where = buildWhere(q, today);
  const offset = (q.page - 1) * q.pageSize;

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<InvoiceListItem[]>`
      SELECT i.id, i.number, i.status, i."customerId", c.name AS "customerName",
             i."subscriptionId", s.number AS "subscriptionNumber",
             i."periodStart", i."periodEnd", i."invoiceDate", i."dueDate", i.total,
             pg.paid, (i.total - pg.paid) AS balance,
             (i.status = 'CONFIRMED' AND i."dueDate" < ${today} AND i.total - pg.paid > 0) AS overdue
      FROM (
        SELECT i.* FROM "Invoice" i
        WHERE ${where}
        ORDER BY i."invoiceDate" DESC, i.id DESC
        LIMIT ${q.pageSize} OFFSET ${offset}
      ) i
      JOIN "Customer" c ON c.id = i."customerId"
      JOIN "Subscription" s ON s.id = i."subscriptionId"
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(p.amount), 0) AS paid
        FROM "Payment" p WHERE p."invoiceId" = i.id AND p."voidedAt" IS NULL
      ) pg
      ORDER BY i."invoiceDate" DESC, i.id DESC`,
    prisma.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM "Invoice" i WHERE ${where}`,
  ]);

  return { items, total: countRows[0]?.count ?? 0, page: q.page, pageSize: q.pageSize };
}

