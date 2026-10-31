import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { buildSubscriptionDraftFromTemplate } from "@/lib/catalog";
import { TEMPLATE_INCLUDE } from "@/lib/catalog";

/**
 * Special P2 -> P3 Handover Endpoint:
 * POST /api/quotation-templates/:id/use (and POST /quotation-templates/:id/use)
 *
 * Returns a validated, pre-filled subscription draft payload that P3 consumes
 * to create a Subscription or Quotation without P2 writing to the Subscription table.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_USE, "Quotation Template use");

    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid quotation template ID" }, { status: 400 });
    }

    const template = await prisma.quotationTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });

    if (!template) {
      return NextResponse.json({ error: "Quotation template not found" }, { status: 404 });
    }

    let body: {
      customerId?: number | null;
      referenceDate?: string;
      defaultTaxId?: number | null;
    } = {};

    try {
      const rawText = await req.text();
      if (rawText) {
        body = JSON.parse(rawText);
      }
    } catch {
      // Optional JSON body
    }

    const payload = buildSubscriptionDraftFromTemplate(template, {
      customerId: body.customerId ?? null,
      referenceDate: body.referenceDate ? new Date(body.referenceDate) : new Date(),
      defaultTaxId: body.defaultTaxId ?? null,
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

