export type UserRole = "ADMIN" | "STAFF" | "CUSTOMER";

export interface UserPermissions {
  canReadProducts: boolean;
  canWriteProducts: boolean;
  canManageVariants: boolean;
  canReadPlans: boolean;
  canWritePlans: boolean;
  canManageTaxes: boolean;
  canManageDiscounts: boolean;
  canReadTemplates: boolean;
  canWriteTemplates: boolean;
  canDeleteTemplates: boolean;
  canUseTemplates: boolean;
}

export interface ProductVariantDto {
  id: number;
  productId: number;
  attribute: string;
  value: string;
  extraPrice: number;
  finalPrice: number;
}

export interface ProductDto {
  id: number;
  name: string;
  type: string;
  salesPrice: number;
  costPrice: number;
  margin: number;
  marginPercent: number;
  notes: string | null;
  isArchived: boolean;
  variants: ProductVariantDto[];
  _count?: {
    subscriptionLines?: number;
    templateLines?: number;
    discountProducts?: number;
  };
}

export type BillingPeriodType = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface PlanDto {
  id: number;
  name: string;
  price: number;
  billingPeriod: BillingPeriodType;
  minQuantity: number;
  availableFrom: string;
  availableTo: string | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isCurrentlyAvailable: boolean;
  availabilityReason: string | null;
  _count?: {
    subscriptions?: number;
    templates?: number;
  };
}

export interface TaxDto {
  id: number;
  name: string;
  type: "PERCENT" | "FIXED";
  rate: number;
  isActive: boolean;
  _count?: {
    lines?: number;
  };
}

export interface DiscountDto {
  id: number;
  name: string;
  type: "FIXED" | "PERCENT";
  value: number;
  minPurchase: number | null;
  minQuantity: number | null;
  startDate: string;
  endDate: string;
  usageLimit: number | null;
  timesUsed: number;
  remainingUses: number | null;
  scope: "PRODUCT" | "SUBSCRIPTION";
  isActive: boolean;
  lifecycleStatus: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "INACTIVE";
  productIds: number[];
  products: {
    productId: number;
    name: string;
    type: string;
    salesPrice: number;
    isArchived: boolean;
  }[];
}

export interface QuotationTemplateLineDto {
  id: number;
  templateId: number;
  productId: number;
  productName: string;
  productType: string;
  productIsArchived: boolean;
  baseSalesPrice: number;
  variantId: number | null;
  variantAttribute: string | null;
  variantValue: string | null;
  variantExtraPrice: number;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface QuotationTemplateDto {
  id: number;
  name: string;
  planId: number;
  validityDays: number;
  plan: PlanDto;
  lines: QuotationTemplateLineDto[];
  linesSubtotal: number;
  planPrice: number;
  estimatedCycleTotal: number;
  totalQuantity: number;
  hasArchivedProduct: boolean;
  isReadyToUse: boolean;
}

export interface CatalogSummaryDto {
  totalProducts: number;
  activeProducts: number;
  archivedProducts: number;
  totalVariants: number;
  totalPlans: number;
  availablePlans: number;
  totalTaxes: number;
  activeTaxes: number;
  totalDiscounts: number;
  activeDiscounts: number;
  totalTemplates: number;
}

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  title: string;
  description?: string;
}

export function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Indefinite";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

