import { NextRequest, NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireStaffOrAdmin(req);

    const [customers, plans, products, taxes, discounts, templates] = await Promise.all([
      prisma.customer.findMany({
        include: {
          user: {
            select: { id: true, email: true, role: true, isActive: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.plan.findMany({ orderBy: { name: "asc" } }),
      prisma.product.findMany({
        where: { isArchived: false },
        include: { variants: { orderBy: { id: "asc" } } },
        orderBy: { name: "asc" },
      }),
      prisma.tax.findMany({
        where: { isActive: true },
        orderBy: { id: "asc" },
      }),
      prisma.discount.findMany({
        where: { isActive: true },
        include: {
          products: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      }),
      prisma.quotationTemplate.findMany({
        include: {
          plan: true,
          lines: {
            include: {
              product: true,
              variant: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      customers,
      plans,
      products,
      taxes,
      discounts,
      templates,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
