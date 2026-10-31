import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { transitionStatusSchema } from "@/lib/subscriptions/validation";
import {
  acceptCustomerQuotation,
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

    // If transitioning to CONFIRMED, strictly enforce CUSTOMER-only quotation acceptance
    if (toStatus === "CONFIRMED") {
      if (session.role !== "CUSTOMER" || !session.customerId) {
        throw new SubscriptionServiceError(
          "Forbidden: Staff and Admin cannot accept a quotation on a customer's behalf. Only the owning Customer can accept their quotation.",
          403,
          "FORBIDDEN_STAFF_ACCEPTANCE"
        );
      }

      const accepted = await acceptCustomerQuotation({
        subscriptionId: id,
        customerUserId: session.userId,
        customerId: session.customerId,
        actorRole: session.role,
        note: note ?? null,
      });

      return NextResponse.json(accepted);
    }

    // All other transitions go through transitionSubscriptionStatus with role enforcement
    const updated = await transitionSubscriptionStatus({
      subscriptionId: id,
      toStatus,
      changedById: session.userId,
      actorRole: session.role,
      actorCustomerId: session.customerId,
      note: note ?? null,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
