// P4 dev data: a handful of invoices in every state, for testing invoice/payment APIs.
// Requires the main seed first (npx prisma db seed).
//   npx tsx prisma/dev-invoices.ts          -> create (idempotent)
//   npx tsx prisma/dev-invoices.ts --clean  -> remove everything this script created
import { PrismaClient, type InvoiceStatus } from "@prisma/client";

const prisma = new PrismaClient();
const PREFIX = "DEV-INV-";

type Spec = { n: number; status: InvoiceStatus; month: number; due: string; paid?: number[]; voided?: number[] };

// Periods are in 2025 so they never collide with P3's real billing periods.
const SPECS: Spec[] = [
  { n: 1, status: "DRAFT", month: 0, due: "2026-12-31" },
  { n: 2, status: "CONFIRMED", month: 1, due: "2025-03-15" }, // overdue, unpaid
  { n: 3, status: "CONFIRMED", month: 2, due: "2025-04-15", paid: [1000], voided: [500] }, // overdue, partial
  { n: 4, status: "CONFIRMED", month: 3, due: "2026-12-31" }, // not due yet
  { n: 5, status: "PAID", month: 4, due: "2025-06-15", paid: [2000, 1681.6] },
  { n: 6, status: "CANCELLED", month: 5, due: "2025-07-15" },
  { n: 7, status: "DRAFT", month: 6, due: "2026-12-31" },
];

async function clean() {
  const where = { invoice: { number: { startsWith: PREFIX } } };
  const p = await prisma.payment.deleteMany({ where });
  const i = await prisma.invoice.deleteMany({ where: { number: { startsWith: PREFIX } } });
  console.log(`Removed ${i.count} invoices, ${p.count} payments`);
}

async function create() {
  const sub = await prisma.subscription.findFirst({ orderBy: { id: "asc" } });
  if (!sub) throw new Error("No subscription found. Run `npx prisma db seed` first.");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  for (const s of SPECS) {
    const number = `${PREFIX}${String(s.n).padStart(4, "0")}`;
    if (await prisma.invoice.findUnique({ where: { number } })) continue;
    const periodStart = new Date(Date.UTC(2025, s.month, 1));
    const periodEnd = new Date(Date.UTC(2025, s.month + 1, 0));
    await prisma.invoice.create({
      data: {
        number, subscriptionId: sub.id, customerId: sub.customerId, status: s.status,
        periodStart, periodEnd, invoiceDate: periodStart, dueDate: new Date(`${s.due}T00:00:00Z`),
        subtotal: 3120, discountTotal: 0, taxTotal: 561.6, total: 3681.6,
        lines: {
          create: [{ productName: "Brightloop CRM (Odoo)", quantity: 2, unitPrice: 1560, tax: 561.6, amount: 3681.6 }],
        },
        payments: {
          create: [
            ...(s.paid ?? []).map((amount) => ({ amount, method: "BANK_TRANSFER" as const, createdById: admin?.id })),
            ...(s.voided ?? []).map((amount) => ({
              amount, method: "CASH" as const, createdById: admin?.id, voidedAt: new Date(), note: "entered twice",
            })),
          ],
        },
      },
    });
    console.log(`Created ${number} (${s.status})`);
  }
}

(process.argv.includes("--clean") ? clean() : create())
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

