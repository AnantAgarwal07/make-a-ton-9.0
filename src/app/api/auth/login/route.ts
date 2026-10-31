import { NextResponse } from "next/server";
import { authenticateUser, getSessionCookieOptions } from "@/lib/auth";
import { loginSchema } from "@/lib/auth-schemas";
import { handle, parseBody } from "@/lib/invoices/http";

export const POST = handle(async (req) => {
  const body = await parseBody(loginSchema, req);
  const { user, token, redirectTo } = await authenticateUser(body.email, body.password);

  const response = NextResponse.json({
    user,
    redirectTo,
  });

  response.cookies.set({
    ...getSessionCookieOptions(),
    value: token,
  });

  return response;
});

