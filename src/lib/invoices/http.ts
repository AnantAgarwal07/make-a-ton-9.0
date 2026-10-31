import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { InvoiceError, type InvoiceErrorCode } from "./errors";
import { HttpError } from "./http-error";

export { HttpError };

const INVOICE_ERROR_STATUS: Record<InvoiceErrorCode, number> = {
  INVALID_AMOUNT: 400,
  OVERPAYMENT: 400,
  INVALID_TRANSITION: 409,
  INVOICE_NOT_PAYABLE: 409,
  HAS_PAYMENTS: 409,
};

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    const issues = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }
  if (e instanceof InvoiceError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: INVOICE_ERROR_STATUS[e.code] });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Prisma connection error / pool timeout during serverless cold start:
  if (
    e instanceof Prisma.PrismaClientInitializationError ||
    (e instanceof Prisma.PrismaClientKnownRequestError &&
      ["P1001", "P1002", "P1017", "P2024"].includes(e.code))
  ) {
    console.error("Neon DB wake-up/connection error:", (e as Error).message);
    return NextResponse.json(
      { error: "Database is waking up. Please refresh in a moment." },
      { status: 503 }
    );
  }
  // HttpError, or any auth error from P1's helpers that carries a 4xx `status`.
  const status = (e as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return NextResponse.json({ error: (e as Error).message || "Request failed" }, { status });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Recursively turn Prisma.Decimal into fixed 2-decimal strings ("3681.60"), so money is consistent in JSON. */
export function serializeMoney(value: unknown): unknown {
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed(2);
  if (Array.isArray(value)) return value.map(serializeMoney);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeMoney(v)]));
  }
  return value;
}

/** NextResponse.json with money formatting. Use this for every success response. */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(serializeMoney(data), init);
}

/** Wraps a route handler so every thrown error becomes a JSON response with the right status. */
export function handle<C = { params: Record<string, string> }>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx?: C): Promise<Response> => {
    try {
      return await fn(req, (ctx ?? {}) as C);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Parse URL search params with a Zod schema. Empty values (?status=) are treated as missing. */
export function parseQuery<S extends z.ZodTypeAny>(schema: S, params: URLSearchParams): z.infer<S> {
  const obj: Record<string, string> = {};
  params.forEach((v, k) => {
    if (v.trim() !== "") obj[k] = v.trim();
  });
  return schema.parse(obj);
}

/** Parse a JSON body with a Zod schema. Missing/invalid JSON => 400. */
export async function parseBody<S extends z.ZodTypeAny>(schema: S, req: Request): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function parseId(raw: string, label = "id"): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(400, `Invalid ${label}`);
  return n;
}
