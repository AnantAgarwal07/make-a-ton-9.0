import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth";
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
    // Enforces ownership on the server using the authenticated customer session
    const session = await requireCustomerSession(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const sub = await getSubscriptionById(id, {
      enforceCustomerId: session.customerId,
    });

    return NextResponse.json(sub);
  } catch (err) {
    return handleApiError(err);
  }
}

