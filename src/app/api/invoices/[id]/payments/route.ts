import { getCurrentUser, requireRole } from "@/lib/invoices/auth-stub";
import { handle, json, parseBody, parseId } from "@/lib/invoices/http";
import { recordPayment } from "@/lib/invoices/record-payment";
import { recordPaymentBody } from "@/lib/invoices/schemas";

// POST /api/invoices/:id/payments  { amount, method, paymentDate?, note? }
export const POST = handle(async (req, { params }: { params: { id: string } }) => {
  const user = requireRole(await getCurrentUser(req), "ADMIN", "STAFF");
  const invoiceId = parseId(params.id, "invoice id");
  const body = await parseBody(recordPaymentBody, req);
  const result = await recordPayment(invoiceId, body, user.id);
  return json(result, { status: 201 });
});

