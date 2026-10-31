import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { transitionStatusSchema } from "@/lib/subscriptions/validation";
import {
  getSubscriptionById,
  SubscriptionServiceError,
  transitionSubscriptionStatus,
} from "@/lib/subscriptions/service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireAuth(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const body = await req.json();
    const { toStatus, note } = transitionStatusSchema.parse(body);

    // If actor is a CUSTOMER, verify ownership and only allow accepting a quotation (QUOTATION -> CONFIRMED)
    // or closing via the close route
    if (session.role === "CUSTOMER") {
      if (!session.customerId) {
        throw new SubscriptionServiceError("Customer profile not linked", 403, "FORBIDDEN");
      }
      await getSubscriptionById(id, { enforceCustomerId: session.customerId });
      if (toStatus !== "CONFIRMED") {
        throw new SubscriptionServiceError(
          "Customers can only accept quotations (transition to CONFIRMED) via this endpoint",
          403,
          "FORBIDDEN_TRANSITION"
        );
      }
    }

    const updated = await transitionSubscriptionStatus({
      subscriptionId: id,
      toStatus,
      changedById: session.userId,
      note: note ?? null,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

