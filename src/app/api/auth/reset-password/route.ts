import { resetPasswordSchema } from "@/lib/auth-schemas";
import { handle, json, parseBody } from "@/lib/invoices/http";
import {
  completePasswordReset,
  validatePasswordResetToken,
} from "@/lib/password-reset";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const token = req.nextUrl.searchParams.get("token") || "";
  const status = await validatePasswordResetToken(token);
  return json({ valid: status.valid });
});

export const POST = handle(async (req) => {
  const body = await parseBody(resetPasswordSchema, req);
  const result = await completePasswordReset(body.token, body.password);
  return json(result);
});

