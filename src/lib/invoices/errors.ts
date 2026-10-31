// Domain errors for invoice/payment logic. `code` lets API routes map to HTTP status later.
export type InvoiceErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_TRANSITION"
  | "INVOICE_NOT_PAYABLE"
  | "OVERPAYMENT"
  | "HAS_PAYMENTS";

export class InvoiceError extends Error {
  constructor(
    public readonly code: InvoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvoiceError";
  }
}

