// TEMPORARY auth stub until P1 ships src/lib/auth.ts. Swap the imports to "@/lib/auth" then delete this file.
import { HttpError } from "./http-error";

export type Role = "ADMIN" | "STAFF" | "CUSTOMER";
export interface CurrentUser {
  id: number;
  role: Role;
  customerId: number | null;
}

const FAKE_ADMIN: CurrentUser = { id: 1, role: "ADMIN", customerId: null };

/**
 * Returns a fake ADMIN. In development only, you can impersonate other roles with headers:
 *   x-debug-role: ADMIN | STAFF | CUSTOMER | NONE (NONE => not logged in => 401)
 *   x-debug-customer-id: 2   (for CUSTOMER)
 */
export async function getCurrentUser(req?: Request): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV === "production" || !req) return FAKE_ADMIN;
  const role = req.headers.get("x-debug-role")?.toUpperCase();
  if (!role) return FAKE_ADMIN;
  if (role === "NONE") return null;
  if (role !== "ADMIN" && role !== "STAFF" && role !== "CUSTOMER") return FAKE_ADMIN;
  const cid = Number(req.headers.get("x-debug-customer-id"));
  return { id: 999, role, customerId: Number.isInteger(cid) && cid > 0 ? cid : null };
}

/** 401 if not logged in, 403 if role not allowed. Returns the user (non-null) for convenience. */
export function requireRole(user: CurrentUser | null, ...roles: Role[]): CurrentUser {
  if (!user) throw new HttpError(401, "Not authenticated");
  if (roles.length && !roles.includes(user.role)) throw new HttpError(403, "Forbidden");
  return user;
}

