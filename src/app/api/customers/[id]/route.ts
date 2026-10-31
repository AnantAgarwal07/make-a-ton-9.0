import { getSessionFromRequest, requireRole } from "@/lib/auth";
import { updateCustomerSchema } from "@/lib/auth-schemas";
import { getCustomerById, updateCustomerRecord } from "@/lib/customers";
import { handle, json, parseBody, parseId } from "@/lib/invoices/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }: { params: { id: string } }) => {
  const actor = requireRole(
    await getSessionFromRequest(req),
    "ADMIN",
    "STAFF",
    "CUSTOMER"
  );
  const customerId = parseId(params.id, "customer id");
  const customer = await getCustomerById(actor, customerId);
  return json({ customer });
});

export const PATCH = handle(async (req, { params }: { params: { id: string } }) => {
  const actor = requireRole(
    await getSessionFromRequest(req),
    "ADMIN",
    "STAFF",
    "CUSTOMER"
  );
  const customerId = parseId(params.id, "customer id");
  const body = await parseBody(updateCustomerSchema, req);
  const customer = await updateCustomerRecord(actor, customerId, body);
  return json({
    message: "Customer updated successfully",
    customer,
  });
});
