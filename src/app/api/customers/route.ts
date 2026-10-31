import { getCurrentUser, requireRole } from "@/lib/auth";
import { createCustomerSchema, customerListQuerySchema } from "@/lib/auth-schemas";
import { createCustomerRecord, listCustomers } from "@/lib/customers";
import { handle, json, parseBody, parseQuery } from "@/lib/invoices/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const actor = requireRole(await getCurrentUser(req), "ADMIN", "STAFF");
  const query = parseQuery(customerListQuerySchema, req.nextUrl.searchParams);
  const result = await listCustomers(actor, query);
  return json(result);
});

export const POST = handle(async (req) => {
  const actor = requireRole(await getCurrentUser(req), "ADMIN", "STAFF");
  const body = await parseBody(createCustomerSchema, req);
  const created = await createCustomerRecord(actor, body);
  return json({ customer: created }, { status: 201 });
});

