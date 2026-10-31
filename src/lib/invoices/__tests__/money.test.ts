import { describe, expect, it } from "vitest";
import { fromCents, sumCents, toCents } from "../money";
import { InvoiceError } from "../errors";

describe("money", () => {
  it("parses strings, numbers and Decimal-like objects to cents", () => {
    expect(toCents("12.5")).toBe(BigInt(1250));
    expect(toCents(12)).toBe(BigInt(1200));
    expect(toCents({ toString: () => "99.99" })).toBe(BigInt(9999));
    expect(toCents("-3.10")).toBe(-BigInt(310));
  });

  it("rounds half away from zero to 2 decimals", () => {
    expect(toCents("1.005")).toBe(BigInt(101));
    expect(toCents("1.004")).toBe(BigInt(100));
    expect(toCents("-1.005")).toBe(-BigInt(101));
  });

  it("avoids floating-point drift (0.1 + 0.2)", () => {
    expect(fromCents(sumCents([toCents(0.1), toCents(0.2)]))).toBe("0.30");
  });

  it("rejects invalid input", () => {
    for (const bad of ["abc", "", "1e5", "1.2.3", NaN, Infinity]) {
      expect(() => toCents(bad as never)).toThrow(InvoiceError);
    }
  });

  it("formats cents", () => {
    expect(fromCents(BigInt(5))).toBe("0.05");
    expect(fromCents(-BigInt(1250))).toBe("-12.50");
  });
});
