import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import {
  calculateVariantUnitPrice,
  roundCurrency,
  toSafeNumber,
  validateVariantInput,
} from "@/lib/catalog";

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; variantId: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.VARIANTS_MANAGE, "Product Variant update");

    const productId = Number(params.id);
    const variantId = Number(params.variantId);
    if (!Number.isInteger(productId) || !Number.isInteger(variantId)) {
      return NextResponse.json({ error: "Invalid product or variant ID" }, { status: 400 });
    }

    const existing = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });

    if (!existing || existing.productId !== productId) {
      return NextResponse.json({ error: "Variant not found for this product" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateVariantInput({
      attribute: body.attribute ?? existing.attribute,
      value: body.value ?? existing.value,
      extraPrice: body.extraPrice ?? existing.extraPrice,
    });

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        attribute: validated.attribute,
        value: validated.value,
        extraPrice: validated.extraPrice,
      },
    });

    const baseSalesPrice = roundCurrency(toSafeNumber(existing.product.salesPrice, "salesPrice"));
    const extraPrice = roundCurrency(toSafeNumber(updated.extraPrice, "extraPrice"));

    return NextResponse.json({
      message: "Variant updated successfully",
      variant: {
        id: updated.id,
        productId: updated.productId,
        attribute: updated.attribute,
        value: updated.value,
        extraPrice,
        finalPrice: calculateVariantUnitPrice(baseSalesPrice, extraPrice),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { id: string; variantId: string } }
) {
  return PUT(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; variantId: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.VARIANTS_MANAGE, "Product Variant deletion");

    const productId = Number(params.id);
    const variantId = Number(params.variantId);
    if (!Number.isInteger(productId) || !Number.isInteger(variantId)) {
      return NextResponse.json({ error: "Invalid product or variant ID" }, { status: 400 });
    }

    const existing = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        _count: {
          select: {
            subscriptionLines: true,
            templateLines: true,
          },
        },
      },
    });

    if (!existing || existing.productId !== productId) {
      return NextResponse.json({ error: "Variant not found for this product" }, { status: 404 });
    }

    if (existing._count.subscriptionLines > 0 || existing._count.templateLines > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete variant "${existing.attribute}: ${existing.value}" because it is referenced by ${existing._count.subscriptionLines} subscription line(s) and ${existing._count.templateLines} quotation template(s).`,
        },
        { status: 400 }
      );
    }

    await prisma.productVariant.delete({ where: { id: variantId } });

    return NextResponse.json({
      message: "Variant deleted successfully",
    });
  } catch (error) {
    return handleApiError(error);
  }
}

