import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import {
  calculateVariantUnitPrice,
  roundCurrency,
  toSafeNumber,
  validateVariantInput,
} from "@/lib/catalog";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.VARIANTS_MANAGE, "Product Variants");

    const productId = Number(params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: {
          include: {
            _count: {
              select: {
                subscriptionLines: true,
                templateLines: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const baseSalesPrice = roundCurrency(toSafeNumber(product.salesPrice, "salesPrice"));

    return NextResponse.json({
      productId: product.id,
      productName: product.name,
      baseSalesPrice,
      variants: product.variants.map((v) => {
        const extraPrice = roundCurrency(toSafeNumber(v.extraPrice, "extraPrice"));
        return {
          id: v.id,
          productId: v.productId,
          attribute: v.attribute,
          value: v.value,
          extraPrice,
          finalPrice: calculateVariantUnitPrice(baseSalesPrice, extraPrice),
          _count: v._count,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.VARIANTS_MANAGE, "Product Variant creation");

    const productId = Number(params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateVariantInput(body);

    const created = await prisma.productVariant.create({
      data: {
        productId,
        attribute: validated.attribute,
        value: validated.value,
        extraPrice: validated.extraPrice,
      },
    });

    const baseSalesPrice = roundCurrency(toSafeNumber(product.salesPrice, "salesPrice"));
    const extraPrice = roundCurrency(toSafeNumber(created.extraPrice, "extraPrice"));

    return NextResponse.json(
      {
        message: "Product variant created successfully",
        variant: {
          id: created.id,
          productId: created.productId,
          attribute: created.attribute,
          value: created.value,
          extraPrice,
          finalPrice: calculateVariantUnitPrice(baseSalesPrice, extraPrice),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

