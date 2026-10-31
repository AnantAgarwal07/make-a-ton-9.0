import { BillingPeriod } from "@prisma/client";
import { calculateVariantUnitPrice, NumericInput, roundCurrency, toSafeNumber } from "./decimal";
import { calculatePlanCycleEndDate, PlanCandidate, serializePlan, validatePlanAvailability } from "./plan";
import { ValidationError } from "./validation";

export interface TemplateLineEntity {
  id?: number;
  productId: number;
  variantId?: number | null;
  quantity: number;
  product: {
    id: number;
    name: string;
    type: string;
    salesPrice: NumericInput;
    costPrice?: NumericInput;
    isArchived: boolean;
  };
  variant?: {
    id: number;
    productId: number;
    attribute: string;
    value: string;
    extraPrice: NumericInput;
  } | null;
}

export interface QuotationTemplateEntity {
  id: number;
  name: string;
  planId: number;
  validityDays: number;
  plan: PlanCandidate;
  lines: TemplateLineEntity[];
}

export interface UseTemplateOptions {
  customerId?: number | null;
  referenceDate?: Date | string;
  defaultTaxId?: number | null;
}

export interface SubscriptionDraftLinePayload {
  productId: number;
  productName: string;
  productType: string;
  baseSalesPrice: number;
  variantId: number | null;
  variantAttribute: string | null;
  variantValue: string | null;
  variantExtraPrice: number;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxId: number | null;
}

export interface QuotationTemplateDraftPayload {
  template: {
    id: number;
    name: string;
    planId: number;
    validityDays: number;
  };
  plan: ReturnType<typeof serializePlan>;
  lines: SubscriptionDraftLinePayload[];
  subtotal: number;
  planPrice: number;
  estimatedCycleTotal: number;
  totalQuantity: number;
  quotationValidUntil: string;
  subscriptionDraft: {
    templateId: number;
    templateName: string;
    customerId: number | null;
    planId: number;
    status: "DRAFT";
    startDate: string;
    expiryDate: string;
    quotationValidUntil: string;
    validityDays: number;
    plan: {
      id: number;
      name: string;
      price: number;
      billingPeriod: BillingPeriod | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
      minQuantity: number;
      autoClose: boolean;
      closable: boolean;
      pausable: boolean;
      renewable: boolean;
    };
    lines: SubscriptionDraftLinePayload[];
    subtotal: number;
    planPrice: number;
    estimatedCycleTotal: number;
    totalQuantity: number;
  };
}

/**
 * Pure business logic function that builds a pre-filled subscription draft payload
 * from a QuotationTemplate for P3 consumption (`POST /quotation-templates/:id/use`).
 *
 * Validates:
 * - Template has at least one product line
 * - Associated Plan is currently within its availability date window
 * - Every Product is active (not archived)
 * - Every Variant (if specified) belongs to the line's Product
 * - Total quantity satisfies Plan's minimum quantity requirement
 * - Calculates each line's current unitPrice = Product.salesPrice + Variant.extraPrice
 */
export function buildSubscriptionDraftFromTemplate(
  template: QuotationTemplateEntity,
  options: UseTemplateOptions = {}
): QuotationTemplateDraftPayload {
  if (!template || typeof template !== "object") {
    throw new ValidationError("Quotation template is required");
  }

  if (!template.plan) {
    throw new ValidationError("Quotation template is missing its associated subscription plan");
  }

  if (!Array.isArray(template.lines) || template.lines.length === 0) {
    throw new ValidationError(`Quotation template "${template.name}" has no product lines configured`);
  }

  const refDate = options.referenceDate
    ? options.referenceDate instanceof Date
      ? options.referenceDate
      : new Date(options.referenceDate)
    : new Date();

  if (Number.isNaN(refDate.getTime())) {
    throw new ValidationError("Invalid reference date provided");
  }

  // 1. Validate Plan availability dates
  const planCheck = validatePlanAvailability(template.plan, refDate);
  if (!planCheck.isAvailable) {
    throw new ValidationError(
      planCheck.reason || `Plan "${template.plan.name}" is not available on the requested date`
    );
  }

  // 2. Validate and build each product/variant line
  const draftLines: SubscriptionDraftLinePayload[] = [];
  let linesSubtotal = 0;
  let totalQuantity = 0;

  for (let i = 0; i < template.lines.length; i++) {
    const line = template.lines[i];
    if (!line.product) {
      throw new ValidationError(`Line #${i + 1}: Product not found`);
    }

    if (line.product.isArchived) {
      throw new ValidationError(
        `Cannot use template "${template.name}": Product "${line.product.name}" is archived`
      );
    }

    if (line.quantity < 1 || !Number.isInteger(line.quantity)) {
      throw new ValidationError(
        `Line #${i + 1} (${line.product.name}): Quantity must be a positive integer`
      );
    }

    let variantExtraPrice = 0;
    let variantId: number | null = null;
    let variantAttribute: string | null = null;
    let variantValue: string | null = null;

    if (line.variantId !== null && line.variantId !== undefined) {
      if (!line.variant) {
        throw new ValidationError(
          `Line #${i + 1} (${line.product.name}): Selected variant (ID ${line.variantId}) no longer exists`
        );
      }
      if (line.variant.productId !== line.product.id) {
        throw new ValidationError(
          `Line #${i + 1}: Variant "${line.variant.attribute}: ${line.variant.value}" does not belong to product "${line.product.name}"`
        );
      }
      variantId = line.variant.id;
      variantAttribute = line.variant.attribute;
      variantValue = line.variant.value;
      variantExtraPrice = roundCurrency(toSafeNumber(line.variant.extraPrice, "variant.extraPrice"));
    }

    const baseSalesPrice = roundCurrency(toSafeNumber(line.product.salesPrice, "product.salesPrice"));
    const unitPrice = calculateVariantUnitPrice(baseSalesPrice, variantExtraPrice);
    const amount = roundCurrency(unitPrice * line.quantity);

    draftLines.push({
      productId: line.product.id,
      productName: line.product.name,
      productType: line.product.type,
      baseSalesPrice,
      variantId,
      variantAttribute,
      variantValue,
      variantExtraPrice,
      quantity: line.quantity,
      unitPrice,
      amount,
      taxId: options.defaultTaxId ?? null,
    });

    linesSubtotal = roundCurrency(linesSubtotal + amount);
    totalQuantity += line.quantity;
  }

  // 3. Validate total quantity against Plan's minQuantity
  if (totalQuantity < template.plan.minQuantity) {
    throw new ValidationError(
      `Template total product quantity (${totalQuantity}) is less than plan "${template.plan.name}" minimum quantity (${template.plan.minQuantity})`
    );
  }

  const serializedPlan = serializePlan(template.plan);
  const startDateIso = refDate.toISOString();
  const expiryDateIso = calculatePlanCycleEndDate(refDate, template.plan.billingPeriod).toISOString();
  const validUntilDate = new Date(refDate.getTime() + template.validityDays * 86400000);
  const quotationValidUntilIso = validUntilDate.toISOString();
  const planPrice = serializedPlan.price;
  const estimatedCycleTotal = roundCurrency(linesSubtotal + planPrice);

  return {
    template: {
      id: template.id,
      name: template.name,
      planId: template.planId,
      validityDays: template.validityDays,
    },
    plan: serializedPlan,
    lines: draftLines,
    subtotal: linesSubtotal,
    planPrice,
    estimatedCycleTotal,
    totalQuantity,
    quotationValidUntil: quotationValidUntilIso,
    subscriptionDraft: {
      templateId: template.id,
      templateName: template.name,
      customerId: options.customerId ?? null,
      planId: serializedPlan.id,
      status: "DRAFT",
      startDate: startDateIso,
      expiryDate: expiryDateIso,
      quotationValidUntil: quotationValidUntilIso,
      validityDays: template.validityDays,
      plan: {
        id: serializedPlan.id,
        name: serializedPlan.name,
        price: serializedPlan.price,
        billingPeriod: serializedPlan.billingPeriod,
        minQuantity: serializedPlan.minQuantity,
        autoClose: serializedPlan.autoClose,
        closable: serializedPlan.closable,
        pausable: serializedPlan.pausable,
        renewable: serializedPlan.renewable,
      },
      lines: draftLines,
      subtotal: linesSubtotal,
      planPrice,
      estimatedCycleTotal,
      totalQuantity,
    },
  };
}

