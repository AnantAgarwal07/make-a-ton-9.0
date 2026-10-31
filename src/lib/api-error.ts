import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { SubscriptionServiceError } from "./subscriptions/service";

export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message, code: "AUTH_ERROR" },
      { status: error.statusCode }
    );
  }

  if (error instanceof SubscriptionServiceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  console.error("[API Error]", error);
  return NextResponse.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}

