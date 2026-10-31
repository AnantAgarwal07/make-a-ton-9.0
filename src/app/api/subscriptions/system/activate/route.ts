import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-error";
import {
  activateConfirmedSubscriptions,
  closeExpiredSubscriptions,
} from "@/lib/subscriptions/service";

export const dynamic = "force-dynamic";

/**
 * System Scheduled / Cron Endpoint (BRD v2 Section 6 Step 4 & Section 8)
 *
 * 1. Activates all CONFIRMED subscriptions whose startDate <= asOfDate
 *    (recording changedById = null and note = "SYSTEM:START_DATE_REACHED" and initializing nextInvoiceDate).
 * 2. Auto-closes expired ACTIVE subscriptions where Plan.autoClose = true.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const asOfDate = body.asOfDate ? new Date(body.asOfDate) : new Date();

    const [activationResult, autoCloseResult] = await Promise.all([
      activateConfirmedSubscriptions(asOfDate),
      closeExpiredSubscriptions(asOfDate),
    ]);

    return NextResponse.json({
      asOfDate: asOfDate.toISOString(),
      activationResult,
      autoCloseResult,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

