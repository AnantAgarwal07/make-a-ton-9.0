import { portalCustomerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseQuery } from "@/lib/invoices/http";
import { listInvoices } from "@/lib/invoices/list-invoices";
import { invoiceListQuery } from "@/lib/invoices/schemas";

export const dynamic = "force-dynamic";

// GET /api/portal/invoices?status=&dateFrom=&dateTo=&overdue=true&page=1&pageSize=20
export const GET = handle(async (req) => {
  const user = requireRole(await getCurrentUser(req), "CUSTOMER", "ADMIN", "STAFF");
  const q = parseQuery(invoiceListQuery, req.nextUrl.searchParams);
  const customerId = portalCustomerScope(user, q.customerId);
  const result = await listInvoices({ ...q, customerId });
  return json({ ...result, customerId });
});

