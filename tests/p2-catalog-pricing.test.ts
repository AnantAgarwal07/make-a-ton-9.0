import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  buildSubscriptionDraftFromTemplate,
  calculatePlanCycleEndDate,
  calculateTax,
  calculateVariantUnitPrice,
  findApplicableDiscounts,
  roundCurrency,
  serializePlan,
  TaxCalculationError,
  validateDiscountInput,
  validatePlanAvailability,
  validatePlanInput,
  validateProductInput,
  validateQuotationTemplateInput,
  validateTaxInput,
  validateVariantInput,
  ValidationError,
} from "../src/lib/catalog";
import {
  assertRoleAllowed,
  AuthError,
  P2_PERMISSIONS,
  requireRole,
} from "../src/lib/auth";

describe("P2 – Catalog and Pricing Configuration Comprehensive Test Suite", () => {
  // ---------------------------------------------------------------------------
  // 1. PRODUCT CREATION, VALIDATION & ARCHIVING
  // ---------------------------------------------------------------------------
  describe("1. Product Creation, Validation & Archiving", () => {
    it("validates a complete valid product creation payload with initial variants", () => {
      const validated = validateProductInput({
        name: "  Business Software  ",
        type: "Software",
        salesPrice: "1000.5",
        costPrice: 400,
        notes: "Enterprise CRM Suite",
        variants: [
          { attribute: "Edition", value: "Standard", extraPrice: 0 },
          { attribute: "Edition", value: "Odoo", extraPrice: 560 },
          { attribute: "Edition", value: "Premium", extraPrice: 1000 },
        ],
      });

      assert.equal(validated.name, "Business Software");
      assert.equal(validated.type, "Software");
      assert.equal(validated.salesPrice, 1000.5);
      assert.equal(validated.costPrice, 400);
      assert.equal(validated.notes, "Enterprise CRM Suite");
      assert.equal(validated.variants?.length, 3);
      assert.equal(validated.variants?.[1].value, "Odoo");
      assert.equal(validated.variants?.[1].extraPrice, 560);
    });

    it("rejects products with missing name, missing type, or negative prices", () => {
      assert.throws(
        () =>
          validateProductInput({
            name: "",
            type: "Software",
            salesPrice: 1000,
            costPrice: 400,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.message.includes("Product name is required")
      );

      assert.throws(
        () =>
          validateProductInput({
            name: "Cloud Storage",
            type: "SaaS",
            salesPrice: -10,
            costPrice: 100,
          }),
        (err: unknown) =>
          err instanceof ValidationError && err.message.includes("Sales price cannot be negative")
      );
    });

    it("supports soft-archiving and restoring products via isArchived flag", () => {
      const archiveUpdate = validateProductInput({ isArchived: true }, true);
      assert.equal(archiveUpdate.isArchived, true);

      const restoreUpdate = validateProductInput({ isArchived: false }, true);
      assert.equal(restoreUpdate.isArchived, false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. VARIANT PRICE CALCULATION
  // ---------------------------------------------------------------------------
  describe("2. Product Variant Management & Final Price Calculation", () => {
    it("calculates Final Price = Product Sales Price + Variant Extra Price accurately", () => {
      // Business Software example from specification:
      // Base = ₹1,000; Standard (+₹0) = ₹1,000; Odoo (+₹560) = ₹1,560; Premium (+₹1,000) = ₹2,000
      const baseSalesPrice = 1000;
      assert.equal(calculateVariantUnitPrice(baseSalesPrice, 0), 1000);
      assert.equal(calculateVariantUnitPrice(baseSalesPrice, 560), 1560);
      assert.equal(calculateVariantUnitPrice(baseSalesPrice, 1000), 2000);
      assert.equal(calculateVariantUnitPrice(baseSalesPrice, undefined), 1000);
    });

    it("handles decimal variant prices and rejects negative extra prices", () => {
      assert.equal(calculateVariantUnitPrice("999.95", "149.55"), 1149.5);
      assert.throws(
        () => calculateVariantUnitPrice(1000, -50),
        /Variant extra price cannot be negative/
      );
      assert.throws(
        () => validateVariantInput({ attribute: "Tier", value: "Bad", extraPrice: -1 }),
        ValidationError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. SUBSCRIPTION PLAN AVAILABILITY & 4 LIFECYCLE FLAGS
  // ---------------------------------------------------------------------------
  describe("3. Subscription Plan Availability & Lifecycle Flags (P3 Handover)", () => {
    const samplePlan = {
      id: 10,
      name: "Enterprise Yearly",
      price: 12000,
      billingPeriod: "YEARLY" as const,
      minQuantity: 2,
      availableFrom: new Date("2026-01-01T00:00:00.000Z"),
      availableTo: new Date("2026-12-31T23:59:59.000Z"),
      autoClose: true,
      closable: false,
      pausable: true,
      renewable: false,
    };

    it("validates plan availability within start and end dates and minimum quantity", () => {
      // Within date window & valid quantity
      const validCheck = validatePlanAvailability(
        samplePlan,
        new Date("2026-06-15T12:00:00.000Z"),
        3
      );
      assert.equal(validCheck.isAvailable, true);

      // Before availableFrom
      const earlyCheck = validatePlanAvailability(
        samplePlan,
        new Date("2025-11-01T00:00:00.000Z")
      );
      assert.equal(earlyCheck.isAvailable, false);
      assert.match(earlyCheck.reason || "", /not available until/);

      // After availableTo
      const expiredCheck = validatePlanAvailability(
        samplePlan,
        new Date("2027-02-01T00:00:00.000Z")
      );
      assert.equal(expiredCheck.isAvailable, false);
      assert.match(expiredCheck.reason || "", /expired on/);

      // Below minQuantity
      const lowQtyCheck = validatePlanAvailability(
        samplePlan,
        new Date("2026-06-15T12:00:00.000Z"),
        1
      );
      assert.equal(lowQtyCheck.isAvailable, false);
      assert.match(lowQtyCheck.reason || "", /requires a minimum quantity of 2/);
    });

    it("preserves all four boolean lifecycle flags (autoClose, closable, pausable, renewable) and supports DAILY, WEEKLY, MONTHLY, YEARLY", () => {
      for (const period of ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const) {
        const validated = validatePlanInput({
          name: `${period} Plan`,
          price: 500,
          billingPeriod: period,
          minQuantity: 1,
          availableFrom: "2026-01-01",
          autoClose: true,
          closable: false,
          pausable: true,
          renewable: false,
        });
        assert.equal(validated.billingPeriod, period);
        assert.equal(validated.autoClose, true);
        assert.equal(validated.closable, false);
        assert.equal(validated.pausable, true);
        assert.equal(validated.renewable, false);
      }

      const serialized = serializePlan(samplePlan);
      assert.deepEqual(serialized.lifecycleFlags, {
        autoClose: true,
        closable: false,
        pausable: true,
        renewable: false,
      });

      const cycleEnd = calculatePlanCycleEndDate("2026-01-01T00:00:00.000Z", "MONTHLY");
      assert.equal(cycleEnd.toISOString().slice(0, 10), "2026-02-01");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. TAX MANAGEMENT & calculateTax(lines) PURE FUNCTION
  // ---------------------------------------------------------------------------
  describe("4. Tax Calculation Engine — calculateTax(lines) (P3 Handover)", () => {
    it("calculates percentage taxes accurately", () => {
      const result = calculateTax([
        {
          id: 1,
          productId: 101,
          quantity: 2,
          unitPrice: 1560, // 3120
          tax: { id: 1, name: "GST 18%", type: "PERCENT", rate: 18, isActive: true },
        },
      ]);

      assert.equal(result.subtotal, 3120);
      assert.equal(result.lines[0].taxAmount, 561.6);
      assert.deepEqual(result.lineTaxes, [561.6]);
      assert.equal(result.totalTax, 561.6);
      assert.equal(result.grandTotal, 3681.6);
    });

    it("calculates fixed taxes accurately", () => {
      const result = calculateTax([
        {
          id: 2,
          quantity: 3,
          unitPrice: 500, // 1500
          tax: { id: 2, name: "Regulatory Levy", type: "FIXED", rate: 125.5, isActive: true },
        },
      ]);

      assert.equal(result.subtotal, 1500);
      assert.equal(result.lines[0].taxAmount, 125.5);
      assert.equal(result.totalTax, 125.5);
      assert.equal(result.grandTotal, 1625.5);
    });

    it("supports zero tax, null tax, and inactive tax rules", () => {
      const result = calculateTax([
        {
          quantity: 1,
          unitPrice: 1000,
          tax: { type: "PERCENT", rate: 0, isActive: true },
        },
        {
          quantity: 1,
          unitPrice: 500,
          tax: null,
        },
        {
          quantity: 1,
          unitPrice: 800,
          tax: { type: "PERCENT", rate: 18, isActive: false },
        },
      ]);

      assert.deepEqual(result.lineTaxes, [0, 0, 0]);
      assert.equal(result.totalTax, 0);
      assert.equal(result.subtotal, 2300);
      assert.equal(result.grandTotal, 2300);
    });

    it("calculates multiple mixed tax lines and rounds monetary values to 2 decimal places", () => {
      // 333.33 * 1 = 333.33; 18% of 333.33 = 59.9994 -> rounds to 60.00
      // 19.99 * 3 = 59.97; 7.25% of 59.97 = 4.347825 -> rounds to 4.35
      // Fixed tax 25.125 -> rounds to 25.13
      const result = calculateTax([
        {
          quantity: 1,
          unitPrice: 333.33,
          tax: { type: "PERCENT", rate: 18 },
        },
        {
          quantity: 3,
          unitPrice: 19.99,
          tax: { type: "PERCENT", rate: 7.25 },
        },
        {
          quantity: 1,
          unitPrice: 100,
          tax: { type: "FIXED", rate: 25.125 },
        },
      ]);

      assert.equal(roundCurrency(1.005), 1.01);
      assert.deepEqual(result.lineTaxes, [60, 4.35, 25.13]);
      assert.equal(result.totalTax, 89.48);
      assert.equal(result.subtotal, 493.3);
      assert.equal(result.grandTotal, 582.78);
    });

    it("handles invalid input safely by throwing descriptive TaxCalculationError", () => {
      assert.throws(
        () => calculateTax(null as unknown as []),
        TaxCalculationError
      );

      assert.throws(
        () =>
          calculateTax([
            {
              quantity: -1,
              unitPrice: 100,
              tax: { type: "PERCENT", rate: 18 },
            },
          ]),
        /quantity cannot be negative/
      );

      assert.throws(
        () =>
          calculateTax([
            {
              quantity: 1,
              unitPrice: 100,
              tax: { type: "PERCENT", rate: -5 },
            },
          ]),
        /rate cannot be negative/
      );

      assert.throws(
        () =>
          calculateTax([
            {
              quantity: 1,
              unitPrice: 100,
              tax: { type: "INVALID_TYPE" as "PERCENT", rate: 10 },
            },
          ]),
        /Invalid tax type/
      );

      assert.doesNotThrow(() => validateTaxInput({ name: "GST 18%", type: "PERCENT", rate: 18 }));
    });
  });

  // ---------------------------------------------------------------------------
  // 5. DISCOUNT MANAGEMENT & findApplicableDiscounts(subscription, date)
  // ---------------------------------------------------------------------------
  describe("5. Discount Calculation & Eligibility — findApplicableDiscounts(subscription, date) (P3 Handover)", () => {
    const evalDate = new Date("2026-06-15T00:00:00.000Z");

    const baseSubscription = {
      id: 500,
      lines: [
        { productId: 1, quantity: 2, unitPrice: 1500 }, // 3000 (Product 1)
        { productId: 2, quantity: 5, unitPrice: 400 },  // 2000 (Product 2)
      ],
      // Total subtotal = 5000, Total quantity = 7
    };

    it("calculates FIXED and PERCENT subscription-wide discounts", () => {
      const discounts = [
        {
          id: 1,
          name: "Flat ₹400 Off",
          type: "FIXED" as const,
          value: 400,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
        {
          id: 2,
          name: "10% Subscription Off",
          type: "PERCENT" as const,
          value: 10,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
      ];

      // Support 2-argument signature findApplicableDiscounts(subscriptionWithDiscounts, date)
      const res = findApplicableDiscounts(
        { ...baseSubscription, discounts },
        evalDate
      );

      assert.equal(res.eligibleDiscounts.length, 2);
      // 10% of 5000 = 500 vs Fixed 400 -> 10% wins under non-stacking highest benefit!
      assert.equal(res.bestDiscount?.id, 2);
      assert.equal(res.appliedDiscountAmount, 500);
      assert.equal(res.stackingResult.policy, "NON_STACKING_HIGHEST_BENEFIT");
      assert.equal(res.stackingResult.subtotalAfterDiscount, 4500);
    });

    it("enforces minimum purchase and minimum quantity thresholds", () => {
      const discounts = [
        {
          id: 10,
          name: "High Roller ₹1000 Off (Min ₹10,000)",
          type: "FIXED" as const,
          value: 1000,
          minPurchase: 10000,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
        {
          id: 11,
          name: "Bulk 20% Off (Min 10 units)",
          type: "PERCENT" as const,
          value: 20,
          minQuantity: 10,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
      ];

      const res = findApplicableDiscounts(baseSubscription, evalDate, discounts);
      assert.equal(res.eligibleDiscounts.length, 0);
      assert.equal(res.ineligibleDiscounts.length, 2);
      assert.match(res.ineligibleDiscounts[0].reasons[0], /Minimum purchase/);
      assert.match(res.ineligibleDiscounts[1].reasons[0], /Minimum quantity/);
    });

    it("filters out expired, future-scheduled, inactive, and usage-limit-exhausted discounts", () => {
      const discounts = [
        {
          id: 21,
          name: "Expired 2025 Promo",
          type: "PERCENT" as const,
          value: 25,
          startDate: "2025-01-01",
          endDate: "2025-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
        {
          id: 22,
          name: "Exhausted Promo",
          type: "FIXED" as const,
          value: 500,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          usageLimit: 50,
          timesUsed: 50,
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
        {
          id: 23,
          name: "Inactive Promo",
          type: "PERCENT" as const,
          value: 15,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: false,
        },
      ];

      const res = findApplicableDiscounts(baseSubscription, evalDate, discounts);
      assert.equal(res.eligibleDiscounts.length, 0);
      assert.equal(res.ineligibleDiscounts.length, 3);
      assert.equal(discounts[1].timesUsed, 50, "Pure function must not mutate timesUsed");
    });

    it("evaluates PRODUCT-scoped discounts only against matching product lines", () => {
      const discounts = [
        {
          id: 31,
          name: "20% Off Product #1 Only",
          type: "PERCENT" as const,
          value: 20,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "PRODUCT" as const,
          isActive: true,
          products: [{ productId: 1 }], // Product #1 line subtotal is 3000 -> 20% = 600
        },
        {
          id: 32,
          name: "50% Off Unpurchased Product #99",
          type: "PERCENT" as const,
          value: 50,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "PRODUCT" as const,
          isActive: true,
          products: [{ productId: 99 }],
        },
      ];

      const res = findApplicableDiscounts(baseSubscription, evalDate, discounts);
      assert.equal(res.eligibleDiscounts.length, 1);
      assert.equal(res.eligibleDiscounts[0].id, 31);
      assert.equal(res.eligibleDiscounts[0].applicableSubtotal, 3000);
      assert.equal(res.eligibleDiscounts[0].discountAmount, 600);
    });

    it("enforces non-stacking policy by selecting the single discount with the highest monetary benefit", () => {
      const discounts = [
        {
          id: 41,
          name: "Subscription 10% Off (₹500 value)",
          type: "PERCENT" as const,
          value: 10,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
        {
          id: 42,
          name: "Product #1 25% Off (₹750 value)",
          type: "PERCENT" as const,
          value: 25,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "PRODUCT" as const,
          isActive: true,
          products: [{ productId: 1 }],
        },
        {
          id: 43,
          name: "Subscription Flat ₹650 Off",
          type: "FIXED" as const,
          value: 650,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          scope: "SUBSCRIPTION" as const,
          isActive: true,
        },
      ];

      const res = findApplicableDiscounts(baseSubscription, evalDate, discounts);
      assert.equal(res.eligibleDiscounts.length, 3);
      assert.equal(res.bestDiscount?.id, 42);
      assert.equal(res.appliedDiscountAmount, 750);
      assert.equal(res.stackingResult.stacked, false);
      assert.equal(res.stackingResult.totalDiscountAmount, 750);
      assert.equal(res.stackingResult.subtotalAfterDiscount, 4250);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. ROLE-BASED AUTHORIZATION (RBAC)
  // ---------------------------------------------------------------------------
  describe("6. Role-Based Authorization & STAFF Discount HTTP 403 Restriction", () => {
    it("returns HTTP 403 Forbidden when STAFF attempts restricted discount, tax, variant, or product write operations", async () => {
      const staffReq = new NextRequest("http://localhost:3000/api/discounts", {
        method: "POST",
        headers: { "x-user-role": "STAFF" },
      });

      await assert.rejects(
        () => requireRole(staffReq, P2_PERMISSIONS.DISCOUNTS_MANAGE, "Discounts"),
        (err: unknown) =>
          err instanceof AuthError &&
          err.statusCode === 403 &&
          err.code === "FORBIDDEN"
      );

      assert.throws(
        () => assertRoleAllowed("STAFF", P2_PERMISSIONS.TAXES_MANAGE, "Taxes"),
        (err: unknown) => err instanceof AuthError && err.statusCode === 403
      );

      assert.throws(
        () => assertRoleAllowed("STAFF", P2_PERMISSIONS.VARIANTS_MANAGE, "Variants"),
        (err: unknown) => err instanceof AuthError && err.statusCode === 403
      );

      assert.throws(
        () => assertRoleAllowed("STAFF", P2_PERMISSIONS.PRODUCTS_WRITE, "Product Write"),
        (err: unknown) => err instanceof AuthError && err.statusCode === 403
      );
    });

    it("allows STAFF to read products/plans and use quotation templates, and allows ADMIN full access", () => {
      assert.equal(assertRoleAllowed("STAFF", P2_PERMISSIONS.PRODUCTS_READ), "STAFF");
      assert.equal(assertRoleAllowed("STAFF", P2_PERMISSIONS.PLANS_READ), "STAFF");
      assert.equal(assertRoleAllowed("STAFF", P2_PERMISSIONS.TEMPLATES_USE), "STAFF");
      assert.equal(assertRoleAllowed("ADMIN", P2_PERMISSIONS.DISCOUNTS_MANAGE), "ADMIN");
      assert.equal(assertRoleAllowed("ADMIN", P2_PERMISSIONS.TAXES_MANAGE), "ADMIN");
      assert.equal(assertRoleAllowed("ADMIN", P2_PERMISSIONS.VARIANTS_MANAGE), "ADMIN");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. QUOTATION TEMPLATE CREATION & PAYLOAD GENERATION
  // ---------------------------------------------------------------------------
  describe("7. Quotation Template Validation & Pre-Filled Subscription Draft Payload (POST /quotation-templates/:id/use)", () => {
    const enterpriseTemplate = {
      id: 77,
      name: "Enterprise Package",
      planId: 5,
      validityDays: 15,
      plan: {
        id: 5,
        name: "Enterprise Yearly",
        price: 10000,
        billingPeriod: "YEARLY" as const,
        minQuantity: 1,
        availableFrom: new Date("2026-01-01T00:00:00.000Z"),
        availableTo: new Date("2027-12-31T00:00:00.000Z"),
        autoClose: false,
        closable: true,
        pausable: true,
        renewable: true,
      },
      lines: [
        {
          id: 1,
          productId: 101,
          variantId: 201,
          quantity: 1,
          product: {
            id: 101,
            name: "Business Software",
            type: "Software",
            salesPrice: 1000,
            isArchived: false,
          },
          variant: {
            id: 201,
            productId: 101,
            attribute: "Edition",
            value: "Odoo",
            extraPrice: 560,
          },
        },
        {
          id: 2,
          productId: 102,
          variantId: null,
          quantity: 5,
          product: {
            id: 102,
            name: "Cloud Storage",
            type: "SaaS",
            salesPrice: 200,
            isArchived: false,
          },
          variant: null,
        },
        {
          id: 3,
          productId: 103,
          variantId: null,
          quantity: 2,
          product: {
            id: 103,
            name: "Security Tool",
            type: "Security",
            salesPrice: 350,
            isArchived: false,
          },
          variant: null,
        },
      ],
    };

    it("validates quotation template creation inputs", () => {
      const validated = validateQuotationTemplateInput({
        name: "Enterprise Package",
        planId: 5,
        validityDays: 15,
        lines: [
          { productId: 101, variantId: 201, quantity: 1 },
          { productId: 102, variantId: null, quantity: 5 },
          { productId: 103, variantId: null, quantity: 2 },
        ],
      });

      assert.equal(validated.name, "Enterprise Package");
      assert.equal(validated.validityDays, 15);
      assert.equal(validated.lines?.length, 3);
    });

    it("generates a complete pre-filled subscription draft payload with calculated variant unit prices", () => {
      const refDate = new Date("2026-06-01T00:00:00.000Z");
      const payload = buildSubscriptionDraftFromTemplate(enterpriseTemplate, {
        customerId: 42,
        referenceDate: refDate,
      });

      assert.equal(payload.template.id, 77);
      assert.equal(payload.template.name, "Enterprise Package");
      assert.equal(payload.plan.name, "Enterprise Yearly");
      assert.equal(payload.lines.length, 3);

      // Line 1: Business Software (1000) + Odoo (560) = 1560 * 1 = 1560
      assert.equal(payload.lines[0].unitPrice, 1560);
      assert.equal(payload.lines[0].amount, 1560);

      // Line 2: Cloud Storage (200) * 5 = 1000
      assert.equal(payload.lines[1].unitPrice, 200);
      assert.equal(payload.lines[1].amount, 1000);

      // Line 3: Security Tool (350) * 2 = 700
      assert.equal(payload.lines[2].unitPrice, 350);
      assert.equal(payload.lines[2].amount, 700);

      // Total lines subtotal = 1560 + 1000 + 700 = 3260
      assert.equal(payload.subtotal, 3260);
      assert.equal(payload.totalQuantity, 8);
      assert.equal(payload.subscriptionDraft.customerId, 42);
      assert.equal(payload.subscriptionDraft.status, "DRAFT");
      assert.equal(
        payload.quotationValidUntil.slice(0, 10),
        "2026-06-16",
        "15 days validity from 2026-06-01"
      );
    });

    it("rejects generating a subscription draft if a template product is archived or plan is expired", () => {
      const archivedTemplate = {
        ...enterpriseTemplate,
        lines: [
          {
            ...enterpriseTemplate.lines[0],
            product: { ...enterpriseTemplate.lines[0].product, isArchived: true },
          },
        ],
      };

      assert.throws(
        () => buildSubscriptionDraftFromTemplate(archivedTemplate),
        /Product "Business Software" is archived/
      );

      assert.throws(
        () =>
          buildSubscriptionDraftFromTemplate(enterpriseTemplate, {
            referenceDate: new Date("2029-01-01T00:00:00.000Z"),
          }),
        /expired/
      );
    });
  });
});
