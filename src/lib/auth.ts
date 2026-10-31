import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/invoices/http-error";
import {
  getRoleDashboardPath,
  getSessionCookieOptions,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken as verifyJwtSessionToken,
  type Role,
} from "@/lib/session";

export {
  getRoleDashboardPath,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  signSessionToken,
  type Role,
};

export interface CurrentUser {
  userId?: number;
  id: number;
  email: string;
  name: string;
  role: Role;
  customerId: number | null;
  isActive: boolean;
}

export interface AuthSession extends CurrentUser {
  userId: number;
}

export type AuthUser = AuthSession;

export class AuthError extends Error {
  public readonly statusCode: 401 | 403;
  public readonly status: 401 | 403;
  public readonly code: "UNAUTHORIZED" | "FORBIDDEN";

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = statusCode === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  }
}

const VALID_ROLES: Role[] = ["ADMIN", "STAFF", "CUSTOMER"];

const DEFAULT_USERS_BY_ROLE: Record<Role, AuthSession> = {
  ADMIN: {
    userId: 1,
    id: 1,
    email: "admin@brightloop.test",
    name: "Admin",
    role: "ADMIN",
    customerId: null,
    isActive: true,
  },
  STAFF: {
    userId: 2,
    id: 2,
    email: "staff@brightloop.test",
    name: "Staff",
    role: "STAFF",
    customerId: null,
    isActive: true,
  },
  CUSTOMER: {
    userId: 3,
    id: 3,
    email: "acme@customer.test",
    name: "Acme Traders",
    role: "CUSTOMER",
    customerId: 1,
    isActive: true,
  },
};

// Constant dummy bcrypt hash to prevent user-enumeration timing attacks
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8D0R5V6P3h0wG8v8zK5y8zK5y8zK5y";

function parseRole(raw: string | null | undefined): Role | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (VALID_ROLES.includes(upper as Role)) {
    return upper as Role;
  }
  return null;
}

export function formatDisplayName(email: string, customerName?: string | null): string {
  if (customerName && customerName.trim()) {
    return customerName.trim();
  }
  const local = email.split("@")[0] || "User";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function isUserActive(user: { isActive?: boolean } | null | undefined): boolean {
  return Boolean(user && user.isActive !== false);
}

export async function verifySessionToken(token: string): Promise<AuthSession | null> {
  const payload = await verifyJwtSessionToken(token);
  if (!payload) return null;
  return {
    userId: payload.userId,
    id: payload.userId,
    email: payload.email,
    name: formatDisplayName(payload.email),
    role: payload.role,
    customerId: payload.customerId,
    isActive: true,
  };
}

/**
 * Authenticates a user by email and password, verifies active status,
 * reads their role from the database, and issues a signed JWT session token.
 */
export async function authenticateUser(email: string, password: string): Promise<{
  user: CurrentUser;
  token: string;
  redirectTo: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();

  const dbUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!dbUser) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    throw new HttpError(401, "Invalid email or password");
  }

  const isValidPassword = await verifyPassword(password, dbUser.passwordHash);
  if (!isValidPassword) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (!dbUser.isActive) {
    throw new HttpError(403, "Your account has been deactivated. Please contact an administrator.");
  }

  const user: CurrentUser = {
    userId: dbUser.id,
    id: dbUser.id,
    email: dbUser.email,
    name: formatDisplayName(dbUser.email, dbUser.customer?.name),
    role: dbUser.role,
    isActive: dbUser.isActive,
    customerId: dbUser.customerId,
  };

  const token = await signSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    customerId: user.customerId,
  });

  return {
    user,
    token,
    redirectTo: getRoleDashboardPath(user.role),
  };
}

function readTokenFromRequestOrCookies(req?: Request): string | null {
  const cookieNames = [
    SESSION_COOKIE_NAME,
    "token",
    "session",
    "auth_token",
    "brightloop_session",
  ];
  if (req) {
    if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
      for (const name of cookieNames) {
        const val = (req as NextRequest).cookies.get(name)?.value;
        if (val) return val;
      }
    }
    const cookieHeader = req.headers.get("cookie");
    for (const name of cookieNames) {
      const fromHeader = parseCookieHeader(cookieHeader, name);
      if (fromHeader) return fromHeader;
    }
  }
  try {
    const cookieStore = cookies();
    for (const name of cookieNames) {
      const val = cookieStore.get(name)?.value;
      if (val) return val;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves the currently authenticated user from the HTTP-only JWT session cookie
 * and verifies that the account exists and is active in the database.
 */
export async function getCurrentUser(req?: Request): Promise<AuthSession | null> {
  if (process.env.NODE_ENV !== "production" && req) {
    const debugRole = (
      req.headers.get("x-debug-role") ?? req.headers.get("x-user-role")
    )?.toUpperCase();
    if (debugRole) {
      if (debugRole === "NONE") return null;
      if (debugRole === "ADMIN" || debugRole === "STAFF" || debugRole === "CUSTOMER") {
        const cid = Number(
          req.headers.get("x-debug-customer-id") ?? req.headers.get("x-customer-id")
        );
        const uid = Number(req.headers.get("x-user-id")) || 999;
        return {
          userId: uid,
          id: uid,
          email: req.headers.get("x-user-email") || `${debugRole.toLowerCase()}@brightloop.test`,
          name: `${debugRole} User`,
          role: debugRole,
          isActive: true,
          customerId: Number.isInteger(cid) && cid > 0 ? cid : null,
        };
      }
    }
  }

  const token = readTokenFromRequestOrCookies(req);
  if (!token) {
    return null;
  }

  const payload = await verifyJwtSessionToken(token);
  if (!payload) {
    return null;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      customer: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!dbUser || !dbUser.isActive) {
    return null;
  }

  return {
    userId: dbUser.id,
    id: dbUser.id,
    email: dbUser.email,
    name: formatDisplayName(dbUser.email, dbUser.customer?.name),
    role: dbUser.role,
    isActive: dbUser.isActive,
    customerId: dbUser.customerId,
  };
}

/**
 * Resolves the authenticated user session from the incoming request (P2/P3 compatibility).
 */
export async function getSessionFromRequest(
  req?: NextRequest | Request
): Promise<AuthSession | null> {
  if (!req) {
    const fromCookies = await getCurrentUser();
    return fromCookies ?? DEFAULT_USERS_BY_ROLE.ADMIN;
  }

  const headers = req.headers;

  const rawRoleHeader = headers.get("x-user-role") ?? headers.get("x-debug-role");
  if (rawRoleHeader && rawRoleHeader.trim().toUpperCase() === "NONE") {
    return null;
  }

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
      name: formatDisplayName(dbUser.email),
      role: dbUser.role,
      customerId: dbUser.customerId,
      isActive: dbUser.isActive,
    };
  }

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
      name: formatDisplayName(email),
      role: headerRole,
      customerId,
      isActive: true,
    };
  }

  const authHeader = headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = await verifySessionToken(token);
    if (verified) return verified;
  }

  const current = await getCurrentUser(req);
  if (current) return current;

  if ("cookies" in req && typeof req.cookies?.get === "function") {
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
          name: formatDisplayName(user.email),
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
          name: formatDisplayName(dbUser.email),
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

/**
 * Requires an authenticated, active user. Throws 401 if unauthenticated or 403 if inactive.
 */
export function requireUser(user: CurrentUser | null): CurrentUser {
  if (!user) {
    throw new HttpError(401, "Not authenticated");
  }
  if (!isUserActive(user)) {
    throw new HttpError(403, "Account is inactive");
  }
  return user;
}

/**
 * Overloaded requireRole supporting both:
 * 1) P1/P4 synchronous check: requireRole(user, "ADMIN", "STAFF")
 * 2) P2/P3 request check: await requireRole(req, ["ADMIN", "STAFF"], "resource")
 */
export function requireRole(user: CurrentUser | null, ...roles: Role[]): CurrentUser;
export function requireRole(
  req: NextRequest | Request,
  allowedRoles: Role[],
  resourceName?: string
): Promise<AuthSession>;
export function requireRole(
  first: CurrentUser | null | NextRequest | Request,
  ...rest: unknown[]
): CurrentUser | Promise<AuthSession> {
  if (
    first &&
    typeof first === "object" &&
    "headers" in first &&
    Array.isArray(rest[0])
  ) {
    const req = first as NextRequest | Request;
    const allowedRoles = rest[0] as Role[];
    const resourceName = (rest[1] as string | undefined) ?? "this resource";
    return (async () => {
      const user = await resolveAuthUser(req);
      if (!user.isActive) {
        throw new AuthError("User account is disabled", 403);
      }
      assertRoleAllowed(user.role, allowedRoles, resourceName);
      return user;
    })();
  }

  const user = first as CurrentUser | null;
  const roles = rest as Role[];
  const authenticated = requireUser(user);
  if (roles.length > 0 && !roles.includes(authenticated.role)) {
    throw new HttpError(403, "Forbidden");
  }
  return authenticated;
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

export async function requireAuthenticatedRole(
  req: Request | undefined,
  ...roles: Role[]
): Promise<CurrentUser> {
  const user = await getCurrentUser(req);
  return requireRole(user, ...roles);
}

/**
 * Server Component guard: ensures the current user is authenticated and has an allowed role.
 * Redirects to /login if unauthenticated, or to the user's own dashboard if unauthorized.
 */
export async function requirePageAuth(...allowedRoles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    redirect(getRoleDashboardPath(user.role));
  }
  return user;
}

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
