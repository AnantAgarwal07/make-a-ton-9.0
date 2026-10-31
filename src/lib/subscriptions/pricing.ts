import { Prisma, TaxType } from "@prisma/client";
import { findApplicableDiscounts, CandidateDiscountInput } from "@/lib/catalog/discount";

/**
 * Isolated Pricing & Totals Module for P3 Subscriptions
 *
 * NOTE FOR P2 / P4 COORDINATION (Section 5.2 of BRD v2):
 * The shared schema contains both `Plan.price` and `Product.salesPrice` / `SubscriptionLine.unitPrice`.
 * `Plan.price` is NOT double-counted on top of product lines. All totals calculations are isolated in
 * this single function (`calculateSubscriptionTotals`) and integrated with P2's shared discount eligibility
 * engine (`findApplicableDiscounts`).
 */
export const PRICING_CONFIG = {
  includePlanBaseFeeInTotal: false,
};

export function toDecimal(value: Prisma.Decimal | number | string): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  return new Prisma.Decimal(value);
}

/**
 * Suggested starting unit price for a line:
 * Product.salesPrice + ProductVariant.extraPrice (or product salesPrice when no variant).
 */
export function calculateDefaultUnitPrice(
  productSalesPrice: Prisma.Decimal | number | string,
  variantExtraPrice?: Prisma.Decimal | number | string | null
): Prisma.Decimal {
  const base = toDecimal(productSalesPrice);
  const extra = variantExtraPrice != null ? toDecimal(variantExtraPrice) : new Prisma.Decimal(0);
  return base.add(extra).toDecimalPlaces(2);
}

/**
 * Line amount = quantity * agreed unitPrice (stored as Prisma Decimal with 2 decimal places).
 */
export function calculateLineAmount(
  quantity: number,
  agreedUnitPrice: Prisma.Decimal | number | string
): Prisma.Decimal {
  const qty = new Prisma.Decimal(quantity);
  const unit = toDecimal(agreedUnitPrice).toDecimalPlaces(2);
  return qty.mul(unit).toDecimalPlaces(2);
}

/**
 * Calculates tax for a single subscription line if a tax rule is attached.
 */
export function calculateLineTax(
  lineAmount: Prisma.Decimal | number | string,
  quantity: number,
  tax?: { type: TaxType; rate: Prisma.Decimal | number | string; isActive?: boolean } | null
): Prisma.Decimal {
  if (!tax || tax.isActive === false) {
    return new Prisma.Decimal(0);
  }
  const amount = toDecimal(lineAmount);
  const rate = toDecimal(tax.rate);

  if (tax.type === "PERCENT") {
    return amount.mul(rate).div(new Prisma.Decimal(100)).toDecimalPlaces(2);
  }
  // FIXED tax per unit
  return rate.mul(new Prisma.Decimal(quantity)).toDecimalPlaces(2);
}

export interface SubscriptionTotalsBreakdown {
  linesSubtotal: string;
  discountTotal: string;
  eligibleDiscount: {
    id: number;
    name: string;
    type: "FIXED" | "PERCENT";
    value: number;
    scope: "PRODUCT" | "SUBSCRIPTION";
    discountAmount: number;
  } | null;
  subtotalAfterDiscount: string;
  taxTotal: string;
  planReferencePrice: string;
  grandTotal: string;
  includesPlanFee: boolean;
}

/**
 * Isolated total calculation function for a subscription.
 * Uses P2's shared `findApplicableDiscounts` when candidate discounts are provided.
 */
export function calculateSubscriptionTotals(params: {
  lines: Array<{
    productId?: number;
    quantity: number;
    unitPrice?: Prisma.Decimal | number | string;
    amount: Prisma.Decimal | number | string;
    tax?: { type: TaxType; rate: Prisma.Decimal | number | string; isActive?: boolean } | null;
  }>;
  planPrice?: Prisma.Decimal | number | string | null;
  candidateDiscounts?: CandidateDiscountInput[];
  evaluationDate?: Date;
  includePlanFeeOverride?: boolean;
}): SubscriptionTotalsBreakdown {
  const includePlanFee =
    params.includePlanFeeOverride ?? PRICING_CONFIG.includePlanBaseFeeInTotal;

  let linesSubtotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);

  for (const line of params.lines) {
    const lineAmt = toDecimal(line.amount);
    linesSubtotal = linesSubtotal.add(lineAmt);
    const lineTax = calculateLineTax(lineAmt, line.quantity, line.tax);
    taxTotal = taxTotal.add(lineTax);
  }

  let discountDecimal = new Prisma.Decimal(0);
  let eligibleDiscount: SubscriptionTotalsBreakdown["eligibleDiscount"] = null;

  if (params.candidateDiscounts && params.candidateDiscounts.length > 0 && params.lines.length > 0) {
    try {
      const evalResult = findApplicableDiscounts(
        {
          lines: params.lines.map((l, idx) => ({
            productId: l.productId ?? idx + 1,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? toDecimal(l.amount).div(Math.max(1, l.quantity)),
            amount: l.amount,
          })),
        },
        params.evaluationDate ?? new Date(),
        params.candidateDiscounts
      );

      if (evalResult.bestDiscount && evalResult.appliedDiscountAmount > 0) {
        discountDecimal = new Prisma.Decimal(evalResult.appliedDiscountAmount).toDecimalPlaces(2);
        eligibleDiscount = {
          id: evalResult.bestDiscount.id,
          name: evalResult.bestDiscount.name,
          type: evalResult.bestDiscount.type,
          value: evalResult.bestDiscount.value,
          scope: evalResult.bestDiscount.scope,
          discountAmount: evalResult.bestDiscount.discountAmount,
        };
      }
    } catch {
      // Ignore discount evaluation errors on incomplete lines
    }
  }

  const subtotalAfterDiscount = Prisma.Decimal.max(
    new Prisma.Decimal(0),
    linesSubtotal.sub(discountDecimal)
  ).toDecimalPlaces(2);

  const planReferencePrice =
    params.planPrice != null
      ? toDecimal(params.planPrice).toDecimalPlaces(2)
      : new Prisma.Decimal(0);

  const grandTotal = (
    includePlanFee
      ? subtotalAfterDiscount.add(planReferencePrice)
      : subtotalAfterDiscount
  )
    .add(taxTotal)
    .toDecimalPlaces(2);

  return {
    linesSubtotal: linesSubtotal.toFixed(2),
    discountTotal: discountDecimal.toFixed(2),
    eligibleDiscount,
    subtotalAfterDiscount: subtotalAfterDiscount.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    planReferencePrice: planReferencePrice.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    includesPlanFee: includePlanFee,
  };
}
