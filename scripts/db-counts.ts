import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const out: Record<string, unknown> = {};
  out.users = await prisma.user.groupBy({ by: ["role"], _count: true });
  out.customers = await prisma.customer.count();
  out.products = await prisma.product.count();
  out.plans = await prisma.plan.count();
  out.taxes = await prisma.tax.count();
  out.discounts = await prisma.discount.count();
  out.subscriptions = await prisma.subscription.groupBy({ by: ["status"], _count: true });
  out.invoices = await prisma.invoice.groupBy({ by: ["status"], _count: true });
  out.payments = await prisma.payment.count();
  console.log(JSON.stringify(out, null, 2));
}
main().finally(() => prisma.$disconnect());

