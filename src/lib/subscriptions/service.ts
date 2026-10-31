import { Prisma, PrismaClient, Role, SubscriptionStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../prisma";
import {
  calculateDefaultUnitPrice,
  calculateLineAmount,
  calculateSubscriptionTotals,
} from "./pricing";
import {
  addBillingCycles,
  calculateResumedNextInvoiceDate,
  evaluatePauseDuration,
  PAUSE_ACTION_NOTE,
  PausePolicyConfig,
  RENEW_ACTION_NOTE,
  RESUME_ACTION_NOTE,
} from "./pause-policy";
import { CandidateDiscountInput } from "@/lib/catalog/discount";

export class SubscriptionServiceError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 400, code: string = "BAD_REQUEST") {
    super(message);
    this.name = "SubscriptionServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const ALLOWED_NEXT_STATUS: Record<SubscriptionStatus, SubscriptionStatus | null> = {
  DRAFT: "QUOTATION",
  QUOTATION: "CONFIRMED",
  CONFIRMED: "ACTIVE",
  ACTIVE: "CLOSED",
  CLOSED: null,
};

export function isAllowedStatusTransition(
  fromStatus: SubscriptionStatus,
  toStatus: SubscriptionStatus
): boolean {
  return ALLOWED_NEXT_STATUS[fromStatus] === toStatus;
}

/**
 * Generates a unique, sequential subscription number (e.g. SUB-000001)
 * using an atomic upsert/increment on the shared Counter model.
 */
export async function generateNextSubscriptionNumber(
  db: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<string> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value")
    VALUES ('SUB', 1)
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  const val = rows[0]?.value ?? 1;
  return `SUB-${String(val).padStart(6, "0")}`;
}

/**
 * Computes whether a subscription in QUOTATION status is expired based on quotationValidUntil.
 * EXPIRED is a derived display/validation condition, NOT a new SubscriptionStatus enum value.
 */
export function isQuotationExpired(
  status: SubscriptionStatus,
  quotationValidUntil: Date | null,
  asOfDate: Date = new Date()
): boolean {
  if (status !== "QUOTATION" || !quotationValidUntil) {
    return false;
  }
  return asOfDate.getTime() > new Date(quotationValidUntil).getTime();
}

/**
 * Initializes nextInvoiceDate when a subscription transitions to ACTIVE.
 */
export function computeInitialNextInvoiceDate(
  startDate: Date,
  activationDate: Date = new Date()
): Date {
  if (startDate.getTime() > activationDate.getTime()) {
    return new Date(startDate.getTime());
  }
  return new Date(startDate.getTime());
}

/**
 * Enriches a subscription record with computed fields:
 * - isQuotationExpired (derived boolean flag without changing status enum)
 * - pauseEvaluation (elapsed pause duration, maxPauseUntil, limitReached, warningMessage)
 * - totals (linesSubtotal, discountTotal, eligibleDiscount via P2's shared function, taxTotal, grandTotal)
 * - permittedActions (role-aware and plan-flag-aware lifecycle controls)
 */
export function enrichSubscription<
  T extends {
    status: SubscriptionStatus;
    isPaused: boolean;
    quotationValidUntil: Date | null;
    plan?: {
      billingPeriod: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
      price: Prisma.Decimal | number | string;
      pausable?: boolean;
      closable?: boolean;
      renewable?: boolean;
    } | null;
    lines?: Array<{
      productId?: number;
      quantity: number;
      unitPrice?: Prisma.Decimal | number | string;
      amount: Prisma.Decimal | number | string;
      tax?: {
        type: "PERCENT" | "FIXED";
        rate: Prisma.Decimal | number | string;
        isActive?: boolean;
      } | null;
    }>;
    history?: Array<{ note: string | null; changedAt: Date }>;
  }
>(
  sub: T,
  options?: {
    asOfDate?: Date;
    pausePolicyOverride?: PausePolicyConfig;
    candidateDiscounts?: CandidateDiscountInput[];
  }
) {
  const asOfDate = options?.asOfDate ?? new Date();
  const quotationExpired = isQuotationExpired(sub.status, sub.quotationValidUntil, asOfDate);

  const pauseEvaluation = sub.plan
    ? evaluatePauseDuration({
        isPaused: sub.isPaused,
        billingPeriod: sub.plan.billingPeriod,
        history: sub.history ?? [],
        asOfDate,
        policyOverride: options?.pausePolicyOverride,
      })
    : null;

  const totals = calculateSubscriptionTotals({
    lines: sub.lines ?? [],
    planPrice: sub.plan?.price ?? 0,
    candidateDiscounts: options?.candidateDiscounts,
    evaluationDate: asOfDate,
  });

  const nextAllowedStatus = ALLOWED_NEXT_STATUS[sub.status as SubscriptionStatus];
  const canSendQuotation = sub.status === "DRAFT";
  const canCustomerAccept = sub.status === "QUOTATION" && !quotationExpired;
  const canPause =
    sub.status === "ACTIVE" && !sub.isPaused && Boolean(sub.plan?.pausable);
  const canResume =
    sub.status === "ACTIVE" && Boolean(sub.isPaused) && Boolean(sub.plan?.pausable);
  const canClose =
    sub.status === "ACTIVE" && Boolean(sub.plan?.closable);
  const canRenew =
    sub.status === "ACTIVE" && Boolean(sub.plan?.renewable);
  const canEdit = sub.status === "DRAFT" || sub.status === "QUOTATION";

  return {
    ...sub,
    isQuotationExpired: quotationExpired,
    pauseEvaluation,
    totals,
    permittedActions: {
      nextStatus: nextAllowedStatus,
      canSendQuotation,
      canCustomerAccept,
      canEdit,
      canPause,
      canResume,
      canClose,
      canRenew,
    },
  };
}

export const SUBSCRIPTION_INCLUDE = {
  customer: {
    include: {
      user: {
        select: { id: true, email: true, role: true, isActive: true },
      },
    },
  },
  plan: true,
  lines: {
    include: {
      product: true,
      variant: true,
      tax: true,
    },
    orderBy: { id: "asc" as const },
  },
  history: {
    orderBy: [{ changedAt: "desc" as const }, { id: "desc" as const }],
  },
};

async function fetchActiveCandidateDiscounts(
  db: PrismaClient | Prisma.TransactionClient
): Promise<CandidateDiscountInput[]> {
  if (!("discount" in db) || typeof (db as PrismaClient).discount?.findMany !== "function") {
    return [];
  }
  try {
    const rows = await (db as PrismaClient).discount.findMany({
      where: { isActive: true },
      include: { products: true },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      value: d.value,
      minPurchase: d.minPurchase,
      minQuantity: d.minQuantity,
      startDate: d.startDate,
      endDate: d.endDate,
      usageLimit: d.usageLimit,
      timesUsed: d.timesUsed,
      scope: d.scope,
      isActive: d.isActive,
      products: d.products,
    }));
  } catch {
    return [];
  }
}

/**
 * Validates plan availability dates, minimum quantities, products, variants, and taxes,
 * and returns prepared SubscriptionLine data with Prisma.Decimal amounts.
 */
async function validateAndPrepareLines(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    plan: { id: number; minQuantity: number; availableFrom: Date; availableTo: Date | null };
    startDate: Date;
    lines: Array<{
      productId: number;
      variantId?: number | null;
      quantity: number;
      unitPrice?: number | string;
      taxId?: number | null;
    }>;
  }
) {
  const { plan, startDate, lines } = params;

  if (!lines || lines.length === 0) {
    throw new SubscriptionServiceError(
      "At least one subscription line is required",
      400,
      "MISSING_LINES"
    );
  }

  // Check plan availability on startDate
  const startMs = startDate.getTime();
  if (startMs < new Date(plan.availableFrom).getTime()) {
    throw new SubscriptionServiceError(
      `Selected plan is not available before ${new Date(plan.availableFrom).toISOString().slice(0, 10)}`,
      400,
      "PLAN_NOT_AVAILABLE"
    );
  }
  if (plan.availableTo && startMs > new Date(plan.availableTo).getTime()) {
    throw new SubscriptionServiceError(
      `Selected plan is no longer available after ${new Date(plan.availableTo).toISOString().slice(0, 10)}`,
      400,
      "PLAN_EXPIRED"
    );
  }

  const preparedLines: Array<{
    productId: number;
    variantId: number | null;
    quantity: number;
    unitPrice: Prisma.Decimal;
    taxId: number | null;
    amount: Prisma.Decimal;
  }> = [];

  for (const line of lines) {
    if (line.quantity < plan.minQuantity) {
      throw new SubscriptionServiceError(
        `Line quantity (${line.quantity}) must be at least the plan's minimum quantity (${plan.minQuantity})`,
        400,
        "MIN_QUANTITY_VIOLATION"
      );
    }

    const product = await db.product.findUnique({
      where: { id: line.productId },
      include: { variants: true },
    });

    if (!product || product.isArchived) {
      throw new SubscriptionServiceError(
        `Product ID ${line.productId} does not exist or is archived`,
        400,
        "UNKNOWN_PRODUCT"
      );
    }

    let variantExtraPrice: Prisma.Decimal | null = null;
    let resolvedVariantId: number | null = null;

    if (line.variantId != null) {
      const variant = product.variants.find((v) => v.id === line.variantId);
      if (!variant) {
        throw new SubscriptionServiceError(
          `Variant ID ${line.variantId} does not belong to Product ID ${line.productId}`,
          400,
          "UNKNOWN_VARIANT"
        );
      }
      variantExtraPrice = variant.extraPrice;
      resolvedVariantId = variant.id;
    }

    let resolvedTaxId: number | null = null;
    if (line.taxId != null) {
      const tax = await db.tax.findUnique({ where: { id: line.taxId } });
      if (!tax || !tax.isActive) {
        throw new SubscriptionServiceError(
          `Tax ID ${line.taxId} does not exist or is inactive`,
          400,
          "UNKNOWN_TAX"
        );
      }
      resolvedTaxId = tax.id;
    }

    // Determine unit price: staff-entered agreed price OR default (Product.salesPrice + Variant.extraPrice)
    const unitPrice =
      line.unitPrice !== undefined && line.unitPrice !== ""
        ? new Prisma.Decimal(line.unitPrice).toDecimalPlaces(2)
        : calculateDefaultUnitPrice(product.salesPrice, variantExtraPrice);

    const amount = calculateLineAmount(line.quantity, unitPrice);

    preparedLines.push({
      productId: product.id,
      variantId: resolvedVariantId,
      quantity: line.quantity,
      unitPrice,
      taxId: resolvedTaxId,
      amount,
    });
  }

  return preparedLines;
}

export interface CreateSubscriptionInput {
  customerId: number;
  planId?: number;
  templateId?: number | null;
  startDate: Date;
  expiryDate: Date;
  paymentTermsDays?: number;
  quotationValidUntil?: Date | null;
  createdById?: number | null;
  note?: string;
  lines?: Array<{
    productId: number;
    variantId?: number | null;
    quantity: number;
    unitPrice?: number | string;
    taxId?: number | null;
  }>;
}

/**
 * Creates a new DRAFT subscription from a blank form (or optional template),
 * generates a sequential SUB-xxxxxx number, stores lines with Decimal amounts,
 * and writes the initial SubscriptionStatusHistory entry.
 */
export async function createSubscription(
  input: CreateSubscriptionInput,
  db: PrismaClient = defaultPrisma
) {
  if (input.expiryDate.getTime() <= input.startDate.getTime()) {
    throw new SubscriptionServiceError(
      "Expiry date must be after start date",
      400,
      "INVALID_DATES"
    );
  }

  const customer = await db.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) {
    throw new SubscriptionServiceError(
      `Customer ID ${input.customerId} not found`,
      404,
      "UNKNOWN_CUSTOMER"
    );
  }

  let resolvedPlanId = input.planId;
  let resolvedQuotationValidUntil = input.quotationValidUntil ?? null;
  let templateLinesInput = input.lines;

  if (input.templateId != null) {
    const template = await db.quotationTemplate.findUnique({
      where: { id: input.templateId },
      include: { lines: true },
    });
    if (!template) {
      throw new SubscriptionServiceError(
        `QuotationTemplate ID ${input.templateId} not found`,
        404,
        "UNKNOWN_TEMPLATE"
      );
    }
    if (!resolvedPlanId) {
      resolvedPlanId = template.planId;
    }
    if (!resolvedQuotationValidUntil) {
      const validUntil = new Date();
      validUntil.setUTCDate(validUntil.getUTCDate() + template.validityDays);
      resolvedQuotationValidUntil = validUntil;
    }
    if (!templateLinesInput || templateLinesInput.length === 0) {
      templateLinesInput = template.lines.map((tl) => ({
        productId: tl.productId,
        variantId: tl.variantId,
        quantity: tl.quantity,
      }));
    }
  }

  if (!resolvedPlanId) {
    throw new SubscriptionServiceError("Plan ID is required", 400, "MISSING_PLAN");
  }

  const plan = await db.plan.findUnique({ where: { id: resolvedPlanId } });
  if (!plan) {
    throw new SubscriptionServiceError(
      `Plan ID ${resolvedPlanId} not found`,
      404,
      "UNKNOWN_PLAN"
    );
  }

  const preparedLines = await validateAndPrepareLines(db, {
    plan,
    startDate: input.startDate,
    lines: templateLinesInput ?? [],
  });

  const number = await generateNextSubscriptionNumber(db);

  const created = await db.subscription.create({
    data: {
      number,
      customerId: customer.id,
      planId: plan.id,
      status: "DRAFT",
      isPaused: false,
      startDate: input.startDate,
      expiryDate: input.expiryDate,
      paymentTermsDays: input.paymentTermsDays ?? 15,
      quotationValidUntil: resolvedQuotationValidUntil,
      createdById: input.createdById ?? null,
      lines: {
        create: preparedLines,
      },
      history: {
        create: {
          fromStatus: null,
          toStatus: "DRAFT",
          changedById: input.createdById ?? null,
          note:
            input.note ??
            (input.templateId
              ? `Created Draft from Template #${input.templateId}`
              : "Created Draft subscription"),
        },
      },
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(created, { candidateDiscounts });
}

/**
 * Updates an existing subscription while in DRAFT (or QUOTATION revision flow).
 * Rejects edits to CONFIRMED, ACTIVE, or CLOSED subscriptions.
 */
export async function updateSubscription(
  subscriptionId: number,
  input: {
    customerId?: number;
    planId?: number;
    startDate?: Date;
    expiryDate?: Date;
    paymentTermsDays?: number;
    quotationValidUntil?: Date | null;
    lines?: Array<{
      productId: number;
      variantId?: number | null;
      quantity: number;
      unitPrice?: number | string;
      taxId?: number | null;
    }>;
  },
  db: PrismaClient = defaultPrisma
) {
  const existing = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, lines: true },
  });

  if (!existing) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (existing.status !== "DRAFT" && existing.status !== "QUOTATION") {
    throw new SubscriptionServiceError(
      `Cannot edit a subscription in ${existing.status} status. Only DRAFT or QUOTATION subscriptions can be edited.`,
      400,
      "EDIT_NOT_ALLOWED"
    );
  }

  const nextCustomerId = input.customerId ?? existing.customerId;
  const nextPlanId = input.planId ?? existing.planId;
  const nextStartDate = input.startDate ?? existing.startDate;
  const nextExpiryDate = input.expiryDate ?? existing.expiryDate;

  if (nextExpiryDate.getTime() <= nextStartDate.getTime()) {
    throw new SubscriptionServiceError(
      "Expiry date must be after start date",
      400,
      "INVALID_DATES"
    );
  }

  if (input.customerId) {
    const customer = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) {
      throw new SubscriptionServiceError("Customer not found", 404, "UNKNOWN_CUSTOMER");
    }
  }

  const plan = await db.plan.findUnique({ where: { id: nextPlanId } });
  if (!plan) {
    throw new SubscriptionServiceError("Plan not found", 404, "UNKNOWN_PLAN");
  }

  const linesToValidate =
    input.lines ??
    existing.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toString(),
      taxId: l.taxId,
    }));

  const preparedLines = await validateAndPrepareLines(db, {
    plan,
    startDate: nextStartDate,
    lines: linesToValidate,
  });

  const updated = await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      customerId: nextCustomerId,
      planId: nextPlanId,
      startDate: nextStartDate,
      expiryDate: nextExpiryDate,
      paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
      quotationValidUntil:
        input.quotationValidUntil !== undefined
          ? input.quotationValidUntil
          : existing.quotationValidUntil,
      ...(input.lines
        ? {
            lines: {
              deleteMany: {},
              create: preparedLines,
            },
          }
        : {}),
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(updated, { candidateDiscounts });
}

/**
 * CENTRAL STATUS TRANSITION FUNCTION (BRD v2 Sections 6 & 7)
 *
 * Enforces the strict linear flow:
 *   DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE -> CLOSED
 *
 * Also enforces role-based transition rules when `actorRole` is provided:
 * - DRAFT -> QUOTATION: ADMIN or STAFF only
 * - QUOTATION -> CONFIRMED: Owning CUSTOMER only (Staff/Admin receive 403 Forbidden)
 * - CONFIRMED -> ACTIVE: System activation when startDate is reached (Staff/Admin manual activation receives 403)
 * - ACTIVE -> CLOSED: ADMIN, STAFF, Owning CUSTOMER (if Plan.closable), or SYSTEM (autoClose)
 */
export async function transitionSubscriptionStatus(
  params: {
    subscriptionId: number;
    toStatus: SubscriptionStatus;
    changedById?: number | null;
    actorRole?: Role | "SYSTEM";
    actorCustomerId?: number | null;
    note?: string | null;
    activationDate?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const {
    subscriptionId,
    toStatus,
    changedById = null,
    actorRole,
    actorCustomerId,
    note = null,
    activationDate = new Date(),
  } = params;

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  const fromStatus = sub.status;

  if (!isAllowedStatusTransition(fromStatus, toStatus)) {
    throw new SubscriptionServiceError(
      `Illegal status transition from ${fromStatus} to ${toStatus}. Allowed next status is ${
        ALLOWED_NEXT_STATUS[fromStatus] ?? "NONE"
      }.`,
      400,
      "ILLEGAL_STATUS_TRANSITION"
    );
  }

  // Enforce role-specific transition permissions when actorRole is supplied
  if (actorRole) {
    if (toStatus === "QUOTATION") {
      if (actorRole !== "ADMIN" && actorRole !== "STAFF") {
        throw new SubscriptionServiceError(
          "Forbidden: Only Staff or Admin can send a quotation",
          403,
          "FORBIDDEN_ROLE"
        );
      }
    } else if (toStatus === "CONFIRMED") {
      // Critical BRD v2 Rule #4 & #5: Only the owning CUSTOMER can accept a quotation.
      // Staff and Admin must NEVER accept on a customer's behalf (returns 403).
      if (actorRole !== "CUSTOMER") {
        throw new SubscriptionServiceError(
          "Forbidden: Staff and Admin cannot accept a quotation on a customer's behalf. Only the owning Customer can accept their quotation in the Customer Portal.",
          403,
          "FORBIDDEN_STAFF_ACCEPTANCE"
        );
      }
      if (!actorCustomerId || actorCustomerId !== sub.customerId) {
        throw new SubscriptionServiceError(
          "Forbidden: You can only accept quotations belonging to your own customer account",
          403,
          "FORBIDDEN_OWNERSHIP"
        );
      }
      if (isQuotationExpired(sub.status, sub.quotationValidUntil, activationDate)) {
        throw new SubscriptionServiceError(
          "Cannot accept this quotation because its validity date has expired",
          400,
          "QUOTATION_EXPIRED"
        );
      }
    } else if (toStatus === "ACTIVE") {
      // Critical BRD v2 Rule #5: System activates when startDate is reached; Staff/Admin cannot manually activate.
      if (actorRole !== "SYSTEM") {
        throw new SubscriptionServiceError(
          "Forbidden: Manual activation by Staff or Admin is not permitted. Subscriptions activate automatically when their start date is reached.",
          403,
          "FORBIDDEN_MANUAL_ACTIVATION"
        );
      }
    }
  }

  const updateData: Prisma.SubscriptionUpdateInput = {
    status: toStatus,
  };

  if (toStatus === "QUOTATION" && !sub.quotationValidUntil) {
    const validUntil = new Date(activationDate.getTime());
    validUntil.setUTCDate(validUntil.getUTCDate() + 30);
    updateData.quotationValidUntil = validUntil;
  }

  if (toStatus === "ACTIVE") {
    updateData.nextInvoiceDate = computeInitialNextInvoiceDate(sub.startDate, activationDate);
    updateData.isPaused = false;
  }

  if (toStatus === "CLOSED") {
    updateData.isPaused = false;
  }

  const updated = await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      ...updateData,
      history: {
        create: {
          fromStatus,
          toStatus,
          changedById: actorRole === "SYSTEM" ? null : changedById,
          note: note ?? `Status changed from ${fromStatus} to ${toStatus}`,
          changedAt: activationDate,
        },
      },
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(updated, { asOfDate: activationDate, candidateDiscounts });
}

/**
 * Customer Quotation Acceptance Service (BRD v2 Section 6 Step 3)
 *
 * - Strictly requires role = CUSTOMER and ownership (sub.customerId === customerId)
 * - Verifies status === QUOTATION and that quotationValidUntil has not passed
 * - Transitions QUOTATION -> CONFIRMED and logs customer user ID in SubscriptionStatusHistory
 * - If startDate <= acceptanceDate, automatically invokes system activation (CONFIRMED -> ACTIVE)
 *   with changedById = null and note = "SYSTEM:START_DATE_REACHED", initializing nextInvoiceDate.
 * - If startDate > acceptanceDate, leaves status as CONFIRMED until `activateConfirmedSubscriptions` runs on startDate.
 */
export async function acceptCustomerQuotation(
  params: {
    subscriptionId: number;
    customerUserId: number;
    customerId: number;
    actorRole: Role;
    note?: string | null;
    acceptedAt?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const {
    subscriptionId,
    customerUserId,
    customerId,
    actorRole,
    note = null,
    acceptedAt = new Date(),
  } = params;

  if (actorRole !== "CUSTOMER") {
    throw new SubscriptionServiceError(
      "Forbidden: Only the owning Customer can accept a quotation. Staff and Admin cannot accept on the customer's behalf.",
      403,
      "FORBIDDEN_STAFF_ACCEPTANCE"
    );
  }

  const confirmedSub = await transitionSubscriptionStatus(
    {
      subscriptionId,
      toStatus: "CONFIRMED",
      changedById: customerUserId,
      actorRole: "CUSTOMER",
      actorCustomerId: customerId,
      note: note ?? "Customer accepted quotation offer in portal",
      activationDate: acceptedAt,
    },
    db
  );

  // Step 4: If startDate is today or in the past, system activates it immediately
  if (new Date(confirmedSub.startDate).getTime() <= acceptedAt.getTime()) {
    return transitionSubscriptionStatus(
      {
        subscriptionId,
        toStatus: "ACTIVE",
        changedById: null,
        actorRole: "SYSTEM",
        note: "SYSTEM:START_DATE_REACHED",
        activationDate: acceptedAt,
      },
      db
    );
  }

  return confirmedSub;
}

/**
 * Idempotent System Activation Function (BRD v2 Section 6 Step 4)
 *
 * Transitions all CONFIRMED subscriptions whose startDate <= asOfDate to ACTIVE,
 * records `changedById = null` and `note = "SYSTEM:START_DATE_REACHED"` in SubscriptionStatusHistory,
 * and initializes `nextInvoiceDate`.
 */
export async function activateConfirmedSubscriptions(
  asOfDate: Date = new Date(),
  db: PrismaClient = defaultPrisma
) {
  const dueConfirmed = await db.subscription.findMany({
    where: {
      status: "CONFIRMED",
      startDate: {
        lte: asOfDate,
      },
    },
    select: { id: true, number: true },
  });

  const activated = [];
  for (const sub of dueConfirmed) {
    const res = await transitionSubscriptionStatus(
      {
        subscriptionId: sub.id,
        toStatus: "ACTIVE",
        changedById: null,
        actorRole: "SYSTEM",
        note: "SYSTEM:START_DATE_REACHED",
        activationDate: asOfDate,
      },
      db
    );
    activated.push(res);
  }

  return {
    asOfDate,
    activatedCount: activated.length,
    activatedIds: activated.map((s) => s.id),
    activatedNumbers: activated.map((s) => s.number),
  };
}

/**
 * Pauses an ACTIVE subscription if Plan.pausable = true.
 */
export async function pauseSubscription(
  params: {
    subscriptionId: number;
    changedById?: number | null;
    note?: string | null;
    pausedAt?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const { subscriptionId, changedById = null, note = null, pausedAt = new Date() } = params;

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (sub.status !== "ACTIVE") {
    throw new SubscriptionServiceError(
      `Only ACTIVE subscriptions can be paused (current status: ${sub.status})`,
      400,
      "INVALID_STATE_FOR_PAUSE"
    );
  }

  if (!sub.plan.pausable) {
    throw new SubscriptionServiceError(
      `Plan "${sub.plan.name}" does not allow pausing subscriptions`,
      403,
      "PLAN_NOT_PAUSABLE"
    );
  }

  if (sub.isPaused) {
    throw new SubscriptionServiceError(
      "Subscription is already paused",
      400,
      "ALREADY_PAUSED"
    );
  }

  const formattedNote = note ? `${PAUSE_ACTION_NOTE} - ${note}` : PAUSE_ACTION_NOTE;

  const updated = await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      isPaused: true,
      history: {
        create: {
          fromStatus: sub.status,
          toStatus: sub.status,
          changedById,
          note: formattedNote,
          changedAt: pausedAt,
        },
      },
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(updated, { asOfDate: pausedAt, candidateDiscounts });
}

/**
 * Resumes a paused ACTIVE subscription if Plan.pausable = true.
 */
export async function resumeSubscription(
  params: {
    subscriptionId: number;
    changedById?: number | null;
    note?: string | null;
    resumedAt?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const { subscriptionId, changedById = null, note = null, resumedAt = new Date() } = params;

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      history: { orderBy: { changedAt: "desc" } },
    },
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (sub.status !== "ACTIVE") {
    throw new SubscriptionServiceError(
      `Only ACTIVE subscriptions can be resumed (current status: ${sub.status})`,
      400,
      "INVALID_STATE_FOR_RESUME"
    );
  }

  if (!sub.plan.pausable) {
    throw new SubscriptionServiceError(
      `Plan "${sub.plan.name}" does not allow pause/resume`,
      403,
      "PLAN_NOT_PAUSABLE"
    );
  }

  if (!sub.isPaused) {
    throw new SubscriptionServiceError(
      "Subscription is not currently paused",
      400,
      "NOT_PAUSED"
    );
  }

  const pauseEval = evaluatePauseDuration({
    isPaused: sub.isPaused,
    billingPeriod: sub.plan.billingPeriod,
    history: sub.history,
    asOfDate: resumedAt,
  });

  const adjustedNextInvoiceDate = calculateResumedNextInvoiceDate({
    currentNextInvoiceDate: sub.nextInvoiceDate,
    pausedAt: pauseEval.pausedAt,
    resumedAt,
  });

  const formattedNote = note ? `${RESUME_ACTION_NOTE} - ${note}` : RESUME_ACTION_NOTE;

  const updated = await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      isPaused: false,
      nextInvoiceDate: adjustedNextInvoiceDate,
      history: {
        create: {
          fromStatus: sub.status,
          toStatus: sub.status,
          changedById,
          note: formattedNote,
          changedAt: resumedAt,
        },
      },
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(updated, { asOfDate: resumedAt, candidateDiscounts });
}

/**
 * Early closes an ACTIVE subscription if Plan.closable = true.
 */
export async function closeSubscription(
  params: {
    subscriptionId: number;
    changedById?: number | null;
    note?: string | null;
  },
  db: PrismaClient = defaultPrisma
) {
  const { subscriptionId, changedById = null, note = null } = params;

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (sub.status !== "ACTIVE") {
    throw new SubscriptionServiceError(
      `Only ACTIVE subscriptions can be closed (current status: ${sub.status})`,
      400,
      "INVALID_STATE_FOR_CLOSE"
    );
  }

  if (!sub.plan.closable) {
    throw new SubscriptionServiceError(
      `Plan "${sub.plan.name}" does not allow closing subscriptions early`,
      403,
      "PLAN_NOT_CLOSABLE"
    );
  }

  return transitionSubscriptionStatus(
    {
      subscriptionId,
      toStatus: "CLOSED",
      changedById,
      note: note ? `ACTION:CLOSED - ${note}` : "ACTION:CLOSED - Closed early",
    },
    db
  );
}

/**
 * Renews an ACTIVE subscription if Plan.renewable = true.
 */
export async function renewSubscription(
  params: {
    subscriptionId: number;
    changedById?: number | null;
    note?: string | null;
    renewedAt?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const { subscriptionId, changedById = null, note = null, renewedAt = new Date() } = params;

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true },
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (sub.status === "CLOSED") {
    throw new SubscriptionServiceError(
      "A Closed subscription cannot be renewed or changed back to Active.",
      400,
      "CANNOT_RENEW_CLOSED"
    );
  }

  if (sub.status !== "ACTIVE") {
    throw new SubscriptionServiceError(
      `Only ACTIVE subscriptions can be renewed (current status: ${sub.status})`,
      400,
      "INVALID_STATE_FOR_RENEW"
    );
  }

  if (!sub.plan.renewable) {
    throw new SubscriptionServiceError(
      `Plan "${sub.plan.name}" does not allow renewal`,
      403,
      "PLAN_NOT_RENEWABLE"
    );
  }

  const baseExpiry =
    sub.expiryDate.getTime() > renewedAt.getTime() ? sub.expiryDate : renewedAt;
  const newExpiryDate = addBillingCycles(baseExpiry, sub.plan.billingPeriod, 1);

  const nextInvoiceBase = sub.nextInvoiceDate ?? sub.expiryDate;
  const newNextInvoiceDate = addBillingCycles(nextInvoiceBase, sub.plan.billingPeriod, 1);

  const formattedNote = note
    ? `${RENEW_ACTION_NOTE} - ${note}`
    : `${RENEW_ACTION_NOTE} - Extended expiry to ${newExpiryDate.toISOString().slice(0, 10)}`;

  const updated = await db.subscription.update({
    where: { id: subscriptionId },
    data: {
      expiryDate: newExpiryDate,
      nextInvoiceDate: newNextInvoiceDate,
      history: {
        create: {
          fromStatus: sub.status,
          toStatus: sub.status,
          changedById,
          note: formattedNote,
          changedAt: renewedAt,
        },
      },
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(updated, { asOfDate: renewedAt, candidateDiscounts });
}

/**
 * Automatic close at expiry (BRD v2 Section 8):
 */
export async function closeExpiredSubscriptions(
  asOfDate: Date = new Date(),
  db: PrismaClient = defaultPrisma
) {
  const expiredActiveSubs = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      expiryDate: {
        lt: asOfDate,
      },
      plan: {
        autoClose: true,
      },
    },
    select: { id: true, number: true },
  });

  const closedSubscriptions = [];
  for (const sub of expiredActiveSubs) {
    const closed = await transitionSubscriptionStatus(
      {
        subscriptionId: sub.id,
        toStatus: "CLOSED",
        changedById: null,
        actorRole: "SYSTEM",
        note: `ACTION:AUTO_CLOSED - Automatically closed after expiry date as of ${asOfDate.toISOString().slice(0, 10)}`,
        activationDate: asOfDate,
      },
      db
    );
    closedSubscriptions.push(closed);
  }

  return {
    asOfDate,
    closedCount: closedSubscriptions.length,
    closedIds: closedSubscriptions.map((s) => s.id),
    closedNumbers: closedSubscriptions.map((s) => s.number),
  };
}

/**
 * P3-to-P4 Integration Contract Reader:
 * First activates any due CONFIRMED subscriptions whose startDate <= asOfDate,
 * then returns all ACTIVE, unpaused subscriptions due for invoicing.
 */
export async function getDueSubscriptionsForBilling(
  asOfDate: Date = new Date(),
  db: PrismaClient = defaultPrisma
) {
  await activateConfirmedSubscriptions(asOfDate, db);

  const dueSubscriptions = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      isPaused: false,
      nextInvoiceDate: {
        lte: asOfDate,
      },
    },
    include: {
      customer: true,
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
          tax: true,
        },
      },
    },
    orderBy: { nextInvoiceDate: "asc" },
  });

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return dueSubscriptions.map((sub) =>
    enrichSubscription(sub, { asOfDate, candidateDiscounts })
  );
}

/**
 * Lists, searches, filters, and paginates subscriptions.
 * Automatically runs `activateConfirmedSubscriptions` so any CONFIRMED subscription
 * whose startDate has arrived is transitioned to ACTIVE by the system.
 */
export async function listSubscriptions(
  params: {
    search?: string;
    status?: SubscriptionStatus;
    isPaused?: boolean;
    planId?: number;
    customerId?: number;
    page?: number;
    pageSize?: number;
    asOfDate?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const asOfDate = params.asOfDate ?? new Date();
  await activateConfirmedSubscriptions(asOfDate, db);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where: Prisma.SubscriptionWhereInput = {};

  if (params.status) {
    where.status = params.status;
  }
  if (params.isPaused !== undefined) {
    where.isPaused = params.isPaused;
  }
  if (params.planId) {
    where.planId = params.planId;
  }
  if (params.customerId) {
    where.customerId = params.customerId;
  }
  if (params.search && params.search.trim() !== "") {
    const q = params.search.trim();
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { plan: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, items, candidateDiscounts] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    fetchActiveCandidateDiscounts(db),
  ]);

  return {
    items: items.map((item) =>
      enrichSubscription(item, { asOfDate, candidateDiscounts })
    ),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/**
 * Retrieves a single subscription by ID, enforcing customer ownership if requested by a customer.
 * Also runs system activation check if subscription is CONFIRMED and startDate <= asOfDate.
 */
export async function getSubscriptionById(
  subscriptionId: number,
  options?: {
    enforceCustomerId?: number;
    asOfDate?: Date;
    pausePolicyOverride?: PausePolicyConfig;
  },
  db: PrismaClient = defaultPrisma
) {
  const asOfDate = options?.asOfDate ?? new Date();
  await activateConfirmedSubscriptions(asOfDate, db);

  const sub = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: SUBSCRIPTION_INCLUDE,
  });

  if (!sub) {
    throw new SubscriptionServiceError("Subscription not found", 404, "NOT_FOUND");
  }

  if (
    options?.enforceCustomerId !== undefined &&
    sub.customerId !== options.enforceCustomerId
  ) {
    throw new SubscriptionServiceError(
      "Forbidden: You do not have access to this subscription",
      403,
      "FORBIDDEN_OWNERSHIP"
    );
  }

  const candidateDiscounts = await fetchActiveCandidateDiscounts(db);
  return enrichSubscription(sub, {
    asOfDate,
    pausePolicyOverride: options?.pausePolicyOverride,
    candidateDiscounts,
  });
}
