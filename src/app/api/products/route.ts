import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import {
  calculateVariantUnitPrice,
  roundCurrency,
  toSafeNumber,
  validateProductInput,
} from "@/lib/catalog";

function serializeProduct(product: {
  id: number;
  name: string;
  type: string;
  salesPrice: unknown;
  costPrice: unknown;
  notes: string | null;
  isArchived: boolean;
  variants?: {
    id: number;
    productId: number;
    attribute: string;
    value: string;
    extraPrice: unknown;
  }[];
  _count?: {
    subscriptionLines?: number;
    templateLines?: number;
    discountProducts?: number;
  };
}) {
  const salesPrice = roundCurrency(toSafeNumber(product.salesPrice as number, "salesPrice"));
  const costPrice = roundCurrency(toSafeNumber(product.costPrice as number, "costPrice"));
  const margin = roundCurrency(salesPrice - costPrice);
  const marginPercent = salesPrice > 0 ? roundCurrency((margin / salesPrice) * 100) : 0;

  return {
    id: product.id,
    name: product.name,
    type: product.type,
    salesPrice,
    costPrice,
    margin,
    marginPercent,
    notes: product.notes,
    isArchived: product.isArchived,
    variants: (product.variants ?? []).map((v) => {
      const extraPrice = roundCurrency(toSafeNumber(v.extraPrice as number, "extraPrice"));
      return {
        id: v.id,
        productId: v.productId,
        attribute: v.attribute,
        value: v.value,
        extraPrice,
        finalPrice: calculateVariantUnitPrice(salesPrice, extraPrice),
      };
    }),
    _count: product._count,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_READ, "Products");

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const type = searchParams.get("type")?.trim() || "";
    const status = searchParams.get("status")?.trim() || "all"; // active | archived | all

    const where: Record<string, unknown> = {};

    if (status === "active") {
      where.isArchived = false;
    } else if (status === "archived") {
      where.isArchived = true;
    }

    if (type && type !== "all") {
      where.type = { equals: type, mode: "insensitive" };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { type: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
        _count: {
          select: {
            subscriptionLines: true,
            templateLines: true,
            discountProducts: true,
          },
        },
      },
      orderBy: [{ isArchived: "asc" }, { id: "desc" }],
    });

    return NextResponse.json({
      products: products.map(serializeProduct),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_WRITE, "Product creation");

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateProductInput(body, false);

    const created = await prisma.product.create({
      data: {
        name: validated.name!,
        type: validated.type!,
        salesPrice: validated.salesPrice!,
        costPrice: validated.costPrice!,
        notes: validated.notes ?? null,
        isArchived: validated.isArchived ?? false,
        variants:
          validated.variants && validated.variants.length > 0
            ? {
                create: validated.variants.map((v) => ({
                  attribute: v.attribute,
                  value: v.value,
                  extraPrice: v.extraPrice,
                })),
              }
            : undefined,
      },
      include: {
        variants: { orderBy: { id: "asc" } },
        _count: {
          select: {
            subscriptionLines: true,
            templateLines: true,
            discountProducts: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Product created successfully",
        product: serializeProduct(created),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

