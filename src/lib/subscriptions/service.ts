import { Prisma, PrismaClient, SubscriptionStatus } from "@prisma/client";
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
  // Using raw atomic PostgreSQL upsert to guarantee concurrency safety even outside serializable tx
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
 * Does NOT alter the SubscriptionStatus enum.
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
 * - If startDate is in the future relative to activationDate, initializes to startDate.
 * - If subscription starts immediately (or startDate <= activationDate), initializes to startDate
 *   (or activationDate if startDate is in the past; per PRD Section 7: "normally the start date for advance billing,
 *   or if start date is in the future, initialize to that future start date").
 */
export function computeInitialNextInvoiceDate(
  startDate: Date,
  activationDate: Date = new Date()
): Date {
  // Per PRD Section 7:
  // - If the subscription starts immediately, initialize it to the agreed first billing date (normally the start date for advance billing).
  // - If the start date is in the future, initialize it to that future start date.
  if (startDate.getTime() > activationDate.getTime()) {
    return new Date(startDate.getTime());
  }
  return new Date(startDate.getTime());
}

/**
 * Enriches a subscription record with computed fields:
 * - isQuotationExpired (boolean flag without changing status enum)
 * - pauseEvaluation (elapsed pause duration, maxPauseUntil, limitReached, warningMessage)
 * - totals (linesSubtotal, taxTotal, planReferencePrice, grandTotal)
 * - permittedActions (which lifecycle transitions & actions are currently allowed)
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
      quantity: number;
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
  options?: { asOfDate?: Date; pausePolicyOverride?: PausePolicyConfig }
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
  });

  const nextAllowedStatus = ALLOWED_NEXT_STATUS[sub.status as SubscriptionStatus];
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
      canEdit,
      canPause,
      canResume,
      canClose,
      canRenew,
    },
  };
}

export const SUBSCRIPTION_INCLUDE = {
  customer: true,
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
 * Creates a new DRAFT subscription (optionally pre-filled from a P2 QuotationTemplate),
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

  const created = await db.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
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
            note: input.note ?? (input.templateId ? `Created Draft from Template #${input.templateId}` : "Created Draft subscription"),
          },
        },
      },
      include: SUBSCRIPTION_INCLUDE,
    });
    return sub;
  });

  return enrichSubscription(created);
}

/**
 * Updates an existing subscription while in DRAFT or QUOTATION status.
 * Rejects unsafe edits to CONFIRMED, ACTIVE, or CLOSED subscriptions.
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

  const updated = await db.$transaction(async (tx) => {
    if (input.lines) {
      await tx.subscriptionLine.deleteMany({ where: { subscriptionId } });
    }

    return tx.subscription.update({
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
                create: preparedLines,
              },
            }
          : {}),
      },
      include: SUBSCRIPTION_INCLUDE,
    });
  });

  return enrichSubscription(updated);
}

/**
 * CENTRAL STATUS TRANSITION FUNCTION (PRD Section 4)
 *
 * Enforces the strict linear flow:
 *   DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE -> CLOSED
 *
 * Every status transition across API routes, UI actions, close actions, and auto-close
 * MUST go through this function. Writes an append-only row to SubscriptionStatusHistory.
 */
export async function transitionSubscriptionStatus(
  params: {
    subscriptionId: number;
    toStatus: SubscriptionStatus;
    changedById?: number | null;
    note?: string | null;
    activationDate?: Date;
  },
  db: PrismaClient = defaultPrisma
) {
  const { subscriptionId, toStatus, changedById = null, note = null, activationDate = new Date() } = params;

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

  const updateData: Prisma.SubscriptionUpdateInput = {
    status: toStatus,
  };

  // When transitioning to QUOTATION, if quotationValidUntil is not set, default to 30 days
  if (toStatus === "QUOTATION" && !sub.quotationValidUntil) {
    const validUntil = new Date(activationDate.getTime());
    validUntil.setUTCDate(validUntil.getUTCDate() + 30);
    updateData.quotationValidUntil = validUntil;
  }

  // When transitioning to ACTIVE, initialize nextInvoiceDate for P4 hand-off
  if (toStatus === "ACTIVE") {
    updateData.nextInvoiceDate = computeInitialNextInvoiceDate(sub.startDate, activationDate);
    updateData.isPaused = false;
  }

  // When transitioning to CLOSED, ensure isPaused is cleared
  if (toStatus === "CLOSED") {
    updateData.isPaused = false;
  }

  const updated = await db.$transaction(async (tx) => {
    const updatedSub = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...updateData,
        history: {
          create: {
            fromStatus,
            toStatus,
            changedById,
            note: note ?? `Status changed from ${fromStatus} to ${toStatus}`,
            changedAt: activationDate,
          },
        },
      },
      include: SUBSCRIPTION_INCLUDE,
    });
    return updatedSub;
  });

  return enrichSubscription(updated);
}

/**
 * Pauses an ACTIVE subscription if Plan.pausable = true.
 * Records ACTION:PAUSED in SubscriptionStatusHistory without changing SubscriptionStatus enum.
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

  const updated = await db.$transaction(async (tx) => {
    return tx.subscription.update({
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
  });

  return enrichSubscription(updated, { asOfDate: pausedAt });
}

/**
 * Resumes a paused ACTIVE subscription if Plan.pausable = true.
 * Adjusts nextInvoiceDate by the elapsed pause duration and logs ACTION:RESUMED in history.
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

  const updated = await db.$transaction(async (tx) => {
    return tx.subscription.update({
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
  });

  return enrichSubscription(updated, { asOfDate: resumedAt });
}

/**
 * Early closes an ACTIVE subscription if Plan.closable = true.
 * Uses the central status-transition function to transition ACTIVE -> CLOSED.
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
 * Extends expiryDate by 1 billing cycle (or custom date) and updates nextInvoiceDate,
 * recording ACTION:RENEWED in SubscriptionStatusHistory.
 * Rejects CLOSED subscriptions per PRD Section 6.
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

  const updated = await db.$transaction(async (tx) => {
    return tx.subscription.update({
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
  });

  return enrichSubscription(updated, { asOfDate: renewedAt });
}

/**
 * Automatic close at expiry (PRD Section 6):
 * Reusable P3 service function for P4 to call at the start of the billing run
 * (or callable by a daily scheduler).
 * Closes ACTIVE subscriptions whose expiryDate has passed ONLY when Plan.autoClose = true.
 * Uses the central status-transition function so every automatic close is recorded in history.
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
 * P3-to-P4 Integration Contract Reader (PRD Section 10):
 * Exposes due, active, unpaused subscriptions with all required fields for P4's billing engine.
 * P4 reads this data to generate invoices; P3 never creates invoices.
 */
export async function getDueSubscriptionsForBilling(
  asOfDate: Date = new Date(),
  db: PrismaClient = defaultPrisma
) {
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

  return dueSubscriptions.map((sub) => enrichSubscription(sub, { asOfDate }));
}

/**
 * Lists, searches, filters, and paginates subscriptions.
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

  const [total, items] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    items: items.map((item) => enrichSubscription(item, { asOfDate: params.asOfDate })),
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

  return enrichSubscription(sub, {
    asOfDate: options?.asOfDate,
    pausePolicyOverride: options?.pausePolicyOverride,
  });
}

