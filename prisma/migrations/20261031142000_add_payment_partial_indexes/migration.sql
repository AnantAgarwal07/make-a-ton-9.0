-- Partial indexes for active (non-voided) payments to accelerate:
-- 1. Correlated & grouped balance lookups per invoice (overdue filter, list-invoices, list-overdue, report-summary)
-- 2. Monthly revenue collected aggregation by paymentDate (report-summary)

DROP INDEX IF EXISTS "Payment_paymentDate_idx";

CREATE INDEX IF NOT EXISTS idx_payment_active_invoice
ON "Payment" ("invoiceId")
WHERE "voidedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_active_date
ON "Payment" ("paymentDate")
WHERE "voidedAt" IS NULL;

