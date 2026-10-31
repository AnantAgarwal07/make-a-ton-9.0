export interface CustomerDTO {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  user?: {
    id: number;
    email: string;
    role: string;
    isActive: boolean;
  } | null;
  _count?: {
    subscriptions?: number;
  };
}

export interface PlanDTO {
  id: number;
  name: string;
  price: string | number;
  billingPeriod: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  minQuantity: number;
  availableFrom: string;
  availableTo?: string | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

export interface ProductVariantDTO {
  id: number;
  productId: number;
  attribute: string;
  value: string;
  extraPrice: string | number;
}

export interface ProductDTO {
  id: number;
  name: string;
  type: string;
  salesPrice: string | number;
  costPrice: string | number;
  isArchived?: boolean;
  variants?: ProductVariantDTO[];
}

export interface TaxDTO {
  id: number;
  name: string;
  type: "PERCENT" | "FIXED";
  rate: string | number;
  isActive: boolean;
}

export interface DiscountDTO {
  id: number;
  name: string;
  type: "FIXED" | "PERCENT";
  value: string | number;
  minPurchase?: string | number | null;
  minQuantity?: number | null;
  startDate: string;
  endDate: string;
  usageLimit?: number | null;
  timesUsed: number;
  scope: "PRODUCT" | "SUBSCRIPTION";
  isActive: boolean;
  products?: Array<{
    discountId: number;
    productId: number;
    product?: { id: number; name: string };
  }>;
}

export interface QuotationTemplateLineDTO {
  id: number;
  templateId: number;
  productId: number;
  variantId?: number | null;
  quantity: number;
}

export interface QuotationTemplateDTO {
  id: number;
  name: string;
  planId: number;
  plan?: PlanDTO;
  validityDays: number;
  lines: QuotationTemplateLineDTO[];
}

export interface SubscriptionLineDTO {
  id: number;
  subscriptionId: number;
  productId: number;
  product?: ProductDTO;
  variantId?: number | null;
  variant?: ProductVariantDTO | null;
  quantity: number;
  unitPrice: string | number;
  taxId?: number | null;
  tax?: TaxDTO | null;
  amount: string | number;
}

export interface SubscriptionHistoryDTO {
  id: number;
  subscriptionId: number;
  fromStatus: string | null;
  toStatus: string;
  changedById: number | null;
  note: string | null;
  changedAt: string;
}

export interface SubscriptionDTO {
  id: number;
  number: string;
  customerId: number;
  customer?: CustomerDTO;
  planId: number;
  plan?: PlanDTO;
  status: "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "CLOSED";
  isPaused: boolean;
  startDate: string;
  expiryDate: string;
  paymentTermsDays: number;
  nextInvoiceDate?: string | null;
  quotationValidUntil?: string | null;
  createdById?: number | null;
  lines: SubscriptionLineDTO[];
  history: SubscriptionHistoryDTO[];
  isQuotationExpired: boolean;
  pauseEvaluation?: {
    isPaused: boolean;
    pausedAt: string | null;
    maxAllowedCycles: number;
    maxPauseUntil: string | null;
    elapsedMs: number;
    elapsedDays: number;
    limitReached: boolean;
    warningMessage: string | null;
  } | null;
  totals: {
    linesSubtotal: string;
    discountTotal: string;
    eligibleDiscount?: {
      id: number;
      name: string;
      type: "FIXED" | "PERCENT";
      value: number;
      scope: "PRODUCT" | "SUBSCRIPTION";
      discountAmount: number;
    } | null;
    subtotalAfterDiscount: string;
    taxTotal: string;
    planReferencePrice: string;
    grandTotal: string;
    includesPlanFee: boolean;
  };
  permittedActions: {
    nextStatus: "QUOTATION" | "CONFIRMED" | "ACTIVE" | "CLOSED" | null;
    canSendQuotation: boolean;
    canCustomerAccept: boolean;
    canEdit: boolean;
    canPause: boolean;
    canResume: boolean;
    canClose: boolean;
    canRenew: boolean;
  };
}
