import { NextRequest, NextResponse } from "next/server";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import { calculateTax, TaxableLineInput, TaxCalculationError } from "@/lib/catalog";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.PRODUCTS_READ, "Tax calculation");

    const body = (await req.json()) as { lines?: TaxableLineInput[] };
    if (!body || !Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "Request body must include a 'lines' array" },
        { status: 400 }
      );
    }

    const result = calculateTax(body.lines);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TaxCalculationError) {
      return NextResponse.json(
        { error: error.message, code: "TAX_CALCULATION_ERROR" },
        { status: 400 }
      );
    }
    return handleApiError(error);
  }
}

