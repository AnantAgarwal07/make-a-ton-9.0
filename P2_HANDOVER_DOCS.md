# Brightloop — P2 Catalog & Pricing Configuration Handover Documentation

**Owner:** P2 – Sumit (Catalog and Pricing Configuration)  
**Branch:** `p2/catalog-pricing`  
**Stack:** Next.js 14 (App Router), TypeScript, Prisma ORM, Neon PostgreSQL, Tailwind CSS

---

## 1. Executive Overview

Module **P2 (Catalog and Pricing Configuration)** is fully implemented and tested. It provides:
1. **Product Management** — Full CRUD, search, filtering, margin calculation, and soft-archiving (`isArchived`) to preserve historical subscriptions and invoices.
2. **Product Variant Management** — Multi-variant support per product (`attribute`, `value`, `extraPrice`) with deterministic final price calculation:
   $$\text{Final Unit Price} = \text{Product.salesPrice} + \text{ProductVariant.extraPrice}$$
3. **Subscription Plan Management** — Supports `DAILY`, `WEEKLY`, `MONTHLY`, and `YEARLY` billing periods, availability date validation (`availableFrom` / `availableTo`), minimum quantity validation, and all four P3 lifecycle boolean flags (`autoClose`, `closable`, `pausable`, `renewable`).
4. **Tax Configuration & Pure Calculation Engine (`calculateTax`)** — Supports `PERCENT`, `FIXED`, and zero/inactive taxes across multiple lines with 2-decimal half-up currency rounding.
5. **Discount Configuration & Pure Eligibility Engine (`findApplicableDiscounts`)** — Supports `FIXED` and `PERCENT` discounts, `PRODUCT` and `SUBSCRIPTION` scopes, minimum purchase/quantity thresholds, date windows, usage limits, and a documented non-stacking default (`NON_STACKING_HIGHEST_BENEFIT`).
6. **Quotation Template Management & Subscription Draft Generator (`POST /quotation-templates/:id/use`)** — Reusable bundles of Plan + Products + Variants + Quantities + Validity Days that generate a pre-filled subscription draft payload for P3.

---

## 2. P2 → P3 Handover Contracts (Subscriptions & Billing)

### Phase 1 Handover: Subscription Plan Model & Lifecycle Flags
Import from `@/lib/catalog`:
```ts
import { validatePlanAvailability, calculatePlanCycleEndDate, serializePlan } from "@/lib/catalog";
```
Every Plan returned by `/api/plans` or `/api/plans/:id` preserves the 4 boolean lifecycle flags required by P3:
- `autoClose: boolean`
- `closable: boolean`
- `pausable: boolean`
- `renewable: boolean`

Use `validatePlanAvailability(plan, referenceDate, requestedQuantity)` before creating a new subscription to verify that `referenceDate` falls within `[availableFrom, availableTo]` and `requestedQuantity >= plan.minQuantity`.

---

### Phase 2 Handover A: Pure Tax Calculation (`calculateTax`)
Import directly in TypeScript or call `POST /api/taxes/calculate`:
```ts
import { calculateTax } from "@/lib/catalog";

const result = calculateTax([
  {
    id: 1,
    productId: 101,
    quantity: 2,
    unitPrice: 1560,
    tax: { id: 1, name: "GST 18%", type: "PERCENT", rate: 18, isActive: true },
  },
  {
    id: 2,
    productId: 102,
    quantity: 1,
    unitPrice: 500,
    tax: { id: 2, name: "Regulatory Fee", type: "FIXED", rate: 75, isActive: true },
  },
]);
```
**Return Structure (`TaxCalculationResult`):**
- `result.lines`: Per-line breakdown (`taxableAmount`, `taxAmount`, `lineTotal`, `taxType`, `taxRate`)
- `result.lineTaxes`: `number[]` (per-line tax amounts in input order)
- `result.subtotal`: `number` (sum of line taxable amounts, rounded to 2 decimal places)
- `result.totalTax`: `number` (sum of per-line taxes, rounded to 2 decimal places)
- `result.grandTotal`: `number` (`subtotal + totalTax`, rounded to 2 decimal places)
- **Pure Function Guarantee:** Zero database writes or side effects. Throws `TaxCalculationError` on invalid/negative inputs.

---

### Phase 2 Handover B: Pure Discount Eligibility (`findApplicableDiscounts`)
Import directly in TypeScript or call `POST /api/discounts/evaluate`:
```ts
import { findApplicableDiscounts } from "@/lib/catalog";

const evaluation = findApplicableDiscounts(subscription, new Date(), candidateDiscounts);
// Note: candidateDiscounts can be passed as the 3rd argument OR attached as `subscription.discounts`
```
**Validation Rules Enforced:**
1. `isActive === true`
2. `startDate <= date <= endDate`
3. `usageLimit === null || timesUsed < usageLimit`
4. `scope === "SUBSCRIPTION"` (applies to full subscription subtotal/quantity) vs `scope === "PRODUCT"` (applies only to matching product lines in `DiscountProduct`)
5. `minPurchase` and `minQuantity` thresholds

**Team Stacking Policy (`NON_STACKING_HIGHEST_BENEFIT`):**
- Discounts do **not** stack by default.
- Among all eligible discounts, `findApplicableDiscounts` calculates the exact monetary benefit (`discountAmount`) for each and selects the single discount that provides the **highest monetary savings** (`evaluation.bestDiscount` / `evaluation.stackingResult.selectedDiscount`).
- **Pure Function Guarantee:** Does **not** mutate database state or increment `timesUsed`. P3 should increment `timesUsed` inside its billing transaction only when a subscription/invoice is finalized.

---

### Additional Handover: Quotation Template to Subscription Draft Endpoint
**Endpoint:** `POST /quotation-templates/:id/use` (also available at `POST /api/quotation-templates/:id/use`)  
**Allowed Roles:** `ADMIN`, `STAFF`  
**Optional Request Body:**
```json
{
  "customerId": 1,
  "referenceDate": "2026-10-31T00:00:00.000Z",
  "defaultTaxId": 1
}
```
**Response Payload (`200 OK`):**
```json
{
  "template": {
    "id": 1,
    "name": "Enterprise Package",
    "planId": 1,
    "validityDays": 15
  },
  "plan": {
    "id": 1,
    "name": "Monthly Pro",
    "price": 1000,
    "billingPeriod": "MONTHLY",
    "minQuantity": 1,
    "autoClose": false,
    "closable": true,
    "pausable": true,
    "renewable": true,
    "isCurrentlyAvailable": true
  },
  "lines": [
    {
      "productId": 1,
      "productName": "Brightloop CRM",
      "productType": "Software",
      "baseSalesPrice": 1000,
      "variantId": 1,
      "variantAttribute": "Brand",
      "variantValue": "Odoo",
      "variantExtraPrice": 560,
      "quantity": 2,
      "unitPrice": 1560,
      "amount": 3120,
      "taxId": null
    }
  ],
  "subtotal": 3120,
  "planPrice": 1000,
  "estimatedCycleTotal": 4120,
  "totalQuantity": 2,
  "quotationValidUntil": "2026-11-15T00:00:00.000Z",
  "subscriptionDraft": {
    "templateId": 1,
    "templateName": "Enterprise Package",
    "customerId": 1,
    "planId": 1,
    "status": "DRAFT",
    "startDate": "2026-10-31T00:00:00.000Z",
    "expiryDate": "2026-11-30T00:00:00.000Z",
    "quotationValidUntil": "2026-11-15T00:00:00.000Z",
    "validityDays": 15,
    "lines": [ ... ],
    "subtotal": 3120,
    "planPrice": 1000,
    "estimatedCycleTotal": 4120,
    "totalQuantity": 2
  }
}
```

---

## 3. P1 Authentication & Authorization Integration (`src/lib/auth.ts`)

P2 enforces backend role-based access control on every API route via `requireRole(req, allowedRoles)` in `src/lib/auth.ts`:

| Resource / Operation | `ADMIN` | `STAFF` | `CUSTOMER` |
| :--- | :---: | :---: | :---: |
| **Products Read (`GET /api/products`)** | ✅ | ✅ | ❌ (`403`) |
| **Products Write / Archive (`POST/PUT/DELETE /api/products`)** | ✅ | ❌ (`403`) | ❌ (`403`) |
| **Product Variants (`GET/POST/PUT/DELETE /api/products/:id/variants`)** | ✅ | ❌ (`403`) | ❌ (`403`) |
| **Plans Read (`GET /api/plans`)** | ✅ | ✅ | ❌ (`403`) |
| **Plans Write (`POST/PUT/DELETE /api/plans`)** | ✅ | ❌ (`403`) | ❌ (`403`) |
| **Taxes (`GET/POST/PUT/DELETE /api/taxes`)** | ✅ | ❌ (`403`) | ❌ (`403`) |
| **Discounts (`GET/POST/PUT/DELETE /api/discounts`)** | ✅ | ❌ (`403`) | ❌ (`403`) |
| **Quotation Templates (`GET/POST/PUT /api/quotation-templates`)** | ✅ | ✅ | ❌ (`403`) |
| **Use Quotation Template (`POST /quotation-templates/:id/use`)** | ✅ | ✅ | ❌ (`403`) |

**How P1 Integrates:**
`resolveAuthUser(req)` automatically reads:
1. Headers set by P1 middleware or API callers (`x-user-role`, `x-user-email`, `x-user-id`)
2. Session cookies (`brightloop_role`, `user_role`)
3. Database lookup against `prisma.user` when `x-user-email` is provided or via `POST /api/auth/session` with `{ email, password }`.

