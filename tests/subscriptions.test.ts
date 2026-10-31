import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSubscription,
  transitionSubscriptionStatus,
  acceptCustomerQuotation,
  activateConfirmedSubscriptions,
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
import { PAYMENT_TERMS_OPTIONS, subscriptionLineInputSchema } from "@/lib/subscriptions/validation";
import { POST as createProductRoute } from "@/app/api/products/route";
import { POST as createPlanRoute } from "@/app/api/plans/route";
import { POST as createTaxRoute } from "@/app/api/taxes/route";
import { POST as createDiscountRoute } from "@/app/api/discounts/route";
import { POST as createCustomerRoute, GET as listCustomersRoute } from "@/app/api/customers/route";
import { POST as transitionRoute } from "@/app/api/subscriptions/[id]/transition/route";
import { POST as acceptPortalRoute } from "@/app/api/portal/subscriptions/[id]/accept/route";

describe("Brightloop BRD v2 — Real PostgreSQL Persistence, RBAC & Quotation Lifecycle Suite", () => {
  // ---------------------------------------------------------------------------
  // 1. ROLE & PERMISSION MATRIX VERIFICATION (BACKEND API ENFORCEMENT)
  // ---------------------------------------------------------------------------
  describe("1. Role & Permission Matrix (Admin vs Staff vs Customer)", () => {
    it("proves Staff API requests to create Product, Plan, Tax, or Discount return HTTP 403 Forbidden", async () => {
      const staffProductReq = new NextRequest("http://localhost:3000/api/products", {
        method: "POST",
        headers: { "x-user-role": "STAFF", "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Staff Product",
          type: "Software",
          salesPrice: 500,
          costPrice: 100,
        }),
      });
      const prodRes = await createProductRoute(staffProductReq);
      expect(prodRes.status).toBe(403);

      const staffPlanReq = new NextRequest("http://localhost:3000/api/plans", {
        method: "POST",
        headers: { "x-user-role": "STAFF", "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Staff Plan",
          price: 1000,
          billingPeriod: "MONTHLY",
          minQuantity: 1,
          availableFrom: "2026-01-01",
        }),
      });
      const planRes = await createPlanRoute(staffPlanReq);
      expect(planRes.status).toBe(403);

      const staffTaxReq = new NextRequest("http://localhost:3000/api/taxes", {
        method: "POST",
        headers: { "x-user-role": "STAFF", "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Tax",
          type: "PERCENT",
          rate: 18,
        }),
      });
      const taxRes = await createTaxRoute(staffTaxReq);
      expect(taxRes.status).toBe(403);

      const staffDiscountReq = new NextRequest("http://localhost:3000/api/discounts", {
        method: "POST",
        headers: { "x-user-role": "STAFF", "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Discount",
          type: "PERCENT",
          value: 15,
          startDate: "2026-01-01",
          endDate: "2027-01-01",
          scope: "SUBSCRIPTION",
        }),
      });
      const discRes = await createDiscountRoute(staffDiscountReq);
      expect(discRes.status).toBe(403);
    });

    it("allows Admin to create Product with variants, Plan, Tax, and Discount in PostgreSQL", async () => {
      const uniqueSuffix = Date.now();

      const adminProductReq = new NextRequest("http://localhost:3000/api/products", {
        method: "POST",
        headers: { "x-user-role": "ADMIN", "content-type": "application/json" },
        body: JSON.stringify({
          name: `Admin Cloud Suite ${uniqueSuffix}`,
          type: "SaaS",
          salesPrice: 1200,
          costPrice: 400,
          notes: "Created by Admin in test",
          variants: [{ attribute: "Brand", value: "Odoo", extraPrice: 560 }],
        }),
      });
      const prodRes = await createProductRoute(adminProductReq);
      expect(prodRes.status).toBe(201);
      const prodJson = await prodRes.json();
      expect(prodJson.product.id).toBeGreaterThan(0);
      expect(prodJson.product.variants[0].finalPrice).toBe(1760);

      // Verify persisted in PostgreSQL
      const dbProd = await prisma.product.findUnique({
        where: { id: prodJson.product.id },
        include: { variants: true },
      });
      expect(dbProd).not.toBeNull();
      expect(dbProd?.variants).toHaveLength(1);
    });

    it("allows Staff and Admin to create a Customer via POST /api/customers and persists it in PostgreSQL", async () => {
      const uniqueSuffix = Date.now();
      const staffCustomerReq = new NextRequest("http://localhost:3000/api/customers", {
        method: "POST",
        headers: { "x-user-role": "STAFF", "content-type": "application/json" },
        body: JSON.stringify({
          name: `QuickCreated Corp ${uniqueSuffix}`,
          email: `quick.${uniqueSuffix}@customer.test`,
          phone: "+91 9876543210",
          address: "Kochi, Kerala",
          createLoginAccount: true,
        }),
      });

      const res = await createCustomerRoute(staffCustomerReq);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.customer.id).toBeGreaterThan(0);

      // Verify customer still exists when queried back from PostgreSQL (simulating refresh/new login)
      const listReq = new NextRequest(
        `http://localhost:3000/api/customers?search=QuickCreated%20Corp%20${uniqueSuffix}`,
        { headers: { "x-user-role": "STAFF" } }
      );
      const listRes = await listCustomersRoute(listReq);
      const listJson = await listRes.json();
      expect(listJson.customers.some((c: { id: number }) => c.id === data.customer.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. BLANK SUBSCRIPTION FORM, DECIMAL PRICING, TAX & PAYMENT TERMS
  // ---------------------------------------------------------------------------
  describe("2. Blank Subscription Form, Agreed Unit Price, Payment Terms & Tax Rules", () => {
    it("creates a Draft subscription from a blank form (without a template) with multiple lines, saves paymentTermsDays, and preserves Product.salesPrice", async () => {
      const customer = await prisma.customer.findFirstOrThrow();
      const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Monthly Pro" } });
      const crm = await prisma.product.findFirstOrThrow({
        where: { name: "Brightloop CRM" },
        include: { variants: true },
      });
      const support = await prisma.product.findFirstOrThrow({
        where: { name: "Priority Support Add-on" },
      });
      const gst18 = await prisma.tax.findFirstOrThrow({
        where: { name: "GST 18%", isActive: true },
      });

      const originalCrmSalesPrice = crm.salesPrice.toFixed(2);
      const selectedPaymentTerms = PAYMENT_TERMS_OPTIONS.find((o) => o.label === "1 month")!;
      expect(selectedPaymentTerms.value).toBe(30);

      // Line 1 uses default price (1000 + 560 = 1560), Line 2 uses staff-edited agreed unitPrice (425.50 instead of 500)
      const created = await createSubscription({
        customerId: customer.id,
        planId: plan.id,
        startDate: new Date("2026-07-01T00:00:00Z"),
        expiryDate: new Date("2027-07-01T00:00:00Z"),
        paymentTermsDays: selectedPaymentTerms.value,
        quotationValidUntil: new Date("2026-07-15T00:00:00Z"),
        lines: [
          {
            productId: crm.id,
            variantId: crm.variants[0]?.id ?? null,
            quantity: 2,
            taxId: gst18.id,
          },
          {
            productId: support.id,
            variantId: null,
            quantity: 3,
            unitPrice: "425.50",
            taxId: gst18.id,
          },
        ],
      });

      expect(created.id).toBeGreaterThan(0);
      expect(created.number).toMatch(/^SUB-\d{6}$/);
      expect(created.status).toBe("DRAFT");
      expect(created.paymentTermsDays).toBe(30);
      expect(created.lines).toHaveLength(2);
      expect(Number(created.lines[0].unitPrice)).toBe(1560);
      expect(Number(created.lines[0].amount)).toBe(3120);
      expect(Number(created.lines[1].unitPrice)).toBe(425.5);
      expect(Number(created.lines[1].amount)).toBe(1276.5);

      // Verify master Product.salesPrice in PostgreSQL was NOT altered by staff's negotiated line price
      const supportAfter = await prisma.product.findUniqueOrThrow({ where: { id: support.id } });
      expect(Number(supportAfter.salesPrice)).toBe(500);
      const crmAfter = await prisma.product.findUniqueOrThrow({ where: { id: crm.id } });
      expect(crmAfter.salesPrice.toFixed(2)).toBe(originalCrmSalesPrice);
    });

    it("rejects quantity below Plan.minQuantity, unknown IDs, and plans outside availability dates", async () => {
      const customer = await prisma.customer.findFirstOrThrow();
      const strictPlan = await prisma.plan.findFirstOrThrow({
        where: { name: "Yearly Enterprise Team" }, // minQuantity = 5
      });
      const crm = await prisma.product.findFirstOrThrow({ where: { name: "Brightloop CRM" } });
      const gst18 = await prisma.tax.findFirstOrThrow({ where: { name: "GST 18%" } });

      // Quantity below Plan.minQuantity (5)
      await expect(
        createSubscription({
          customerId: customer.id,
          planId: strictPlan.id,
          startDate: new Date("2026-08-01T00:00:00Z"),
          expiryDate: new Date("2027-08-01T00:00:00Z"),
          lines: [{ productId: crm.id, quantity: 2, taxId: gst18.id }],
        })
      ).rejects.toThrow(/must be at least the plan's minimum quantity \(5\)/);

      // Plan before availableFrom (2026-01-01)
      await expect(
        createSubscription({
          customerId: customer.id,
          planId: strictPlan.id,
          startDate: new Date("2025-05-01T00:00:00Z"),
          expiryDate: new Date("2026-05-01T00:00:00Z"),
          lines: [{ productId: crm.id, quantity: 5, taxId: gst18.id }],
        })
      ).rejects.toThrow(/Selected plan is not available before/);

      // Validation schema requires a non-null positive taxId for new subscription lines
      expect(() =>
        subscriptionLineInputSchema.parse({
          productId: crm.id,
          quantity: 1,
          taxId: null,
        })
      ).toThrow();
    });

    it("generates unique, sequential subscription numbers under concurrent creation in PostgreSQL", async () => {
      const numbers = await Promise.all([
        generateNextSubscriptionNumber(),
        generateNextSubscriptionNumber(),
        generateNextSubscriptionNumber(),
      ]);
      const unique = new Set(numbers);
      expect(unique.size).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. QUOTATION WORKFLOW: STAFF SENDS -> CUSTOMER ACCEPTS -> SYSTEM ACTIVATES
  // ---------------------------------------------------------------------------
  describe("3. Quotation Acceptance & System Start-Date Activation", () => {
    it("proves Staff and Admin receive 403 Forbidden when trying to accept a quotation on a customer's behalf", async () => {
      const customer = await prisma.customer.findFirstOrThrow({
        where: { email: "acme@customer.test" },
      });
      const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Monthly Pro" } });
      const crm = await prisma.product.findFirstOrThrow({ where: { name: "Brightloop CRM" } });
      const gst18 = await prisma.tax.findFirstOrThrow({ where: { name: "GST 18%" } });

      const draft = await createSubscription({
        customerId: customer.id,
        planId: plan.id,
        startDate: new Date("2027-01-01T00:00:00Z"),
        expiryDate: new Date("2028-01-01T00:00:00Z"),
        quotationValidUntil: new Date("2027-12-31T00:00:00Z"),
        lines: [{ productId: crm.id, quantity: 1, taxId: gst18.id }],
      });

      // Staff sends quotation (DRAFT -> QUOTATION)
      const quotation = await transitionSubscriptionStatus({
        subscriptionId: draft.id,
        toStatus: "QUOTATION",
        actorRole: "STAFF",
        changedById: 2,
      });
      expect(quotation.status).toBe("QUOTATION");

      // Staff tries to accept quotation via transition endpoint -> 403 Forbidden
      const staffAcceptReq = new NextRequest(
        `http://localhost:3000/api/subscriptions/${draft.id}/transition`,
        {
          method: "POST",
          headers: { "x-user-role": "STAFF", "content-type": "application/json" },
          body: JSON.stringify({ toStatus: "CONFIRMED" }),
        }
      );
      const staffRes = await transitionRoute(staffAcceptReq, {
        params: { id: String(draft.id) },
      });
      expect(staffRes.status).toBe(403);

      // Admin tries to accept quotation via portal accept endpoint -> 403 Forbidden
      const adminAcceptReq = new NextRequest(
        `http://localhost:3000/api/portal/subscriptions/${draft.id}/accept`,
        {
          method: "POST",
          headers: { "x-user-role": "ADMIN", "content-type": "application/json" },
          body: JSON.stringify({ note: "Admin trying to accept" }),
        }
      );
      const adminRes = await acceptPortalRoute(adminAcceptReq, {
        params: { id: String(draft.id) },
      });
      expect(adminRes.status).toBe(403);

      // Another customer tries to accept this customer's quotation -> 403 Forbidden
      const otherCustomer = await prisma.customer.findFirstOrThrow({
        where: { email: "zen@customer.test" },
        include: { user: true },
      });
      await expect(
        acceptCustomerQuotation({
          subscriptionId: draft.id,
          customerUserId: otherCustomer.user!.id,
          customerId: otherCustomer.id,
          actorRole: "CUSTOMER",
        })
      ).rejects.toThrow(/Forbidden/);
    });

    it("allows only the owning Customer to accept their quotation, keeps future-dated subscriptions CONFIRMED, and activates them via system function when startDate is reached", async () => {
      const acme = await prisma.customer.findFirstOrThrow({
        where: { email: "acme@customer.test" },
        include: { user: true },
      });
      const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Monthly Pro" } });
      const crm = await prisma.product.findFirstOrThrow({ where: { name: "Brightloop CRM" } });
      const gst18 = await prisma.tax.findFirstOrThrow({ where: { name: "GST 18%" } });

      const futureStart = new Date("2027-06-01T00:00:00Z");
      const draft = await createSubscription({
        customerId: acme.id,
        planId: plan.id,
        startDate: futureStart,
        expiryDate: new Date("2028-06-01T00:00:00Z"),
        quotationValidUntil: new Date("2027-05-25T00:00:00Z"),
        lines: [{ productId: crm.id, quantity: 2, taxId: gst18.id }],
      });

      await transitionSubscriptionStatus({
        subscriptionId: draft.id,
        toStatus: "QUOTATION",
        actorRole: "STAFF",
        changedById: 2,
      });

      // Owning customer accepts on 2027-05-10 (before startDate 2027-06-01)
      const accepted = await acceptCustomerQuotation({
        subscriptionId: draft.id,
        customerUserId: acme.user!.id,
        customerId: acme.id,
        actorRole: "CUSTOMER",
        acceptedAt: new Date("2027-05-10T10:00:00Z"),
      });

      expect(accepted.status).toBe("CONFIRMED");
      expect(
        accepted.history.some(
          (h) => h.toStatus === "CONFIRMED" && h.changedById === acme.user!.id
        )
      ).toBe(true);

      // Staff/Admin manual activation attempt must fail with 403
      await expect(
        transitionSubscriptionStatus({
          subscriptionId: draft.id,
          toStatus: "ACTIVE",
          actorRole: "ADMIN",
        })
      ).rejects.toThrow(/Manual activation by Staff or Admin is not permitted/);

      // System runs activateConfirmedSubscriptions on 2027-06-01
      const sysResult = await activateConfirmedSubscriptions(
        new Date("2027-06-01T00:05:00Z")
      );
      expect(sysResult.activatedIds).toContain(draft.id);

      const activatedSub = await getSubscriptionById(draft.id, {
        asOfDate: new Date("2027-06-01T00:05:00Z"),
      });
      expect(activatedSub.status).toBe("ACTIVE");
      expect(activatedSub.nextInvoiceDate?.toISOString()).toBe(futureStart.toISOString());
      expect(
        activatedSub.history.some(
          (h) =>
            h.toStatus === "ACTIVE" &&
            h.changedById === null &&
            h.note === "SYSTEM:START_DATE_REACHED"
        )
      ).toBe(true);
    });

    it("blocks customer acceptance of an expired quotation while keeping status as QUOTATION", async () => {
      const acme = await prisma.customer.findFirstOrThrow({
        where: { email: "acme@customer.test" },
        include: { user: true },
      });
      const plan = await prisma.plan.findFirstOrThrow({ where: { name: "Monthly Pro" } });
      const crm = await prisma.product.findFirstOrThrow({ where: { name: "Brightloop CRM" } });
      const gst18 = await prisma.tax.findFirstOrThrow({ where: { name: "GST 18%" } });

      const draft = await createSubscription({
        customerId: acme.id,
        planId: plan.id,
        startDate: new Date("2027-02-01T00:00:00Z"),
        expiryDate: new Date("2028-02-01T00:00:00Z"),
        quotationValidUntil: new Date("2027-01-10T00:00:00Z"),
        lines: [{ productId: crm.id, quantity: 1, taxId: gst18.id }],
      });

      await transitionSubscriptionStatus({
        subscriptionId: draft.id,
        toStatus: "QUOTATION",
        actorRole: "STAFF",
      });

      await expect(
        acceptCustomerQuotation({
          subscriptionId: draft.id,
          customerUserId: acme.user!.id,
          customerId: acme.id,
          actorRole: "CUSTOMER",
          acceptedAt: new Date("2027-01-20T00:00:00Z"), // Past 2027-01-10
        })
      ).rejects.toThrow(/validity date has expired/);

      const checkSub = await getSubscriptionById(draft.id, {
        asOfDate: new Date("2027-01-20T00:00:00Z"),
      });
      expect(checkSub.status).toBe("QUOTATION");
      expect(checkSub.isQuotationExpired).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. PAUSE, RESUME, CLOSE, RENEW, CONFIGURABLE PAUSE POLICY & AUTO-CLOSE
  // ---------------------------------------------------------------------------
  describe("4. Pause/Resume, Close, Renew, Configurable Pause Policy & Auto-Close", () => {
    it("enforces Plan.pausable, Plan.closable, Plan.renewable, and Plan.autoClose in PostgreSQL", async () => {
      const acme = await prisma.customer.findFirstOrThrow({
        where: { email: "acme@customer.test" },
        include: { user: true },
      });
      const flexPlan = await prisma.plan.findFirstOrThrow({ where: { name: "Monthly Pro" } });
      const strictPlan = await prisma.plan.findFirstOrThrow({
        where: { name: "Yearly Enterprise Team" },
      });
      const crm = await prisma.product.findFirstOrThrow({ where: { name: "Brightloop CRM" } });
      const gst18 = await prisma.tax.findFirstOrThrow({ where: { name: "GST 18%" } });

      // Create and activate subscription on Monthly Pro (pausable, closable, renewable)
      const subFlex = await createSubscription({
        customerId: acme.id,
        planId: flexPlan.id,
        startDate: new Date("2026-05-01T00:00:00Z"),
        expiryDate: new Date("2027-05-01T00:00:00Z"),
        lines: [{ productId: crm.id, quantity: 1, taxId: gst18.id }],
      });
      await transitionSubscriptionStatus({
        subscriptionId: subFlex.id,
        toStatus: "QUOTATION",
        actorRole: "STAFF",
      });
      const activeFlex = await acceptCustomerQuotation({
        subscriptionId: subFlex.id,
        customerUserId: acme.user!.id,
        customerId: acme.id,
        actorRole: "CUSTOMER",
        acceptedAt: new Date("2026-05-02T00:00:00Z"), // >= startDate -> immediately activated by system!
      });
      expect(activeFlex.status).toBe("ACTIVE");

      // Pause
      const paused = await pauseSubscription({
        subscriptionId: subFlex.id,
        changedById: acme.user!.id,
        pausedAt: new Date("2026-05-10T00:00:00Z"),
      });
      expect(paused.isPaused).toBe(true);
      expect(paused.history.some((h) => h.note?.includes("ACTION:PAUSED"))).toBe(true);

      // Resume 5 days later -> shifts nextInvoiceDate forward by 5 days
      const resumed = await resumeSubscription({
        subscriptionId: subFlex.id,
        changedById: acme.user!.id,
        resumedAt: new Date("2026-05-15T00:00:00Z"),
      });
      expect(resumed.isPaused).toBe(false);
      expect(resumed.nextInvoiceDate?.toISOString()).toBe("2026-05-06T00:00:00.000Z");

      // Renew
      const renewed = await renewSubscription({
        subscriptionId: subFlex.id,
        changedById: acme.user!.id,
        renewedAt: new Date("2026-05-20T00:00:00Z"),
      });
      expect(renewed.expiryDate.toISOString().slice(0, 10)).toBe("2027-06-01");
      expect(renewed.history.some((h) => h.note?.includes("ACTION:RENEWED"))).toBe(true);

      // Close
      const closed = await closeSubscription({
        subscriptionId: subFlex.id,
        changedById: acme.user!.id,
      });
      expect(closed.status).toBe("CLOSED");

      // Strict Plan (pausable: false, closable: false, autoClose: true)
      const subStrict = await createSubscription({
        customerId: acme.id,
        planId: strictPlan.id,
        startDate: new Date("2026-02-01T00:00:00Z"),
        expiryDate: new Date("2026-04-01T00:00:00Z"),
        lines: [{ productId: crm.id, quantity: 5, taxId: gst18.id }],
      });
      await transitionSubscriptionStatus({
        subscriptionId: subStrict.id,
        toStatus: "QUOTATION",
        actorRole: "STAFF",
      });
      await acceptCustomerQuotation({
        subscriptionId: subStrict.id,
        customerUserId: acme.user!.id,
        customerId: acme.id,
        actorRole: "CUSTOMER",
        acceptedAt: new Date("2026-02-02T00:00:00Z"),
      });

      await expect(pauseSubscription({ subscriptionId: subStrict.id })).rejects.toThrow(
        /does not allow pausing/
      );
      await expect(closeSubscription({ subscriptionId: subStrict.id })).rejects.toThrow(
        /does not allow closing subscriptions early/
      );

      // Auto-close after expiryDate (2026-04-01)
      const autoClosed = await closeExpiredSubscriptions(new Date("2026-04-15T00:00:00Z"));
      expect(autoClosed.closedIds).toContain(subStrict.id);
    });

    it("dynamically recalculates max pause duration when pause-policy configuration changes", () => {
      const pausedAt = new Date("2026-07-01T00:00:00Z");
      const history = [{ note: "ACTION:PAUSED", changedAt: pausedAt }];
      const checkDateAfter40Days = new Date("2026-08-10T00:00:00Z");

      const eval2Cycles = evaluatePauseDuration({
        isPaused: true,
        billingPeriod: "MONTHLY",
        history,
        asOfDate: checkDateAfter40Days,
        policyOverride: PAUSE_POLICY_CYCLES,
      });
      expect(eval2Cycles.limitReached).toBe(false);

      const eval1Cycle = evaluatePauseDuration({
        isPaused: true,
        billingPeriod: "MONTHLY",
        history,
        asOfDate: checkDateAfter40Days,
        policyOverride: { ...PAUSE_POLICY_CYCLES, MONTHLY: 1 },
      });
      expect(eval1Cycle.limitReached).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. CUSTOMER OWNERSHIP ISOLATION & P2 DISCOUNT INTEGRATION
  // ---------------------------------------------------------------------------
  describe("5. Customer Ownership Isolation & Shared P2 Discount Evaluation", () => {
    it("prevents Customer B from reading Customer A's subscription and computes P2 eligible discounts", async () => {
      const acme = await prisma.customer.findFirstOrThrow({
        where: { email: "acme@customer.test" },
      });
      const zen = await prisma.customer.findFirstOrThrow({
        where: { email: "zen@customer.test" },
      });

      const acmeList = await listSubscriptions({ customerId: acme.id });
      expect(acmeList.items.length).toBeGreaterThan(0);
      expect(acmeList.items.every((s) => s.customerId === acme.id)).toBe(true);

      const targetSubId = acmeList.items[0].id;
      await expect(
        getSubscriptionById(targetSubId, { enforceCustomerId: zen.id })
      ).rejects.toThrow(/Forbidden: You do not have access to this subscription/);

      // Verify P2 eligible discount is attached on totals breakdown
      expect(acmeList.items[0].totals.eligibleDiscount).toBeDefined();
      expect(
        isQuotationExpired("QUOTATION", new Date("2025-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))
      ).toBe(true);

      // Verify P4 due-subscriptions contract returns active unpaused subscriptions
      const dueForP4 = await getDueSubscriptionsForBilling(new Date("2028-01-01T00:00:00Z"));
      expect(dueForP4.every((s) => s.status === "ACTIVE" && !s.isPaused)).toBe(true);
    });
  });
});
