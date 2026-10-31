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
}

main().finally(() => prisma.$disconnect());