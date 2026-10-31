import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { subscriptionListQuerySchema } from "@/lib/subscriptions/validation";
import { listSubscriptions } from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Enforces server-side customer identity from authenticated session.
    // Never trusts a customerId passed by the browser.
    const session = await requireCustomerSession(req);
    const { searchParams } = new URL(req.url);

    const parsedQuery = subscriptionListQuerySchema.parse({
      search: searchParams.get("search") || undefined,
      status: searchParams.get("status") || undefined,
      isPaused: searchParams.get("isPaused") || undefined,
      planId: searchParams.get("planId") || undefined,
      page: searchParams.get("page") || 1,
      pageSize: searchParams.get("pageSize") || 10,
    });

    const result = await listSubscriptions({
      ...parsedQuery,
      customerId: session.customerId,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

