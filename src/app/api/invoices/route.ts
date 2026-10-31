import { customerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseQuery } from "@/lib/invoices/http";
import { listInvoices } from "@/lib/invoices/list-invoices";
import { invoiceListQuery } from "@/lib/invoices/schemas";

export const dynamic = "force-dynamic";

// GET /api/invoices?status=&customerId=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&overdue=true&page=1&pageSize=20
export const GET = handle(async (req) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF", "CUSTOMER");
  const q = parseQuery(invoiceListQuery, req.nextUrl.searchParams);
  const result = await listInvoices({ ...q, customerId: customerScope(user, q.customerId) });
  return json(result);
});
