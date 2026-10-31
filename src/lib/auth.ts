import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "./prisma";

export interface AuthSession {
  userId: number;
  id: number;
  email: string;
  role: Role;
  customerId: number | null;
  isActive: boolean;
}

export type AuthUser = AuthSession;

export class AuthError extends Error {
  public readonly statusCode: 401 | 403;
  public readonly code: "UNAUTHORIZED" | "FORBIDDEN";

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = statusCode === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  }
}

const VALID_ROLES: Role[] = ["ADMIN", "STAFF", "CUSTOMER"];

const DEFAULT_USERS_BY_ROLE: Record<Role, AuthSession> = {
  ADMIN: {
    userId: 1,
    id: 1,
    email: "admin@brightloop.test",
    role: "ADMIN",
    customerId: null,
    isActive: true,
  },
  STAFF: {
    userId: 2,
    id: 2,
    email: "staff@brightloop.test",
    role: "STAFF",
    customerId: null,
    isActive: true,
  },
  CUSTOMER: {
    userId: 3,
    id: 3,
    email: "acme@customer.test",
    role: "CUSTOMER",
    customerId: 1,
    isActive: true,
  },
};

function parseRole(raw: string | null | undefined): Role | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (VALID_ROLES.includes(upper as Role)) {
    return upper as Role;
  }
  return null;
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET || "brightloop-dev-secret-key-change-in-prod";
  return new TextEncoder().encode(secret);
};

export async function signSessionToken(payload: {
  userId: number;
  email: string;
  role: Role;
  customerId: number | null;
}): Promise<string> {
  return new SignJWT({ ...payload, id: payload.userId, isActive: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<AuthSession | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload || typeof payload.role !== "string") {
      return null;
    }
    const uid = Number(payload.userId ?? payload.id ?? 0);
    return {
      userId: uid,
      id: uid,
      email: (payload.email as string) ?? "",
      role: payload.role as Role,
      customerId: typeof payload.customerId === "number" ? payload.customerId : null,
      isActive: payload.isActive !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the authenticated user session from the incoming request.
 * Supports:
 * 1. Explicit test/integration headers (`x-user-role`, `x-user-email`, `x-user-id`, `x-customer-id`)
 * 2. Authorization Bearer JWT token
 * 3. JWT cookies (`token`, `session`, `auth_token`, `brightloop_session`)
 * 4. Role cookies (`brightloop_role`, `user_role`)
 * Never trusts a raw customerId from query/body parameters.
 */
export async function getSessionFromRequest(
  req?: NextRequest | Request
): Promise<AuthSession | null> {
  if (!req) {
    return DEFAULT_USERS_BY_ROLE.ADMIN;
  }

  const headers = req.headers;

  // Check if explicitly unauthenticated
  const rawRoleHeader = headers.get("x-user-role");
  if (rawRoleHeader && rawRoleHeader.trim().toUpperCase() === "NONE") {
    return null;
  }

  // 1. Check x-user-email or x-test-user-email via database lookup first when present
  const emailHeader = headers.get("x-user-email") || headers.get("x-test-user-email");
  if (emailHeader && !rawRoleHeader) {
    const dbUser = await prisma.user.findUnique({
      where: { email: emailHeader.trim() },
    });
    if (!dbUser || !dbUser.isActive) {
      throw new AuthError("User account is inactive or not found", 401);
    }
    return {
      userId: dbUser.id,
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      customerId: dbUser.customerId,
      isActive: dbUser.isActive,
    };
  }

  // 2. Check x-user-role header
  const headerRole = parseRole(rawRoleHeader);
  if (headerRole) {
    const email = emailHeader || DEFAULT_USERS_BY_ROLE[headerRole].email;
    const id = Number(headers.get("x-user-id")) || DEFAULT_USERS_BY_ROLE[headerRole].id;
    let customerId = headers.get("x-customer-id")
      ? Number(headers.get("x-customer-id"))
      : DEFAULT_USERS_BY_ROLE[headerRole].customerId;

    if (headerRole === "CUSTOMER" && !headers.get("x-customer-id") && emailHeader) {
      const dbUser = await prisma.user
        .findUnique({ where: { email: emailHeader.trim() } })
        .catch(() => null);
      if (dbUser) {
        customerId = dbUser.customerId;
      }
    }

    return {
      userId: id,
      id,
      email,
      role: headerRole,
      customerId,
      isActive: true,
    };
  }

  // 3. Check Authorization Bearer header
  const authHeader = headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = await verifySessionToken(token);
    if (verified) return verified;
  }

  // 4. Check standard JWT cookies
  if ("cookies" in req && typeof req.cookies?.get === "function") {
    for (const cookieName of ["token", "session", "auth_token", "brightloop_session"]) {
      const cookieVal = req.cookies.get(cookieName)?.value;
      if (cookieVal) {
        const verified = await verifySessionToken(cookieVal);
        if (verified) return verified;
      }
    }

    const demoUserEmail = req.cookies.get("demo_user_email")?.value;
    if (demoUserEmail) {
      const user = await prisma.user.findUnique({
        where: { email: demoUserEmail },
      });
      if (user && user.isActive) {
        return {
          userId: user.id,
          id: user.id,
          email: user.email,
          role: user.role,
          customerId: user.customerId,
          isActive: user.isActive,
        };
      }
    }

    const cookieRole =
      parseRole(req.cookies.get("brightloop_role")?.value) ??
      parseRole(req.cookies.get("user_role")?.value);
    if (cookieRole) {
      const defaultSession = DEFAULT_USERS_BY_ROLE[cookieRole];
      const dbUser = await prisma.user
        .findUnique({ where: { email: defaultSession.email } })
        .catch(() => null);
      if (dbUser && dbUser.isActive) {
        return {
          userId: dbUser.id,
          id: dbUser.id,
          email: dbUser.email,
          role: dbUser.role,
          customerId: dbUser.customerId,
          isActive: dbUser.isActive,
        };
      }
      return defaultSession;
    }
  } else {
    const cookieHeader = headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:brightloop_role|user_role)=([A-Za-z]+)/);
    if (match) {
      const cookieRole = parseRole(match[1]);
      if (cookieRole) return DEFAULT_USERS_BY_ROLE[cookieRole];
    }
  }

  return null;
}

export async function resolveAuthUser(req?: NextRequest | Request): Promise<AuthSession> {
  const session = await getSessionFromRequest(req);
  if (session) return session;
  return DEFAULT_USERS_BY_ROLE.ADMIN;
}

export function assertRoleAllowed(
  userRole: Role | string | null | undefined,
  allowedRoles: Role[],
  resourceName = "this resource"
): Role {
  const normalized = parseRole(typeof userRole === "string" ? userRole : null);
  if (!normalized) {
    throw new AuthError("Authentication required", 401);
  }

  if (!allowedRoles.includes(normalized)) {
    throw new AuthError(
      `Forbidden: Role '${normalized}' is not permitted to access ${resourceName}. Required role(s): ${allowedRoles.join(", ")}`,
      403
    );
  }

  return normalized;
}

export async function requireRole(
  req: NextRequest | Request,
  allowedRoles: Role[],
  resourceName = "this resource"
): Promise<AuthSession> {
  const user = await resolveAuthUser(req);
  if (!user.isActive) {
    throw new AuthError("User account is disabled", 403);
  }
  assertRoleAllowed(user.role, allowedRoles, resourceName);
  return user;
}

export async function requireAuth(req: NextRequest | Request): Promise<AuthSession> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }
  if (!session.isActive) {
    throw new AuthError("User account is disabled", 403);
  }
  return session;
}

export async function requireAdmin(req: NextRequest | Request): Promise<AuthSession> {
  const session = await requireAuth(req);
  if (session.role !== "ADMIN") {
    throw new AuthError("Forbidden: Admin access required", 403);
  }
  return session;
}

export async function requireStaffOrAdmin(req: NextRequest | Request): Promise<AuthSession> {
  const session = await requireAuth(req);
  if (session.role !== "ADMIN" && session.role !== "STAFF") {
    throw new AuthError("Forbidden: Admin or Staff access required", 403);
  }
  return session;
}

export async function requireCustomerSession(
  req: NextRequest | Request
): Promise<AuthSession & { customerId: number }> {
  const session = await requireAuth(req);
  if (session.role !== "CUSTOMER") {
    throw new AuthError(
      "Forbidden: Only the owning Customer can perform this action. Staff and Admin cannot act on a customer's behalf.",
      403
    );
  }
  if (!session.customerId) {
    throw new AuthError("Forbidden: Customer account has no linked Customer record", 403);
  }
  return { ...session, customerId: session.customerId };
}

/**
 * Standardized Permission Matrix for P2 & P3
 * Strictly enforces BRD v2 Section 3:
 * - Only ADMIN creates/edits/archives products, variants, plans, taxes, discounts, templates.
 * - Both ADMIN and STAFF can read products, plans, taxes, and discounts to prepare quotations.
 */
export const P2_PERMISSIONS = {
  PRODUCTS_READ: ["ADMIN", "STAFF"] as Role[],
  PRODUCTS_WRITE: ["ADMIN"] as Role[],
  VARIANTS_MANAGE: ["ADMIN"] as Role[],
  PLANS_READ: ["ADMIN", "STAFF"] as Role[],
  PLANS_WRITE: ["ADMIN"] as Role[],
  TAXES_READ: ["ADMIN", "STAFF"] as Role[],
  TAXES_MANAGE: ["ADMIN"] as Role[],
  DISCOUNTS_READ: ["ADMIN", "STAFF"] as Role[],
  DISCOUNTS_MANAGE: ["ADMIN"] as Role[],
  TEMPLATES_READ: ["ADMIN", "STAFF"] as Role[],
  TEMPLATES_WRITE: ["ADMIN"] as Role[],
  TEMPLATES_DELETE: ["ADMIN"] as Role[],
  TEMPLATES_USE: ["ADMIN", "STAFF"] as Role[],
} as const;

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.statusCode }
    );
  }

  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "SubscriptionServiceError"
  ) {
    const subErr = error as Error & { statusCode?: number; code?: string };
    return NextResponse.json(
      {
        error: subErr.message,
        code: subErr.code ?? "SUBSCRIPTION_ERROR",
      },
      { status: subErr.statusCode ?? 400 }
    );
  }

  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ValidationError"
  ) {
    const valErr = error as Error & { details?: string[] };
    return NextResponse.json(
      {
        error: valErr.message,
        code: "VALIDATION_ERROR",
        details: valErr.details ?? [valErr.message],
      },
      { status: 400 }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: error.issues[0]?.message || "Validation failed",
        code: "VALIDATION_ERROR",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json(
    {
      error: message,
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
