"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Plus, Trash2 } from "lucide-react";
import {
  CustomerDTO,
  PlanDTO,
  ProductDTO,
  ProductVariantDTO,
  QuotationTemplateDTO,
  QuotationTemplateLineDTO,
  SubscriptionDTO,
  SubscriptionLineDTO,
  TaxDTO,
} from "@/lib/subscriptions/types";

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
    templates: QuotationTemplateDTO[];
  }>({
    customers: [],
    plans: [],
    products: [],
    taxes: [],
    templates: [],
  });

  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ path: string; message: string }>>([]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const nextYearIso = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
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
      : ""
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
          setCatalog(data);
        }
      })
      .finally(() => setLoadingCatalog(false));
  }, []);

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

  function handleApplyTemplate(tmplId: string) {
    setSelectedTemplateId(tmplId);
    if (!tmplId) return;
    const tmpl = catalog.templates.find((t) => String(t.id) === tmplId);
    if (!tmpl) return;

    setPlanId(String(tmpl.planId));
    const validDate = new Date();
    validDate.setUTCDate(validDate.getUTCDate() + (tmpl.validityDays || 30));
    setQuotationValidUntil(validDate.toISOString().slice(0, 10));

    if (tmpl.lines && tmpl.lines.length > 0) {
      const mappedLines: LineDraft[] = tmpl.lines.map((tl: QuotationTemplateLineDTO) => ({
        productId: tl.productId,
        variantId: tl.variantId ?? "",
        quantity: tl.quantity,
        unitPrice: computeSuggestedPrice(tl.productId, tl.variantId ?? ""),
        taxId: "",
        customPriceEdited: false,
      }));
      setLines(mappedLines);
    }
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
        taxId: "",
        customPriceEdited: false,
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
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
        if (taxObj) {
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

    return {
      lineBreakdowns,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: (subtotal + taxTotal).toFixed(2),
    };
  }, [lines, catalog.taxes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);
    setSubmitting(true);

    try {
      const payload = {
        customerId: Number(customerId),
        planId: Number(planId),
        templateId: selectedTemplateId ? Number(selectedTemplateId) : null,
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
          taxId: l.taxId ? Number(l.taxId) : null,
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
        if (data.details) {
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
        Loading customers, plans, products, and quotation templates...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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

      {mode === "create" && catalog.templates.length > 0 && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Start from Quotation Template (Optional)
                </h3>
                <p className="text-xs text-slate-600">
                  Pre-fills the plan, quotation validity date, and product/variant lines from P2 templates.
                </p>
              </div>
            </div>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleApplyTemplate(e.target.value)}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">-- Choose a Quotation Template --</option>
              {catalog.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.plan?.name} • {t.validityDays}d validity)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <h2 className="text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
          Customer, Plan & Schedule
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Customer *
            </label>
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select Customer...</option>
              {catalog.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Subscription Plan *
            </label>
            <select
              required
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select Plan...</option>
              {catalog.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.billingPeriod} (Min Qty: {p.minQuantity})
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedPlan && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-slate-900">{selectedPlan.name}:</span>{" "}
              Billing: <span className="font-semibold">{selectedPlan.billingPeriod}</span> • Min Quantity:{" "}
              <span className="font-semibold">{selectedPlan.minQuantity}</span> • Available From:{" "}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Start Date *
            </label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Payment Terms (Days) *
            </label>
            <input
              type="number"
              min={0}
              required
              value={paymentTermsDays}
              onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Quotation Valid Until
            </label>
            <input
              type="date"
              value={quotationValidUntil}
              onChange={(e) => setQuotationValidUntil(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Subscription Lines */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Subscription Lines</h2>
            <p className="text-xs text-slate-500">
              Default unit price is Product Sales Price + Variant Extra Price. Staff may override the agreed per-customer unit price.
            </p>
          </div>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
          >
            <Plus className="h-4 w-4" />
            Add Line
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => {
            const productObj = catalog.products.find((p) => p.id === Number(line.productId));
            const variants = productObj?.variants || [];
            const breakdown = calculatedSummary.lineBreakdowns[index];

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
                        {prod.name} (₹{Number(prod.salesPrice).toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Variant
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
                    <option value="">No Variant</option>
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Agreed Unit Price (₹) *
                  </label>
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
                    Tax Rule
                  </label>
                  <select
                    value={line.taxId}
                    onChange={(e) =>
                      updateLine(index, {
                        taxId: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
                  >
                    <option value="">No Tax</option>
                    {catalog.taxes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.type === "PERCENT" ? `${t.rate}%` : `₹${t.rate}`})
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

        {/* Totals Summary */}
        <div className="mt-4 flex flex-col items-end border-t border-slate-100 pt-4 text-sm space-y-1">
          <div className="flex w-64 justify-between text-slate-600">
            <span>Lines Subtotal:</span>
            <span className="font-mono font-medium">₹{calculatedSummary.subtotal}</span>
          </div>
          <div className="flex w-64 justify-between text-slate-600">
            <span>Estimated Tax:</span>
            <span className="font-mono font-medium">₹{calculatedSummary.taxTotal}</span>
          </div>
          <div className="flex w-64 justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
            <span>Total Estimated:</span>
            <span className="font-mono text-indigo-700">₹{calculatedSummary.grandTotal}</span>
          </div>
        </div>
      </div>

      {mode === "create" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
            Creation Note (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g., Custom enterprise offer negotiated for Q4"
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
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          {submitting
            ? "Saving..."
            : mode === "create"
            ? "Create Draft Subscription"
            : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
