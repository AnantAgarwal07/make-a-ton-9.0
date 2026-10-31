import type { CurrentUser } from "@/lib/auth";
import { HttpError } from "./http-error";

/**
 * Rule 5: which customerId a query must be restricted to.
 * Staff/admin: whatever they asked for (or no restriction). CUSTOMER: always their own id.
 */
export function customerScope(user: CurrentUser, requested?: number): number | undefined {
  if (user.role !== "CUSTOMER") return requested;
  if (!user.customerId) throw new HttpError(403, "No customer account linked to this user");
  return user.customerId;
}

/**
 * Customer Portal scoping:
 * - CUSTOMER role: strictly forced to `user.customerId` (403 if missing).
 * - ADMIN / STAFF (previewing portal or using the dev auth stub): uses `requested` customerId if provided,
 *   or defaults to customerId = 1 so the portal works out-of-the-box in dev.
 */
export function portalCustomerScope(user: CurrentUser, requested?: number): number {
  if (user.role === "CUSTOMER") {
    if (!user.customerId) throw new HttpError(403, "No customer account linked to this user");
    return user.customerId;
  }
  return requested ?? user.customerId ?? 1;
}

