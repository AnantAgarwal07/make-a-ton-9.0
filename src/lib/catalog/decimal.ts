import { Prisma } from "@prisma/client";

export type NumericInput = number | string | Prisma.Decimal | null | undefined;

/**
 * Safely converts a Prisma.Decimal, string, or number to a finite JavaScript number.
 * Throws a descriptive error if the value is NaN or infinite.
 */
export function toSafeNumber(value: NumericInput, fieldName = "value"): number {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Invalid numeric input for ${fieldName}: value is required`);
  }

  let num: number;
  if (typeof value === "number") {
    num = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid numeric input for ${fieldName}: empty string`);
    }
    num = Number(trimmed);
  } else if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    num = value.toNumber();
  } else {
    num = Number(value);
  }

  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric input for ${fieldName}: must be a finite number`);
  }

  return num;
}

/**
 * Rounds a monetary amount to 2 decimal places using half-up integer cents arithmetic
 * to eliminate IEEE-754 floating-point drift (e.g., 1.005 -> 1.01).
 */
export function roundCurrency(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  // Add 1e-9 epsilon before Math.round to guard against binary float representation like 1.005 * 100 = 100.49999999999999
  const rounded = Math.round((abs + 1e-9) * 100) / 100;
  const result = sign * rounded;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Computes final unit price for a product and optional variant:
 * Final Price = Product Sales Price + Variant Extra Price
 */
export function calculateVariantUnitPrice(
  productSalesPrice: NumericInput,
  variantExtraPrice?: NumericInput
): number {
  const basePrice = toSafeNumber(productSalesPrice, "productSalesPrice");
  if (basePrice < 0) {
    throw new Error("Product sales price cannot be negative");
  }

  const extra =
    variantExtraPrice === null || variantExtraPrice === undefined
      ? 0
      : toSafeNumber(variantExtraPrice, "variantExtraPrice");

  if (extra < 0) {
    throw new Error("Variant extra price cannot be negative");
  }

  return roundCurrency(basePrice + extra);
}

