import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/invoices/http-error";
import {
  getRoleDashboardPath,
  getSessionCookieOptions,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
  type Role,
} from "@/lib/session";

export {
  getRoleDashboardPath,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
  type Role,
};

export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  customerId: number | null;
}

// Constant dummy bcrypt hash to prevent user-enumeration timing attacks
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8D0R5V6P3h0wG8v8zK5y8zK5y8zK5y";

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
  if (req) {
    const cookieHeader = req.headers.get("cookie");
    const fromHeader = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
    if (fromHeader) return fromHeader;
  }
  try {
    const cookieStore = cookies();
    return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the currently authenticated user from the HTTP-only JWT session cookie
 * and verifies that the account exists and is active in the database.
 */
export async function getCurrentUser(req?: Request): Promise<CurrentUser | null> {
  // In non-production, allow explicit x-debug-role header override for API testing
  if (process.env.NODE_ENV !== "production" && req) {
    const debugRole = req.headers.get("x-debug-role")?.toUpperCase();
    if (debugRole) {
      if (debugRole === "NONE") return null;
      if (debugRole === "ADMIN" || debugRole === "STAFF" || debugRole === "CUSTOMER") {
        const cid = Number(req.headers.get("x-debug-customer-id"));
        return {
          id: 999,
          email: `${debugRole.toLowerCase()}@brightloop.test`,
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

  const payload = await verifySessionToken(token);
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
    id: dbUser.id,
    email: dbUser.email,
    name: formatDisplayName(dbUser.email, dbUser.customer?.name),
    role: dbUser.role,
    isActive: dbUser.isActive,
    customerId: dbUser.customerId,
  };
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
 * Requires an authenticated, active user with one of the specified roles.
 * Throws 401 if not logged in, 403 if inactive or role is not allowed.
 */
export function requireRole(user: CurrentUser | null, ...roles: Role[]): CurrentUser {
  const authenticated = requireUser(user);
  if (roles.length > 0 && !roles.includes(authenticated.role)) {
    throw new HttpError(403, "Forbidden");
  }
  return authenticated;
}

/**
 * Async helper for API routes and server actions: fetches current user and enforces role(s).
 */
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

