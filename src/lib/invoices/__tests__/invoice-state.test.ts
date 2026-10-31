import { describe, expect, it } from "vitest";
import { INVOICE_STATUSES, type InvoiceStatus, assertTransition, canTransition } from "../invoice-state";
import { InvoiceError } from "../errors";

const allowed: [InvoiceStatus, InvoiceStatus][] = [
  ["DRAFT", "CONFIRMED"],
  ["DRAFT", "CANCELLED"],
  ["CONFIRMED", "CANCELLED"],
  ["CONFIRMED", "PAID"],
];

describe("canTransition", () => {
  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Every pair not in the allowed list must be rejected (including same-status).
  const rejected = INVOICE_STATUSES.flatMap((from) =>
    INVOICE_STATUSES.map((to) => [from, to] as [InvoiceStatus, InvoiceStatus]),
  ).filter(([f, t]) => !allowed.some(([af, at]) => af === f && at === t));

  it.each(rejected)("rejects %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvoiceError);
  });

  it("PAID cannot be cancelled and CANCELLED cannot be confirmed", () => {
    expect(canTransition("PAID", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
  });

  it("rejects unknown statuses safely", () => {
    expect(canTransition("BOGUS" as InvoiceStatus, "PAID")).toBe(false);
  });
});

