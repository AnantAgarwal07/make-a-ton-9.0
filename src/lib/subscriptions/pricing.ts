import { Prisma, TaxType } from "@prisma/client";

/**
 * Isolated Pricing & Totals Module for P3 Subscriptions
 *
 * NOTE FOR P2 / P4 COORDINATION (Section 5 of PRD):
 * The shared schema contains both `Plan.price` and `Product.salesPrice` / `SubscriptionLine.unitPrice`.
 * Until P2 and P4 confirm whether `Plan.price` is:
 *   (a) a recurring base fee invoiced in addition to product lines, OR
 *   (b) a reference/default plan price while the actual charge is represented by `SubscriptionLine` rows,
 * all pricing calculations are isolated in this file. By default, `includePlanBaseFeeInTotal` is set to `false`
 * (lines represent the billed charges, while `planBasePrice` is returned separately in the summary breakdown
 * so UI and P4 can inspect both without guessing).
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
  taxTotal: string;
  planReferencePrice: string;
  grandTotal: string;
  includesPlanFee: boolean;
}

/**
 * Isolated total calculation function for a subscription.
 */
export function calculateSubscriptionTotals(params: {
  lines: Array<{
    quantity: number;
    amount: Prisma.Decimal | number | string;
    tax?: { type: TaxType; rate: Prisma.Decimal | number | string; isActive?: boolean } | null;
  }>;
  planPrice?: Prisma.Decimal | number | string | null;
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

  const planReferencePrice =
    params.planPrice != null ? toDecimal(params.planPrice).toDecimalPlaces(2) : new Prisma.Decimal(0);

  const grandTotal = (includePlanFee ? linesSubtotal.add(planReferencePrice) : linesSubtotal)
    .add(taxTotal)
    .toDecimalPlaces(2);

  return {
    linesSubtotal: linesSubtotal.toFixed(2),
    taxTotal: taxTotal.toFixed(2),
    planReferencePrice: planReferencePrice.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    includesPlanFee: includePlanFee,
  };
}

