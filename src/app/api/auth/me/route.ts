import { getCurrentUser, requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/invoices/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const user = requireUser(await getCurrentUser(req));
  return json({ user });
});

