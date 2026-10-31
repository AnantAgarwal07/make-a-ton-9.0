import { customerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { handle, json, parseQuery } from "@/lib/invoices/http";
import { getReportSummary } from "@/lib/invoices/report-summary";
import { reportSummaryQuery } from "@/lib/invoices/schemas";

export const dynamic = "force-dynamic";

// GET /api/reports/summary?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&customerId=
export const GET = handle(async (req) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF", "CUSTOMER");
  const q = parseQuery(reportSummaryQuery, req.nextUrl.searchParams);
  const summary = await getReportSummary({ ...q, customerId: customerScope(user, q.customerId) });
  return json(summary);
});

