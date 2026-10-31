import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import {
  CandidateDiscountInput,
  DiscountEvaluationError,
  findApplicableDiscounts,
  SubscriptionDiscountInput,
} from "@/lib/catalog";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_READ, "Discount evaluation");

    const body = (await req.json()) as {
      subscription?: SubscriptionDiscountInput;
      date?: string;
      discounts?: CandidateDiscountInput[];
    };

    if (!body || !body.subscription) {
      return NextResponse.json(
        { error: "Request body must include a 'subscription' object" },
        { status: 400 }
      );
    }

    let candidateDiscounts = body.discounts;
    if (!candidateDiscounts) {
      const dbDiscounts = await prisma.discount.findMany({
        include: { products: true },
      });
      candidateDiscounts = dbDiscounts.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        value: d.value,
        minPurchase: d.minPurchase,
        minQuantity: d.minQuantity,
        startDate: d.startDate,
        endDate: d.endDate,
        usageLimit: d.usageLimit,
        timesUsed: d.timesUsed,
        scope: d.scope,
        isActive: d.isActive,
        products: d.products,
      }));
    }

    const result = findApplicableDiscounts(
      body.subscription,
      body.date ? new Date(body.date) : new Date(),
      candidateDiscounts
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DiscountEvaluationError) {
      return NextResponse.json(
        { error: error.message, code: "DISCOUNT_EVALUATION_ERROR" },
        { status: 400 }
      );
    }
    return handleApiError(error);
  }
}

