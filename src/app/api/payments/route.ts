import { customerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { handle, json, parseQuery } from "@/lib/invoices/http";
import { listPayments } from "@/lib/invoices/list-payments";
import { paymentListQuery } from "@/lib/invoices/schemas";

export const dynamic = "force-dynamic";

// GET /api/payments?invoiceId=&customerId=&method=&dateFrom=&dateTo=&includeVoided=true&page=1&pageSize=20
export const GET = handle(async (req) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF", "CUSTOMER");
  const q = parseQuery(paymentListQuery, req.nextUrl.searchParams);
  const result = await listPayments({ ...q, customerId: customerScope(user, q.customerId) });
  return json(result);
});

