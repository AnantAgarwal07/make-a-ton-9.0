import { InvoiceError } from "./errors";

/**
 * Decimal-safe money helpers. All arithmetic is done on integer cents (bigint),
 * never on JS floating-point numbers.
 *
 * Accepts strings ("12.50"), numbers, bigints (already cents is NOT assumed — a bigint
 * is treated as whole currency units), or Prisma.Decimal (anything with toString()).
 */
export type MoneyInput = string | number | bigint | { toString(): string };
export type Cents = bigint;

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Parse a money value to integer cents, rounding half away from zero to 2 decimals. */
export function toCents(value: MoneyInput): Cents {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new InvoiceError("INVALID_AMOUNT", "Amount must be a finite number");
  }
  const str = String(value).trim();
  const m = DECIMAL_RE.exec(str);
  if (!m) throw new InvoiceError("INVALID_AMOUNT", `Invalid money value: "${str}"`);

  const [, sign, intPart, fracRaw = ""] = m;
  const frac = (fracRaw + "00").slice(0, 2);
  let cents = BigInt(intPart) * BigInt(100) + BigInt(frac);
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) cents += BigInt(1); // half-up on magnitude
  return sign === "-" ? -cents : cents;
}

/** Format cents as a fixed 2-decimal string, e.g. BigInt(1250) -> "12.50". */
export function fromCents(cents: Cents): string {
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  const whole = abs / BigInt(100);
  const frac = (abs % BigInt(100)).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, BigInt(0));
}
