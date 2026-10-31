import { DiscountScope, DiscountType } from "@prisma/client";
import { NumericInput, roundCurrency, toSafeNumber } from "./decimal";

export class DiscountEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountEvaluationError";
  }
}

export type DiscountProductRef =
  | number
  | { productId: number }
  | { id: number }
  | { product: { id: number } };

export interface CandidateDiscountInput {
  id: number;
  name: string;
  type: DiscountType | "FIXED" | "PERCENT";
  value: NumericInput;
  minPurchase?: NumericInput;
  minQuantity?: number | null;
  startDate: Date | string;
  endDate: Date | string;
  usageLimit?: number | null;
  timesUsed?: number;
  scope: DiscountScope | "PRODUCT" | "SUBSCRIPTION";
  isActive?: boolean;
  products?: DiscountProductRef[];
  productIds?: number[];
}

export interface SubscriptionDiscountLineInput {
  id?: number | string;
  productId: number;
  variantId?: number | null;
  quantity: NumericInput;
  unitPrice?: NumericInput;
  amount?: NumericInput;
}

export interface SubscriptionDiscountInput {
  id?: number | string;
  customerId?: number;
  planId?: number;
  lines?: SubscriptionDiscountLineInput[];
  subtotal?: NumericInput;
  totalAmount?: NumericInput;
  totalQuantity?: NumericInput;
  /**
   * Candidate discounts may be passed directly on the subscription payload
   * (for 2-argument calls `findApplicableDiscounts(subscription, date)`)
   * or as the 3rd argument `findApplicableDiscounts(subscription, date, discounts)`.
   */
  discounts?: CandidateDiscountInput[];
  availableDiscounts?: CandidateDiscountInput[];
  candidateDiscounts?: CandidateDiscountInput[];
}

export interface EvaluatedDiscount {
  id: number;
  name: string;
  type: "FIXED" | "PERCENT";
  value: number;
  scope: "PRODUCT" | "SUBSCRIPTION";
  applicableProductIds: number[];
  applicableSubtotal: number;
  applicableQuantity: number;
  /** Calculated monetary savings in currency units (rounded to 2 decimal places) */
  discountAmount: number;
  minPurchase: number | null;
  minQuantity: number | null;
  usageLimit: number | null;
  timesUsed: number;
  remainingUses: number | null;
  startDate: string;
  endDate: string;
}

export interface IneligibleDiscount {
  id: number;
  name: string;
  reasons: string[];
}

export interface DiscountStackingResult {
  /**
   * Default Team Policy: NON_STACKING_HIGHEST_BENEFIT
   * Discounts do not stack. The single eligible discount that provides
   * the highest monetary benefit (discountAmount) is selected.
   */
  policy: "NON_STACKING_HIGHEST_BENEFIT";
  stacked: false;
  selectedDiscount: EvaluatedDiscount | null;
  totalDiscountAmount: number;
  subtotalBeforeDiscount: number;
  subtotalAfterDiscount: number;
}

export interface ApplicableDiscountsResult {
  evaluatedAt: string;
  subscriptionSubtotal: number;
  subscriptionQuantity: number;
  eligibleDiscounts: EvaluatedDiscount[];
  ineligibleDiscounts: IneligibleDiscount[];
  /** Selected best discount under the non-stacking highest-benefit policy */
  bestDiscount: EvaluatedDiscount | null;
  /** Monetary savings of the selected best discount */
  appliedDiscountAmount: number;
  /** Detailed stacking policy outcome */
  stackingResult: DiscountStackingResult;
}

function extractProductIds(discount: CandidateDiscountInput): number[] {
  const ids = new Set<number>();

  if (Array.isArray(discount.productIds)) {
    for (const pid of discount.productIds) {
      if (typeof pid === "number" && Number.isInteger(pid)) {
        ids.add(pid);
      }
    }
  }

  if (Array.isArray(discount.products)) {
    for (const item of discount.products) {
      if (typeof item === "number" && Number.isInteger(item)) {
        ids.add(item);
      } else if (item && typeof item === "object") {
        if ("productId" in item && typeof item.productId === "number") {
          ids.add(item.productId);
        } else if ("product" in item && item.product && typeof item.product.id === "number") {
          ids.add(item.product.id);
        } else if ("id" in item && typeof item.id === "number") {
          ids.add(item.id);
        }
      }
    }
  }

  return Array.from(ids);
}

function parseValidDate(input: Date | string | number, label: string): Date {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new DiscountEvaluationError(`Invalid date for ${label}`);
  }
  return d;
}

/**
 * Pure business logic function for P3 Billing handover:
 * `findApplicableDiscounts(subscription, date, discounts?)`
 *
 * Validates all candidate discounts against:
 * 1. Active status (`isActive === true`)
 * 2. Date range (`startDate <= date <= endDate`)
 * 3. Usage limit (`usageLimit == null || timesUsed < usageLimit`)
 * 4. Scope (`SUBSCRIPTION` vs `PRODUCT` matching lines)
 * 5. Minimum purchase requirement (`minPurchase`)
 * 6. Minimum quantity requirement (`minQuantity`)
 *
 * Stacking Policy (Non-Stacking Default):
 * Because discounts do not stack by default, the function evaluates every
 * eligible discount's exact monetary benefit on the subscription and selects
 * the single eligible discount that yields the highest monetary savings.
 *
 * Pure Function Guarantee:
 * Performs zero database writes and does NOT mutate `timesUsed` or input objects.
 */
export function findApplicableDiscounts(
  subscription: SubscriptionDiscountInput,
  date: Date | string | number = new Date(),
  discounts?: CandidateDiscountInput[]
): ApplicableDiscountsResult {
  if (!subscription || typeof subscription !== "object") {
    throw new DiscountEvaluationError("Invalid subscription input: must be an object");
  }

  const evaluationDate = parseValidDate(date, "evaluationDate");

  // Normalize subscription lines
  const rawLines = Array.isArray(subscription.lines) ? subscription.lines : [];
  const normalizedLines: {
    productId: number;
    quantity: number;
    lineSubtotal: number;
  }[] = [];

  let computedSubtotal = 0;
  let computedQuantity = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line || typeof line !== "object") {
      throw new DiscountEvaluationError(`Invalid subscription line at index ${i}`);
    }

    const quantity = toSafeNumber(line.quantity ?? 0, `subscription.lines[${i}].quantity`);
    if (quantity < 0) {
      throw new DiscountEvaluationError(`Invalid quantity at line ${i}: cannot be negative`);
    }

    let lineSubtotal = 0;
    if (line.amount !== undefined && line.amount !== null) {
      lineSubtotal = roundCurrency(toSafeNumber(line.amount, `subscription.lines[${i}].amount`));
    } else if (line.unitPrice !== undefined && line.unitPrice !== null) {
      const unitPrice = toSafeNumber(line.unitPrice, `subscription.lines[${i}].unitPrice`);
      if (unitPrice < 0) {
        throw new DiscountEvaluationError(`Invalid unitPrice at line ${i}: cannot be negative`);
      }
      lineSubtotal = roundCurrency(unitPrice * quantity);
    }

    if (lineSubtotal < 0) {
      throw new DiscountEvaluationError(`Invalid line amount at index ${i}: cannot be negative`);
    }

    normalizedLines.push({
      productId: Number(line.productId),
      quantity,
      lineSubtotal,
    });

    computedSubtotal = roundCurrency(computedSubtotal + lineSubtotal);
    computedQuantity += quantity;
  }

  // Allow explicit subtotal / totalQuantity override if lines weren't itemized
  const subscriptionSubtotal =
    subscription.subtotal !== undefined && subscription.subtotal !== null
      ? roundCurrency(toSafeNumber(subscription.subtotal, "subscription.subtotal"))
      : subscription.totalAmount !== undefined && subscription.totalAmount !== null
      ? roundCurrency(toSafeNumber(subscription.totalAmount, "subscription.totalAmount"))
      : computedSubtotal;

  const subscriptionQuantity =
    subscription.totalQuantity !== undefined && subscription.totalQuantity !== null
      ? toSafeNumber(subscription.totalQuantity, "subscription.totalQuantity")
      : computedQuantity;

  if (subscriptionSubtotal < 0 || subscriptionQuantity < 0) {
    throw new DiscountEvaluationError("Subscription subtotal and quantity cannot be negative");
  }

  // Resolve candidate discounts from 3rd argument or subscription properties
  const candidateList: CandidateDiscountInput[] = Array.isArray(discounts)
    ? discounts
    : Array.isArray(subscription.discounts)
    ? subscription.discounts
    : Array.isArray(subscription.availableDiscounts)
    ? subscription.availableDiscounts
    : Array.isArray(subscription.candidateDiscounts)
    ? subscription.candidateDiscounts
    : [];

  const eligibleDiscounts: EvaluatedDiscount[] = [];
  const ineligibleDiscounts: IneligibleDiscount[] = [];

  for (const discount of candidateList) {
    if (!discount || typeof discount !== "object") {
      continue;
    }

    const reasons: string[] = [];
    const isActive = discount.isActive !== undefined ? Boolean(discount.isActive) : true;

    // 1. Active check
    if (!isActive) {
      reasons.push("Discount is inactive");
    }

    // 2. Date range check
    const startDate = parseValidDate(discount.startDate, `discount(${discount.name}).startDate`);
    const endDate = parseValidDate(discount.endDate, `discount(${discount.name}).endDate`);

    if (evaluationDate < startDate) {
      reasons.push("Discount has not started yet");
    }
    if (evaluationDate > endDate) {
      reasons.push("Discount has expired");
    }

    // 3. Usage limit check
    const timesUsed = discount.timesUsed !== undefined && discount.timesUsed !== null ? Number(discount.timesUsed) : 0;
    const usageLimit =
      discount.usageLimit !== undefined && discount.usageLimit !== null ? Number(discount.usageLimit) : null;

    if (usageLimit !== null && timesUsed >= usageLimit) {
      reasons.push("Discount usage limit has been reached");
    }

    // 4. Value & type check
    const value = toSafeNumber(discount.value, `discount(${discount.name}).value`);
    if (value <= 0) {
      reasons.push("Discount value must be greater than zero");
    }
    if (discount.type !== "FIXED" && discount.type !== "PERCENT") {
      reasons.push(`Unsupported discount type: ${String(discount.type)}`);
    }
    if (discount.type === "PERCENT" && value > 100) {
      reasons.push("Percentage discount cannot exceed 100%");
    }

    // 5. Scope & applicable base calculation
    const targetProductIds = extractProductIds(discount);
    let applicableSubtotal = 0;
    let applicableQuantity = 0;

    if (discount.scope === "SUBSCRIPTION") {
      applicableSubtotal = subscriptionSubtotal;
      applicableQuantity = subscriptionQuantity;
    } else if (discount.scope === "PRODUCT") {
      if (targetProductIds.length === 0) {
        reasons.push("Product-scoped discount has no linked products");
      } else {
        const matchingLines = normalizedLines.filter((l) => targetProductIds.includes(l.productId));
        if (matchingLines.length === 0) {
          reasons.push("No matching products in subscription for this product-scoped discount");
        } else {
          for (const mLine of matchingLines) {
            applicableSubtotal = roundCurrency(applicableSubtotal + mLine.lineSubtotal);
            applicableQuantity += mLine.quantity;
          }
        }
      }
    } else {
      reasons.push(`Unsupported discount scope: ${String(discount.scope)}`);
    }

    // 6. Minimum purchase & minimum quantity validation
    // Note: Checked against the applicable scope base (and subscription total)
    const minPurchase =
      discount.minPurchase !== undefined && discount.minPurchase !== null
        ? roundCurrency(toSafeNumber(discount.minPurchase, `discount(${discount.name}).minPurchase`))
        : null;

    const minQuantity =
      discount.minQuantity !== undefined && discount.minQuantity !== null
        ? Number(discount.minQuantity)
        : null;

    if (minPurchase !== null && applicableSubtotal < minPurchase) {
      reasons.push(
        `Minimum purchase of ${minPurchase.toFixed(2)} not met (applicable amount: ${applicableSubtotal.toFixed(2)})`
      );
    }

    if (minQuantity !== null && applicableQuantity < minQuantity) {
      reasons.push(
        `Minimum quantity of ${minQuantity} not met (applicable quantity: ${applicableQuantity})`
      );
    }

    // 7. Compute monetary benefit
    let discountAmount = 0;
    if (reasons.length === 0 && applicableSubtotal > 0) {
      if (discount.type === "PERCENT") {
        discountAmount = roundCurrency((applicableSubtotal * value) / 100);
      } else {
        // FIXED discount capped at applicableSubtotal so net amount never drops below 0
        discountAmount = roundCurrency(Math.min(value, applicableSubtotal));
      }
    }

    if (reasons.length === 0 && discountAmount <= 0) {
      reasons.push("Calculated discount benefit is zero for this subscription");
    }

    if (reasons.length > 0) {
      ineligibleDiscounts.push({
        id: discount.id,
        name: discount.name,
        reasons,
      });
    } else {
      eligibleDiscounts.push({
        id: discount.id,
        name: discount.name,
        type: discount.type as "FIXED" | "PERCENT",
        value: roundCurrency(value),
        scope: discount.scope as "PRODUCT" | "SUBSCRIPTION",
        applicableProductIds: targetProductIds,
        applicableSubtotal,
        applicableQuantity,
        discountAmount,
        minPurchase,
        minQuantity,
        usageLimit,
        timesUsed,
        remainingUses: usageLimit !== null ? Math.max(0, usageLimit - timesUsed) : null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }
  }

  // Sort eligible discounts by highest monetary benefit (descending), then by lowest ID as deterministic tie-breaker
  eligibleDiscounts.sort((a, b) => {
    if (b.discountAmount !== a.discountAmount) {
      return b.discountAmount - a.discountAmount;
    }
    return a.id - b.id;
  });

  const bestDiscount = eligibleDiscounts.length > 0 ? eligibleDiscounts[0] : null;
  const appliedDiscountAmount = bestDiscount ? bestDiscount.discountAmount : 0;
  const subtotalAfterDiscount = roundCurrency(Math.max(0, subscriptionSubtotal - appliedDiscountAmount));

  return {
    evaluatedAt: evaluationDate.toISOString(),
    subscriptionSubtotal,
    subscriptionQuantity,
    eligibleDiscounts,
    ineligibleDiscounts,
    bestDiscount,
    appliedDiscountAmount,
    stackingResult: {
      policy: "NON_STACKING_HIGHEST_BENEFIT",
      stacked: false,
      selectedDiscount: bestDiscount,
      totalDiscountAmount: appliedDiscountAmount,
      subtotalBeforeDiscount: subscriptionSubtotal,
      subtotalAfterDiscount,
    },
  };
}

