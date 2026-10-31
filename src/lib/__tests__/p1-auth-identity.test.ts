import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma client using vi.hoisted so it is initialized before hoisted vi.mock()
const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  passwordResetToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import {
  authenticateUser,
  getCurrentUser,
  getRoleDashboardPath,
  hashPassword,
  requireRole,
  requireUser,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
  type CurrentUser,
} from "@/lib/auth";
import { customerRegisterSchema } from "@/lib/auth-schemas";
import {
  getCustomerById,
  listCustomers,
  registerCustomerAccount,
  updateCustomerRecord,
} from "@/lib/customers";
import {
  createStaffAccount,
  listStaffMembers,
  updateStaffAccountStatus,
} from "@/lib/staff";
import {
  completePasswordReset,
  generateResetToken,
  GENERIC_RESET_REQUEST_MESSAGE,
  hashResetToken,
  requestPasswordReset,
  validatePasswordResetToken,
} from "@/lib/password-reset";
import { HttpError } from "@/lib/invoices/http-error";

const ADMIN_ACTOR: CurrentUser = {
  id: 1,
  email: "admin@brightloop.test",
  name: "Admin",
  role: "ADMIN",
  isActive: true,
  customerId: null,
};

const STAFF_ACTOR: CurrentUser = {
  id: 2,
  email: "staff@brightloop.test",
  name: "Staff",
  role: "STAFF",
  isActive: true,
  customerId: null,
};

const CUSTOMER_ACTOR_1: CurrentUser = {
  id: 10,
  email: "acme@customer.test",
  name: "Acme Traders",
  role: "CUSTOMER",
  isActive: true,
  customerId: 100,
};

describe("P1 Authentication, Identity, Customer & Staff Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => unknown) =>
      cb(mockPrisma)
    );
  });

  describe("1. Password Verification & JWT Sessions", () => {
    it("hashes and verifies passwords accurately with bcryptjs", async () => {
      const hash = await hashPassword("SecretPass!123");
      expect(hash).not.toBe("SecretPass!123");
      expect(await verifyPassword("SecretPass!123", hash)).toBe(true);
      expect(await verifyPassword("WrongPassword!123", hash)).toBe(false);
    });

    it("signs and verifies JWT session tokens and maps roles to correct dashboards", async () => {
      const token = await signSessionToken({
        userId: 42,
        email: "staff@brightloop.test",
        role: "STAFF",
        customerId: null,
      });
      const payload = await verifySessionToken(token);
      expect(payload).toMatchObject({
        userId: 42,
        email: "staff@brightloop.test",
        role: "STAFF",
        customerId: null,
      });
      expect(getRoleDashboardPath("ADMIN")).toBe("/admin");
      expect(getRoleDashboardPath("STAFF")).toBe("/staff");
      expect(getRoleDashboardPath("CUSTOMER")).toBe("/customer");
    });
  });

  describe("2. Valid Login, Invalid Login & Inactive Account Rejection", () => {
    it("authenticates a valid active user and returns role-specific redirect", async () => {
      const pwHash = await hashPassword("Admin@1234");
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: "admin@brightloop.test",
        passwordHash: pwHash,
        role: "ADMIN",
        isActive: true,
        customerId: null,
        customer: null,
      });

      const result = await authenticateUser("ADMIN@brightloop.test", "Admin@1234");
      expect(result.user.role).toBe("ADMIN");
      expect(result.redirectTo).toBe("/admin");
      expect(result.token).toBeTruthy();
      expect("passwordHash" in result.user).toBe(false);
    });

    it("rejects login with invalid password or non-existent email (401)", async () => {
      const pwHash = await hashPassword("Admin@1234");
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 1,
        email: "admin@brightloop.test",
        passwordHash: pwHash,
        role: "ADMIN",
        isActive: true,
        customerId: null,
        customer: null,
      });

      await expect(authenticateUser("admin@brightloop.test", "WrongPass")).rejects.toMatchObject({
        status: 401,
      });

      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(authenticateUser("unknown@brightloop.test", "Admin@1234")).rejects.toMatchObject({
        status: 401,
      });
    });

    it("rejects login for inactive accounts (403) and invalidates session lookup if deactivated", async () => {
      const pwHash = await hashPassword("Admin@1234");
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 5,
        email: "deactivated@brightloop.test",
        passwordHash: pwHash,
        role: "STAFF",
        isActive: false,
        customerId: null,
        customer: null,
      });

      await expect(
        authenticateUser("deactivated@brightloop.test", "Admin@1234")
      ).rejects.toMatchObject({
        status: 403,
      });

      // Even if a user holds an existing JWT cookie, getCurrentUser returns null if deactivated in DB
      const token = await signSessionToken({
        userId: 5,
        email: "deactivated@brightloop.test",
        role: "STAFF",
        customerId: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 5,
        email: "deactivated@brightloop.test",
        role: "STAFF",
        isActive: false,
        customerId: null,
        customer: null,
      });

      const req = new Request("http://localhost:3000/api/auth/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      expect(await getCurrentUser(req)).toBeNull();
    });
  });

  describe("3. Customer Registration & Role Escalation Prevention", () => {
    it("creates Customer and linked User transactionally and strictly forces role = CUSTOMER", async () => {
      // Attempt role escalation in raw input payload
      const rawPayload = {
        name: "New Client Ltd",
        email: "Client@Example.com",
        password: "Password@123",
        phone: "+91 9999988888",
        address: "100 MG Road",
        role: "ADMIN", // malicious attempt to escalate role
      };

      const parsed = customerRegisterSchema.parse(rawPayload);
      expect("role" in parsed).toBe(false);

      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue({
        id: 25,
        name: "New Client Ltd",
        email: "client@example.com",
        phone: "+91 9999988888",
        address: "100 MG Road",
        createdAt: new Date("2026-10-31T00:00:00Z"),
      });
      mockPrisma.user.create.mockImplementation(async ({ data }) => ({
        id: 55,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        isActive: true,
        customerId: data.customerId,
      }));

      const res = await registerCustomerAccount(parsed);
      expect(res.user.role).toBe("CUSTOMER");
      expect(res.user.customerId).toBe(25);
      expect(res.redirectTo).toBe("/customer");
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: "CUSTOMER",
            customerId: 25,
          }),
        })
      );
    });

    it("rejects duplicate emails during customer registration (409)", async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 1 });
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        registerCustomerAccount({
          name: "Duplicate User",
          email: "existing@brightloop.test",
          password: "Password@123",
          phone: null,
          address: null,
        })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("4. Role-Based Access Restrictions & Customer Data Isolation", () => {
    it("enforces requireUser and requireRole on the server", () => {
      expect(() => requireUser(null)).toThrow(HttpError);
      expect(() =>
        requireUser({ ...CUSTOMER_ACTOR_1, isActive: false })
      ).toThrow(HttpError);

      expect(() => requireRole(CUSTOMER_ACTOR_1, "ADMIN", "STAFF")).toThrow(HttpError);
      expect(() => requireRole(STAFF_ACTOR, "ADMIN")).toThrow(HttpError);
      expect(requireRole(ADMIN_ACTOR, "ADMIN")).toEqual(ADMIN_ACTOR);
    });

    it("prevents a CUSTOMER from listing all customers or viewing/editing another customer's record", async () => {
      await expect(
        listCustomers(CUSTOMER_ACTOR_1, { status: "all", page: 1, pageSize: 15 })
      ).rejects.toMatchObject({ status: 403 });

      // CUSTOMER_ACTOR_1 has customerId = 100; accessing customerId = 200 must be forbidden (403)
      await expect(getCustomerById(CUSTOMER_ACTOR_1, 200)).rejects.toMatchObject({
        status: 403,
      });

      await expect(
        updateCustomerRecord(CUSTOMER_ACTOR_1, 200, { name: "Hacked Name" })
      ).rejects.toMatchObject({ status: 403 });

      // Customer cannot modify their own isActive status
      await expect(
        updateCustomerRecord(CUSTOMER_ACTOR_1, 100, { isActive: false })
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("5. Customer Search, Pagination & Transactional Email Sync", () => {
    it("searches customers by name, email, or numeric ID with server pagination", async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 100,
          name: "Acme Traders",
          email: "acme@customer.test",
          phone: "9876543210",
          address: "Kochi",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          user: { id: 10, isActive: true },
          _count: { subscriptions: 2, invoices: 5 },
        },
      ]);
      mockPrisma.customer.count.mockResolvedValue(1);

      const res = await listCustomers(STAFF_ACTOR, {
        search: "#100",
        status: "active",
        page: 2,
        pageSize: 10,
      });

      expect(res.total).toBe(1);
      expect(res.page).toBe(2);
      expect(res.items[0].name).toBe("Acme Traders");
      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });

    it("synchronizes Customer.email and User.email transactionally on update", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 100,
        name: "Acme Traders",
        email: "acme@customer.test",
        phone: null,
        address: null,
        createdAt: new Date(),
        user: { id: 10, email: "acme@customer.test", isActive: true },
        _count: { subscriptions: 1, invoices: 1 },
      });
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.customer.update.mockResolvedValue({
        id: 100,
        name: "Acme Global",
        email: "new-acme@customer.test",
        phone: null,
        address: null,
        createdAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 10,
        email: "new-acme@customer.test",
        isActive: false,
      });

      const updated = await updateCustomerRecord(ADMIN_ACTOR, 100, {
        name: "Acme Global",
        email: "new-acme@customer.test",
        isActive: false,
      });

      expect(updated.email).toBe("new-acme@customer.test");
      expect(updated.isActive).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: { email: "new-acme@customer.test", isActive: false },
        })
      );
    });
  });

  describe("6. Staff Creation, Management & Last-Admin Protection", () => {
    it("forbids non-admins from listing or creating staff accounts", async () => {
      await expect(
        listStaffMembers(STAFF_ACTOR, { status: "all", role: "all" })
      ).rejects.toMatchObject({ status: 403 });

      await expect(
        createStaffAccount(STAFF_ACTOR, {
          email: "other@brightloop.test",
          password: "Password@123",
        })
      ).rejects.toMatchObject({ status: 403 });
    });

    it("allows ADMIN to create STAFF accounts with hashed password and rejects duplicate emails", async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 20,
        email: "ops.staff@brightloop.test",
        role: "STAFF",
        isActive: true,
        createdAt: new Date(),
      });

      const created = await createStaffAccount(ADMIN_ACTOR, {
        email: "Ops.Staff@Brightloop.test",
        password: "Password@123",
      });

      expect(created.role).toBe("STAFF");
      expect(created.email).toBe("ops.staff@brightloop.test");
      expect("passwordHash" in created).toBe(false);

      // Duplicate email rejected with 409
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 20 });
      await expect(
        createStaffAccount(ADMIN_ACTOR, {
          email: "ops.staff@brightloop.test",
          password: "Password@123",
        })
      ).rejects.toMatchObject({ status: 409 });
    });

    it("prevents deactivating the last active administrator", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: "admin@brightloop.test",
        role: "ADMIN",
        isActive: true,
        createdAt: new Date(),
      });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(
        updateStaffAccountStatus(ADMIN_ACTOR, 1, { isActive: false })
      ).rejects.toMatchObject({
        status: 400,
        message: "Cannot deactivate the last active administrator account",
      });
    });
  });

  describe("7. Password Reset Expiration & Token Reuse Prevention", () => {
    it("returns a generic response and stores only SHA-256 token hash on reset request", async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      const resUnknown = await requestPasswordReset("nonexistent@example.com");
      expect(resUnknown.message).toBe(GENERIC_RESET_REQUEST_MESSAGE);
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();

      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: 2,
        email: "staff@brightloop.test",
        isActive: true,
      });
      mockPrisma.passwordResetToken.create.mockResolvedValue({ id: 1 });

      const resKnown = await requestPasswordReset("staff@brightloop.test");
      expect(resKnown.message).toBe(GENERIC_RESET_REQUEST_MESSAGE);
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });

    it("rejects expired tokens and already-used tokens, and prevents token reuse", async () => {
      const { rawToken, tokenHash } = generateResetToken();
      expect(tokenHash).toBe(hashResetToken(rawToken));
      expect(tokenHash).not.toBe(rawToken);

      const now = new Date("2026-10-31T12:00:00Z");
      const expiredDate = new Date("2026-10-31T11:00:00Z");
      const futureDate = new Date("2026-10-31T13:00:00Z");

      // 1. Expired token
      mockPrisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 10,
        userId: 2,
        tokenHash,
        expiresAt: expiredDate,
        usedAt: null,
        user: { id: 2, isActive: true },
      });
      expect((await validatePasswordResetToken(rawToken, now)).valid).toBe(false);

      // 2. Valid unused token -> succeeds once
      mockPrisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 10,
        userId: 2,
        tokenHash,
        expiresAt: futureDate,
        usedAt: null,
        user: { id: 2, isActive: true },
      });
      mockPrisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.user.update.mockResolvedValueOnce({ id: 2 });

      const completed = await completePasswordReset(rawToken, "NewSecurePass!99", now);
      expect(completed.ok).toBe(true);

      // 3. Reusing the same token after usedAt is set must fail (400)
      mockPrisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 10,
        userId: 2,
        tokenHash,
        expiresAt: futureDate,
        usedAt: now,
        user: { id: 2, isActive: true },
      });
      await expect(
        completePasswordReset(rawToken, "AnotherPass!99", now)
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
