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

  response.cookies.set({
    ...getSessionCookieOptions(),
    value: token,
  });

  return response;
});

