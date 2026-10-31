import { getSessionFromRequest, requireRole } from "@/lib/auth";
import { createCustomerSchema, customerListQuerySchema } from "@/lib/auth-schemas";
import { createCustomerRecord, listCustomers } from "@/lib/customers";
import { handle, json, parseBody, parseQuery } from "@/lib/invoices/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const actor = requireRole(await getSessionFromRequest(req), "ADMIN", "STAFF");
  const query = parseQuery(customerListQuerySchema, req.nextUrl.searchParams);
  const result = await listCustomers(actor, query);
  return json({
    ...result,
    customers: result.items,
  });
});

export const POST = handle(async (req) => {
  const actor = requireRole(await getSessionFromRequest(req), "ADMIN", "STAFF");
  const body = await parseBody(createCustomerSchema, req);
  const created = await createCustomerRecord(actor, body);
  return json(
    {
      message: "Customer created and persisted to database",
      customer: created,
    },
    { status: 201 }
  );
});
