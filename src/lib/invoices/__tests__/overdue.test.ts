import { describe, expect, it } from "vitest";
import { computeDaysOverdue, isOverdue } from "../overdue";

// Fixed "today" for determinism — never use the real clock in tests.
const TODAY = new Date("2026-10-31T10:00:00Z");
const PAST = new Date("2026-10-30T00:00:00Z");
const FUTURE = new Date("2026-11-15T00:00:00Z");

describe("isOverdue", () => {
  it("CONFIRMED + past due + balance > 0 is overdue", () => {
    expect(isOverdue({ status: "CONFIRMED", dueDate: PAST }, BigInt(5000), TODAY)).toBe(true);
  });

  it("not overdue when due date is in the future", () => {
    expect(isOverdue({ status: "CONFIRMED", dueDate: FUTURE }, BigInt(5000), TODAY)).toBe(false);
  });

  it("not overdue on the due date itself", () => {
    const dueToday = new Date("2026-10-31T00:00:00Z");
    expect(isOverdue({ status: "CONFIRMED", dueDate: dueToday }, BigInt(5000), TODAY)).toBe(false);
  });

  it("not overdue when balance is zero", () => {
    expect(isOverdue({ status: "CONFIRMED", dueDate: PAST }, BigInt(0), TODAY)).toBe(false);
  });

  it("PAID invoices are never overdue", () => {
    expect(isOverdue({ status: "PAID", dueDate: PAST }, BigInt(0), TODAY)).toBe(false);
    expect(isOverdue({ status: "PAID", dueDate: PAST }, BigInt(100), TODAY)).toBe(false);
  });

  it("CANCELLED invoices are never overdue", () => {
    expect(isOverdue({ status: "CANCELLED", dueDate: PAST }, BigInt(5000), TODAY)).toBe(false);
  });

  it("DRAFT invoices are never overdue", () => {
    expect(isOverdue({ status: "DRAFT", dueDate: PAST }, BigInt(5000), TODAY)).toBe(false);
  });

  it("computes daysOverdue accurately", () => {
    expect(computeDaysOverdue(PAST, TODAY)).toBe(1);
    expect(computeDaysOverdue(new Date("2026-10-21T00:00:00Z"), TODAY)).toBe(10);
    expect(computeDaysOverdue(TODAY, TODAY)).toBe(0);
    expect(computeDaysOverdue(FUTURE, TODAY)).toBe(0);
  });
});
