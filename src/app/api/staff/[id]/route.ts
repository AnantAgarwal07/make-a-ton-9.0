import { getCurrentUser, requireRole } from "@/lib/auth";
import { updateStaffStatusSchema } from "@/lib/auth-schemas";
import { handle, json, parseBody, parseId } from "@/lib/invoices/http";
import { updateStaffAccountStatus } from "@/lib/staff";

export const PATCH = handle(async (req, { params }: { params: { id: string } }) => {
  const actor = requireRole(await getCurrentUser(req), "ADMIN");
  const targetId = parseId(params.id, "staff user id");
  const body = await parseBody(updateStaffStatusSchema, req);
  const staff = await updateStaffAccountStatus(actor, targetId, body);
  return json({ staff });
});

