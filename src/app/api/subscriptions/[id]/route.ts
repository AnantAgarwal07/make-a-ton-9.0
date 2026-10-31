import { NextRequest, NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { updateSubscriptionSchema } from "@/lib/subscriptions/validation";
import {
  getSubscriptionById,
  SubscriptionServiceError,
  updateSubscription,
} from "@/lib/subscriptions/service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireStaffOrAdmin(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const sub = await getSubscriptionById(id);
    return NextResponse.json(sub);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireStaffOrAdmin(req);
    const id = Number(params.id);
    if (isNaN(id) || id <= 0) {
      throw new SubscriptionServiceError("Invalid subscription ID", 400);
    }

    const body = await req.json();
    const parsed = updateSubscriptionSchema.parse(body);
    const updated = await updateSubscription(id, parsed);

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

