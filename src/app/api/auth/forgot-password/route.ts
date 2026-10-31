import { forgotPasswordSchema } from "@/lib/auth-schemas";
import { handle, json, parseBody } from "@/lib/invoices/http";
import { requestPasswordReset } from "@/lib/password-reset";

export const POST = handle(async (req) => {
  const body = await parseBody(forgotPasswordSchema, req);
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const result = await requestPasswordReset(body.email, appBaseUrl);
  return json(result);
});

