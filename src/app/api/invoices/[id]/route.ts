import { customerScope } from "@/lib/invoices/access";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { handle, json, parseId } from "@/lib/invoices/http";
import { getInvoiceDetail } from "@/lib/invoices/invoice-detail";

export const dynamic = "force-dynamic";

// GET /api/invoices/:id  (CUSTOMER gets 404 for invoices that aren't theirs)
export const GET = handle(async (req, { params }: { params: { id: string } }) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF", "CUSTOMER");
  const invoice = await getInvoiceDetail(parseId(params.id, "invoice id"), customerScope(user));
  return json(invoice);
});
