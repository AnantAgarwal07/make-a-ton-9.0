import { Prisma } from "@prisma/client";

// Shared SQL fragments. They assume the Invoice table is aliased as `i`.

/** Sum of non-voided payments for invoice `i` (rule 2). */
export const PAID_SQL = Prisma.sql`(SELECT COALESCE(SUM(p.amount), 0) FROM "Payment" p WHERE p."invoiceId" = i.id AND p."voidedAt" IS NULL)`;

/** Rule 4: CONFIRMED AND balance > 0 AND dueDate < today. `today` must be start of day (UTC). */
export function overdueSql(today: Date): Prisma.Sql {
  return Prisma.sql`(i.status = 'CONFIRMED' AND i."dueDate" < ${today} AND i.total > ${PAID_SQL})`;
}

