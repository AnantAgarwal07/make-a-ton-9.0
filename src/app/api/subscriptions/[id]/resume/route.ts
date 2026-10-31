import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { actionNoteSchema } from "@/lib/subscriptions/validation";
import {
  getSubscriptionById,
  resumeSubscription,
  SubscriptionServiceError,
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

    if (session.role === "CUSTOMER") {
      if (!session.customerId) {
        throw new SubscriptionServiceError("Customer profile not linked", 403, "FORBIDDEN");
      }
      await getSubscriptionById(id, { enforceCustomerId: session.customerId });
    }

    const body = await req.json().catch(() => ({}));
    const { note } = actionNoteSchema.parse(body);

    const updated = await resumeSubscription({
      subscriptionId: id,
      changedById: session.userId,
      note: note ?? null,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

