import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { serializePlan, validatePlanAvailability, validatePlanInput } from "@/lib/catalog";
import { BillingPeriod } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PLANS_READ, "Subscription Plans");

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const billingPeriod = searchParams.get("billingPeriod")?.trim().toUpperCase() || "";
    const availableOnly = searchParams.get("availableOnly") === "true";
    const dateParam = searchParams.get("date");
    const targetDate = dateParam ? new Date(dateParam) : new Date();

    const where: Record<string, unknown> = {};
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (billingPeriod && ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(billingPeriod)) {
      where.billingPeriod = billingPeriod as BillingPeriod;
    }

    const plans = await prisma.plan.findMany({
      where,
      include: {
        _count: {
          select: {
            subscriptions: true,
            templates: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    const serialized = plans
      .map((p) => {
        const s = serializePlan(p);
        const check = validatePlanAvailability(p, targetDate);
        return {
          ...s,
          isCurrentlyAvailable: check.isAvailable,
          availabilityReason: check.reason ?? null,
        };
      })
      .filter((p) => (!availableOnly ? true : p.isCurrentlyAvailable));

    return NextResponse.json({ plans: serialized });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PLANS_WRITE, "Plan creation");

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validatePlanInput(body, false);

    const created = await prisma.plan.create({
      data: {
        name: validated.name!,
        price: validated.price!,
        billingPeriod: validated.billingPeriod!,
        minQuantity: validated.minQuantity!,
        availableFrom: validated.availableFrom!,
        availableTo: validated.availableTo ?? null,
        autoClose: validated.autoClose!,
        closable: validated.closable!,
        pausable: validated.pausable!,
        renewable: validated.renewable!,
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

    return NextResponse.json(
      {
        message: "Subscription plan created successfully",
        plan: serializePlan(created),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

