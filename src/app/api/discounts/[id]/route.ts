import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { validateDiscountInput, ValidationError } from "@/lib/catalog";
import { serializeDiscount } from "../route";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discount details");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid discount ID" }, { status: 400 });
    }

    const discount = await prisma.discount.findUnique({
      where: { id },
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

    if (!discount) {
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }

    return NextResponse.json({ discount: serializeDiscount(discount) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Strictly ADMIN only; STAFF receives HTTP 403
    await requireRole(req, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discount update");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid discount ID" }, { status: 400 });
    }

    const existing = await prisma.discount.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateDiscountInput(
      {
        ...body,
        type: body.type ?? existing.type,
        scope: body.scope ?? existing.scope,
        startDate: body.startDate ?? existing.startDate,
        endDate: body.endDate ?? existing.endDate,
      },
      true
    );

    const targetScope = validated.scope ?? existing.scope;
    const targetProductIds =
      validated.productIds !== undefined
        ? validated.productIds
        : existing.products.map((p) => p.productId);

    if (targetScope === "PRODUCT" && targetProductIds.length === 0) {
      throw new ValidationError(
        "At least one applicable product is required for a PRODUCT-scoped discount"
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.discount.update({
        where: { id },
        data: {
          ...(validated.name !== undefined ? { name: validated.name } : {}),
          ...(validated.type !== undefined ? { type: validated.type } : {}),
          ...(validated.value !== undefined ? { value: validated.value } : {}),
          ...(validated.minPurchase !== undefined ? { minPurchase: validated.minPurchase } : {}),
          ...(validated.minQuantity !== undefined ? { minQuantity: validated.minQuantity } : {}),
          ...(validated.startDate !== undefined ? { startDate: validated.startDate } : {}),
          ...(validated.endDate !== undefined ? { endDate: validated.endDate } : {}),
          ...(validated.usageLimit !== undefined ? { usageLimit: validated.usageLimit } : {}),
          ...(validated.scope !== undefined ? { scope: validated.scope } : {}),
          ...(validated.isActive !== undefined ? { isActive: validated.isActive } : {}),
        },
      });

      if (validated.productIds !== undefined || validated.scope === "SUBSCRIPTION") {
        await tx.discountProduct.deleteMany({ where: { discountId: id } });
        if (targetScope === "PRODUCT" && targetProductIds.length > 0) {
          await tx.discountProduct.createMany({
            data: targetProductIds.map((productId) => ({
              discountId: id,
              productId,
            })),
          });
        }
      }

      return tx.discount.findUniqueOrThrow({
        where: { id },
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

    return NextResponse.json({
      message: "Discount updated successfully",
      discount: serializeDiscount(updated),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { id: string } }
) {
  return PUT(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Strictly ADMIN only; STAFF receives HTTP 403
    await requireRole(req, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discount deletion");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid discount ID" }, { status: 400 });
    }

    const existing = await prisma.discount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Discount not found" }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.discountProduct.deleteMany({ where: { discountId: id } }),
      prisma.discount.delete({ where: { id } }),
    ]);

    return NextResponse.json({
      message: `Discount "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

