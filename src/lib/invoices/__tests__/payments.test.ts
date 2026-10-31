import { describe, expect, it } from "vitest";
import {
  balanceCents,
  computeBalance,
  totalPaidCents,
  validatePayment,
  type PayableInvoice,
} from "../payments";
import { InvoiceError } from "../errors";

const inv = (over: Partial<PayableInvoice> = {}): PayableInvoice => ({
  status: "CONFIRMED",
  total: "100.00",
  payments: [],
  ...over,
});

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvoiceError);
    expect((e as InvoiceError).code).toBe(code);
    return;
  }
  throw new Error(`Expected InvoiceError ${code}`);
}

describe("computeBalance", () => {
  it("returns a 2-decimal string and skips voided payments", () => {
    expect(computeBalance("1180.00", [])).toBe("1180.00");
    expect(
      computeBalance({ toString: () => "1180" }, [
        { amount: "500" },
        { amount: "100", voidedAt: new Date("2026-01-01") },
      ]),
    ).toBe("680.00");
  });

  it("is exact with fractional cents sums (no float drift)", () => {
    expect(computeBalance("0.30", [{ amount: 0.1 }, { amount: 0.2 }])).toBe("0.00");
  });

  it("is negative if data is already overpaid (legacy/bad data is surfaced, not hidden)", () => {
    expect(computeBalance("10", [{ amount: "12.5" }])).toBe("-2.50");
  });
});

describe("balance", () => {
  it("is total minus non-voided payments", () => {
    const i = inv({
      payments: [
        { amount: "30.00" },
        { amount: "20.00", voidedAt: new Date("2026-01-01") },
        { amount: "10.25", voidedAt: null },
      ],
    });
    expect(totalPaidCents(i.payments)).toBe(BigInt(4025));
    expect(balanceCents(i)).toBe(BigInt(5975));
  });

  it("equals total with no payments", () => {
    expect(balanceCents(inv())).toBe(BigInt(10000));
  });
});

describe("validatePayment", () => {
  it("partial payment keeps invoice CONFIRMED", () => {
    const r = validatePayment(inv(), "40");
    expect(r).toEqual({
      amount: "40.00",
      totalPaid: "40.00",
      balance: "60.00",
      newStatus: "CONFIRMED",
      becamePaid: false,
    });
  });

  it("full payment marks invoice PAID", () => {
    const r = validatePayment(inv(), "100.00");
    expect(r.balance).toBe("0.00");
    expect(r.newStatus).toBe("PAID");
    expect(r.becamePaid).toBe(true);
  });

  it("multiple payments accumulate and the last one pays it off", () => {
    let i = inv({ total: "0.30" });
    const r1 = validatePayment(i, 0.1);
    i = { ...i, payments: [...i.payments, { amount: r1.amount }] };
    const r2 = validatePayment(i, 0.1);
    i = { ...i, payments: [...i.payments, { amount: r2.amount }] };
    expect(r2.newStatus).toBe("CONFIRMED");
    const r3 = validatePayment(i, 0.1);
    expect(r3.totalPaid).toBe("0.30");
    expect(r3.balance).toBe("0.00");
    expect(r3.newStatus).toBe("PAID");
  });

  it("ignores voided payments when computing remaining balance", () => {
    const i = inv({ payments: [{ amount: "100", voidedAt: new Date("2026-01-01") }] });
    expect(validatePayment(i, "100").becamePaid).toBe(true);
  });

  it("rounds the payment amount to 2 decimals", () => {
    expect(validatePayment(inv(), "10.005").amount).toBe("10.01");
  });

  it("rejects negative and zero payments", () => {
    expectCode(() => validatePayment(inv(), "-5"), "INVALID_AMOUNT");
    expectCode(() => validatePayment(inv(), 0), "INVALID_AMOUNT");
    expectCode(() => validatePayment(inv(), "0.004"), "INVALID_AMOUNT"); // rounds to 0.00
  });

  it("rejects non-numeric amounts", () => {
    expectCode(() => validatePayment(inv(), "ten"), "INVALID_AMOUNT");
    expectCode(() => validatePayment(inv(), NaN), "INVALID_AMOUNT");
  });

  it("rejects overpayment (amount > balance)", () => {
    expectCode(() => validatePayment(inv(), "100.01"), "OVERPAYMENT");
    const partlyPaid = inv({ payments: [{ amount: "70" }] });
    expectCode(() => validatePayment(partlyPaid, "30.01"), "OVERPAYMENT");
    expect(validatePayment(partlyPaid, "30").becamePaid).toBe(true);
  });

  it.each(["DRAFT", "PAID", "CANCELLED"] as const)("rejects payments on %s invoices", (status) => {
    expectCode(() => validatePayment(inv({ status }), "10"), "INVOICE_NOT_PAYABLE");
  });
});
