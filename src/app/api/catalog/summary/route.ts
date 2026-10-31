import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { validatePlanAvailability } from "@/lib/catalog";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_READ, "Catalog summary");

    const [products, variantsCount, plans, taxes, discounts, templatesCount] = await Promise.all([
      prisma.product.findMany({ select: { isArchived: true } }),
      prisma.productVariant.count(),
      prisma.plan.findMany({
        select: {
          id: true,
          name: true,
          price: true,
          billingPeriod: true,
          minQuantity: true,
          availableFrom: true,
          availableTo: true,
          autoClose: true,
          closable: true,
          pausable: true,
          renewable: true,
        },
      }),
      prisma.tax.findMany({ select: { isActive: true } }),
      prisma.discount.findMany({
        select: {
          isActive: true,
          startDate: true,
          endDate: true,
          usageLimit: true,
          timesUsed: true,
        },
      }),
      prisma.quotationTemplate.count(),
    ]);

    const now = new Date();
    const activeProducts = products.filter((p) => !p.isArchived).length;
    const archivedProducts = products.filter((p) => p.isArchived).length;
    const availablePlans = plans.filter((p) => validatePlanAvailability(p, now).isAvailable).length;
    const activeTaxes = taxes.filter((t) => t.isActive).length;
    const activeDiscounts = discounts.filter(
      (d) =>
        d.isActive &&
        now >= d.startDate &&
        now <= d.endDate &&
        (d.usageLimit === null || d.timesUsed < d.usageLimit)
    ).length;

    return NextResponse.json({
      summary: {
        totalProducts: products.length,
        activeProducts,
        archivedProducts,
        totalVariants: variantsCount,
        totalPlans: plans.length,
        availablePlans,
        totalTaxes: taxes.length,
        activeTaxes,
        totalDiscounts: discounts.length,
        activeDiscounts,
        totalTemplates: templatesCount,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

