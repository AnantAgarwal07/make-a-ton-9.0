// Re-exports P1's real authentication and role-based authorization utilities from @/lib/auth.
export {
  getCurrentUser,
  requireRole,
  requireUser,
  requireAuthenticatedRole,
  type CurrentUser,
  type Role,
} from "@/lib/auth";
