import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { actionNoteSchema } from "@/lib/subscriptions/validation";
import {
  acceptCustomerQuotation,
  SubscriptionServiceError,
} from "@/lib/subscriptions/service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Strictly requires CUSTOMER role; ADMIN and STAFF receive HTTP 403 Forbidden
    const session = await requireCustomerSession(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const body = await req.json().catch(() => ({}));
    const { note } = actionNoteSchema.parse(body);

    const accepted = await acceptCustomerQuotation({
      subscriptionId: id,
      customerUserId: session.userId,
      customerId: session.customerId,
      actorRole: session.role,
      note: note ?? "Customer accepted quotation in portal",
    });

    return NextResponse.json(accepted);
  } catch (err) {
    return handleApiError(err);
  }
}

