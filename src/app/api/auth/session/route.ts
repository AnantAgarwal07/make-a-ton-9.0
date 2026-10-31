import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, resolveAuthUser, signSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = (await getSessionFromRequest(req)) ?? (await resolveAuthUser(req));
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
      user: session,
      session,
      availableUsers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let user = null;

    if (body.email) {
      user = await prisma.user.findUnique({
        where: { email: body.email },
        select: { id: true, email: true, role: true, isActive: true, customerId: true },
      });
    } else if (body.role) {
      const targetRole = String(body.role).toUpperCase() as Role;
      user = await prisma.user.findFirst({
        where: { role: targetRole, isActive: true },
        select: { id: true, email: true, role: true, isActive: true, customerId: true },
        orderBy: { id: "asc" },
      });
    }

    if (!user || !user.isActive) {
      return NextResponse.json({ error: "User not found or inactive" }, { status: 404 });
    }

    const token = await signSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customerId,
    });

    const sessionPayload = {
      id: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      customerId: user.customerId,
      isActive: user.isActive,
    };

    const res = NextResponse.json({
      user: sessionPayload,
      session: sessionPayload,
    });

    res.cookies.set("token", token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });

    res.cookies.set("brightloop_role", user.role, {
      httpOnly: false,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
