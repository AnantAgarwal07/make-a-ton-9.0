import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseId } from "@/lib/invoices/http";
import { getInvoiceDetail } from "@/lib/invoices/invoice-detail";
import { transitionInvoice } from "@/lib/invoices/transition-invoice";

// POST /api/invoices/:id/confirm   DRAFT -> CONFIRMED (no body)
export const POST = handle(async (req, { params }: { params: { id: string } }) => {
  requireRole(await getCurrentUser(req), "ADMIN", "STAFF");
  const id = parseId(params.id, "invoice id");
  await transitionInvoice(id, "CONFIRMED");
  return json(await getInvoiceDetail(id));
});
