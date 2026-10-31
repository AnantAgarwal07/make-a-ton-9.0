import { getCurrentUser, requireRole } from "@/lib/auth";
import { createStaffSchema, staffListQuerySchema } from "@/lib/auth-schemas";
import { handle, json, parseBody, parseQuery } from "@/lib/invoices/http";
import { createStaffAccount, listStaffMembers } from "@/lib/staff";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const actor = requireRole(await getCurrentUser(req), "ADMIN");
  const query = parseQuery(staffListQuerySchema, req.nextUrl.searchParams);
  const result = await listStaffMembers(actor, query);
  return json(result);
});

export const POST = handle(async (req) => {
  const actor = requireRole(await getCurrentUser(req), "ADMIN");
  const body = await parseBody(createStaffSchema, req);
  const staff = await createStaffAccount(actor, body);
  return json({ staff }, { status: 201 });
});

