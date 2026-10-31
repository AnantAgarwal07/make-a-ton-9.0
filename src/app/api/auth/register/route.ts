import { NextResponse } from "next/server";
import { getSessionCookieOptions } from "@/lib/auth";
import { customerRegisterSchema } from "@/lib/auth-schemas";
import { registerCustomerAccount } from "@/lib/customers";
import { handle, parseBody } from "@/lib/invoices/http";

export const POST = handle(async (req) => {
  const body = await parseBody(customerRegisterSchema, req);
  const { user, customer, token, redirectTo } = await registerCustomerAccount(body);

  const response = NextResponse.json(
    {
      user,
      customer,
      redirectTo,
    },
    { status: 201 }
  );

  const cookieOpts = getSessionCookieOptions();
  response.cookies.set({
    ...cookieOpts,
    value: token,
  });
  response.cookies.set({
    ...cookieOpts,
    name: "token",
    value: token,
  });
  response.cookies.set({
    name: "brightloop_role",
    value: user.role,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: cookieOpts.maxAge,
  });

  return response;
});
