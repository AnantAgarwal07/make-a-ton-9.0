import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, signSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/**
 * Session inspection and role switcher endpoint so P3 screens can be tested
 * seamlessly with P1's User / Customer records or standalone during development.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const availableUsers = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        email: true,
        role: true,
        customerId: true,
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { id: "asc" },
    });

    return NextResponse.json({
      session,
      availableUsers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, isActive: true, customerId: true },
    });

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "User not found or inactive" }, { status: 404 });
    }

    const token = await signSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customerId,
    });

    const res = NextResponse.json({
      session: {
        userId: user.id,
        email: user.email,
        role: user.role,
        customerId: user.customerId,
      },
    });

    res.cookies.set("token", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}

