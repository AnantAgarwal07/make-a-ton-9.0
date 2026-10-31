import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createSubscription,
  transitionSubscriptionStatus,
  pauseSubscription,
  resumeSubscription,
  closeSubscription,
  renewSubscription,
  closeExpiredSubscriptions,
  getSubscriptionById,
  listSubscriptions,
  getDueSubscriptionsForBilling,
  generateNextSubscriptionNumber,
  isQuotationExpired,
} from "@/lib/subscriptions/service";
import {
  PAUSE_POLICY_CYCLES,
  evaluatePauseDuration,
} from "@/lib/subscriptions/pause-policy";

/**
 * In-memory mock implementation of PrismaClient tailored for P3's exact Prisma contract.
 * Guarantees deterministic, fast, isolated test runs and never mutates or wipes the shared Neon database.
 */
function createTestDb() {
  let subIdSeq = 100;
  let lineIdSeq = 1000;
  let historyIdSeq = 5000;
  let counterVal = 0;

  const customers = new Map<number, any>([
    [1, { id: 1, name: "Acme Traders", email: "acme@customer.test" }],
    [2, { id: 2, name: "Aarav Sharma", email: "aarav@customer.test" }],
  ]);

  const plans = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "Monthly Flexible",
        price: new Prisma.Decimal("1000.00"),
        billingPeriod: "MONTHLY",
        minQuantity: 1,
        availableFrom: new Date("2026-01-01T00:00:00Z"),
        availableTo: new Date("2027-12-31T23:59:59Z"),
        autoClose: false,
        closable: true,
        pausable: true,
        renewable: true,
      },
    ],
    [
      2,
      {
        id: 2,
        name: "Yearly Strict Min5",
        price: new Prisma.Decimal("10000.00"),
        billingPeriod: "YEARLY",
        minQuantity: 5,
        availableFrom: new Date("2026-06-01T00:00:00Z"),
        availableTo: new Date("2026-12-31T23:59:59Z"),
        autoClose: true,
        closable: false,
        pausable: false,
        renewable: false,
      },
    ],
  ]);

  const products = new Map<number, any>([
    [
      10,
      {
        id: 10,
        name: "Brightloop CRM",
        type: "Software",
        salesPrice: new Prisma.Decimal("1000.00"),
        costPrice: new Prisma.Decimal("400.00"),
        isArchived: false,
        variants: [
          {
            id: 101,
            productId: 10,
            attribute: "Edition",
            value: "Enterprise",
            extraPrice: new Prisma.Decimal("560.00"),
          },
        ],
      },
    ],
    [
      20,
      {
        id: 20,
        name: "Support Package",
        type: "Service",
        salesPrice: new Prisma.Decimal("500.00"),
        costPrice: new Prisma.Decimal("100.00"),
        isArchived: false,
        variants: [],
      },
    ],
  ]);

  const taxes = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "GST 18%",
        type: "PERCENT",
        rate: new Prisma.Decimal("18.00"),
        isActive: true,
      },
    ],
  ]);

  const templates = new Map<number, any>([
    [
      1,
      {
        id: 1,
        name: "CRM Starter Template",
        planId: 1,
        validityDays: 15,
        lines: [
          { id: 1, templateId: 1, productId: 10, variantId: 101, quantity: 2 },
          { id: 2, templateId: 1, productId: 20, variantId: null, quantity: 1 },
        ],
      },
    ],
  ]);

  const subscriptions = new Map<number, any>();

  function hydrateSubscription(raw: any) {
    if (!raw) return null;
    const customer = customers.get(raw.customerId) ?? null;
    const plan = plans.get(raw.planId) ?? null;
    const lines = (raw.lines ?? []).map((l: any) => {
      const prod = products.get(l.productId) ?? null;
      const variant = prod?.variants?.find((v: any) => v.id === l.variantId) ?? null;
      const tax = l.taxId ? taxes.get(l.taxId) ?? null : null;
      return { ...l, product: prod, variant, tax };
    });
    const history = [...(raw.history ?? [])].sort(
      (a, b) => b.changedAt.getTime() - a.changedAt.getTime() || b.id - a.id
    );
    return {
      ...raw,
      customer,
      plan,
      lines,
      history,
    };
  }

  const db: any = {
    _state: { customers, plans, products, taxes, templates, subscriptions },
    $queryRaw: async () => {
      counterVal += 1;
      return [{ value: counterVal }];
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      return fn(db);
    },
    customer: {
      findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
    },
    plan: {
      findUnique: async ({ where }: any) => plans.get(where.id) ?? null,
    },
    product: {
      findUnique: async ({ where }: any) => products.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const existing = products.get(where.id);
        if (!existing) throw new Error("Not found");
        const updated = {
          ...existing,
          ...(data.salesPrice !== undefined
            ? { salesPrice: new Prisma.Decimal(data.salesPrice) }
            : {}),
        };
        products.set(where.id, updated);
        return updated;
      },
    },
    tax: {
      findUnique: async ({ where }: any) => taxes.get(where.id) ?? null,
    },
    quotationTemplate: {
      findUnique: async ({ where }: any) => templates.get(where.id) ?? null,
    },
    subscriptionLine: {
      deleteMany: async ({ where }: any) => {
        const sub = subscriptions.get(where.subscriptionId);
        if (sub) {
          sub.lines = [];
        }
      },
    },
    subscription: {
      create: async ({ data }: any) => {
        const id = ++subIdSeq;
        const now = new Date();
        const createdLines = (data.lines?.create ?? []).map((l: any) => ({
          id: ++lineIdSeq,
          subscriptionId: id,
          productId: l.productId,
          variantId: l.variantId ?? null,
          quantity: l.quantity,
          unitPrice: new Prisma.Decimal(l.unitPrice),
          taxId: l.taxId ?? null,
          amount: new Prisma.Decimal(l.amount),
        }));
        const rawHistory = data.history?.create
          ? Array.isArray(data.history.create)
            ? data.history.create
            : [data.history.create]
          : [];
        const createdHistory = rawHistory.map((h: any) => ({
          id: ++historyIdSeq,
          subscriptionId: id,
          fromStatus: h.fromStatus ?? null,
          toStatus: h.toStatus,
          changedById: h.changedById ?? null,
          note: h.note ?? null,
          changedAt: h.changedAt ?? now,
        }));

        const record = {
          id,
          number: data.number,
          customerId: data.customerId,
          planId: data.planId,
          status: data.status ?? "DRAFT",
          isPaused: data.isPaused ?? false,
          startDate: data.startDate,
          expiryDate: data.expiryDate,
          paymentTermsDays: data.paymentTermsDays ?? 15,
          nextInvoiceDate: data.nextInvoiceDate ?? null,
          quotationValidUntil: data.quotationValidUntil ?? null,
          createdById: data.createdById ?? null,
          createdAt: now,
          lines: createdLines,
          history: createdHistory,
        };
        subscriptions.set(id, record);
        return hydrateSubscription(record);
      },
      findUnique: async ({ where }: any) => {
        const raw = subscriptions.get(where.id);
        return hydrateSubscription(raw);
      },
      update: async ({ where, data }: any) => {
        const raw = subscriptions.get(where.id);
        if (!raw) throw new Error("Subscription not found");

        if (data.status !== undefined) raw.status = data.status;
        if (data.isPaused !== undefined) raw.isPaused = data.isPaused;
        if (data.customerId !== undefined) raw.customerId = data.customerId;
        if (data.planId !== undefined) raw.planId = data.planId;
        if (data.startDate !== undefined) raw.startDate = data.startDate;
        if (data.expiryDate !== undefined) raw.expiryDate = data.expiryDate;
        if (data.paymentTermsDays !== undefined) raw.paymentTermsDays = data.paymentTermsDays;
        if (data.nextInvoiceDate !== undefined) raw.nextInvoiceDate = data.nextInvoiceDate;
        if (data.quotationValidUntil !== undefined) {
          raw.quotationValidUntil = data.quotationValidUntil;
        }

        if (data.lines?.create) {
          const newLines = data.lines.create.map((l: any) => ({
            id: ++lineIdSeq,
            subscriptionId: raw.id,
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: l.quantity,
            unitPrice: new Prisma.Decimal(l.unitPrice),
            taxId: l.taxId ?? null,
            amount: new Prisma.Decimal(l.amount),
          }));
          raw.lines.push(...newLines);
        }

        if (data.history?.create) {
          const h = data.history.create;
          raw.history.push({
            id: ++historyIdSeq,
            subscriptionId: raw.id,
            fromStatus: h.fromStatus ?? null,
            toStatus: h.toStatus,
            changedById: h.changedById ?? null,
            note: h.note ?? null,
            changedAt: h.changedAt ?? new Date(),
          });
        }

        subscriptions.set(raw.id, raw);
        return hydrateSubscription(raw);
      },
      findMany: async ({ where, skip = 0, take = 50 }: any = {}) => {
        const all = Array.from(subscriptions.values()).map(hydrateSubscription);
        const filtered = all.filter((sub: any) => {
          if (!where) return true;
          if (where.status && sub.status !== where.status) return false;
          if (where.isPaused !== undefined && sub.isPaused !== where.isPaused) return false;
          if (where.planId && sub.planId !== where.planId) return false;
          if (where.customerId && sub.customerId !== where.customerId) return false;
          if (where.expiryDate?.lt && !(sub.expiryDate < where.expiryDate.lt)) return false;
          if (
            where.nextInvoiceDate?.lte &&
            (!sub.nextInvoiceDate || !(sub.nextInvoiceDate <= where.nextInvoiceDate.lte))
          ) {
            return false;
          }
          if (where.plan?.autoClose !== undefined && sub.plan?.autoClose !== where.plan.autoClose) {
            return false;
          }
          if (where.OR) {
            const q = where.OR[0]?.number?.contains?.toLowerCase() ?? "";
            const matches =
              sub.number.toLowerCase().includes(q) ||
              sub.customer?.name?.toLowerCase().includes(q) ||
              sub.customer?.email?.toLowerCase().includes(q) ||
              sub.plan?.name?.toLowerCase().includes(q);
            if (!matches) return false;
          }
          return true;
        });
        return filtered.slice(skip, skip + take);
      },
      count: async ({ where }: any = {}) => {
        const matched = await db.subscription.findMany({ where, skip: 0, take: 10000 });
        return matched.length;
      },
    },
  };

  return db;
}

describe("P3 Subscription Management Suite (20 Required PRD Tests)", () => {
  // 1. Create a subscription with valid customer, plan and lines.
  it("1. creates a subscription with valid customer, plan and lines", async () => {
    const db = createTestDb();
    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        paymentTermsDays: 15,
        createdById: 10,
        lines: [{ productId: 10, variantId: 101, quantity: 2, taxId: 1 }],
      },
      db
    );

    expect(sub.number).toBe("SUB-000001");
    expect(sub.status).toBe("DRAFT");
    expect(sub.customerId).toBe(1);
    expect(sub.planId).toBe(1);
    expect(sub.lines).toHaveLength(1);
    expect(sub.lines[0].amount.toString()).toBe("3120");
    expect(sub.history).toHaveLength(1);
    expect(sub.history[0].toStatus).toBe("DRAFT");
  });

  // 2. Reject unknown customer/plan/product/variant IDs.
  it("2. rejects unknown customer, plan, product, or variant IDs", async () => {
    const db = createTestDb();
    const validDates = {
      startDate: new Date("2026-07-01T00:00:00Z"),
      expiryDate: new Date("2027-07-01T00:00:00Z"),
    };

    await expect(
      createSubscription(
        {
          customerId: 999,
          planId: 1,
          ...validDates,
          lines: [{ productId: 10, quantity: 1 }],
        },
        db
      )
    ).rejects.toThrow(/Customer ID 999 not found/);

    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 999,
          ...validDates,
          lines: [{ productId: 10, quantity: 1 }],
        },
        db
      )
    ).rejects.toThrow(/Plan ID 999 not found/);

    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 1,
          ...validDates,
          lines: [{ productId: 999, quantity: 1 }],
        },
        db
      )
    ).rejects.toThrow(/Product ID 999 does not exist/);

    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 1,
          ...validDates,
          lines: [{ productId: 10, variantId: 999, quantity: 1 }],
        },
        db
      )
    ).rejects.toThrow(/Variant ID 999 does not belong to Product ID 10/);
  });

  // 3. Reject a plan outside its availability dates.
  it("3. rejects a plan outside its availability dates (availableFrom / availableTo)", async () => {
    const db = createTestDb();

    // Plan 2 is only available between 2026-06-01 and 2026-12-31
    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 2,
          startDate: new Date("2026-03-01T00:00:00Z"),
          expiryDate: new Date("2027-03-01T00:00:00Z"),
          lines: [{ productId: 10, quantity: 5 }],
        },
        db
      )
    ).rejects.toThrow(/Selected plan is not available before/);

    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 2,
          startDate: new Date("2027-02-01T00:00:00Z"),
          expiryDate: new Date("2028-02-01T00:00:00Z"),
          lines: [{ productId: 10, quantity: 5 }],
        },
        db
      )
    ).rejects.toThrow(/Selected plan is no longer available after/);
  });

  // 4. Reject quantity below Plan.minQuantity.
  it("4. rejects line quantity below Plan.minQuantity", async () => {
    const db = createTestDb();

    // Plan 2 requires minQuantity = 5
    await expect(
      createSubscription(
        {
          customerId: 1,
          planId: 2,
          startDate: new Date("2026-08-01T00:00:00Z"),
          expiryDate: new Date("2027-08-01T00:00:00Z"),
          lines: [{ productId: 10, quantity: 3 }],
        },
        db
      )
    ).rejects.toThrow(/must be at least the plan's minimum quantity \(5\)/);
  });

  // 5. Default unit price uses product sales price plus variant extra price.
  it("5. calculates default unit price as Product.salesPrice + ProductVariant.extraPrice", async () => {
    const db = createTestDb();

    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [
          { productId: 10, variantId: 101, quantity: 2 }, // 1000 + 560 = 1560
          { productId: 20, variantId: null, quantity: 3 }, // 500 + 0 = 500
        ],
      },
      db
    );

    expect(Number(sub.lines[0].unitPrice)).toBe(1560);
    expect(Number(sub.lines[0].amount)).toBe(3120);
    expect(Number(sub.lines[1].unitPrice)).toBe(500);
    expect(Number(sub.lines[1].amount)).toBe(1500);
  });

  // 6. Staff-entered agreed unit price is saved and remains unchanged if the catalogue price later changes.
  it("6. saves staff-entered agreed unit price and keeps it unchanged when catalogue price changes", async () => {
    const db = createTestDb();

    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, variantId: 101, quantity: 2, unitPrice: "1250.50" }],
      },
      db
    );

    expect(sub.lines[0].unitPrice.toFixed(2)).toBe("1250.50");
    expect(sub.lines[0].amount.toFixed(2)).toBe("2501.00");

    // Mutate product catalogue salesPrice later
    await db.product.update({
      where: { id: 10 },
      data: { salesPrice: "2500.00" },
    });

    const fetched = await getSubscriptionById(sub.id, {}, db);
    expect(fetched.lines[0].unitPrice.toFixed(2)).toBe("1250.50");
    expect(fetched.lines[0].amount.toFixed(2)).toBe("2501.00");
  });

  // 7. Subscription numbers are unique and sequential under concurrent creation.
  it("7. generates unique and sequential subscription numbers under concurrent creation", async () => {
    const db = createTestDb();

    const numbers = await Promise.all([
      generateNextSubscriptionNumber(db),
      generateNextSubscriptionNumber(db),
      generateNextSubscriptionNumber(db),
      generateNextSubscriptionNumber(db),
      generateNextSubscriptionNumber(db),
    ]);

    const unique = new Set(numbers);
    expect(unique.size).toBe(5);
    expect(numbers).toEqual([
      "SUB-000001",
      "SUB-000002",
      "SUB-000003",
      "SUB-000004",
      "SUB-000005",
    ]);
  });

  // 8. Every allowed status transition succeeds.
  it("8. succeeds on every allowed linear status transition (DRAFT -> QUOTATION -> CONFIRMED -> ACTIVE -> CLOSED)", async () => {
    const db = createTestDb();
    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );

    const q = await transitionSubscriptionStatus(
      { subscriptionId: sub.id, toStatus: "QUOTATION", changedById: 1 },
      db
    );
    expect(q.status).toBe("QUOTATION");

    const c = await transitionSubscriptionStatus(
      { subscriptionId: sub.id, toStatus: "CONFIRMED", changedById: 1 },
      db
    );
    expect(c.status).toBe("CONFIRMED");

    const a = await transitionSubscriptionStatus(
      { subscriptionId: sub.id, toStatus: "ACTIVE", changedById: 1 },
      db
    );
    expect(a.status).toBe("ACTIVE");

    const cl = await transitionSubscriptionStatus(
      { subscriptionId: sub.id, toStatus: "CLOSED", changedById: 1 },
      db
    );
    expect(cl.status).toBe("CLOSED");
  });

  // 9. Illegal transitions (especially Draft to Active and Closed to Active) fail.
  it("9. rejects illegal status transitions (DRAFT -> ACTIVE, QUOTATION -> ACTIVE, CLOSED -> ACTIVE)", async () => {
    const db = createTestDb();
    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );

    await expect(
      transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "ACTIVE" }, db)
    ).rejects.toThrow(/Illegal status transition from DRAFT to ACTIVE/);

    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "QUOTATION" }, db);

    await expect(
      transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "ACTIVE" }, db)
    ).rejects.toThrow(/Illegal status transition from QUOTATION to ACTIVE/);

    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "ACTIVE" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "CLOSED" }, db);

    await expect(
      transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "ACTIVE" }, db)
    ).rejects.toThrow(/Illegal status transition from CLOSED to ACTIVE/);
  });

  // 10. Each status change creates one history record with the actor and timestamp.
  it("10. writes one SubscriptionStatusHistory row with actor and timestamp for each transition", async () => {
    const db = createTestDb();
    const t1 = new Date("2026-07-01T10:00:00Z");
    const t2 = new Date("2026-07-02T11:30:00Z");

    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        createdById: 42,
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );

    await transitionSubscriptionStatus(
      {
        subscriptionId: sub.id,
        toStatus: "QUOTATION",
        changedById: 42,
        note: "Offer sent",
        activationDate: t1,
      },
      db
    );

    const updated = await transitionSubscriptionStatus(
      {
        subscriptionId: sub.id,
        toStatus: "CONFIRMED",
        changedById: 99,
        note: "Customer accepted",
        activationDate: t2,
      },
      db
    );

    expect(updated.history).toHaveLength(3); // Initial DRAFT + QUOTATION + CONFIRMED
    const confirmedEntry = updated.history.find((h: any) => h.toStatus === "CONFIRMED");
    expect(confirmedEntry).toBeDefined();
    expect(confirmedEntry.fromStatus).toBe("QUOTATION");
    expect(confirmedEntry.toStatus).toBe("CONFIRMED");
    expect(confirmedEntry.changedById).toBe(99);
    expect(confirmedEntry.changedAt.toISOString()).toBe(t2.toISOString());
  });

  // 11. Pause/resume respects Plan.pausable and records the event.
  it("11. enforces Plan.pausable on pause/resume, records ACTION:PAUSED and ACTION:RESUMED, and adjusts nextInvoiceDate", async () => {
    const db = createTestDb();

    // Create subscription on pausable Plan 1
    const sub1 = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus(
      {
        subscriptionId: sub1.id,
        toStatus: "ACTIVE",
        activationDate: new Date("2026-07-01T00:00:00Z"),
      },
      db
    );

    const pausedAt = new Date("2026-07-10T00:00:00Z");
    const paused = await pauseSubscription(
      { subscriptionId: sub1.id, changedById: 7, pausedAt },
      db
    );
    expect(paused.isPaused).toBe(true);
    expect(paused.status).toBe("ACTIVE");
    expect(paused.history.some((h: any) => h.note?.includes("ACTION:PAUSED"))).toBe(true);

    // Resume 5 days later -> nextInvoiceDate should shift forward by 5 days
    const resumedAt = new Date("2026-07-15T00:00:00Z");
    const resumed = await resumeSubscription(
      { subscriptionId: sub1.id, changedById: 7, resumedAt },
      db
    );
    expect(resumed.isPaused).toBe(false);
    expect(resumed.history.some((h: any) => h.note?.includes("ACTION:RESUMED"))).toBe(true);
    expect(resumed.nextInvoiceDate?.toISOString()).toBe("2026-07-06T00:00:00.000Z");

    // Non-pausable Plan 2 must reject pause
    const sub2 = await createSubscription(
      {
        customerId: 1,
        planId: 2,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 5 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "ACTIVE" }, db);

    await expect(pauseSubscription({ subscriptionId: sub2.id }, db)).rejects.toThrow(
      /does not allow pausing/
    );
  });

  // 12. Close respects Plan.closable.
  it("12. respects Plan.closable when closing an active subscription early", async () => {
    const db = createTestDb();

    // Plan 1 is closable
    const sub1 = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "ACTIVE" }, db);

    const closed = await closeSubscription({ subscriptionId: sub1.id, changedById: 1 }, db);
    expect(closed.status).toBe("CLOSED");

    // Plan 2 has closable = false
    const sub2 = await createSubscription(
      {
        customerId: 1,
        planId: 2,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 5 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "ACTIVE" }, db);

    await expect(closeSubscription({ subscriptionId: sub2.id }, db)).rejects.toThrow(
      /does not allow closing subscriptions early/
    );
  });

  // 13. Renew respects Plan.renewable and records the renewal event.
  it("13. respects Plan.renewable, extends expiryDate, and records ACTION:RENEWED in history", async () => {
    const db = createTestDb();

    const sub1 = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2026-08-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub1.id, toStatus: "ACTIVE" }, db);

    const renewed = await renewSubscription(
      {
        subscriptionId: sub1.id,
        changedById: 5,
        renewedAt: new Date("2026-07-20T00:00:00Z"),
      },
      db
    );
    expect(renewed.expiryDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(renewed.history.some((h: any) => h.note?.includes("ACTION:RENEWED"))).toBe(true);

    // Plan 2 has renewable = false
    const sub2 = await createSubscription(
      {
        customerId: 1,
        planId: 2,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 5 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub2.id, toStatus: "ACTIVE" }, db);

    await expect(renewSubscription({ subscriptionId: sub2.id }, db)).rejects.toThrow(
      /does not allow renewal/
    );
  });

  // 14. Pause-duration calculation changes when the period-specific configuration changes.
  it("14. dynamically adjusts max pause duration when pause-policy configuration changes", () => {
    const pausedAt = new Date("2026-07-01T00:00:00Z");
    const history = [{ note: "ACTION:PAUSED", changedAt: pausedAt }];
    const checkDateAfter40Days = new Date("2026-08-10T00:00:00Z");

    // Default policy: MONTHLY = 2 cycles (maxPauseUntil = 2026-09-01) -> not reached at 40 days
    const evalDefault = evaluatePauseDuration({
      isPaused: true,
      billingPeriod: "MONTHLY",
      history,
      asOfDate: checkDateAfter40Days,
      policyOverride: PAUSE_POLICY_CYCLES,
    });
    expect(evalDefault.maxAllowedCycles).toBe(2);
    expect(evalDefault.limitReached).toBe(false);
    expect(evalDefault.warningMessage).toBeNull();

    // Custom policy: MONTHLY = 1 cycle (maxPauseUntil = 2026-08-01) -> reached at 40 days!
    const evalSingleCycle = evaluatePauseDuration({
      isPaused: true,
      billingPeriod: "MONTHLY",
      history,
      asOfDate: checkDateAfter40Days,
      policyOverride: { ...PAUSE_POLICY_CYCLES, MONTHLY: 1 },
    });
    expect(evalSingleCycle.maxAllowedCycles).toBe(1);
    expect(evalSingleCycle.limitReached).toBe(true);
    expect(evalSingleCycle.warningMessage).toContain("Maximum pause limit of 1 month(s) reached");
  });

  // 15. Expired Active subscriptions are closed only when Plan.autoClose = true; the close is recorded in history.
  it("15. auto-closes expired ACTIVE subscriptions only when Plan.autoClose = true and logs history", async () => {
    const db = createTestDb();

    // Sub A: Plan 1 (autoClose = false)
    const subA = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-06-10T00:00:00Z"),
        expiryDate: new Date("2026-07-10T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: subA.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: subA.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: subA.id, toStatus: "ACTIVE" }, db);

    // Sub B: Plan 2 (autoClose = true)
    const subB = await createSubscription(
      {
        customerId: 1,
        planId: 2,
        startDate: new Date("2026-06-10T00:00:00Z"),
        expiryDate: new Date("2026-07-10T00:00:00Z"),
        lines: [{ productId: 10, quantity: 5 }],
      },
      db
    );
    await transitionSubscriptionStatus({ subscriptionId: subB.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: subB.id, toStatus: "CONFIRMED" }, db);
    await transitionSubscriptionStatus({ subscriptionId: subB.id, toStatus: "ACTIVE" }, db);

    // Run closeExpiredSubscriptions after both have expired (2026-08-01)
    const result = await closeExpiredSubscriptions(new Date("2026-08-01T00:00:00Z"), db);
    expect(result.closedCount).toBe(1);
    expect(result.closedIds).toEqual([subB.id]);

    const afterA = await getSubscriptionById(subA.id, {}, db);
    const afterB = await getSubscriptionById(subB.id, {}, db);
    expect(afterA.status).toBe("ACTIVE"); // Remains open because autoClose = false
    expect(afterB.status).toBe("CLOSED");
    expect(afterB.history.some((h: any) => h.note?.includes("ACTION:AUTO_CLOSED"))).toBe(true);
  });

  // 16. A quotation past quotationValidUntil is flagged Expired without changing the status enum.
  it("16. flags a quotation past quotationValidUntil as Expired without changing status enum", async () => {
    const db = createTestDb();
    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        quotationValidUntil: new Date("2026-07-15T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );

    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "QUOTATION" }, db);

    const fetchedAfterExpiry = await getSubscriptionById(
      sub.id,
      { asOfDate: new Date("2026-07-20T00:00:00Z") },
      db
    );
    expect(fetchedAfterExpiry.status).toBe("QUOTATION");
    expect(fetchedAfterExpiry.isQuotationExpired).toBe(true);
    expect(
      isQuotationExpired(
        fetchedAfterExpiry.status,
        fetchedAfterExpiry.quotationValidUntil,
        new Date("2026-07-10T00:00:00Z")
      )
    ).toBe(false);
  });

  // 17. Starting from a quotation template pre-fills the Draft and calculates its validity date.
  it("17. pre-fills Draft plan, lines, and quotationValidUntil when starting from a QuotationTemplate", async () => {
    const db = createTestDb();

    const sub = await createSubscription(
      {
        customerId: 1,
        templateId: 1, // Plan 1, validityDays: 15, 2 lines
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
      },
      db
    );

    expect(sub.planId).toBe(1);
    expect(sub.lines).toHaveLength(2);
    expect(sub.lines[0].productId).toBe(10);
    expect(sub.lines[0].variantId).toBe(101);
    expect(sub.lines[0].quantity).toBe(2);
    expect(sub.quotationValidUntil).toBeInstanceOf(Date);
  });

  // 18. A customer cannot list or read another customer's subscription.
  it("18. prevents a customer from listing or reading another customer's subscription", async () => {
    const db = createTestDb();

    // Sub belonging to Customer 1
    const subCust1 = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 10, quantity: 1 }],
      },
      db
    );

    // Sub belonging to Customer 2
    await createSubscription(
      {
        customerId: 2,
        planId: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        lines: [{ productId: 20, quantity: 1 }],
      },
      db
    );

    // Customer 2 tries to read Customer 1's subscription
    await expect(
      getSubscriptionById(subCust1.id, { enforceCustomerId: 2 }, db)
    ).rejects.toThrow(/Forbidden: You do not have access to this subscription/);

    // Customer 2 lists their own subscriptions -> only sees Customer 2's record
    const cust2List = await listSubscriptions({ customerId: 2 }, db);
    expect(cust2List.items).toHaveLength(1);
    expect(cust2List.items[0].customerId).toBe(2);
  });

  // 19. List filters and pagination return correct results.
  it("19. filters and paginates subscriptions accurately", async () => {
    const db = createTestDb();

    for (let i = 0; i < 4; i++) {
      await createSubscription(
        {
          customerId: i % 2 === 0 ? 1 : 2,
          planId: 1,
          startDate: new Date("2026-07-01T00:00:00Z"),
          expiryDate: new Date("2027-07-01T00:00:00Z"),
          lines: [{ productId: 10, quantity: 1 }],
        },
        db
      );
    }

    const page1 = await listSubscriptions({ page: 1, pageSize: 2 }, db);
    expect(page1.items).toHaveLength(2);
    expect(page1.pagination.total).toBe(4);
    expect(page1.pagination.totalPages).toBe(2);

    const searchAcme = await listSubscriptions({ search: "Acme" }, db);
    expect(searchAcme.items).toHaveLength(2);
    expect(searchAcme.items.every((s: any) => s.customer.name === "Acme Traders")).toBe(true);
  });

  // 20. Activation initializes nextInvoiceDate according to the agreed first-billing-date rule
  //     and exposes due active unpaused subscriptions to P4.
  it("20. initializes nextInvoiceDate on activation and satisfies P3-to-P4 billing read contract", async () => {
    const db = createTestDb();
    const startDate = new Date("2026-07-15T00:00:00Z");

    const sub = await createSubscription(
      {
        customerId: 1,
        planId: 1,
        startDate,
        expiryDate: new Date("2027-07-15T00:00:00Z"),
        lines: [{ productId: 10, variantId: 101, quantity: 2, taxId: 1 }],
      },
      db
    );

    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "QUOTATION" }, db);
    await transitionSubscriptionStatus({ subscriptionId: sub.id, toStatus: "CONFIRMED" }, db);
    const active = await transitionSubscriptionStatus(
      {
        subscriptionId: sub.id,
        toStatus: "ACTIVE",
        activationDate: new Date("2026-07-01T00:00:00Z"),
      },
      db
    );

    expect(active.nextInvoiceDate?.toISOString()).toBe(startDate.toISOString());

    // P4 queries due subscriptions as of 2026-07-15
    const dueForP4 = await getDueSubscriptionsForBilling(
      new Date("2026-07-15T12:00:00Z"),
      db
    );
    expect(dueForP4).toHaveLength(1);
    expect(dueForP4[0].number).toBe(sub.number);
    expect(dueForP4[0].isPaused).toBe(false);
    expect(dueForP4[0].lines[0].unitPrice.toString()).toBe("1560");
  });
});
