import { z } from "zod";

export const INVOICE_STATUS_VALUES = ["DRAFT", "CONFIRMED", "PAID", "CANCELLED"] as const;
export const PAYMENT_METHOD_VALUES = [
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "UPI",
  "CHEQUE",
  "OTHER",
] as const;

/** "YYYY-MM-DD" -> Date at 00:00 UTC. Rejects impossible dates like 2026-02-31. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, "Invalid date")
  .transform((s) => new Date(`${s}T00:00:00Z`));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const invoiceListQuery = paginationSchema
  .extend({
    status: z.enum(INVOICE_STATUS_VALUES).optional(),
    customerId: z.coerce.number().int().positive().optional(),
    dateFrom: isoDate.optional(), // filters invoiceDate, inclusive
    dateTo: isoDate.optional(), // filters invoiceDate, inclusive
    overdue: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: "dateFrom must be on or before dateTo",
    path: ["dateTo"],
  });

export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

export const recordPaymentBody = z.object({
  amount: z.union([z.number(), z.string().trim().min(1, "Amount is required")]),
  method: z.enum(PAYMENT_METHOD_VALUES),
  paymentDate: z
    .string()
    .trim()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid paymentDate")
    .transform((s) => new Date(s))
    .optional(),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type RecordPaymentBody = z.infer<typeof recordPaymentBody>;

export const paymentListQuery = paginationSchema
  .extend({
    invoiceId: z.coerce.number().int().positive().optional(),
    customerId: z.coerce.number().int().positive().optional(),
    method: z.enum(PAYMENT_METHOD_VALUES).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    includeVoided: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: "dateFrom must be on or before dateTo",
    path: ["dateTo"],
  });

export type PaymentListQuery = z.infer<typeof paymentListQuery>;

export const overdueListQuery = paginationSchema.extend({
  customerId: z.coerce.number().int().positive().optional(),
});

export type OverdueListQuery = z.infer<typeof overdueListQuery>;

export const reportSummaryQuery = z
  .object({
    customerId: z.coerce.number().int().positive().optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: "dateFrom must be on or before dateTo",
    path: ["dateTo"],
  });

export type ReportSummaryQuery = z.infer<typeof reportSummaryQuery>;

