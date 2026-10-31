"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Plus,
  Tag,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  CustomerDTO,
  DiscountDTO,
  PlanDTO,
  ProductDTO,
  ProductVariantDTO,
  SubscriptionDTO,
  SubscriptionLineDTO,
  TaxDTO,
} from "@/lib/subscriptions/types";
import { PAYMENT_TERMS_OPTIONS } from "@/lib/subscriptions/validation";
import { findApplicableDiscounts } from "@/lib/catalog/discount";

interface LineDraft {
  productId: number | "";
  variantId: number | "";
  quantity: number;
  unitPrice: string;
  taxId: number | "";
  customPriceEdited: boolean;
}

export function SubscriptionForm({
  mode,
  initialSubscription,
}: {
  mode: "create" | "edit";
  initialSubscription?: SubscriptionDTO;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<{
    customers: CustomerDTO[];
    plans: PlanDTO[];
    products: ProductDTO[];
    taxes: TaxDTO[];
    discounts: DiscountDTO[];
  }>({
    customers: [],
    plans: [],
    products: [],
    taxes: [],
    discounts: [],
  });

  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([]);

  // Quick-Create Customer Modal state
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerModalError, setCustomerModalError] = useState<string | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const nextYearIso = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const defaultValidUntilIso = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>(
    initialSubscription?.customerId ? String(initialSubscription.customerId) : ""
  );
  const [planId, setPlanId] = useState<string>(
    initialSubscription?.planId ? String(initialSubscription.planId) : ""
  );
  const [startDate, setStartDate] = useState<string>(
    initialSubscription?.startDate
      ? new Date(initialSubscription.startDate).toISOString().slice(0, 10)
      : todayIso
  );
  const [expiryDate, setExpiryDate] = useState<string>(
    initialSubscription?.expiryDate
      ? new Date(initialSubscription.expiryDate).toISOString().slice(0, 10)
      : nextYearIso
  );
  const [paymentTermsDays, setPaymentTermsDays] = useState<number>(
    initialSubscription?.paymentTermsDays ?? 15
  );
  const [quotationValidUntil, setQuotationValidUntil] = useState<string>(
    initialSubscription?.quotationValidUntil
      ? new Date(initialSubscription.quotationValidUntil).toISOString().slice(0, 10)
      : defaultValidUntilIso
  );
  const [note, setNote] = useState<string>("");

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (initialSubscription?.lines && initialSubscription.lines.length > 0) {
      return initialSubscription.lines.map((l: SubscriptionLineDTO) => ({
        productId: l.productId,
        variantId: l.variantId ?? "",
        quantity: l.quantity,
        unitPrice: Number(l.unitPrice).toFixed(2),
        taxId: l.taxId ?? "",
        customPriceEdited: true,
      }));
    }
    return [
      {
        productId: "",
        variantId: "",
        quantity: 1,
        unitPrice: "0.00",
        taxId: "",
        customPriceEdited: false,
      },
    ];
  });

  useEffect(() => {
    fetch("/api/subscriptions/catalog")
      .then((r) => r.json())
      .then((data) => {
        if (data.customers) {
          setCatalog({
            customers: data.customers || [],
            plans: data.plans || [],
            products: data.products || [],
            taxes: data.taxes || [],
            discounts: data.discounts || [],
          });

          // Default new lines to active 18% GST tax rule when available
          const activeTaxes: TaxDTO[] = data.taxes || [];
          const gst18 =
            activeTaxes.find(
              (t) => t.type === "PERCENT" && Math.abs(Number(t.rate) - 18) < 0.01
            ) || activeTaxes[0];

          if (gst18) {
            setLines((prev) =>
              prev.map((line) => ({
                ...line,
                taxId: line.taxId ? line.taxId : gst18.id,
              }))
            );
          }
        }
      })
      .finally(() => setLoadingCatalog(false));
  }, []);

  const defaultTaxId = useMemo(() => {
    const gst18 =
      catalog.taxes.find(
        (t) => t.type === "PERCENT" && Math.abs(Number(t.rate) - 18) < 0.01
      ) || catalog.taxes[0];
    return gst18 ? gst18.id : "";
  }, [catalog.taxes]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return catalog.customers;
    const q = customerSearch.trim().toLowerCase();
    return catalog.customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q))
    );
  }, [catalog.customers, customerSearch]);

  const selectedPlan = useMemo(
    () => catalog.plans.find((p) => String(p.id) === String(planId)),
    [catalog.plans, planId]
  );

  function computeSuggestedPrice(prodId: number | "", varId: number | ""): string {
    const prod = catalog.products.find((p) => p.id === Number(prodId));
    if (!prod) return "0.00";
    let price = Number(prod.salesPrice);
    if (varId) {
      const variant = prod.variants?.find((v: ProductVariantDTO) => v.id === Number(varId));
      if (variant) {
        price += Number(variant.extraPrice);
      }
    }
    return price.toFixed(2);
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, ...patch };

        if (patch.productId !== undefined && patch.productId !== line.productId) {
          updated.variantId = "";
          updated.unitPrice = computeSuggestedPrice(patch.productId, "");
          updated.customPriceEdited = false;
        } else if (patch.variantId !== undefined && patch.variantId !== line.variantId) {
          updated.unitPrice = computeSuggestedPrice(updated.productId, patch.variantId);
          updated.customPriceEdited = false;
        }
        return updated;
      })
    );
  }

  function addLine() {
    const minQty = selectedPlan?.minQuantity ?? 1;
    setLines((prev) => [
      ...prev,
      {
        productId: "",
        variantId: "",
        quantity: minQty,
        unitPrice: "0.00",
        taxId: defaultTaxId,
        customPriceEdited: false,
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleQuickCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    setCustomerModalError(null);
    setCreatingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCustomerName,
          email: newCustomerEmail,
          phone: newCustomerPhone || null,
          address: newCustomerAddress || null,
          createLoginAccount: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCustomerModalError(data.error || "Failed to create customer");
        return;
      }
      const created: CustomerDTO = data.customer;
      setCatalog((prev) => ({
        ...prev,
        customers: [created, ...prev.customers],
      }));
      setCustomerId(String(created.id));
      setNewCustomerName("");
      setNewCustomerEmail("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      setShowAddCustomer(false);
    } catch (err: unknown) {
      setCustomerModalError(err instanceof Error ? err.message : "Failed to add customer");
    } finally {
      setCreatingCustomer(false);
    }
  }

  const calculatedSummary = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;

    const lineBreakdowns = lines.map((l) => {
      const qty = Number(l.quantity) || 0;
      const unit = Number(l.unitPrice) || 0;
      const lineAmount = qty * unit;
      subtotal += lineAmount;

      let lineTax = 0;
      if (l.taxId) {
        const taxObj = catalog.taxes.find((t) => t.id === Number(l.taxId));
        if (taxObj && taxObj.isActive) {
          if (taxObj.type === "PERCENT") {
            lineTax = (lineAmount * Number(taxObj.rate)) / 100;
          } else {
            lineTax = Number(taxObj.rate) * qty;
          }
        }
      }
      taxTotal += lineTax;

      return {
        lineAmount: lineAmount.toFixed(2),
        lineTax: lineTax.toFixed(2),
      };
    });

    // Evaluate eligible discounts via P2's shared function
    let eligibleDiscount: {
      id: number;
      name: string;
      type: "FIXED" | "PERCENT";
      value: number;
      discountAmount: number;
      scope: string;
    } | null = null;
    let discountAmount = 0;

    const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    if (validLines.length > 0 && catalog.discounts.length > 0) {
      try {
        const evalRes = findApplicableDiscounts(
          {
            lines: validLines.map((l) => ({
              productId: Number(l.productId),
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
            })),
          },
          new Date(),
          catalog.discounts
        );
        if (evalRes.bestDiscount && evalRes.appliedDiscountAmount > 0) {
          eligibleDiscount = evalRes.bestDiscount;
          discountAmount = evalRes.appliedDiscountAmount;
        }
      } catch {
        // Ignore discount preview error while typing
      }
    }

    const subtotalAfterDiscount = Math.max(0, subtotal - discountAmount);
    const grandTotal = subtotalAfterDiscount + taxTotal;

    return {
      lineBreakdowns,
      subtotal: subtotal.toFixed(2),
      discountAmount: discountAmount.toFixed(2),
      eligibleDiscount,
      subtotalAfterDiscount: subtotalAfterDiscount.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: grandTotal.toFixed(2),
    };
  }, [lines, catalog.taxes, catalog.discounts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);

    if (catalog.taxes.length === 0) {
      setError(
        "Setup Error: No active Tax rule exists in the database. An Administrator must configure an active tax rule (e.g., GST 18%) before creating subscription lines."
      );
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        customerId: Number(customerId),
        planId: Number(planId),
        startDate,
        expiryDate,
        paymentTermsDays: Number(paymentTermsDays),
        quotationValidUntil: quotationValidUntil || null,
        note: note || undefined,
        lines: lines.map((l) => ({
          productId: Number(l.productId),
          variantId: l.variantId ? Number(l.variantId) : null,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice,
          taxId: Number(l.taxId),
        })),
      };

      const url =
        mode === "create"
          ? "/api/subscriptions"
          : `/api/subscriptions/${initialSubscription?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save subscription");
        if (data.details && Array.isArray(data.details)) {
          setFieldErrors(data.details);
        }
        return;
      }

      router.push(`/subscriptions/${data.id}`);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingCatalog) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Loading customers, plans, products, and tax configuration from PostgreSQL...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {catalog.taxes.length === 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <span>Active Tax Configuration Required (Admin Setup Error)</span>
          </div>
          <p className="mt-1 text-xs">
            No active tax rule was found in the database. Please ask an Admin to create an active tax rule (such as GST 18%) under Catalog & Pricing before creating subscriptions.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            <span>{error}</span>
          </div>
          {fieldErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 space-y-1 text-xs">
              {fieldErrors.map((fe, idx) => (
                <li key={idx}>
                  <span className="font-mono font-semibold">{fe.path}:</span> {fe.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section A: Customer Selection + Quick-Create */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                A. Customer Selection
              </h2>
              <p className="text-xs text-slate-500">
                Select an existing customer or quick-create a new customer record in PostgreSQL without leaving this form.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCustomer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 transition"
            >
              <UserPlus className="h-4 w-4" />
              + Add customer
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Filter / Search Customer
              </label>
              <input
                type="text"
                placeholder="Type customer name, email, or phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Selected Customer *
              </label>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              >
                <option value="">Select Customer...</option>
                {filteredCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.email}){c.phone ? ` • ${c.phone}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Section B: Plan and Subscription Dates */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              B. Plan, Schedule & Payment Terms
            </h2>
            <p className="text-xs text-slate-500">
              Billing frequency and lifecycle rules come from the selected Plan. Payment terms are configured from the agreed dropdown.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Subscription Plan *
              </label>
              <select
                required
                value={planId}
                onChange={(e) => {
                  const newPlanId = e.target.value;
                  setPlanId(newPlanId);
                  const found = catalog.plans.find((p) => String(p.id) === newPlanId);
                  if (found) {
                    setLines((prev) =>
                      prev.map((l) => ({
                        ...l,
                        quantity: Math.max(l.quantity, found.minQuantity),
                      }))
                    );
                  }
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              >
                <option value="">Select Plan...</option>
                {catalog.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.billingPeriod} (Min Qty: {p.minQuantity})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Payment Terms *
              </label>
              <select
                required
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              >
                {PAYMENT_TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value} days)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedPlan && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-slate-900">{selectedPlan.name}</span> (Read-Only Plan Context) • Billing Frequency:{" "}
                <span className="font-semibold text-slate-800">{selectedPlan.billingPeriod}</span> • Plan Reference Price:{" "}
                <span className="font-mono font-semibold">₹{Number(selectedPlan.price).toFixed(2)}</span> • Minimum Quantity:{" "}
                <span className="font-semibold">{selectedPlan.minQuantity}</span> • Available:{" "}
                <span className="font-semibold">
                  {new Date(selectedPlan.availableFrom).toISOString().slice(0, 10)}
                </span>
                {selectedPlan.availableTo && (
                  <>
                    {" "}
                    to{" "}
                    <span className="font-semibold">
                      {new Date(selectedPlan.availableTo).toISOString().slice(0, 10)}
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`rounded px-2 py-0.5 font-medium ${
                    selectedPlan.pausable
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {selectedPlan.pausable ? "Pausable" : "Non-Pausable"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 font-medium ${
                    selectedPlan.closable
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {selectedPlan.closable ? "Closable" : "Non-Closable"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 font-medium ${
                    selectedPlan.renewable
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {selectedPlan.renewable ? "Renewable" : "Non-Renewable"}
                </span>
                {selectedPlan.autoClose && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                    Auto-Close at Expiry
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Start Date *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Expiry Date *
              </label>
              <input
                type="date"
                required
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Quotation Valid Until *
              </label>
              <input
                type="date"
                required
                value={quotationValidUntil}
                onChange={(e) => setQuotationValidUntil(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-600 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section C: Dynamically Editable Subscription Product Lines */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                C. Subscription Product Lines
              </h2>
              <p className="text-xs text-slate-500">
                Select active catalogue products/variants, set quantity (minimum {selectedPlan?.minQuantity ?? 1}), enter agreed customer unit price (saved in SubscriptionLine.unitPrice without altering Product master price), and select an active tax rule.
              </p>
            </div>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 transition"
            >
              <Plus className="h-4 w-4" />
              + Add product line
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const productObj = catalog.products.find((p) => p.id === Number(line.productId));
              const variants = productObj?.variants || [];
              const breakdown = calculatedSummary.lineBreakdowns[index];
              const suggestedPrice = computeSuggestedPrice(line.productId, line.variantId);

              return (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 sm:grid-cols-12 items-end"
                >
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Product *
                    </label>
                    <select
                      required
                      value={line.productId}
                      onChange={(e) =>
                        updateLine(index, {
                          productId: e.target.value ? Number(e.target.value) : "",
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    >
                      <option value="">Select Product...</option>
                      {catalog.products.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.name} (Base: ₹{Number(prod.salesPrice).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Variant (Optional)
                    </label>
                    <select
                      disabled={!productObj || variants.length === 0}
                      value={line.variantId}
                      onChange={(e) =>
                        updateLine(index, {
                          variantId: e.target.value ? Number(e.target.value) : "",
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">Base Product (No Variant)</option>
                      {variants.map((v: ProductVariantDTO) => (
                        <option key={v.id} value={v.id}>
                          {v.attribute}: {v.value} (+₹{Number(v.extraPrice).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Qty *
                    </label>
                    <input
                      type="number"
                      min={selectedPlan?.minQuantity ?? 1}
                      required
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(index, { quantity: Number(e.target.value) })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">
                        Agreed Unit Price (₹) *
                      </label>
                      {line.productId && (
                        <span className="text-[10px] text-slate-400">
                          Suggested: ₹{suggestedPrice}
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={line.unitPrice}
                      onChange={(e) =>
                        updateLine(index, {
                          unitPrice: e.target.value,
                          customPriceEdited: true,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Active Tax Rule *
                    </label>
                    <select
                      required
                      value={line.taxId}
                      onChange={(e) =>
                        updateLine(index, {
                          taxId: e.target.value ? Number(e.target.value) : "",
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                    >
                      {catalog.taxes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.type === "PERCENT" ? `${Number(t.rate)}%` : `₹${Number(t.rate)}`})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="block text-xs text-slate-500">Line Amount</span>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        ₹{breakdown?.lineAmount ?? "0.00"}
                      </span>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Running Subtotal, Eligible P2 Discount & Tax Breakdown */}
          <div className="mt-4 flex flex-col items-end border-t border-slate-100 pt-4 text-sm space-y-1.5">
            <div className="flex w-72 justify-between text-slate-600">
              <span>Lines Subtotal:</span>
              <span className="font-mono font-medium">₹{calculatedSummary.subtotal}</span>
            </div>

            {calculatedSummary.eligibleDiscount && (
              <div className="flex w-72 justify-between text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-xs">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Tag className="h-3.5 w-3.5" />
                  Eligible Offer ({calculatedSummary.eligibleDiscount.name}):
                </span>
                <span className="font-mono font-semibold">
                  -₹{calculatedSummary.discountAmount}
                </span>
              </div>
            )}

            <div className="flex w-72 justify-between text-slate-600">
              <span>Tax Total:</span>
              <span className="font-mono font-medium">₹{calculatedSummary.taxTotal}</span>
            </div>

            <div className="flex w-72 justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
              <span>Grand Total:</span>
              <span className="font-mono text-slate-800">₹{calculatedSummary.grandTotal}</span>
            </div>
          </div>
        </div>

        {mode === "create" && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Internal / Quotation Note (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g., Tailored offer prepared for customer review"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || catalog.taxes.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting
              ? "Saving to PostgreSQL..."
              : mode === "create"
              ? "Save Draft Subscription"
              : "Save Changes"}
          </button>
        </div>
      </form>

      {/* Quick-Create Customer Modal ("+ Add customer") */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Add New Customer
                </h3>
                <p className="text-xs text-slate-500">
                  Saves directly to PostgreSQL Customer table and selects it for this subscription.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {customerModalError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                {customerModalError}
              </div>
            )}

            <form onSubmit={handleQuickCreateCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Name (Individual or Business) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Horizon Enterprises or Priya Nair"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  placeholder="contact@customer.test"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="Street, City, State"
                  value={newCustomerAddress}
                  onChange={(e) => setNewCustomerAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingCustomer}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {creatingCustomer ? "Saving..." : "Save & Select Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
