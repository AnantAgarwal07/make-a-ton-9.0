import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { handleApiError, P2_PERMISSIONS, requireRole } from "@/lib/auth";
import {
  calculateVariantUnitPrice,
  roundCurrency,
  serializePlan,
  toSafeNumber,
  validateQuotationTemplateInput,
  ValidationError,
} from "@/lib/catalog";

const TEMPLATE_INCLUDE = {
  plan: true,
  lines: {
    include: {
      product: true,
      variant: true,
    },
    orderBy: { id: "asc" as const },
  },
};

function serializeQuotationTemplate(template: {
  id: number;
  name: string;
  planId: number;
  validityDays: number;
  plan: {
    id: number;
    name: string;
    price: unknown;
    billingPeriod: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    minQuantity: number;
    availableFrom: Date;
    availableTo: Date | null;
    autoClose: boolean;
    closable: boolean;
    pausable: boolean;
    renewable: boolean;
  };
  lines: {
    id: number;
    templateId: number;
    productId: number;
    variantId: number | null;
    quantity: number;
    product: {
      id: number;
      name: string;
      type: string;
      salesPrice: unknown;
      costPrice: unknown;
      isArchived: boolean;
    };
    variant: {
      id: number;
      productId: number;
      attribute: string;
      value: string;
      extraPrice: unknown;
    } | null;
  }[];
}) {
  const serializedPlan = serializePlan(template.plan as Parameters<typeof serializePlan>[0]);

  let linesSubtotal = 0;
  let totalQuantity = 0;
  let hasArchivedProduct = false;

  const lines = template.lines.map((line) => {
    const baseSalesPrice = roundCurrency(
      toSafeNumber(line.product.salesPrice as number, "product.salesPrice")
    );
    const variantExtraPrice = line.variant
      ? roundCurrency(toSafeNumber(line.variant.extraPrice as number, "variant.extraPrice"))
      : 0;
    const unitPrice = calculateVariantUnitPrice(baseSalesPrice, variantExtraPrice);
    const amount = roundCurrency(unitPrice * line.quantity);

    linesSubtotal = roundCurrency(linesSubtotal + amount);
    totalQuantity += line.quantity;
    if (line.product.isArchived) {
      hasArchivedProduct = true;
    }

    return {
      id: line.id,
      templateId: line.templateId,
      productId: line.productId,
      productName: line.product.name,
      productType: line.product.type,
      productIsArchived: line.product.isArchived,
      baseSalesPrice,
      variantId: line.variantId,
      variantAttribute: line.variant?.attribute ?? null,
      variantValue: line.variant?.value ?? null,
      variantExtraPrice,
      quantity: line.quantity,
      unitPrice,
      amount,
    };
  });

  const isReadyToUse =
    serializedPlan.isCurrentlyAvailable &&
    !hasArchivedProduct &&
    totalQuantity >= serializedPlan.minQuantity &&
    lines.length > 0;

  return {
    id: template.id,
    name: template.name,
    planId: template.planId,
    validityDays: template.validityDays,
    plan: serializedPlan,
    lines,
    linesSubtotal,
    planPrice: serializedPlan.price,
    estimatedCycleTotal: roundCurrency(linesSubtotal + serializedPlan.price),
    totalQuantity,
    hasArchivedProduct,
    isReadyToUse,
  };
}

async function validateTemplateEntitiesInDb(
  planId: number,
  lines: { productId: number; variantId: number | null; quantity: number }[]
) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    throw new ValidationError("Selected subscription plan does not exist");
  }

  let totalQty = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const product = await prisma.product.findUnique({
      where: { id: line.productId },
      include: { variants: true },
    });

    if (!product) {
      throw new ValidationError(`Line #${i + 1}: Product ID ${line.productId} does not exist`);
    }
    if (product.isArchived) {
      throw new ValidationError(
        `Line #${i + 1}: Product "${product.name}" is archived and cannot be added to a quotation template`
      );
    }

    if (line.variantId !== null) {
      const matchingVariant = product.variants.find((v) => v.id === line.variantId);
      if (!matchingVariant) {
        throw new ValidationError(
          `Line #${i + 1}: Variant ID ${line.variantId} does not belong to product "${product.name}"`
        );
      }
    }

    totalQty += line.quantity;
  }

  if (totalQty < plan.minQuantity) {
    throw new ValidationError(
      `Total product quantity (${totalQty}) must be at least ${plan.minQuantity} for plan "${plan.name}"`
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_READ, "Quotation Templates");

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const planIdParam = searchParams.get("planId");

    const where: Record<string, unknown> = {};
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (planIdParam && Number.isInteger(Number(planIdParam))) {
      where.planId = Number(planIdParam);
    }

    const templates = await prisma.quotationTemplate.findMany({
      where,
      include: TEMPLATE_INCLUDE,
      orderBy: { id: "desc" },
    });

    return NextResponse.json({
      templates: templates.map(serializeQuotationTemplate),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, P2_PERMISSIONS.TEMPLATES_WRITE, "Quotation Template creation");

    const body = (await req.json()) as Record<string, unknown>;
    const validated = validateQuotationTemplateInput(body, false);

    await validateTemplateEntitiesInDb(validated.planId!, validated.lines!);

    const created = await prisma.quotationTemplate.create({
      data: {
        name: validated.name!,
        planId: validated.planId!,
        validityDays: validated.validityDays!,
        lines: {
          create: validated.lines!.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        },
      },
      include: TEMPLATE_INCLUDE,
    });

    return NextResponse.json(
      {
        message: "Quotation template created successfully",
        template: serializeQuotationTemplate(created),
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

