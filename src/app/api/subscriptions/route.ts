import { NextRequest, NextResponse } from "next/server";
import { requireStaffOrAdmin } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import {
  createSubscriptionSchema,
  subscriptionListQuerySchema,
} from "@/lib/subscriptions/validation";
import {
  createSubscription,
  listSubscriptions,
} from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireStaffOrAdmin(req);
    const { searchParams } = new URL(req.url);
    const parsedQuery = subscriptionListQuerySchema.parse({
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      isPaused: searchParams.get("isPaused") || undefined,
      planId: searchParams.get("planId") || undefined,
      customerId: searchParams.get("customerId") || undefined,
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("pageSize") || 10,
    });

    const result = await listSubscriptions(parsedQuery);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireStaffOrAdmin(req);
    const body = await req.json();
    const parsed = createSubscriptionSchema.parse(body);

    const created = await createSubscription({
      ...parsed,
      createdById: session.userId,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

