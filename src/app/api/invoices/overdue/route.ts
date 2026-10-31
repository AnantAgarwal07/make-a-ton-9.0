import { customerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseQuery } from "@/lib/invoices/http";
import { listOverdueInvoices } from "@/lib/invoices/list-overdue";
import { overdueListQuery } from "@/lib/invoices/schemas";

export const dynamic = "force-dynamic";

// GET /api/invoices/overdue?customerId=&page=1&pageSize=20
export const GET = handle(async (req) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF", "CUSTOMER");
  const q = parseQuery(overdueListQuery, req.nextUrl.searchParams);
  const result = await listOverdueInvoices({ ...q, customerId: customerScope(user, q.customerId) });
  return json(result);
});

