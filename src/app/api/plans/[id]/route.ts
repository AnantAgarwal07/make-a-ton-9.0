import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { serializePlan, validatePlanAvailability, validatePlanInput } from "@/lib/catalog";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.PLANS_READ, "Plan details");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            subscriptions: true,
            templates: true,
          },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const qtyParam = searchParams.get("quantity");
    const availability = validatePlanAvailability(
      plan,
      dateParam ? new Date(dateParam) : new Date(),
      qtyParam ? Number(qtyParam) : undefined
    );

    return NextResponse.json({
      plan: serializePlan(plan),
      availability,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.PLANS_WRITE, "Plan update");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validatePlanInput(
      {
        ...body,
        availableFrom: body.availableFrom ?? existing.availableFrom,
      },
      true
    );

    const updated = await prisma.plan.update({
      where: { id },
      data: {
        ...(validated.name !== undefined ? { name: validated.name } : {}),
        ...(validated.price !== undefined ? { price: validated.price } : {}),
        ...(validated.billingPeriod !== undefined ? { billingPeriod: validated.billingPeriod } : {}),
        ...(validated.minQuantity !== undefined ? { minQuantity: validated.minQuantity } : {}),
        ...(validated.availableFrom !== undefined ? { availableFrom: validated.availableFrom } : {}),
        ...(validated.availableTo !== undefined ? { availableTo: validated.availableTo } : {}),
        ...(validated.autoClose !== undefined ? { autoClose: validated.autoClose } : {}),
        ...(validated.closable !== undefined ? { closable: validated.closable } : {}),
        ...(validated.pausable !== undefined ? { pausable: validated.pausable } : {}),
        ...(validated.renewable !== undefined ? { renewable: validated.renewable } : {}),
      },
      include: {
        _count: {
          select: {
            subscriptions: true,
            templates: true,
          },
        },
      },
    });

    return NextResponse.json({
      message: "Subscription plan updated successfully",
      plan: serializePlan(updated),
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
    await requireRole(req, P2_PERMISSIONS.PLANS_WRITE, "Plan deletion");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const existing = await prisma.plan.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            subscriptions: true,
            templates: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (existing._count.subscriptions > 0 || existing._count.templates > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete plan "${existing.name}" because it is linked to ${existing._count.subscriptions} subscription(s) and ${existing._count.templates} quotation template(s). Set an Available To date instead to retire it.`,
        },
        { status: 400 }
      );
    }

    await prisma.plan.delete({ where: { id } });

    return NextResponse.json({
      message: `Plan "${existing.name}" deleted successfully`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

