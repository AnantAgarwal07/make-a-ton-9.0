import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { validateTaxInput } from "@/lib/catalog";
import { serializeTax } from "../route";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TAXES_MANAGE, "Tax details");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid tax ID" }, { status: 400 });
    }

    const tax = await prisma.tax.findUnique({
      where: { id },
      include: {
        _count: {
          select: { lines: true },
        },
      },
    });

    if (!tax) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }

    return NextResponse.json({ tax: serializeTax(tax) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TAXES_MANAGE, "Tax update");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid tax ID" }, { status: 400 });
    }

    const existing = await prisma.tax.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateTaxInput(
      {
        ...body,
        type: body.type ?? existing.type,
      },
      true
    );

    const updated = await prisma.tax.update({
      where: { id },
      data: {
        ...(validated.name !== undefined ? { name: validated.name } : {}),
        ...(validated.type !== undefined ? { type: validated.type } : {}),
        ...(validated.rate !== undefined ? { rate: validated.rate } : {}),
        ...(validated.isActive !== undefined ? { isActive: validated.isActive } : {}),
      },
      include: {
        _count: {
          select: { lines: true },
        },
      },
    });

    return NextResponse.json({
      message: "Tax rule updated successfully",
      tax: serializeTax(updated),
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
    await requireRole(req, P2_PERMISSIONS.TAXES_MANAGE, "Tax deletion");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid tax ID" }, { status: 400 });
    }

    const existing = await prisma.tax.findUnique({
      where: { id },
      include: {
        _count: {
          select: { lines: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Tax rule not found" }, { status: 404 });
    }

    if (existing._count.lines > 0) {
      const deactivated = await prisma.tax.update({
        where: { id },
        data: { isActive: false },
        include: {
          _count: {
            select: { lines: true },
          },
        },
      });
      return NextResponse.json({
        message: `Tax "${existing.name}" is referenced by ${existing._count.lines} subscription line(s), so it was marked inactive instead of deleted.`,
        tax: serializeTax(deactivated),
      });
    }

    await prisma.tax.delete({ where: { id } });

    return NextResponse.json({
      message: `Tax "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

