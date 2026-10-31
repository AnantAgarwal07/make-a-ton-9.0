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

async function main() {
  const pw = await bcrypt.hash("Admin@1234", 10);

  for (const [email, role] of [
    ["admin@brightloop.test", "ADMIN"],
    ["staff@brightloop.test", "STAFF"],
  ] as const) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: pw, role } });
  }

  const customers = [];
  for (const [name, email] of [
    ["Acme Traders", "acme@customer.test"],
    ["Zen Studio", "zen@customer.test"],
  ]) {
    let c = await prisma.customer.findFirst({ where: { name } });
    if (!c) {
      c = await prisma.customer.create({ data: { name, email } });
      await prisma.user.create({ data: { email, passwordHash: pw, role: "CUSTOMER", customerId: c.id } });
    }
    customers.push(c);
  }

  if ((await prisma.product.count()) === 0) {
    const tax = await prisma.tax.create({ data: { name: "GST 18%", type: "PERCENT", rate: 18 } });
    const product = await prisma.product.create({
      data: {
        name: "Brightloop CRM", type: "Software", salesPrice: 1000, costPrice: 400,
        variants: { create: [{ attribute: "Brand", value: "Odoo", extraPrice: 560 }] },
      },
      include: { variants: true },
    });
    const plan = await prisma.plan.create({
      data: {
        name: "Monthly Pro", price: 1000, billingPeriod: "MONTHLY", minQuantity: 1,
        availableFrom: new Date("2026-01-01"), pausable: true,
      },
    });
    await prisma.discount.create({
      data: {
        name: "Welcome 10%", type: "PERCENT", value: 10, startDate: new Date("2026-01-01"),
        endDate: new Date("2027-12-31"), usageLimit: 100, scope: "SUBSCRIPTION",
      },
    });
    await prisma.subscription.create({
      data: {
        number: await nextSub(), customerId: customers[0].id, planId: plan.id, status: "ACTIVE",
        startDate: new Date(), expiryDate: new Date(Date.now() + 365 * 86400000), nextInvoiceDate: new Date(),
        lines: {
          create: [{
            productId: product.id, variantId: product.variants[0].id,
            quantity: 2, unitPrice: 1560, taxId: tax.id, amount: 3120,
          }],
        },
      },
    });
  }
  console.log("Seed done. All users use password Admin@1234");

  if (process.argv.includes("--scale") || process.env.SEED_SCALE === "true") {
    await seedScale(customers[0].id);
  }
}

/**
 * Step 7 Performance Seed:
 * Uses PostgreSQL generate_series() to insert up to 10,000+ subscriptions, 50,000+ invoices,
 * 50,000+ invoice lines, and ~30,000 payments in a single round-trip (< 5 seconds).
 */
async function seedScale(customerId: number) {
  const plan = await prisma.plan.findFirst({ orderBy: { id: "asc" } });
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!plan) throw new Error("Run base seed first");

  const existingSubs = await prisma.subscription.count({
    where: { number: { startsWith: "SUB-SCALE-" } },
  });
  const subsToCreate = Math.max(0, 10_000 - existingSubs);

  if (subsToCreate > 0) {
    console.log(`Generating ${subsToCreate} subscriptions in bulk...`);
    await prisma.$executeRaw`
      INSERT INTO "Subscription" ("number", "customerId", "planId", "status", "isPaused", "startDate", "expiryDate", "paymentTermsDays", "nextInvoiceDate")
      SELECT
        'SUB-SCALE-' || LPAD(g::text, 6, '0'),
        ${customerId},
        ${plan.id},
        (CASE WHEN g % 10 = 0 THEN 'CLOSED' ELSE 'ACTIVE' END)::"SubscriptionStatus",
        false,
        TIMESTAMPTZ '2025-01-01 00:00:00Z',
        TIMESTAMPTZ '2027-01-01 00:00:00Z',
        15,
        TIMESTAMPTZ '2026-11-01 00:00:00Z'
      FROM generate_series(1, 10000) AS g
      ON CONFLICT ("number") DO NOTHING`;
  }

  const existingInvs = await prisma.invoice.count();
  if (existingInvs < 50_000) {
    console.log("Generating 50,000 invoices, invoice lines, and payments in bulk...");
    await prisma.$executeRaw`
      WITH target_subs AS (
        SELECT id, "customerId", ROW_NUMBER() OVER (ORDER BY id) AS rn
        FROM "Subscription"
        WHERE "number" LIKE 'SUB-SCALE-%'
        ORDER BY id
        LIMIT 10000
      ),
      inserted_invs AS (
        INSERT INTO "Invoice" (
          "number", "subscriptionId", "customerId",
          "periodStart", "periodEnd", "invoiceDate", "dueDate",
          "subtotal", "discountTotal", "taxTotal", "total", "status"
        )
        SELECT
          'INV-SCALE-' || LPAD(((s.rn - 1) * 5 + m)::text, 6, '0'),
          s.id,
          s."customerId",
          (DATE '2025-01-01' + ((m - 1) || ' months')::interval)::timestamptz,
          (DATE '2025-01-01' + (m || ' months')::interval - INTERVAL '1 day')::timestamptz,
          (DATE '2025-01-01' + ((m - 1) || ' months')::interval)::timestamptz,
          (CASE
            WHEN m <= 3 THEN (DATE '2025-01-15' + ((m - 1) || ' months')::interval)
            ELSE (DATE '2026-12-15' + ((m - 4) || ' months')::interval)
          END)::timestamptz,
          1000.00,
          0.00,
          180.00,
          1180.00,
          (CASE
            WHEN (s.rn + m) % 5 IN (0, 1) THEN 'PAID'
            WHEN (s.rn + m) % 5 IN (2, 3) THEN 'CONFIRMED'
            WHEN (s.rn + m) % 10 = 4 THEN 'DRAFT'
            ELSE 'CANCELLED'
          END)::"InvoiceStatus"
        FROM target_subs s
        CROSS JOIN generate_series(1, 5) AS m
        ON CONFLICT DO NOTHING
        RETURNING id, status, "invoiceDate", total
      ),
      inserted_lines AS (
        INSERT INTO "InvoiceLine" ("invoiceId", "productName", "quantity", "unitPrice", "discount", "tax", "amount")
        SELECT id, 'Brightloop CRM Pro', 1, 1000.00, 0.00, 180.00, total
        FROM inserted_invs
      )
      INSERT INTO "Payment" ("invoiceId", "method", "amount", "paymentDate", "note", "createdById")
      SELECT
        id,
        (CASE (id % 4)
          WHEN 0 THEN 'BANK_TRANSFER'
          WHEN 1 THEN 'UPI'
          WHEN 2 THEN 'CARD'
          ELSE 'CASH'
        END)::"PaymentMethod",
        CASE WHEN status = 'PAID' THEN total ELSE 500.00 END,
        ("invoiceDate" + INTERVAL '5 days'),
        'Bulk scale seed payment',
        ${admin?.id ?? null}
      FROM inserted_invs
      WHERE status = 'PAID' OR (status = 'CONFIRMED' AND id % 3 = 0)`;
  }

  const [subsCount, invsCount, payCount] = await Promise.all([
    prisma.subscription.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
  ]);
  console.log(`Scale seed complete: ${subsCount} subscriptions, ${invsCount} invoices, ${payCount} payments.`);
}

main().finally(() => prisma.$disconnect());
