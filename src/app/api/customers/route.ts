import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireStaffOrAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required"),
  email: z.string().trim().email("Valid email address is required"),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  createLoginAccount: z.boolean().optional().default(true),
  password: z.string().min(6).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireStaffOrAdmin(req);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const customers = await prisma.customer.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        _count: {
          select: { subscriptions: true },
        },
      },
      orderBy: { id: "desc" },
    });

    return NextResponse.json({ customers });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireStaffOrAdmin(req);
    const body = await req.json();
    const parsed = createCustomerSchema.parse(body);

    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: parsed.name,
          email: parsed.email,
          phone: parsed.phone || null,
          address: parsed.address || null,
        },
      });

      // Optionally link or create a portal login User so the customer can sign in and accept quotations
      if (parsed.createLoginAccount !== false) {
        const existingUser = await tx.user.findUnique({
          where: { email: parsed.email },
        });
        if (!existingUser) {
          const passwordHash = await bcrypt.hash(parsed.password || "Admin@1234", 10);
          await tx.user.create({
            data: {
              email: parsed.email,
              passwordHash,
              role: "CUSTOMER",
              isActive: true,
              customerId: customer.id,
            },
          });
        } else if (!existingUser.customerId && existingUser.role === "CUSTOMER") {
          await tx.user.update({
            where: { id: existingUser.id },
            data: { customerId: customer.id },
          });
        }
      }

      return tx.customer.findUniqueOrThrow({
        where: { id: customer.id },
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

    return NextResponse.json(
      {
        message: "Customer created and persisted to database",
        customer: created,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

