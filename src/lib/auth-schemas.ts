import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(255)
  .transform((v) => v.toLowerCase());

export const passwordPolicySchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .max(128, "Password must be at most 128 characters long");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const customerRegisterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(120, "Full name must be at most 120 characters"),
  email: emailSchema,
  password: passwordPolicySchema,
  phone: z
    .string()
    .trim()
    .max(40, "Phone number is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  address: z
    .string()
    .trim()
    .max(500, "Address is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

export const customerListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  status: z.enum(["active", "inactive", "all"]).optional().default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

export const createCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Customer name must be at least 2 characters")
    .max(120, "Customer name must be at most 120 characters"),
  email: emailSchema,
  password: passwordPolicySchema.optional(),
  phone: z
    .string()
    .trim()
    .max(40, "Phone number is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  address: z
    .string()
    .trim()
    .max(500, "Address is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Customer name must be at least 2 characters")
    .max(120, "Customer name must be at most 120 characters")
    .optional(),
  email: emailSchema.optional(),
  phone: z
    .string()
    .trim()
    .max(40, "Phone number is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  address: z
    .string()
    .trim()
    .max(500, "Address is too long")
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const staffListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .optional(),
  status: z.enum(["active", "inactive", "all"]).optional().default("all"),
  role: z.enum(["STAFF", "ADMIN", "all"]).optional().default("all"),
});

export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

export const createStaffSchema = z.object({
  email: emailSchema,
  password: passwordPolicySchema,
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffStatusSchema = z.object({
  isActive: z.boolean(),
});

export type UpdateStaffStatusInput = z.infer<typeof updateStaffStatusSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16, "Invalid or expired reset token"),
  password: passwordPolicySchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
