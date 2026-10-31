import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, resolveAuthUser } from "@/lib/auth";
import { Role } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuthUser(req);
    return NextResponse.json({
      user,
      permissions: {
        canReadProducts: P2_PERMISSIONS.PRODUCTS_READ.includes(user.role),
        canWriteProducts: P2_PERMISSIONS.PRODUCTS_WRITE.includes(user.role),
        canManageVariants: P2_PERMISSIONS.VARIANTS_MANAGE.includes(user.role),
        canReadPlans: P2_PERMISSIONS.PLANS_READ.includes(user.role),
        canWritePlans: P2_PERMISSIONS.PLANS_WRITE.includes(user.role),
        canManageTaxes: P2_PERMISSIONS.TAXES_MANAGE.includes(user.role),
        canManageDiscounts: P2_PERMISSIONS.DISCOUNTS_MANAGE.includes(user.role),
        canReadTemplates: P2_PERMISSIONS.TEMPLATES_READ.includes(user.role),
        canWriteTemplates: P2_PERMISSIONS.TEMPLATES_WRITE.includes(user.role),
        canDeleteTemplates: P2_PERMISSIONS.TEMPLATES_DELETE.includes(user.role),
        canUseTemplates: P2_PERMISSIONS.TEMPLATES_USE.includes(user.role),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      role?: string;
      email?: string;
      password?: string;
    };

    // Option 1: Full credential login using P1 User table
    if (body.email && body.password) {
      const dbUser = await prisma.user.findUnique({
        where: { email: body.email.trim() },
      });

      if (!dbUser || !dbUser.isActive) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }

      const valid = await bcrypt.compare(body.password, dbUser.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }

      const res = NextResponse.json({
        user: {
          id: dbUser.id,
          email: dbUser.email,
          role: dbUser.role,
          isActive: dbUser.isActive,
        },
      });
      res.cookies.set("brightloop_role", dbUser.role, {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7,
      });
      return res;
    }

    // Option 2: Role switcher for testing RBAC (ADMIN / STAFF / CUSTOMER)
    const targetRole = String(body.role ?? "ADMIN").toUpperCase() as Role;
    if (!["ADMIN", "STAFF", "CUSTOMER"].includes(targetRole)) {
      return NextResponse.json({ error: "Invalid role specified" }, { status: 400 });
    }

    const res = NextResponse.json({
      message: `Switched active role to ${targetRole}`,
      role: targetRole,
    });
    res.cookies.set("brightloop_role", targetRole, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}

