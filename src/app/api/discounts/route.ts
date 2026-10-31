import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { roundCurrency, toSafeNumber, validateDiscountInput } from "@/lib/catalog";
import { DiscountScope, DiscountType } from "@prisma/client";

export function serializeDiscount(discount: {
  id: number;
  name: string;
  type: DiscountType;
  value: unknown;
  minPurchase: unknown;
  minQuantity: number | null;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  timesUsed: number;
  scope: DiscountScope;
  isActive: boolean;
  products?: {
    discountId: number;
    productId: number;
    product?: {
      id: number;
      name: string;
      type: string;
      salesPrice: unknown;
      isArchived: boolean;
    };
  }[];
}) {
  const now = new Date();
  const isExpired = now > discount.endDate;
  const isScheduled = now < discount.startDate;
  const isExhausted =
    discount.usageLimit !== null && discount.timesUsed >= discount.usageLimit;

  let lifecycleStatus: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "INACTIVE" = "ACTIVE";
  if (!discount.isActive) {
    lifecycleStatus = "INACTIVE";
  } else if (isExhausted) {
    lifecycleStatus = "EXHAUSTED";
  } else if (isExpired) {
    lifecycleStatus = "EXPIRED";
  } else if (isScheduled) {
    lifecycleStatus = "SCHEDULED";
  }

  return {
    id: discount.id,
    name: discount.name,
    type: discount.type,
    value: roundCurrency(toSafeNumber(discount.value as number, "discount.value")),
    minPurchase:
      discount.minPurchase !== null && discount.minPurchase !== undefined
        ? roundCurrency(toSafeNumber(discount.minPurchase as number, "discount.minPurchase"))
        : null,
    minQuantity: discount.minQuantity,
    startDate: discount.startDate.toISOString(),
    endDate: discount.endDate.toISOString(),
    usageLimit: discount.usageLimit,
    timesUsed: discount.timesUsed,
    remainingUses:
      discount.usageLimit !== null ? Math.max(0, discount.usageLimit - discount.timesUsed) : null,
    scope: discount.scope,
    isActive: discount.isActive,
    lifecycleStatus,
    productIds: (discount.products ?? []).map((dp) => dp.productId),
    products: (discount.products ?? []).map((dp) => ({
      productId: dp.productId,
      name: dp.product?.name ?? `Product #${dp.productId}`,
      type: dp.product?.type ?? "",
      salesPrice: dp.product
        ? roundCurrency(toSafeNumber(dp.product.salesPrice as number, "salesPrice"))
        : 0,
      isArchived: dp.product?.isArchived ?? false,
    })),
  };
}

export async function GET(req: NextRequest) {
  try {
    // Only ADMIN can manage/access discounts; STAFF receives HTTP 403
    await requireRole(req, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discounts");

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const scope = searchParams.get("scope")?.trim().toUpperCase() || "";
    const type = searchParams.get("type")?.trim().toUpperCase() || "";

    const where: Record<string, unknown> = {};
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (scope === "PRODUCT" || scope === "SUBSCRIPTION") {
      where.scope = scope as DiscountScope;
    }
    if (type === "FIXED" || type === "PERCENT") {
      where.type = type as DiscountType;
    }

    const discounts = await prisma.discount.findMany({
      where,
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                type: true,
                salesPrice: true,
                isArchived: true,
              },
            },
          },
        },
      },
      orderBy: [{ isActive: "desc" }, { id: "desc" }],
    });

    return NextResponse.json({
      discounts: discounts.map(serializeDiscount),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Strictly ADMIN only; STAFF attempting restricted discount operations receives HTTP 403
    await requireRole(req, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discount creation");

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateDiscountInput(body, false);

    const created = await prisma.$transaction(async (tx) => {
      const discount = await tx.discount.create({
        data: {
          name: validated.name!,
          type: validated.type!,
          value: validated.value!,
          minPurchase: validated.minPurchase ?? null,
          minQuantity: validated.minQuantity ?? null,
          startDate: validated.startDate!,
          endDate: validated.endDate!,
          usageLimit: validated.usageLimit ?? null,
          scope: validated.scope!,
          isActive: validated.isActive!,
        },
      });

      if (validated.scope === "PRODUCT" && validated.productIds && validated.productIds.length > 0) {
        await tx.discountProduct.createMany({
          data: validated.productIds.map((productId) => ({
            discountId: discount.id,
            productId,
          })),
        });
      }

      return tx.discount.findUniqueOrThrow({
        where: { id: discount.id },
        include: {
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  salesPrice: true,
                  isArchived: true,
                },
              },
            },
          },
        },
      });
    });

    return NextResponse.json(
      {
        message: "Discount created successfully",
        discount: serializeDiscount(created),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

