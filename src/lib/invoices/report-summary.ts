import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startOfDayUTC } from "./overdue";
import type { ReportSummaryQuery } from "./schemas";

const DAY_MS = 86_400_000;

export interface MonthlyChartPoint {
  month: string; // YYYY-MM
  billed: Prisma.Decimal;
  collected: Prisma.Decimal;
}

export interface StatusBreakdownPoint {
  status: string;
  count: number;
  amount: Prisma.Decimal;
}

/**
 * Finance dashboard summary computed 100% via PostgreSQL aggregation (no JS loops over invoice/payment rows).
 *
 * Optimizations:
 * 1. Outstanding & overdue aggregation first selects CONFIRMED invoices (`conf_invs`) and aggregates
 *    active payments (`voidedAt IS NULL`) only for those confirmed invoices (avoids hashing payments
 *    belonging to historical PAID invoices, eliminating temp-disk HashAggregate spills).
 * 2. Monthly billed (`Invoice.invoiceDate`) and monthly collected (`Payment.paymentDate`) are executed
 *    as two separate database aggregations using `Invoice_invoiceDate_idx` and `idx_payment_active_date`,
 *    then merged by month (missing months default to 0.00).
 */
export async function getReportSummary(q: ReportSummaryQuery, now = new Date()) {
  const today = startOfDayUTC(now);

  const subConds: Prisma.Sql[] = [Prisma.sql`s.status = 'ACTIVE'`];
  if (q.customerId) subConds.push(Prisma.sql`s."customerId" = ${q.customerId}`);

  const invConds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.customerId) invConds.push(Prisma.sql`i."customerId" = ${q.customerId}`);
  if (q.dateFrom) invConds.push(Prisma.sql`i."invoiceDate" >= ${q.dateFrom}`);
  if (q.dateTo) invConds.push(Prisma.sql`i."invoiceDate" < ${new Date(q.dateTo.getTime() + DAY_MS)}`);
  const invWhere = Prisma.join(invConds, " AND ");

  const payDateConds: Prisma.Sql[] = [Prisma.sql`p."voidedAt" IS NULL`];
  if (q.dateFrom) payDateConds.push(Prisma.sql`p."paymentDate" >= ${q.dateFrom}`);
  if (q.dateTo) payDateConds.push(Prisma.sql`p."paymentDate" < ${new Date(q.dateTo.getTime() + DAY_MS)}`);

  // Only join Invoice on payment queries when filtering by customerId; otherwise scan Payment directly via idx_payment_active_date.
  const payFromSql = q.customerId
    ? Prisma.sql`"Payment" p JOIN "Invoice" i ON i.id = p."invoiceId"`
    : Prisma.sql`"Payment" p`;
  const payWhereConds = q.customerId
    ? [...payDateConds, Prisma.sql`i."customerId" = ${q.customerId}`]
    : payDateConds;
  const payWhere = Prisma.join(payWhereConds, " AND ");

  const [subRows, revRows, balRows, billedByMonthRows, collectedByMonthRows, byStatusRows] =
    await Promise.all([
      // 1. Active subscriptions count
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "Subscription" s WHERE ${Prisma.join(subConds, " AND ")}`,

      // 2. Revenue collected (sum of non-voided payments)
      prisma.$queryRaw<{ total: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(p.amount), 0)::numeric(14,2) AS total
        FROM ${payFromSql}
        WHERE ${payWhere}`,

      // 3. Outstanding balance + overdue count + overdue amount across CONFIRMED invoices
      //    First selects confirmed invoices, then aggregates active payments only for those invoices.
      prisma.$queryRaw<{
        outstanding: Prisma.Decimal;
        overdueCount: number;
        overdueAmount: Prisma.Decimal;
      }[]>`
        WITH conf_invs AS (
          SELECT i.id, i."dueDate", i.total
          FROM "Invoice" i
          WHERE i.status = 'CONFIRMED' AND ${invWhere}
        ),
        paid_per_conf AS (
          SELECT p."invoiceId", SUM(p.amount) AS paid
          FROM "Payment" p
          JOIN conf_invs ci ON ci.id = p."invoiceId"
          WHERE p."voidedAt" IS NULL
          GROUP BY p."invoiceId"
        ),
        conf AS (
          SELECT ci.id, ci."dueDate", (ci.total - COALESCE(pp.paid, 0)) AS bal
          FROM conf_invs ci
          LEFT JOIN paid_per_conf pp ON pp."invoiceId" = ci.id
        )
        SELECT
          COALESCE(SUM(CASE WHEN bal > 0 THEN bal ELSE 0 END), 0)::numeric(14,2) AS outstanding,
          COUNT(*) FILTER (WHERE bal > 0 AND "dueDate" < ${today})::int AS "overdueCount",
          COALESCE(SUM(CASE WHEN bal > 0 AND "dueDate" < ${today} THEN bal ELSE 0 END), 0)::numeric(14,2) AS "overdueAmount"
        FROM conf`,

      // 4A. Monthly billed aggregation (CONFIRMED and PAID invoices grouped by invoiceDate month)
      prisma.$queryRaw<{ month: string; billed: Prisma.Decimal }[]>`
        SELECT to_char(date_trunc('month', i."invoiceDate"), 'YYYY-MM') AS month,
               COALESCE(SUM(i.total), 0)::numeric(14,2) AS billed
        FROM "Invoice" i
        WHERE i.status IN ('CONFIRMED', 'PAID') AND ${invWhere}
        GROUP BY 1
        ORDER BY 1 ASC`,

      // 4B. Monthly collected aggregation (non-voided payments grouped by paymentDate month)
      prisma.$queryRaw<{ month: string; collected: Prisma.Decimal }[]>`
        SELECT to_char(date_trunc('month', p."paymentDate"), 'YYYY-MM') AS month,
               COALESCE(SUM(p.amount), 0)::numeric(14,2) AS collected
        FROM ${payFromSql}
        WHERE ${payWhere}
        GROUP BY 1
        ORDER BY 1 ASC`,

      // 5. Invoice count & total amount by status
      prisma.$queryRaw<StatusBreakdownPoint[]>`
        SELECT i.status::text AS status,
               COUNT(*)::int AS count,
               COALESCE(SUM(i.total), 0)::numeric(14,2) AS amount
        FROM "Invoice" i
        WHERE ${invWhere}
        GROUP BY i.status
        ORDER BY i.status ASC`,
    ]);

  // Combine the two monthly aggregations ( at most ~12-24 monthly summary buckets )
  const ZERO = new Prisma.Decimal(0);
  const monthMap = new Map<string, MonthlyChartPoint>();
  for (const r of billedByMonthRows) {
    monthMap.set(r.month, { month: r.month, billed: r.billed, collected: ZERO });
  }
  for (const r of collectedByMonthRows) {
    const existing = monthMap.get(r.month);
    if (existing) {
      existing.collected = r.collected;
    } else {
      monthMap.set(r.month, { month: r.month, billed: ZERO, collected: r.collected });
    }
  }
  const byMonth = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-24);

  const bal = balRows[0] ?? {
    outstanding: ZERO,
    overdueCount: 0,
    overdueAmount: ZERO,
  };

  return {
    activeSubscriptions: subRows[0]?.count ?? 0,
    revenueCollected: revRows[0]?.total ?? ZERO,
    outstanding: bal.outstanding,
    overdueCount: bal.overdueCount,
    overdueAmount: bal.overdueAmount,
    byMonth,
    byStatus: byStatusRows,
  };
}
