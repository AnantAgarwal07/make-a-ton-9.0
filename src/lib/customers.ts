import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, signSessionToken, type CurrentUser } from "@/lib/auth";
import {
  type CreateCustomerInput,
  type CustomerListQuery,
  type CustomerRegisterInput,
  type UpdateCustomerInput,
} from "@/lib/auth-schemas";
import { HttpError } from "@/lib/invoices/http-error";

export interface CustomerSummaryItem {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  createdAt: Date;
  userId: number | null;
  isActive: boolean;
  subscriptionsCount: number;
  invoicesCount: number;
}

export interface CustomerDetailResult extends CustomerSummaryItem {
  subscriptions: {
    id: number;
    number: string;
    status: string;
    planName: string;
    startDate: Date;
    expiryDate: Date;
  }[];
  invoices: {
    id: number;
    number: string;
    status: string;
    invoiceDate: Date;
    dueDate: Date;
    total: string;
  }[];
}

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Public customer registration:
 * - Always assigns role = CUSTOMER on the server (never trusts client input).
 * - Checks for duplicate emails across User and Customer.
 * - Hashes password with bcryptjs.
 * - Creates Customer and linked User inside a single database transaction.
 */
export async function registerCustomerAccount(input: CustomerRegisterInput): Promise<{
  user: CurrentUser;
  customer: CustomerSummaryItem;
  token: string;
  redirectTo: string;
}> {
  const normalizedEmail = input.email.trim().toLowerCase();

  const [existingUser, existingCustomer] = await Promise.all([
    prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);

  if (existingUser || existingCustomer) {
    throw new HttpError(409, "An account with this email address already exists");
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: input.name.trim(),
          email: normalizedEmail,
          phone: input.phone ?? null,
          address: input.address ?? null,
        },
      });

      // Strictly hardcode role: "CUSTOMER" on the server
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: "CUSTOMER",
          isActive: true,
          customerId: customer.id,
        },
      });

      return { customer, user };
    });

    const currentUser: CurrentUser = {
      id: created.user.id,
      email: created.user.email,
      name: created.customer.name,
      role: "CUSTOMER",
      isActive: created.user.isActive,
      customerId: created.customer.id,
    };

    const token = await signSessionToken({
      userId: currentUser.id,
      email: currentUser.email,
      role: "CUSTOMER",
      customerId: currentUser.customerId,
    });

    return {
      user: currentUser,
      customer: {
        id: created.customer.id,
        name: created.customer.name,
        email: created.customer.email,
        phone: created.customer.phone,
        address: created.customer.address,
        createdAt: created.customer.createdAt,
        userId: created.user.id,
        isActive: created.user.isActive,
        subscriptionsCount: 0,
        invoicesCount: 0,
      },
      token,
      redirectTo: "/customer",
    };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new HttpError(409, "An account with this email address already exists");
    }
    throw e;
  }
}

/**
 * Paginated server-side customer list with search by name, email, or Customer ID.
 * Restricted to ADMIN and STAFF.
 */
export async function listCustomers(
  actor: CurrentUser,
  query: CustomerListQuery
): Promise<{
  items: CustomerSummaryItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") {
    throw new HttpError(403, "Forbidden: only administrators and staff can list all customers");
  }

  const andConditions: Prisma.CustomerWhereInput[] = [];

  if (query.search) {
    const rawSearch = query.search.trim();
    const numericCandidate = Number(rawSearch.replace(/^#/, ""));
    const orFilters: Prisma.CustomerWhereInput[] = [
      { name: { contains: rawSearch, mode: "insensitive" } },
      { email: { contains: rawSearch, mode: "insensitive" } },
    ];
    if (Number.isInteger(numericCandidate) && numericCandidate > 0 && numericCandidate <= 2147483647) {
      orFilters.push({ id: numericCandidate });
    }
    andConditions.push({ OR: orFilters });
  }

  if (query.status === "active") {
    andConditions.push({
      OR: [{ user: { is: { isActive: true } } }, { user: { is: null } }],
    });
  } else if (query.status === "inactive") {
    andConditions.push({
      user: { is: { isActive: false } },
    });
  }

  const where: Prisma.CustomerWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const skip = (query.page - 1) * query.pageSize;

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
      include: {
        user: {
          select: {
            id: true,
            isActive: true,
          },
        },
        _count: {
          select: {
            subscriptions: true,
            invoices: true,
          },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  const items: CustomerSummaryItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    createdAt: row.createdAt,
    userId: row.user?.id ?? null,
    isActive: row.user ? row.user.isActive : true,
    subscriptionsCount: row._count.subscriptions,
    invoicesCount: row._count.invoices,
  }));

  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * Fetches full details for a single customer.
 * Enforces strict data isolation: CUSTOMER role can only view their own linked customerId.
 */
export async function getCustomerById(
  actor: CurrentUser,
  customerId: number
): Promise<CustomerDetailResult> {
  if (actor.role === "CUSTOMER") {
    if (!actor.customerId || actor.customerId !== customerId) {
      throw new HttpError(403, "Forbidden: you may only access your own customer profile");
    }
  }

  const row = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
        },
      },
      _count: {
        select: {
          subscriptions: true,
          invoices: true,
        },
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          plan: {
            select: { name: true },
          },
        },
      },
      invoices: {
        orderBy: { invoiceDate: "desc" },
        take: 10,
        select: {
          id: true,
          number: true,
          status: true,
          invoiceDate: true,
          dueDate: true,
          total: true,
        },
      },
    },
  });

  if (!row) {
    throw new HttpError(404, "Customer not found");
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    createdAt: row.createdAt,
    userId: row.user?.id ?? null,
    isActive: row.user ? row.user.isActive : true,
    subscriptionsCount: row._count.subscriptions,
    invoicesCount: row._count.invoices,
    subscriptions: row.subscriptions.map((s) => ({
      id: s.id,
      number: s.number,
      status: s.status,
      planName: s.plan.name,
      startDate: s.startDate,
      expiryDate: s.expiryDate,
    })),
    invoices: row.invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      total: inv.total.toFixed(2),
    })),
  };
}

/**
 * Creates a customer (and linked CUSTOMER User account) by an ADMIN or STAFF member.
 */
export async function createCustomerRecord(
  actor: CurrentUser,
  input: CreateCustomerInput
): Promise<CustomerSummaryItem> {
  if (actor.role !== "ADMIN" && actor.role !== "STAFF") {
    throw new HttpError(403, "Forbidden: only administrators and staff can create customers");
  }

  const normalizedEmail = input.email.trim().toLowerCase();

  const [existingUser, existingCustomer] = await Promise.all([
    prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);

  if (existingUser || existingCustomer) {
    throw new HttpError(409, "A customer or user with this email address already exists");
  }

  const rawPassword = input.password || `Cust@${Math.random().toString(36).slice(2, 10)}!1`;
  const passwordHash = await hashPassword(rawPassword);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          name: input.name.trim(),
          email: normalizedEmail,
          phone: input.phone ?? null,
          address: input.address ?? null,
        },
      });

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          role: "CUSTOMER",
          isActive: true,
          customerId: customer.id,
        },
      });

      return { customer, user };
    });

    return {
      id: created.customer.id,
      name: created.customer.name,
      email: created.customer.email,
      phone: created.customer.phone,
      address: created.customer.address,
      createdAt: created.customer.createdAt,
      userId: created.user.id,
      isActive: created.user.isActive,
      subscriptionsCount: 0,
      invoicesCount: 0,
    };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new HttpError(409, "A customer or user with this email address already exists");
    }
    throw e;
  }
}

/**
 * Updates a customer's details and synchronizes Customer.email <-> User.email
 * and User.isActive inside a database transaction.
 * Enforces strict permissions:
 * - CUSTOMER can only update their own profile and cannot modify isActive.
 * - ADMIN and STAFF can update any customer and toggle isActive.
 */
export async function updateCustomerRecord(
  actor: CurrentUser,
  customerId: number,
  input: UpdateCustomerInput
): Promise<CustomerSummaryItem> {
  if (actor.role === "CUSTOMER") {
    if (!actor.customerId || actor.customerId !== customerId) {
      throw new HttpError(403, "Forbidden: you may only edit your own customer profile");
    }
    if (input.isActive !== undefined) {
      throw new HttpError(403, "Forbidden: customers cannot modify account activation status");
    }
  }

  const existing = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      user: {
        select: { id: true, email: true, isActive: true },
      },
      _count: {
        select: { subscriptions: true, invoices: true },
      },
    },
  });

  if (!existing) {
    throw new HttpError(404, "Customer not found");
  }

  const nextEmail = input.email ? input.email.trim().toLowerCase() : undefined;

  if (nextEmail && nextEmail !== existing.email.toLowerCase()) {
    const [dupCustomer, dupUser] = await Promise.all([
      prisma.customer.findFirst({
        where: {
          email: { equals: nextEmail, mode: "insensitive" },
          id: { not: customerId },
        },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: {
          email: { equals: nextEmail, mode: "insensitive" },
          ...(existing.user ? { id: { not: existing.user.id } } : {}),
        },
        select: { id: true },
      }),
    ]);

    if (dupCustomer || dupUser) {
      throw new HttpError(409, "Another account with this email address already exists");
    }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(nextEmail !== undefined ? { email: nextEmail } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
        },
      });

      let userState = existing.user;
      if (existing.user) {
        const shouldUpdateUser =
          (nextEmail !== undefined && nextEmail !== existing.user.email.toLowerCase()) ||
          (input.isActive !== undefined && input.isActive !== existing.user.isActive);

        if (shouldUpdateUser) {
          userState = await tx.user.update({
            where: { id: existing.user.id },
            data: {
              ...(nextEmail !== undefined ? { email: nextEmail } : {}),
              ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            },
            select: { id: true, email: true, isActive: true },
          });
        }
      }

      return { customer, user: userState };
    });

    return {
      id: updated.customer.id,
      name: updated.customer.name,
      email: updated.customer.email,
      phone: updated.customer.phone,
      address: updated.customer.address,
      createdAt: updated.customer.createdAt,
      userId: updated.user?.id ?? null,
      isActive: updated.user ? updated.user.isActive : true,
      subscriptionsCount: existing._count.subscriptions,
      invoicesCount: existing._count.invoices,
    };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      throw new HttpError(409, "Another account with this email address already exists");
    }
    throw e;
  }
}

