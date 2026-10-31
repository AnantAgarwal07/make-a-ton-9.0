import { BillingPeriod } from "@prisma/client";
import { NumericInput, roundCurrency, toSafeNumber } from "./decimal";

export interface PlanCandidate {
  id: number;
  name: string;
  price: NumericInput;
  billingPeriod: BillingPeriod | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  minQuantity: number;
  availableFrom: Date | string;
  availableTo?: Date | string | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

export interface PlanAvailabilityValidation {
  isAvailable: boolean;
  reason?: string;
  availableFrom: string;
  availableTo: string | null;
  checkedAt: string;
}

/**
 * Validates whether a subscription plan is currently available for selection
 * on a given target date (defaults to current date) and optional requested quantity.
 */
export function validatePlanAvailability(
  plan: PlanCandidate,
  referenceDate: Date | string | number = new Date(),
  requestedQuantity?: number
): PlanAvailabilityValidation {
  const checkDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(checkDate.getTime())) {
    throw new Error("Invalid reference date for plan availability check");
  }

  const fromDate = plan.availableFrom instanceof Date ? plan.availableFrom : new Date(plan.availableFrom);
  if (Number.isNaN(fromDate.getTime())) {
    throw new Error("Plan has an invalid availableFrom date");
  }

  const toDate =
    plan.availableTo !== null && plan.availableTo !== undefined
      ? plan.availableTo instanceof Date
        ? plan.availableTo
        : new Date(plan.availableTo)
      : null;

  if (toDate && Number.isNaN(toDate.getTime())) {
    throw new Error("Plan has an invalid availableTo date");
  }

  if (checkDate < fromDate) {
    return {
      isAvailable: false,
      reason: `Plan "${plan.name}" is not available until ${fromDate.toISOString().split("T")[0]}`,
      availableFrom: fromDate.toISOString(),
      availableTo: toDate ? toDate.toISOString() : null,
      checkedAt: checkDate.toISOString(),
    };
  }

  if (toDate && checkDate > toDate) {
    return {
      isAvailable: false,
      reason: `Plan "${plan.name}" expired on ${toDate.toISOString().split("T")[0]}`,
      availableFrom: fromDate.toISOString(),
      availableTo: toDate.toISOString(),
      checkedAt: checkDate.toISOString(),
    };
  }

  if (requestedQuantity !== undefined && requestedQuantity < plan.minQuantity) {
    return {
      isAvailable: false,
      reason: `Plan "${plan.name}" requires a minimum quantity of ${plan.minQuantity} (requested: ${requestedQuantity})`,
      availableFrom: fromDate.toISOString(),
      availableTo: toDate ? toDate.toISOString() : null,
      checkedAt: checkDate.toISOString(),
    };
  }

  return {
    isAvailable: true,
    availableFrom: fromDate.toISOString(),
    availableTo: toDate ? toDate.toISOString() : null,
    checkedAt: checkDate.toISOString(),
  };
}

/**
 * Calculates the projected expiry date of a subscription based on a Plan's billingPeriod.
 */
export function calculatePlanCycleEndDate(
  startDate: Date | string,
  billingPeriod: BillingPeriod | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
): Date {
  const start = startDate instanceof Date ? new Date(startDate.getTime()) : new Date(startDate);
  const end = new Date(start.getTime());

  switch (billingPeriod) {
    case "DAILY":
      end.setDate(end.getDate() + 1);
      break;
    case "WEEKLY":
      end.setDate(end.getDate() + 7);
      break;
    case "MONTHLY":
      end.setMonth(end.getMonth() + 1);
      break;
    case "YEARLY":
      end.setFullYear(end.getFullYear() + 1);
      break;
    default:
      throw new Error(`Unsupported billing period: ${String(billingPeriod)}`);
  }

  return end;
}

/**
 * Serializes a Prisma Plan into a clean JSON-ready representation
 * with all 4 lifecycle boolean flags preserved for P3.
 */
export function serializePlan(plan: PlanCandidate & { _count?: { subscriptions?: number; templates?: number } }) {
  const availability = validatePlanAvailability(plan);
  return {
    id: plan.id,
    name: plan.name,
    price: roundCurrency(toSafeNumber(plan.price, "plan.price")),
    billingPeriod: plan.billingPeriod,
    minQuantity: plan.minQuantity,
    availableFrom:
      plan.availableFrom instanceof Date ? plan.availableFrom.toISOString() : new Date(plan.availableFrom).toISOString(),
    availableTo:
      plan.availableTo !== null && plan.availableTo !== undefined
        ? plan.availableTo instanceof Date
          ? plan.availableTo.toISOString()
          : new Date(plan.availableTo).toISOString()
        : null,
    autoClose: Boolean(plan.autoClose),
    closable: Boolean(plan.closable),
    pausable: Boolean(plan.pausable),
    renewable: Boolean(plan.renewable),
    lifecycleFlags: {
      autoClose: Boolean(plan.autoClose),
      closable: Boolean(plan.closable),
      pausable: Boolean(plan.pausable),
      renewable: Boolean(plan.renewable),
    },
    isCurrentlyAvailable: availability.isAvailable,
    availabilityReason: availability.reason ?? null,
    _count: plan._count,
  };
}

