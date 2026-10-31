import { SignJWT, jwtVerify } from "jose";

export type Role = "ADMIN" | "STAFF" | "CUSTOMER";

export const SESSION_COOKIE_NAME = "bl_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: number;
  email: string;
  role: Role;
  customerId: number | null;
}

const DEV_FALLBACK_SECRET = "brightloop-dev-jwt-secret-key-at-least-32-chars-long";

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable must be configured with at least 16 characters in production");
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload, expiresIn = "7d"): Promise<string> {
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    customerId: payload.customerId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const userId = Number(payload.userId ?? payload.sub);
    const email = typeof payload.email === "string" ? payload.email : "";
    const role = payload.role as Role;
    const customerId =
      typeof payload.customerId === "number" && Number.isInteger(payload.customerId)
        ? payload.customerId
        : null;

    if (!Number.isInteger(userId) || userId <= 0 || !email) {
      return null;
    }
    if (role !== "ADMIN" && role !== "STAFF" && role !== "CUSTOMER") {
      return null;
    }
    return { userId, email, role, customerId };
  } catch {
    return null;
  }
}

export function getRoleDashboardPath(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "STAFF":
      return "/staff";
    case "CUSTOMER":
      return "/customer";
  }
}

export function getSessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function parseCookieHeader(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

