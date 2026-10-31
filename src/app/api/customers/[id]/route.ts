import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireStaffOrAdmin } from "@/lib/auth";
import { SubscriptionServiceError } from "@/lib/subscriptions/service";

const updateCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").optional(),
  email: z.string().trim().email("Valid email is required").optional(),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  loginIsActive: z.boolean().optional(),
  linkLoginAccount: z.boolean().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireStaffOrAdmin(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid customer ID", 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!customer) {
      throw new SubscriptionServiceError("Customer not found", 404, "NOT_FOUND");
    }

    return NextResponse.json({ customer });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireStaffOrAdmin(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid customer ID", 400);
    }

    const body = await req.json();
    const parsed = updateCustomerSchema.parse(body);

    const existing = await prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      throw new SubscriptionServiceError("Customer not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.email !== undefined ? { email: parsed.email } : {}),
          ...(parsed.phone !== undefined ? { phone: parsed.phone } : {}),
          ...(parsed.address !== undefined ? { address: parsed.address } : {}),
        },
      });

      // If customer has a linked User login, update User.isActive when requested
      if (parsed.loginIsActive !== undefined && existing.user) {
        await tx.user.update({
          where: { id: existing.user.id },
          data: { isActive: parsed.loginIsActive },
        });
      }

      // If Staff/Admin requests linking a portal login for a customer without a linked User
      if (parsed.linkLoginAccount && !existing.user) {
        const targetEmail = parsed.email ?? existing.email;
        const existingUser = await tx.user.findUnique({ where: { email: targetEmail } });
        if (!existingUser) {
          const pw = await bcrypt.hash("Admin@1234", 10);
          await tx.user.create({
            data: {
              email: targetEmail,
              passwordHash: pw,
              role: "CUSTOMER",
              isActive: parsed.loginIsActive ?? true,
              customerId: id,
            },
          });
        } else if (!existingUser.customerId && existingUser.role === "CUSTOMER") {
          await tx.user.update({
            where: { id: existingUser.id },
            data: { customerId: id, isActive: parsed.loginIsActive ?? existingUser.isActive },
          });
        }
      }

      return tx.customer.findUniqueOrThrow({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
        },
      });
    });

    return NextResponse.json({
      message: "Customer updated successfully",
      customer: updated,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

