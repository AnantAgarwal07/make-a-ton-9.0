import { TaxType } from "@prisma/client";
import { NumericInput, roundCurrency, toSafeNumber } from "./decimal";

export class TaxCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxCalculationError";
  }
}

export interface TaxConfigInput {
  id?: number | null;
  name?: string | null;
  type: TaxType | "PERCENT" | "FIXED";
  rate: NumericInput;
  isActive?: boolean;
}

export interface TaxableLineInput {
  id?: number | string;
  productId?: number;
  variantId?: number | null;
  quantity?: NumericInput;
  unitPrice?: NumericInput;
  amount?: NumericInput;
  subtotal?: NumericInput;
  discount?: NumericInput;
  tax?: TaxConfigInput | null;
  taxId?: number | null;
  taxName?: string | null;
  taxType?: TaxType | "PERCENT" | "FIXED" | null;
  taxRate?: NumericInput;
  taxIsActive?: boolean;
  /**
   * Optional flag: if true, a FIXED tax rate is multiplied by line quantity.
   * Defaults to false (flat fixed tax amount applied to the line).
   */
  fixedPerUnit?: boolean;
}

export interface CalculatedTaxLine {
  index: number;
  lineId?: number | string;
  productId?: number;
  variantId?: number | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableAmount: number;
  taxId: number | null;
  taxName: string | null;
  taxType: "PERCENT" | "FIXED" | null;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

export interface TaxCalculationResult {
  lines: CalculatedTaxLine[];
  /** Array of per-line tax amounts in the same order as input lines */
  lineTaxes: number[];
  subtotal: number;
  totalTax: number;
  grandTotal: number;
}

/**
 * Pure business logic function for P3 Billing handover.
 *
 * Calculates per-line and total taxes across subscription or invoice lines:
 * - Supports PERCENT and FIXED tax types
 * - Supports zero tax, null/omitted tax, and inactive taxes (treats inactive as 0 tax)
 * - Supports multiple lines
 * - Rounds all monetary values to 2 decimal places using exact half-up currency rounding
 * - Performs strict validation on invalid or negative inputs without any database side effects
 */
export function calculateTax(lines: TaxableLineInput[]): TaxCalculationResult {
  if (!Array.isArray(lines)) {
    throw new TaxCalculationError("Invalid input: 'lines' must be an array");
  }

  if (lines.length === 0) {
    return {
      lines: [],
      lineTaxes: [],
      subtotal: 0,
      totalTax: 0,
      grandTotal: 0,
    };
  }

  const calculatedLines: CalculatedTaxLine[] = [];
  const lineTaxes: number[] = [];
  let subtotalSum = 0;
  let totalTaxSum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== "object") {
      throw new TaxCalculationError(`Invalid line at index ${i}: must be an object`);
    }

    // 1. Resolve quantity
    const rawQty = line.quantity !== undefined && line.quantity !== null ? line.quantity : 1;
    let quantity: number;
    try {
      quantity = toSafeNumber(rawQty, `lines[${i}].quantity`);
    } catch (err) {
      throw new TaxCalculationError((err as Error).message);
    }

    if (quantity < 0) {
      throw new TaxCalculationError(`Invalid quantity at line ${i}: quantity cannot be negative`);
    }

    // 2. Resolve unitPrice and base line subtotal
    const hasUnitPrice = line.unitPrice !== undefined && line.unitPrice !== null;
    const hasExplicitAmount =
      (line.amount !== undefined && line.amount !== null) ||
      (line.subtotal !== undefined && line.subtotal !== null);

    if (!hasUnitPrice && !hasExplicitAmount) {
      throw new TaxCalculationError(
        `Invalid line at index ${i}: either 'unitPrice' or 'amount'/'subtotal' must be provided`
      );
    }

    let unitPrice = 0;
    let grossLineAmount = 0;

    try {
      if (hasUnitPrice) {
        unitPrice = toSafeNumber(line.unitPrice, `lines[${i}].unitPrice`);
        if (unitPrice < 0) {
          throw new TaxCalculationError(`Invalid unitPrice at line ${i}: cannot be negative`);
        }
        grossLineAmount = roundCurrency(unitPrice * quantity);
      }

      if (hasExplicitAmount) {
        const rawAmount = line.subtotal !== undefined && line.subtotal !== null ? line.subtotal : line.amount;
        const explicitAmount = toSafeNumber(rawAmount, `lines[${i}].amount`);
        if (explicitAmount < 0) {
          throw new TaxCalculationError(`Invalid amount at line ${i}: cannot be negative`);
        }
        if (!hasUnitPrice) {
          grossLineAmount = roundCurrency(explicitAmount);
          unitPrice = quantity > 0 ? roundCurrency(grossLineAmount / quantity) : 0;
        } else {
          // If both unitPrice and explicit amount are provided, use explicit amount if quantity is 1 or matches
          grossLineAmount = roundCurrency(explicitAmount);
        }
      }
    } catch (err) {
      if (err instanceof TaxCalculationError) throw err;
      throw new TaxCalculationError((err as Error).message);
    }

    // 3. Resolve optional line discount
    let discount = 0;
    if (line.discount !== undefined && line.discount !== null) {
      try {
        discount = toSafeNumber(line.discount, `lines[${i}].discount`);
      } catch (err) {
        throw new TaxCalculationError((err as Error).message);
      }
      if (discount < 0) {
        throw new TaxCalculationError(`Invalid discount at line ${i}: cannot be negative`);
      }
    }

    const taxableAmount = quantity === 0 ? 0 : roundCurrency(Math.max(0, grossLineAmount - discount));

    // 4. Resolve tax configuration
    const taxObj = line.tax ?? null;
    const taxTypeRaw = taxObj ? taxObj.type : line.taxType ?? null;
    const taxRateRaw = taxObj ? taxObj.rate : line.taxRate;
    const taxIsActive = taxObj
      ? taxObj.isActive !== undefined
        ? taxObj.isActive
        : true
      : line.taxIsActive !== undefined
      ? line.taxIsActive
      : true;
    const taxId = taxObj?.id ?? line.taxId ?? null;
    const taxName = taxObj?.name ?? line.taxName ?? null;

    let taxType: "PERCENT" | "FIXED" | null = null;
    let taxRate = 0;
    let taxAmount = 0;

    if (taxTypeRaw !== null && taxTypeRaw !== undefined) {
      if (taxTypeRaw !== "PERCENT" && taxTypeRaw !== "FIXED") {
        throw new TaxCalculationError(
          `Invalid tax type at line ${i}: expected 'PERCENT' or 'FIXED', got '${String(taxTypeRaw)}'`
        );
      }
      taxType = taxTypeRaw;

      try {
        taxRate = toSafeNumber(taxRateRaw ?? 0, `lines[${i}].tax.rate`);
      } catch (err) {
        throw new TaxCalculationError((err as Error).message);
      }

      if (taxRate < 0) {
        throw new TaxCalculationError(`Invalid tax rate at line ${i}: rate cannot be negative`);
      }

      if (taxType === "PERCENT" && taxRate > 100) {
        throw new TaxCalculationError(`Invalid percentage tax rate at line ${i}: cannot exceed 100%`);
      }

      if (taxIsActive && taxRate > 0 && quantity > 0 && taxableAmount > 0) {
        if (taxType === "PERCENT") {
          taxAmount = roundCurrency((taxableAmount * taxRate) / 100);
        } else {
          // FIXED tax
          taxAmount = line.fixedPerUnit
            ? roundCurrency(taxRate * quantity)
            : roundCurrency(taxRate);
        }
      }
    }

    const lineTotal = roundCurrency(taxableAmount + taxAmount);

    calculatedLines.push({
      index: i,
      lineId: line.id,
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity,
      unitPrice,
      discount,
      taxableAmount,
      taxId,
      taxName,
      taxType,
      taxRate: roundCurrency(taxRate),
      taxAmount,
      lineTotal,
    });

    lineTaxes.push(taxAmount);
    subtotalSum = roundCurrency(subtotalSum + taxableAmount);
    totalTaxSum = roundCurrency(totalTaxSum + taxAmount);
  }

  return {
    lines: calculatedLines,
    lineTaxes,
    subtotal: subtotalSum,
    totalTax: totalTaxSum,
    grandTotal: roundCurrency(subtotalSum + totalTaxSum),
  };
}

