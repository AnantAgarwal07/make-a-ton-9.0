import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  formatDisplayName,
  hashPassword,
  type CurrentUser,
  type Role,
} from "@/lib/auth";
import {
  type CreateStaffInput,
  type StaffListQuery,
  type UpdateStaffStatusInput,
} from "@/lib/auth-schemas";
import { HttpError } from "@/lib/invoices/http-error";

export interface StaffMemberItem {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

function assertAdmin(actor: CurrentUser) {
  if (actor.role !== "ADMIN") {
    throw new HttpError(403, "Forbidden: only administrators can manage staff accounts");
  }
}

/**
 * Lists STAFF and ADMIN accounts for administrator management.
 * Supports searching by name or email, and filtering by status or role.
 * Never exposes passwordHash.
 */
export async function listStaffMembers(
  actor: CurrentUser,
  query: StaffListQuery
): Promise<{ items: StaffMemberItem[]; total: number }> {
  assertAdmin(actor);

  const where: Prisma.UserWhereInput = {
    role:
      query.role === "STAFF"
        ? "STAFF"
        : query.role === "ADMIN"
          ? "ADMIN"
          : { in: ["ADMIN", "STAFF"] },
    ...(query.status === "active"
      ? { isActive: true }
      : query.status === "inactive"
        ? { isActive: false }
        : {}),
  };

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  const mapped: StaffMemberItem[] = rows.map((row) => ({
    id: row.id,
    name: formatDisplayName(row.email),
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
  }));

  const searchLower = query.search?.trim().toLowerCase();
  const filtered = searchLower
    ? mapped.filter(
        (item) =>
          item.email.toLowerCase().includes(searchLower) ||
          item.name.toLowerCase().includes(searchLower) ||
          String(item.id) === searchLower.replace(/^#/, "")
      )
    : mapped;

  return {
    items: filtered,
    total: filtered.length,
  };
}

/**
 * Creates a new STAFF account.
 * Restricted strictly to ADMIN users. Never creates ADMIN accounts or exposes passwordHash.
 */
export async function createStaffAccount(
  actor: CurrentUser,
  input: CreateStaffInput
): Promise<StaffMemberItem> {
  assertAdmin(actor);

  const normalizedEmail = input.email.trim().toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(409, "A user with this email address already exists");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: "STAFF",
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return {
      id: created.id,
      name: formatDisplayName(created.email),
      email: created.email,
      role: created.role,
      isActive: created.isActive,
      createdAt: created.createdAt,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "A user with this email address already exists");
    }
    throw e;
  }
}

/**
 * Activates or deactivates a STAFF or ADMIN account.
 * Prevents deactivating the last active ADMIN account.
 */
export async function updateStaffAccountStatus(
  actor: CurrentUser,
  targetUserId: number,
  input: UpdateStaffStatusInput
): Promise<StaffMemberItem> {
  assertAdmin(actor);

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!target || (target.role !== "STAFF" && target.role !== "ADMIN")) {
    throw new HttpError(404, "Staff member not found");
  }

  // Prevent deactivating the last active administrator
  if (target.role === "ADMIN" && target.isActive && input.isActive === false) {
    const activeAdminCount = await prisma.user.count({
      where: {
        role: "ADMIN",
        isActive: true,
      },
    });

    if (activeAdminCount <= 1) {
      throw new HttpError(
        400,
        "Cannot deactivate the last active administrator account"
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { isActive: input.isActive },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  return {
    id: updated.id,
    name: formatDisplayName(updated.email),
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
    createdAt: updated.createdAt,
  };
}

