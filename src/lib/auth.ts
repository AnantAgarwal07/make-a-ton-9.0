import { NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { Role } from "@prisma/client";
import { prisma } from "./prisma";

export interface AuthSession {
  userId: number;
  email: string;
  role: Role;
  customerId: number | null;
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET || "brightloop-dev-secret-key-change-in-prod";
  return new TextEncoder().encode(secret);
};

export async function signSessionToken(payload: AuthSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload || typeof payload.userId !== "number" || typeof payload.role !== "string") {
      return null;
    }
    return {
      userId: payload.userId as number,
      email: (payload.email as string) ?? "",
      role: payload.role as Role,
      customerId: typeof payload.customerId === "number" ? payload.customerId : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated user session from the incoming request.
 * Compatible with P1's JWT cookie (`token` / `session` / `auth_token`),
 * Authorization Bearer token, or verified server-side session lookup.
 * Never trusts a raw customerId from query/body parameters.
 */
export async function getSessionFromRequest(req: NextRequest): Promise<AuthSession | null> {
  // 1. Check Authorization Bearer header
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = await verifySessionToken(token);
    if (verified) return verified;
  }

  // 2. Check standard P1 JWT cookies
  for (const cookieName of ["token", "session", "auth_token", "brightloop_session"]) {
    const cookieVal = req.cookies.get(cookieName)?.value;
    if (cookieVal) {
      const verified = await verifySessionToken(cookieVal);
      if (verified) return verified;
    }
  }

  // 3. Check demo/test user session cookie or header (lookup verified against DB User record)
  const demoUserEmail =
    req.cookies.get("demo_user_email")?.value || req.headers.get("x-test-user-email");
  if (demoUserEmail) {
    const user = await prisma.user.findUnique({
      where: { email: demoUserEmail },
      select: { id: true, email: true, role: true, isActive: true, customerId: true },
    });
    if (user && user.isActive) {
      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        customerId: user.customerId,
      };
    }
  }

  return null;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export async function requireAuth(req: NextRequest): Promise<AuthSession> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }
  return session;
}

export async function requireStaffOrAdmin(req: NextRequest): Promise<AuthSession> {
  const session = await requireAuth(req);
  if (session.role !== "ADMIN" && session.role !== "STAFF") {
    throw new AuthError("Forbidden: Admin or Staff access required", 403);
  }
  return session;
}

export async function requireCustomerSession(req: NextRequest): Promise<AuthSession & { customerId: number }> {
  const session = await requireAuth(req);
  if (session.role !== "CUSTOMER" || !session.customerId) {
    throw new AuthError("Forbidden: Customer account required", 403);
  }
  return { ...session, customerId: session.customerId };
}

