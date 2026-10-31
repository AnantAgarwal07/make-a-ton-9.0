import { DiscountScope, DiscountType, TaxType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { calculateVariantUnitPrice, roundCurrency, toSafeNumber } from "./decimal";
import { serializePlan } from "./plan";
import { ValidationError } from "./validation";

export function serializeDiscount(discount: {
  id: number;
  name: string;
  type: DiscountType;
  value: unknown;
  minPurchase: unknown;
  minQuantity: number | null;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  timesUsed: number;
  scope: DiscountScope;
  isActive: boolean;
  products?: {
    discountId: number;
    productId: number;
    product?: {
      id: number;
      name: string;
      type: string;
      salesPrice: unknown;
      isArchived: boolean;
    };
  }[];
}) {
  const now = new Date();
  const isExpired = now > discount.endDate;
  const isScheduled = now < discount.startDate;
  const isExhausted =
    discount.usageLimit !== null && discount.timesUsed >= discount.usageLimit;

  let lifecycleStatus: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "INACTIVE" = "ACTIVE";
  if (!discount.isActive) {
    lifecycleStatus = "INACTIVE";
  } else if (isExhausted) {
    lifecycleStatus = "EXHAUSTED";
  } else if (isExpired) {
    lifecycleStatus = "EXPIRED";
  } else if (isScheduled) {
    lifecycleStatus = "SCHEDULED";
  }

  return {
    id: discount.id,
    name: discount.name,
    type: discount.type,
    value: roundCurrency(toSafeNumber(discount.value as number, "discount.value")),
    minPurchase:
      discount.minPurchase !== null && discount.minPurchase !== undefined
        ? roundCurrency(toSafeNumber(discount.minPurchase as number, "discount.minPurchase"))
        : null,
    minQuantity: discount.minQuantity,
    startDate: discount.startDate.toISOString(),
    endDate: discount.endDate.toISOString(),
    usageLimit: discount.usageLimit,
    timesUsed: discount.timesUsed,
    remainingUses:
      discount.usageLimit !== null
        ? Math.max(0, discount.usageLimit - discount.timesUsed)
        : null,
    scope: discount.scope,
    isActive: discount.isActive,
    lifecycleStatus,
    productIds: (discount.products ?? []).map((dp) => dp.productId),
    products: (discount.products ?? []).map((dp) => ({
      productId: dp.productId,
      name: dp.product?.name ?? `Product #${dp.productId}`,
      type: dp.product?.type ?? "",
      salesPrice: dp.product
        ? roundCurrency(toSafeNumber(dp.product.salesPrice as number, "salesPrice"))
        : 0,
      isArchived: dp.product?.isArchived ?? false,
    })),
  };
}

export function serializeProduct(product: {
  id: number;
  name: string;
  type: string;
  salesPrice: unknown;
  costPrice: unknown;
  notes: string | null;
  isArchived: boolean;
  variants?: {
    id: number;
    productId: number;
    attribute: string;
    value: string;
    extraPrice: unknown;
  }[];
  _count?: {
    subscriptionLines?: number;
    templateLines?: number;
    discountProducts?: number;
  };
}) {
  const salesPrice = roundCurrency(toSafeNumber(product.salesPrice as number, "salesPrice"));
  const costPrice = roundCurrency(toSafeNumber(product.costPrice as number, "costPrice"));
  const margin = roundCurrency(salesPrice - costPrice);
  const marginPercent = salesPrice > 0 ? roundCurrency((margin / salesPrice) * 100) : 0;

  return {
    id: product.id,
    name: product.name,
    type: product.type,
    salesPrice,
    costPrice,
    margin,
    marginPercent,
    notes: product.notes,
    isArchived: product.isArchived,
    variants: (product.variants ?? []).map((v) => {
      const extraPrice = roundCurrency(toSafeNumber(v.extraPrice as number, "extraPrice"));
      return {
        id: v.id,
        productId: v.productId,
        attribute: v.attribute,
        value: v.value,
        extraPrice,
        finalPrice: calculateVariantUnitPrice(salesPrice, extraPrice),
      };
    }),
    _count: product._count,
  };
}

export function serializeTax(tax: {
  id: number;
  name: string;
  type: TaxType;
  rate: unknown;
  isActive: boolean;
  _count?: { lines?: number };
}) {
  return {
    id: tax.id,
    name: tax.name,
    type: tax.type,
    rate: roundCurrency(toSafeNumber(tax.rate as number, "tax.rate")),
    isActive: tax.isActive,
    _count: tax._count,
  };
}

export const TEMPLATE_INCLUDE = {
  plan: true,
  lines: {
    include: {
      product: true,
      variant: true,
    },
    orderBy: { id: "asc" as const },
  },
};

export function serializeQuotationTemplate(template: {
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

export async function validateTemplateEntitiesInDb(
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
