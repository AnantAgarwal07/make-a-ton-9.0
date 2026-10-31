import { NextResponse } from "next/server";
import { getSessionCookieOptions } from "@/lib/auth";
import { handle } from "@/lib/invoices/http";

export const POST = handle(async () => {
  const response = NextResponse.json({
    ok: true,
    redirectTo: "/login",
  });

  const cookieOpts = getSessionCookieOptions(0);
  response.cookies.set({
    ...cookieOpts,
    value: "",
  });
  response.cookies.set({
    ...cookieOpts,
    name: "token",
    value: "",
  });
  response.cookies.set({
    name: "brightloop_role",
    value: "",
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
});
