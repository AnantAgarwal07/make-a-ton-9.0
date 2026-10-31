import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();

async function nextSub() {
  const c = await prisma.counter.upsert({
    where: { key: "SUB" },
    update: { value: { increment: 1 } },
    create: { key: "SUB", value: 1 },
  });
  return `SUB-${String(c.value).padStart(6, "0")}`;
}

async function ensurePlan(data: {
  name: string;
  price: number;
  billingPeriod: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  minQuantity: number;
  availableFrom: Date;
  availableTo?: Date | null;
  autoClose?: boolean;
  closable?: boolean;
  pausable?: boolean;
  renewable?: boolean;
}) {
  const existing = await prisma.plan.findFirst({ where: { name: data.name } });
  if (existing) return existing;
  return prisma.plan.create({ data });
}

async function ensureProduct(data: {
  name: string;
  type: string;
  salesPrice: number;
  costPrice: number;
  variants?: Array<{ attribute: string; value: string; extraPrice: number }>;
}) {
  const existing = await prisma.product.findFirst({
    where: { name: data.name },
    include: { variants: true },
  });
  if (existing) return existing;
  return prisma.product.create({
    data: {
      name: data.name,
      type: data.type,
      salesPrice: data.salesPrice,
      costPrice: data.costPrice,
      ...(data.variants && data.variants.length > 0
        ? { variants: { create: data.variants } }
        : {}),
    },
    include: { variants: true },
  });
}

async function main() {
  const pw = await bcrypt.hash("Admin@1234", 10);

  const staffUsers: Record<string, { id: number; email: string }> = {};
  for (const [email, role] of [
    ["admin@brightloop.test", "ADMIN"],
    ["staff@brightloop.test", "STAFF"],
  ] as const) {
    const u = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash: pw, role },
    });
    staffUsers[role] = u;
  }

  // P1 Customers: at least one business-style ("Acme Traders", "Zen Studio") and one individual-style ("Aarav Sharma")
  const customers = [];
  for (const [name, email] of [
    ["Acme Traders", "acme@customer.test"],
    ["Zen Studio", "zen@customer.test"],
    ["Aarav Sharma", "aarav.sharma@customer.test"],
  ]) {
    let c = await prisma.customer.findFirst({ where: { name } });
    if (!c) {
      c = await prisma.customer.create({ data: { name, email } });
    }
    await prisma.user.upsert({
      where: { email },
      update: { customerId: c.id },
      create: { email, passwordHash: pw, role: "CUSTOMER", customerId: c.id },
    });
    customers.push(c);
  }

  // P2 Tax & Discount rules
  let tax = await prisma.tax.findFirst({ where: { name: "GST 18%" } });
  if (!tax) {
    tax = await prisma.tax.create({
      data: { name: "GST 18%", type: "PERCENT", rate: 18 },
    });
  }

  const existingDiscount = await prisma.discount.findFirst({
    where: { name: "Welcome 10%" },
  });
  if (!existingDiscount) {
    await prisma.discount.create({
      data: {
        name: "Welcome 10%",
        type: "PERCENT",
        value: 10,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2027-12-31"),
        usageLimit: 100,
        scope: "SUBSCRIPTION",
      },
    });
  }

  const existingFixedDiscount = await prisma.discount.findFirst({
    where: { name: "Enterprise Flat ₹1000 Off" },
  });
  if (!existingFixedDiscount) {
    await prisma.discount.create({
      data: {
        name: "Enterprise Flat ₹1000 Off",
        type: "FIXED",
        value: 1000,
        minPurchase: 3000,
        minQuantity: 2,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2027-12-31"),
        usageLimit: 50,
        scope: "SUBSCRIPTION",
      },
    });
  }

  // P2 Products: one with a priced variant, one without variants
  const crmProduct = await ensureProduct({
    name: "Brightloop CRM",
    type: "Software",
    salesPrice: 1000,
    costPrice: 400,
    variants: [{ attribute: "Brand", value: "Odoo", extraPrice: 560 }],
  });

  const supportProduct = await ensureProduct({
    name: "Priority Support Add-on",
    type: "Service",
    salesPrice: 500,
    costPrice: 150,
  });

  // P2 Plans:
  // 1) Monthly Pro (pausable, closable, renewable, minQty 1)
  const monthlyFlexPlan = await ensurePlan({
    name: "Monthly Pro",
    price: 1000,
    billingPeriod: "MONTHLY",
    minQuantity: 1,
    availableFrom: new Date("2026-01-01"),
    pausable: true,
    closable: true,
    renewable: true,
    autoClose: false,
  });

  // 2) Yearly Enterprise Team (yearly, minQuantity > 1, autoClose = true, non-pausable, non-closable early)
  const yearlyStrictPlan = await ensurePlan({
    name: "Yearly Enterprise Team",
    price: 10000,
    billingPeriod: "YEARLY",
    minQuantity: 5,
    availableFrom: new Date("2026-01-01"),
    pausable: false,
    closable: false,
    renewable: true,
    autoClose: true,
  });

  // P2 Quotation Template
  let template = await prisma.quotationTemplate.findFirst({
    where: { name: "Standard CRM Monthly Starter" },
  });
  if (!template) {
    template = await prisma.quotationTemplate.create({
      data: {
        name: "Standard CRM Monthly Starter",
        planId: monthlyFlexPlan.id,
        validityDays: 30,
        lines: {
          create: [
            {
              productId: crmProduct.id,
              variantId: crmProduct.variants[0]?.id ?? null,
              quantity: 2,
            },
            {
              productId: supportProduct.id,
              variantId: null,
              quantity: 1,
            },
          ],
        },
      },
    });
  }

  // P3 Subscriptions in each status (idempotent by checking specific seed notes or numbers)
  const existingSubCount = await prisma.subscription.count();
  if (existingSubCount === 0) {
    const now = new Date();
    const oneYearLater = new Date(now.getTime() + 365 * 86400000);
    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);

    // 1. ACTIVE unpaused subscription (Acme Traders)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[0].id,
        planId: monthlyFlexPlan.id,
        status: "ACTIVE",
        isPaused: false,
        startDate: now,
        expiryDate: oneYearLater,
        nextInvoiceDate: now,
        createdById: staffUsers.STAFF.id,
        lines: {
          create: [
            {
              productId: crmProduct.id,
              variantId: crmProduct.variants[0]?.id ?? null,
              quantity: 2,
              unitPrice: 1560,
              taxId: tax.id,
              amount: 3120,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.STAFF.id,
              note: "Created Draft subscription",
            },
            {
              fromStatus: "DRAFT",
              toStatus: "QUOTATION",
              changedById: staffUsers.STAFF.id,
              note: "Sent quotation to Acme Traders",
            },
            {
              fromStatus: "QUOTATION",
              toStatus: "CONFIRMED",
              changedById: staffUsers.STAFF.id,
              note: "Customer confirmed quotation",
            },
            {
              fromStatus: "CONFIRMED",
              toStatus: "ACTIVE",
              changedById: staffUsers.STAFF.id,
              note: "Activated subscription",
            },
          ],
        },
      },
    });

    // 2. ACTIVE paused subscription (Acme Traders)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[0].id,
        planId: monthlyFlexPlan.id,
        status: "ACTIVE",
        isPaused: true,
        startDate: tenDaysAgo,
        expiryDate: oneYearLater,
        nextInvoiceDate: thirtyDaysLater,
        createdById: staffUsers.STAFF.id,
        lines: {
          create: [
            {
              productId: supportProduct.id,
              variantId: null,
              quantity: 1,
              unitPrice: 500,
              taxId: tax.id,
              amount: 500,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.STAFF.id,
              note: "Created Draft subscription",
              changedAt: tenDaysAgo,
            },
            {
              fromStatus: "CONFIRMED",
              toStatus: "ACTIVE",
              changedById: staffUsers.STAFF.id,
              note: "Activated subscription",
              changedAt: tenDaysAgo,
            },
            {
              fromStatus: "ACTIVE",
              toStatus: "ACTIVE",
              changedById: staffUsers.STAFF.id,
              note: "ACTION:PAUSED - Customer requested temporary pause",
              changedAt: new Date(now.getTime() - 2 * 86400000),
            },
          ],
        },
      },
    });

    // 3. DRAFT subscription (Zen Studio)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[1].id,
        planId: yearlyStrictPlan.id,
        status: "DRAFT",
        isPaused: false,
        startDate: now,
        expiryDate: oneYearLater,
        createdById: staffUsers.STAFF.id,
        lines: {
          create: [
            {
              productId: crmProduct.id,
              variantId: null,
              quantity: 5,
              unitPrice: 1000,
              taxId: tax.id,
              amount: 5000,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.STAFF.id,
              note: "Prepared enterprise team draft",
            },
          ],
        },
      },
    });

    // 4. QUOTATION subscription (Zen Studio)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[1].id,
        planId: monthlyFlexPlan.id,
        status: "QUOTATION",
        isPaused: false,
        startDate: now,
        expiryDate: oneYearLater,
        quotationValidUntil: thirtyDaysLater,
        createdById: staffUsers.STAFF.id,
        lines: {
          create: [
            {
              productId: supportProduct.id,
              variantId: null,
              quantity: 2,
              unitPrice: 450, // Negotiated unit price
              taxId: tax.id,
              amount: 900,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.STAFF.id,
              note: "Created Draft",
            },
            {
              fromStatus: "DRAFT",
              toStatus: "QUOTATION",
              changedById: staffUsers.STAFF.id,
              note: "Sent negotiated quotation offer",
            },
          ],
        },
      },
    });

    // 5. CONFIRMED subscription (Aarav Sharma — individual customer)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[2].id,
        planId: monthlyFlexPlan.id,
        status: "CONFIRMED",
        isPaused: false,
        startDate: thirtyDaysLater,
        expiryDate: oneYearLater,
        createdById: staffUsers.STAFF.id,
        lines: {
          create: [
            {
              productId: crmProduct.id,
              variantId: null,
              quantity: 1,
              unitPrice: 1000,
              taxId: tax.id,
              amount: 1000,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.STAFF.id,
              note: "Created Draft",
            },
            {
              fromStatus: "DRAFT",
              toStatus: "QUOTATION",
              changedById: staffUsers.STAFF.id,
              note: "Sent Quotation",
            },
            {
              fromStatus: "QUOTATION",
              toStatus: "CONFIRMED",
              changedById: staffUsers.STAFF.id,
              note: "Accepted by customer Aarav Sharma",
            },
          ],
        },
      },
    });

    // 6. CLOSED subscription (Aarav Sharma)
    await prisma.subscription.create({
      data: {
        number: await nextSub(),
        customerId: customers[2].id,
        planId: monthlyFlexPlan.id,
        status: "CLOSED",
        isPaused: false,
        startDate: tenDaysAgo,
        expiryDate: oneYearLater,
        createdById: staffUsers.ADMIN.id,
        lines: {
          create: [
            {
              productId: supportProduct.id,
              variantId: null,
              quantity: 1,
              unitPrice: 500,
              taxId: null,
              amount: 500,
            },
          ],
        },
        history: {
          create: [
            {
              fromStatus: null,
              toStatus: "DRAFT",
              changedById: staffUsers.ADMIN.id,
              note: "Created Draft",
            },
            {
              fromStatus: "ACTIVE",
              toStatus: "CLOSED",
              changedById: staffUsers.ADMIN.id,
              note: "ACTION:CLOSED - Closed at customer request",
            },
          ],
        },
      },
    });
  }

  console.log("Seed done. All users use password Admin@1234");
}

main().finally(() => prisma.$disconnect());
