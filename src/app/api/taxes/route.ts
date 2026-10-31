import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { roundCurrency, toSafeNumber, validateTaxInput } from "@/lib/catalog";
import { TaxType } from "@prisma/client";

export function serializeTax(tax: {
  id: number;
  name: string;
  type: TaxType;
  rate: unknown;
  isActive: boolean;
  _count?: { lines?: number };
}) {
  return {
    id: tax.id,
    name: tax.name,
    type: tax.type,
    rate: roundCurrency(toSafeNumber(tax.rate as number, "tax.rate")),
    isActive: tax.isActive,
    _count: tax._count,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.TAXES_MANAGE, "Tax configuration");

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const type = searchParams.get("type")?.trim().toUpperCase() || "";
    const activeOnly = searchParams.get("activeOnly") === "true";

    const where: Record<string, unknown> = {};
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (type === "PERCENT" || type === "FIXED") {
      where.type = type as TaxType;
    }
    if (activeOnly) {
      where.isActive = true;
    }

    const taxes = await prisma.tax.findMany({
      where,
      include: {
        _count: {
          select: { lines: true },
        },
      },
      orderBy: [{ isActive: "desc" }, { id: "desc" }],
    });

    return NextResponse.json({
      taxes: taxes.map(serializeTax),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.TAXES_MANAGE, "Tax creation");

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateTaxInput(body, false);

    const created = await prisma.tax.create({
      data: {
        name: validated.name!,
        type: validated.type!,
        rate: validated.rate!,
        isActive: validated.isActive!,
      },
      include: {
        _count: {
          select: { lines: true },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Tax rule created successfully",
        tax: serializeTax(created),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

