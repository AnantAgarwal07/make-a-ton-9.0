import { z } from "zod";
import { SubscriptionStatus } from "@prisma/client";

export const subscriptionLineInputSchema = z.object({
  productId: z.coerce.number().int().positive("Product ID is required"),
  variantId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: z
    .union([z.number(), z.string()])
    .optional()
    .refine(
      (val) => val === undefined || val === "" || (!isNaN(Number(val)) && Number(val) >= 0),
      "Unit price must be a non-negative number"
    ),
  taxId: z.coerce.number().int().positive().nullable().optional(),
});

export const createSubscriptionSchema = z
  .object({
    customerId: z.coerce.number().int().positive("Customer is required"),
    planId: z.coerce.number().int().positive("Plan is required"),
    templateId: z.coerce.number().int().positive().nullable().optional(),
    startDate: z.string().or(z.date()).transform((val) => new Date(val)),
    expiryDate: z.string().or(z.date()).transform((val) => new Date(val)),
    paymentTermsDays: z.coerce.number().int().min(0, "Payment terms cannot be negative").default(15),
    quotationValidUntil: z
      .string()
      .or(z.date())
      .nullable()
      .optional()
      .transform((val) => (val ? new Date(val) : null)),
    lines: z
      .array(subscriptionLineInputSchema)
      .min(1, "At least one subscription line is required")
      .optional(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => !isNaN(data.startDate.getTime()), {
    message: "Invalid start date",
    path: ["startDate"],
  })
  .refine((data) => !isNaN(data.expiryDate.getTime()), {
    message: "Invalid expiry date",
    path: ["expiryDate"],
  })
  .refine((data) => data.expiryDate.getTime() > data.startDate.getTime(), {
    message: "Expiry date must be after start date",
    path: ["expiryDate"],
  });

export const updateSubscriptionSchema = z
  .object({
    customerId: z.coerce.number().int().positive().optional(),
    planId: z.coerce.number().int().positive().optional(),
    startDate: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val))
      .optional(),
    expiryDate: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val))
      .optional(),
    paymentTermsDays: z.coerce.number().int().min(0).optional(),
    quotationValidUntil: z
      .string()
      .or(z.date())
      .nullable()
      .optional()
      .transform((val) => (val ? new Date(val) : null)),
    lines: z
      .array(subscriptionLineInputSchema)
      .min(1, "At least one subscription line is required")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.expiryDate) {
        return data.expiryDate.getTime() > data.startDate.getTime();
      }
      return true;
    },
    {
      message: "Expiry date must be after start date",
      path: ["expiryDate"],
    }
  );

export const transitionStatusSchema = z.object({
  toStatus: z.nativeEnum(SubscriptionStatus),
  note: z.string().max(500).optional(),
});

export const actionNoteSchema = z.object({
  note: z.string().max(500).optional(),
});

export const subscriptionListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  isPaused: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  planId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

