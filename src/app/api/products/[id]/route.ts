import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { validateProductInput } from "@/lib/catalog";
import { serializeProduct } from "@/lib/catalog";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_READ, "Product details");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { id },
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

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ product: serializeProduct(product) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_WRITE, "Product update");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateProductInput(body, true);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(validated.name !== undefined ? { name: validated.name } : {}),
        ...(validated.type !== undefined ? { type: validated.type } : {}),
        ...(validated.salesPrice !== undefined ? { salesPrice: validated.salesPrice } : {}),
        ...(validated.costPrice !== undefined ? { costPrice: validated.costPrice } : {}),
        ...(validated.notes !== undefined ? { notes: validated.notes } : {}),
        ...(validated.isArchived !== undefined ? { isArchived: validated.isArchived } : {}),
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

    return NextResponse.json({
      message: "Product updated successfully",
      product: serializeProduct(updated),
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

/**
 * Products are archived rather than permanently deleted so historical
 * subscriptions and invoices remain valid.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_WRITE, "Product archiving");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const restore = searchParams.get("restore") === "true";

    const archived = await prisma.product.update({
      where: { id },
      data: { isArchived: !restore },
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

    return NextResponse.json({
      message: restore
        ? `Product "${archived.name}" restored from archive`
        : `Product "${archived.name}" archived to preserve historical subscription and invoice records`,
      product: serializeProduct(archived),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

