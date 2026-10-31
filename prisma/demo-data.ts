// Demo data for the Finance Dashboard, Invoices, Payments and Subscriptions screens.
//
// Safe to run against a shared database:
//   * purely ADDITIVE - never updates or deletes existing rows
//   * IDEMPOTENT - everything it creates is tagged (SUB-DEMO-*, INV-DEMO-*, demo customer emails)
//     and skipped if it already exists, so running it twice changes nothing.
//
//   npx tsx prisma/demo-data.ts           -> create demo data
//   npx tsx prisma/demo-data.ts --clean   -> remove ONLY what this script created
//
// Requires the base seed first (npx prisma db seed) for users/products/plans/taxes.
import bcrypt from "bcryptjs";
import { PrismaClient, type PaymentMethod, type SubscriptionStatus } from "@prisma/client";

const prisma = new PrismaClient();
const SUB_PREFIX = "SUB-DEMO-";
const INV_PREFIX = "INV-DEMO-";
const DAY = 86_400_000;
const MONTHS_OF_HISTORY = 6;

const NEW_CUSTOMERS = [
  { name: "Nimbus Logistics", email: "nimbus@customer.test", phone: "+91 98200 11111", address: "Andheri East, Mumbai" },
  { name: "Orchid Health Clinic", email: "orchid@customer.test", phone: "+91 98450 22222", address: "Indiranagar, Bengaluru" },
  { name: "Priya Nair", email: "priya.nair@customer.test", phone: "+91 99000 33333", address: "Kochi, Kerala" },
  { name: "Vertex Analytics", email: "vertex@customer.test", phone: "+91 98110 44444", address: "Sector 62, Noida" },
];

// customer = email; plan = index into plans (by id asc); product = index into products (by id asc)
const SUBS: {
  customer: string;
  plan: number;
  product: number;
  qty: number;
  status: SubscriptionStatus;
  paused?: boolean;
  /** behaviour of the most recent past-due invoice */
  latest?: "paid" | "partial" | "unpaid";
}[] = [
  { customer: "acme@customer.test", plan: 0, product: 0, qty: 5, status: "ACTIVE", latest: "paid" },
  { customer: "zen@customer.test", plan: 0, product: 0, qty: 3, status: "ACTIVE", latest: "partial" },
  { customer: "aarav.sharma@customer.test", plan: 0, product: 1, qty: 1, status: "ACTIVE", latest: "unpaid" },
  { customer: "nimbus@customer.test", plan: 0, product: 0, qty: 10, status: "ACTIVE", latest: "paid" },
  { customer: "orchid@customer.test", plan: 0, product: 1, qty: 2, status: "ACTIVE", latest: "unpaid" },
  { customer: "priya.nair@customer.test", plan: 0, product: 0, qty: 1, status: "ACTIVE", paused: true, latest: "paid" },
  { customer: "vertex@customer.test", plan: 1, product: 0, qty: 8, status: "ACTIVE", latest: "partial" },
  { customer: "nimbus@customer.test", plan: 1, product: 1, qty: 4, status: "QUOTATION" },
  { customer: "vertex@customer.test", plan: 0, product: 1, qty: 2, status: "DRAFT" },
  { customer: "orchid@customer.test", plan: 0, product: 0, qty: 1, status: "CLOSED" },
];

const METHODS: PaymentMethod[] = ["BANK_TRANSFER", "UPI", "CARD", "CASH", "CHEQUE"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const monthStart = (d: Date, offset: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
const monthEnd = (d: Date, offset: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));

async function clean() {
  const p = await prisma.payment.deleteMany({ where: { invoice: { number: { startsWith: INV_PREFIX } } } });
  const i = await prisma.invoice.deleteMany({ where: { number: { startsWith: INV_PREFIX } } });
  const s = await prisma.subscription.deleteMany({ where: { number: { startsWith: SUB_PREFIX } } });
  const emails = NEW_CUSTOMERS.map((c) => c.email);
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { customerId: true } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  const custIds = users.map((u) => u.customerId).filter((x): x is number => x !== null);
  const c = await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  console.log(`Removed ${p.count} payments, ${i.count} invoices, ${s.count} subscriptions, ${c.count} customers`);
}

async function ensureCustomers() {
  const pw = await bcrypt.hash("Admin@1234", 10);
  for (const c of NEW_CUSTOMERS) {
    const existing = await prisma.user.findUnique({ where: { email: c.email } });
    if (existing) continue;
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: c });
      await tx.user.create({ data: { email: c.email, passwordHash: pw, role: "CUSTOMER", customerId: customer.id } });
    });
    console.log(`Created customer ${c.name} (${c.email})`);
  }
}

async function create() {
  await ensureCustomers();

  const [plans, products, tax, staff] = await Promise.all([
    prisma.plan.findMany({ orderBy: { id: "asc" } }),
    prisma.product.findMany({ where: { isArchived: false }, orderBy: { id: "asc" }, include: { variants: true } }),
    prisma.tax.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } }),
    prisma.user.findFirst({ where: { role: { in: ["STAFF", "ADMIN"] }, isActive: true }, orderBy: { id: "asc" } }),
  ]);
  if (!plans.length || !products.length) throw new Error("No plans/products found. Run `npx prisma db seed` first.");

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let subsCreated = 0;
  let invsCreated = 0;
  let paysCreated = 0;

  for (let idx = 0; idx < SUBS.length; idx++) {
    const spec = SUBS[idx];
    const number = `${SUB_PREFIX}${String(idx + 1).padStart(4, "0")}`;
    const user = await prisma.user.findUnique({ where: { email: spec.customer } });
    if (!user?.customerId) {
      console.warn(`Skipping ${number}: customer ${spec.customer} not found`);
      continue;
    }

    const plan = plans[spec.plan] ?? plans[0];
    const product = products[spec.product] ?? products[0];
    const variant = product.variants[0] ?? null;
    const unitPrice = round2(Number(product.salesPrice) + Number(variant?.extraPrice ?? 0));
    const subtotal = round2(unitPrice * spec.qty);
    const taxRate = tax ? Number(tax.rate) : 0;
    const taxAmt = tax ? round2(tax.type === "PERCENT" ? (subtotal * taxRate) / 100 : taxRate) : 0;
    const total = round2(subtotal + taxAmt);

    let sub = await prisma.subscription.findUnique({ where: { number } });
    if (!sub) {
      const startDate = monthStart(today, -(MONTHS_OF_HISTORY - 1));
      sub = await prisma.subscription.create({
        data: {
          number,
          customerId: user.customerId,
          planId: plan.id,
          status: spec.status,
          isPaused: spec.paused ?? false,
          startDate,
          expiryDate: new Date(startDate.getTime() + 365 * DAY),
          nextInvoiceDate: spec.status === "ACTIVE" ? monthStart(today, 1) : null,
          quotationValidUntil: spec.status === "QUOTATION" ? new Date(today.getTime() + 14 * DAY) : null,
          createdById: staff?.id,
          lines: {
            create: [{ productId: product.id, variantId: variant?.id ?? null, quantity: spec.qty, unitPrice, taxId: tax?.id ?? null, amount: subtotal }],
          },
          history: {
            create: [
              { fromStatus: null, toStatus: "DRAFT", changedById: staff?.id, note: "Demo data: created" },
              ...(spec.status !== "DRAFT"
                ? [{ fromStatus: "DRAFT" as const, toStatus: spec.status, changedById: staff?.id, note: "Demo data: status set" }]
                : []),
            ],
          },
        },
      });
      subsCreated++;
    }

    if (spec.status !== "ACTIVE") continue;

    // One invoice per month of history; older ones paid, the latest past one per `spec.latest`, current month open.
    for (let m = MONTHS_OF_HISTORY - 1; m >= 0; m--) {
      const invNumber = `${INV_PREFIX}${String(idx + 1).padStart(2, "0")}${String(MONTHS_OF_HISTORY - m).padStart(2, "0")}`;
      if (await prisma.invoice.findUnique({ where: { number: invNumber } })) continue;

      const periodStart = monthStart(today, -m);
      const periodEnd = monthEnd(today, -m);
      const dueDate = new Date(periodStart.getTime() + sub.paymentTermsDays * DAY);
      const isCurrent = m === 0;
      const isLatestPast = m === 1;

      let payments: { amount: number; paymentDate: Date }[] = [];
      let status: "PAID" | "CONFIRMED" = "CONFIRMED";
      const payDate = (days: number) => new Date(Math.min(periodStart.getTime() + days * DAY, now.getTime()));

      if (!isCurrent && !isLatestPast) {
        status = "PAID";
        payments = [{ amount: total, paymentDate: payDate(5 + (idx % 7)) }];
      } else if (isLatestPast) {
        if (spec.latest === "paid") {
          status = "PAID";
          payments = [{ amount: total, paymentDate: payDate(8) }];
        } else if (spec.latest === "partial") {
          payments = [{ amount: round2(total * 0.4), paymentDate: payDate(10) }];
        }
      } else if (isCurrent && idx % 3 === 0 && dueDate <= now) {
        status = "PAID";
        payments = [{ amount: total, paymentDate: payDate(3) }];
      }

      await prisma.invoice.create({
        data: {
          number: invNumber,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          status,
          periodStart,
          periodEnd,
          invoiceDate: periodStart,
          dueDate,
          sentAt: periodStart,
          subtotal,
          discountTotal: 0,
          taxTotal: taxAmt,
          total,
          lines: {
            create: [{ productName: variant ? `${product.name} (${variant.value})` : product.name, quantity: spec.qty, unitPrice, tax: taxAmt, amount: total }],
          },
          payments: {
            create: payments.map((p, i) => ({
              amount: p.amount,
              paymentDate: p.paymentDate,
              method: METHODS[(idx + m + i) % METHODS.length],
              createdById: staff?.id,
              note: "Demo data",
            })),
          },
        },
      });
      invsCreated++;
      paysCreated += payments.length;
    }
  }

  console.log(`Demo data: +${subsCreated} subscriptions, +${invsCreated} invoices, +${paysCreated} payments`);
}

(process.argv.includes("--clean") ? clean() : create())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
