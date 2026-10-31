import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import {
  getSubscriptionById,
  SubscriptionServiceError,
} from "@/lib/subscriptions/service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireAuth(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const sub = await getSubscriptionById(id, {
      enforceCustomerId:
        session.role === "CUSTOMER" ? (session.customerId ?? -1) : undefined,
    });

    return NextResponse.json({
      subscriptionId: sub.id,
      number: sub.number,
      currentStatus: sub.status,
      isPaused: sub.isPaused,
      history: sub.history,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

