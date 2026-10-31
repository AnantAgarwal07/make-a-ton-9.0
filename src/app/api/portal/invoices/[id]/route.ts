import { portalCustomerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseId } from "@/lib/invoices/http";
import { getInvoiceDetail } from "@/lib/invoices/invoice-detail";

export const dynamic = "force-dynamic";

// GET /api/portal/invoices/:id  (Always scoped to customerId; returns 404 if invoice belongs to another customer)
export const GET = handle(async (req, { params }: { params: { id: string } }) => {
  const user = requireRole(await getCurrentUser(req), "CUSTOMER", "ADMIN", "STAFF");
  const reqCustomerId = Number(req.nextUrl.searchParams.get("customerId")) || undefined;
  const customerId = portalCustomerScope(user, reqCustomerId);
  const invoice = await getInvoiceDetail(parseId(params.id, "invoice id"), customerId);
  return json(invoice);
});

