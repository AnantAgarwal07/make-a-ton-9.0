import { BillingPeriod, DiscountScope, DiscountType, TaxType } from "@prisma/client";
import { roundCurrency, toSafeNumber } from "./decimal";

export class ValidationError extends Error {
  public readonly statusCode = 400;
  public readonly details?: string[];

  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

const VALID_BILLING_PERIODS: BillingPeriod[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const VALID_TAX_TYPES: TaxType[] = ["PERCENT", "FIXED"];
const VALID_DISCOUNT_TYPES: DiscountType[] = ["FIXED", "PERCENT"];
const VALID_DISCOUNT_SCOPES: DiscountScope[] = ["PRODUCT", "SUBSCRIPTION"];

export interface ValidatedProductInput {
  name: string;
  type: string;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  isArchived?: boolean;
  variants?: ValidatedVariantInput[];
}

export interface ValidatedVariantInput {
  attribute: string;
  value: string;
  extraPrice: number;
}

export function validateProductInput(body: Record<string, unknown>, isUpdate = false): Partial<ValidatedProductInput> {
  const errors: string[] = [];
  const result: Partial<ValidatedProductInput> = {};

  if (!isUpdate || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Product name is required");
    } else if (name.length > 150) {
      errors.push("Product name cannot exceed 150 characters");
    } else {
      result.name = name;
    }
  }

  if (!isUpdate || body.type !== undefined) {
    const type = typeof body.type === "string" ? body.type.trim() : "";
    if (!type) {
      errors.push("Product type is required (e.g., Software, Service, Hardware, SaaS)");
    } else if (type.length > 80) {
      errors.push("Product type cannot exceed 80 characters");
    } else {
      result.type = type;
    }
  }

  if (!isUpdate || body.salesPrice !== undefined) {
    try {
      const salesPrice = roundCurrency(toSafeNumber(body.salesPrice as number | string, "salesPrice"));
      if (salesPrice < 0) {
        errors.push("Sales price cannot be negative");
      } else {
        result.salesPrice = salesPrice;
      }
    } catch {
      errors.push("Sales price must be a valid non-negative number");
    }
  }

  if (!isUpdate || body.costPrice !== undefined) {
    try {
      const costPrice = roundCurrency(toSafeNumber((body.costPrice ?? 0) as number | string, "costPrice"));
      if (costPrice < 0) {
        errors.push("Cost price cannot be negative");
      } else {
        result.costPrice = costPrice;
      }
    } catch {
      errors.push("Cost price must be a valid non-negative number");
    }
  }

  if (body.notes !== undefined) {
    if (body.notes === null || body.notes === "") {
      result.notes = null;
    } else if (typeof body.notes === "string") {
      result.notes = body.notes.trim() || null;
    } else {
      errors.push("Notes must be a string");
    }
  }

  if (body.isArchived !== undefined) {
    result.isArchived = Boolean(body.isArchived);
  }

  if (body.variants !== undefined) {
    if (!Array.isArray(body.variants)) {
      errors.push("Variants must be an array");
    } else {
      const validatedVariants: ValidatedVariantInput[] = [];
      for (let i = 0; i < body.variants.length; i++) {
        try {
          validatedVariants.push(validateVariantInput(body.variants[i] as Record<string, unknown>));
        } catch (err) {
          errors.push(`Variant #${i + 1}: ${(err as Error).message}`);
        }
      }
      result.variants = validatedVariants;
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return result;
}

export function validateVariantInput(body: Record<string, unknown>): ValidatedVariantInput {
  const errors: string[] = [];

  const attribute = typeof body.attribute === "string" ? body.attribute.trim() : "";
  if (!attribute) {
    errors.push("Variant attribute (e.g., Tier, Brand, Edition) is required");
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value) {
    errors.push("Variant value (e.g., Standard, Odoo, Premium) is required");
  }

  let extraPrice = 0;
  if (body.extraPrice !== undefined && body.extraPrice !== null && body.extraPrice !== "") {
    try {
      extraPrice = roundCurrency(toSafeNumber(body.extraPrice as number | string, "extraPrice"));
      if (extraPrice < 0) {
        errors.push("Variant extra price cannot be negative");
      }
    } catch {
      errors.push("Variant extra price must be a valid non-negative number");
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return { attribute, value, extraPrice };
}

export interface ValidatedPlanInput {
  name: string;
  price: number;
  billingPeriod: BillingPeriod;
  minQuantity: number;
  availableFrom: Date;
  availableTo: Date | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

export function validatePlanInput(body: Record<string, unknown>, isUpdate = false): Partial<ValidatedPlanInput> {
  const errors: string[] = [];
  const result: Partial<ValidatedPlanInput> = {};

  if (!isUpdate || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Plan name is required");
    } else {
      result.name = name;
    }
  }

  if (!isUpdate || body.price !== undefined) {
    try {
      const price = roundCurrency(toSafeNumber(body.price as number | string, "price"));
      if (price < 0) {
        errors.push("Plan price cannot be negative");
      } else {
        result.price = price;
      }
    } catch {
      errors.push("Plan price must be a valid non-negative number");
    }
  }

  if (!isUpdate || body.billingPeriod !== undefined) {
    const bp = String(body.billingPeriod ?? "").toUpperCase() as BillingPeriod;
    if (!VALID_BILLING_PERIODS.includes(bp)) {
      errors.push(`Billing period must be one of: ${VALID_BILLING_PERIODS.join(", ")}`);
    } else {
      result.billingPeriod = bp;
    }
  }

  if (!isUpdate || body.minQuantity !== undefined) {
    const mq = body.minQuantity !== undefined ? Number(body.minQuantity) : 1;
    if (!Number.isInteger(mq) || mq < 1) {
      errors.push("Minimum quantity must be an integer of at least 1");
    } else {
      result.minQuantity = mq;
    }
  }

  if (!isUpdate || body.availableFrom !== undefined) {
    const af = body.availableFrom ? new Date(String(body.availableFrom)) : new Date();
    if (Number.isNaN(af.getTime())) {
      errors.push("Available From date must be a valid date");
    } else {
      result.availableFrom = af;
    }
  }

  if (body.availableTo !== undefined) {
    if (body.availableTo === null || body.availableTo === "") {
      result.availableTo = null;
    } else {
      const at = new Date(String(body.availableTo));
      if (Number.isNaN(at.getTime())) {
        errors.push("Available To date must be a valid date");
      } else {
        result.availableTo = at;
      }
    }
  }

  if (result.availableFrom && result.availableTo && result.availableTo < result.availableFrom) {
    errors.push("Available To date cannot be earlier than Available From date");
  }

  if (!isUpdate || body.autoClose !== undefined) {
    result.autoClose = body.autoClose !== undefined ? Boolean(body.autoClose) : false;
  }
  if (!isUpdate || body.closable !== undefined) {
    result.closable = body.closable !== undefined ? Boolean(body.closable) : true;
  }
  if (!isUpdate || body.pausable !== undefined) {
    result.pausable = body.pausable !== undefined ? Boolean(body.pausable) : false;
  }
  if (!isUpdate || body.renewable !== undefined) {
    result.renewable = body.renewable !== undefined ? Boolean(body.renewable) : true;
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return result;
}

export interface ValidatedTaxInput {
  name: string;
  type: TaxType;
  rate: number;
  isActive: boolean;
}

export function validateTaxInput(body: Record<string, unknown>, isUpdate = false): Partial<ValidatedTaxInput> {
  const errors: string[] = [];
  const result: Partial<ValidatedTaxInput> = {};

  if (!isUpdate || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Tax name is required");
    } else {
      result.name = name;
    }
  }

  if (!isUpdate || body.type !== undefined) {
    const type = String(body.type ?? "").toUpperCase() as TaxType;
    if (!VALID_TAX_TYPES.includes(type)) {
      errors.push(`Tax type must be one of: ${VALID_TAX_TYPES.join(", ")}`);
    } else {
      result.type = type;
    }
  }

  if (!isUpdate || body.rate !== undefined) {
    try {
      const rate = roundCurrency(toSafeNumber(body.rate as number | string, "rate"));
      if (rate < 0) {
        errors.push("Tax rate cannot be negative");
      } else if ((result.type === "PERCENT" || body.type === "PERCENT") && rate > 100) {
        errors.push("Percentage tax rate cannot exceed 100%");
      } else {
        result.rate = rate;
      }
    } catch {
      errors.push("Tax rate must be a valid non-negative number");
    }
  }

  if (!isUpdate || body.isActive !== undefined) {
    result.isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return result;
}

export interface ValidatedDiscountInput {
  name: string;
  type: DiscountType;
  value: number;
  minPurchase: number | null;
  minQuantity: number | null;
  startDate: Date;
  endDate: Date;
  usageLimit: number | null;
  scope: DiscountScope;
  isActive: boolean;
  productIds?: number[];
}

export function validateDiscountInput(body: Record<string, unknown>, isUpdate = false): Partial<ValidatedDiscountInput> {
  const errors: string[] = [];
  const result: Partial<ValidatedDiscountInput> = {};

  if (!isUpdate || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Discount name is required");
    } else {
      result.name = name;
    }
  }

  if (!isUpdate || body.type !== undefined) {
    const type = String(body.type ?? "").toUpperCase() as DiscountType;
    if (!VALID_DISCOUNT_TYPES.includes(type)) {
      errors.push(`Discount type must be one of: ${VALID_DISCOUNT_TYPES.join(", ")}`);
    } else {
      result.type = type;
    }
  }

  if (!isUpdate || body.value !== undefined) {
    try {
      const value = roundCurrency(toSafeNumber(body.value as number | string, "value"));
      if (value <= 0) {
        errors.push("Discount value must be greater than zero");
      } else if ((result.type === "PERCENT" || body.type === "PERCENT") && value > 100) {
        errors.push("Percentage discount value cannot exceed 100%");
      } else {
        result.value = value;
      }
    } catch {
      errors.push("Discount value must be a valid positive number");
    }
  }

  if (body.minPurchase !== undefined) {
    if (body.minPurchase === null || body.minPurchase === "") {
      result.minPurchase = null;
    } else {
      try {
        const mp = roundCurrency(toSafeNumber(body.minPurchase as number | string, "minPurchase"));
        if (mp < 0) {
          errors.push("Minimum purchase cannot be negative");
        } else {
          result.minPurchase = mp;
        }
      } catch {
        errors.push("Minimum purchase must be a valid non-negative number");
      }
    }
  }

  if (body.minQuantity !== undefined) {
    if (body.minQuantity === null || body.minQuantity === "") {
      result.minQuantity = null;
    } else {
      const mq = Number(body.minQuantity);
      if (!Number.isInteger(mq) || mq < 1) {
        errors.push("Minimum quantity must be an integer of at least 1");
      } else {
        result.minQuantity = mq;
      }
    }
  }

  if (!isUpdate || body.startDate !== undefined) {
    const sd = body.startDate ? new Date(String(body.startDate)) : new Date();
    if (Number.isNaN(sd.getTime())) {
      errors.push("Start date must be a valid date");
    } else {
      result.startDate = sd;
    }
  }

  if (!isUpdate || body.endDate !== undefined) {
    const ed = body.endDate ? new Date(String(body.endDate)) : new Date(NaN);
    if (Number.isNaN(ed.getTime())) {
      errors.push("End date is required and must be a valid date");
    } else {
      result.endDate = ed;
    }
  }

  if (result.startDate && result.endDate && result.endDate < result.startDate) {
    errors.push("End date cannot be earlier than start date");
  }

  if (body.usageLimit !== undefined) {
    if (body.usageLimit === null || body.usageLimit === "") {
      result.usageLimit = null;
    } else {
      const ul = Number(body.usageLimit);
      if (!Number.isInteger(ul) || ul < 1) {
        errors.push("Usage limit must be a positive integer");
      } else {
        result.usageLimit = ul;
      }
    }
  }

  if (!isUpdate || body.scope !== undefined) {
    const scope = String(body.scope ?? "").toUpperCase() as DiscountScope;
    if (!VALID_DISCOUNT_SCOPES.includes(scope)) {
      errors.push(`Discount scope must be one of: ${VALID_DISCOUNT_SCOPES.join(", ")}`);
    } else {
      result.scope = scope;
    }
  }

  if (!isUpdate || body.isActive !== undefined) {
    result.isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;
  }

  if (body.productIds !== undefined) {
    if (!Array.isArray(body.productIds)) {
      errors.push("productIds must be an array of product IDs");
    } else {
      const pids = Array.from(
        new Set(body.productIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
      );
      result.productIds = pids;
    }
  }

  const effectiveScope = result.scope ?? (body.scope as DiscountScope | undefined);
  if (!isUpdate && effectiveScope === "PRODUCT" && (!result.productIds || result.productIds.length === 0)) {
    errors.push("At least one applicable product must be selected for a PRODUCT-scoped discount");
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return result;
}

export interface ValidatedTemplateLineInput {
  productId: number;
  variantId: number | null;
  quantity: number;
}

export interface ValidatedTemplateInput {
  name: string;
  planId: number;
  validityDays: number;
  lines: ValidatedTemplateLineInput[];
}

export function validateQuotationTemplateInput(
  body: Record<string, unknown>,
  isUpdate = false
): Partial<ValidatedTemplateInput> {
  const errors: string[] = [];
  const result: Partial<ValidatedTemplateInput> = {};

  if (!isUpdate || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      errors.push("Quotation template name is required");
    } else {
      result.name = name;
    }
  }

  if (!isUpdate || body.planId !== undefined) {
    const planId = Number(body.planId);
    if (!Number.isInteger(planId) || planId <= 0) {
      errors.push("A valid subscription plan must be selected");
    } else {
      result.planId = planId;
    }
  }

  if (!isUpdate || body.validityDays !== undefined) {
    const vd = body.validityDays !== undefined ? Number(body.validityDays) : 30;
    if (!Number.isInteger(vd) || vd < 1 || vd > 3650) {
      errors.push("Validity days must be an integer between 1 and 3650");
    } else {
      result.validityDays = vd;
    }
  }

  if (!isUpdate || body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      errors.push("Quotation template must contain at least one product line");
    } else {
      const lines: ValidatedTemplateLineInput[] = [];
      for (let i = 0; i < body.lines.length; i++) {
        const rawLine = body.lines[i] as Record<string, unknown>;
        const productId = Number(rawLine?.productId);
        const variantId =
          rawLine?.variantId !== undefined && rawLine?.variantId !== null && rawLine?.variantId !== ""
            ? Number(rawLine.variantId)
            : null;
        const quantity = rawLine?.quantity !== undefined ? Number(rawLine.quantity) : 1;

        if (!Number.isInteger(productId) || productId <= 0) {
          errors.push(`Line #${i + 1}: Valid productId is required`);
          continue;
        }
        if (variantId !== null && (!Number.isInteger(variantId) || variantId <= 0)) {
          errors.push(`Line #${i + 1}: Invalid variantId`);
          continue;
        }
        if (!Number.isInteger(quantity) || quantity < 1) {
          errors.push(`Line #${i + 1}: Quantity must be an integer of at least 1`);
          continue;
        }
        lines.push({ productId, variantId, quantity });
      }
      result.lines = lines;
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors[0], errors);
  }

  return result;
}

