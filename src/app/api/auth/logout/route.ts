import { NextResponse } from "next/server";
import { getSessionCookieOptions } from "@/lib/auth";
import { handle } from "@/lib/invoices/http";

export const POST = handle(async () => {
  const response = NextResponse.json({
    ok: true,
    redirectTo: "/login",
  });

  response.cookies.set({
    ...getSessionCookieOptions(0),
    value: "",
  });

  return response;
});

