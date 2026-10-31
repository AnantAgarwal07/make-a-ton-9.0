"use client";

import React, { useState } from "react";
import {
  DiscountDto,
  formatINR,
  formatShortDate,
  ProductDto,
  toDateInputValue,
  UserPermissions,
  UserRole,
} from "./types";

interface DiscountsTabProps {
  discounts: DiscountDto[];
  products: ProductDto[];
  loading: boolean;
  role: UserRole;
  permissions: UserPermissions;
  onRefresh: () => Promise<void>;
  notify: (type: "success" | "error" | "info", title: string, description?: string) => void;
}

export default function DiscountsTab({
  discounts,
  products,
  loading,
  role,
  permissions,
  onRefresh,
  notify,
}: DiscountsTabProps) {
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"ALL" | "SUBSCRIPTION" | "PRODUCT">("ALL");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<DiscountDto | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("10");
  const [scope, setScope] = useState<"SUBSCRIPTION" | "PRODUCT">("SUBSCRIPTION");
  const [minPurchase, setMinPurchase] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState("2027-12-31");
  const [usageLimit, setUsageLimit] = useState("100");
  const [isActive, setIsActive] = useState(true);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Interactive findApplicableDiscounts(subscription, date) simulator
  const [simDate, setSimDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [simLines, setSimLines] = useState<
    { productId: number; quantity: string; unitPrice: string }[]
  >(() => [
    {
      productId: products[0]?.id ?? 1,
      quantity: "2",
      unitPrice: String(products[0]?.salesPrice ?? 1560),
    },
  ]);
  const [evalResult, setEvalResult] = useState<{
    subscriptionSubtotal: number;
    subscriptionQuantity: number;
    eligibleDiscounts: {
      id: number;
      name: string;
      type: string;
      value: number;
      scope: string;
      discountAmount: number;
    }[];
    ineligibleDiscounts: {
      id: number;
      name: string;
      reasons: string[];
    }[];
    bestDiscount: {
      id: number;
      name: string;
      discountAmount: number;
    } | null;
    appliedDiscountAmount: number;
    stackingResult: {
      policy: string;
      subtotalBeforeDiscount: number;
      subtotalAfterDiscount: number;
    };
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const filteredDiscounts = discounts.filter((d) => {
    if (scopeFilter !== "ALL" && d.scope !== scopeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!d.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function openCreateModal() {
    setEditingDiscount(null);
    setName("");
    setType("PERCENT");
    setValue("15");
    setScope("SUBSCRIPTION");
    setMinPurchase("");
    setMinQuantity("");
    setStartDate("2026-01-01");
    setEndDate("2027-12-31");
    setUsageLimit("100");
    setIsActive(true);
    setSelectedProductIds(products[0] ? [products[0].id] : []);
    setModalOpen(true);
  }

  function openEditModal(discount: DiscountDto) {
    setEditingDiscount(discount);
    setName(discount.name);
    setType(discount.type);
    setValue(String(discount.value));
    setScope(discount.scope);
    setMinPurchase(discount.minPurchase !== null ? String(discount.minPurchase) : "");
    setMinQuantity(discount.minQuantity !== null ? String(discount.minQuantity) : "");
    setStartDate(toDateInputValue(discount.startDate));
    setEndDate(toDateInputValue(discount.endDate));
    setUsageLimit(discount.usageLimit !== null ? String(discount.usageLimit) : "");
    setIsActive(discount.isActive);
    setSelectedProductIds(discount.productIds || []);
    setModalOpen(true);
  }

  async function handleSaveDiscount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name,
        type,
        value: Number(value),
        scope,
        minPurchase: minPurchase !== "" ? Number(minPurchase) : null,
        minQuantity: minQuantity !== "" ? Number(minQuantity) : null,
        startDate,
        endDate,
        usageLimit: usageLimit !== "" ? Number(usageLimit) : null,
        isActive,
        productIds: scope === "PRODUCT" ? selectedProductIds : [],
      };

      const url = editingDiscount
        ? `/api/discounts/${editingDiscount.id}`
        : "/api/discounts";
      const method = editingDiscount ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? `HTTP 403 Forbidden: ${data.error}`
            : data.error || "Failed to save discount"
        );
      }

      notify(
        "success",
        editingDiscount ? "Discount Updated" : "Discount Created",
        data.message
      );
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify("error", "Discount Operation Blocked", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(discount: DiscountDto) {
    try {
      const res = await fetch(`/api/discounts/${discount.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({ isActive: !discount.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? `HTTP 403 Forbidden: ${data.error}`
            : data.error || "Failed to update discount"
        );
      }
      notify(
        "success",
        "Discount Updated",
        `${discount.name} is now ${!discount.isActive ? "Active" : "Inactive"}`
      );
      await onRefresh();
    } catch (err) {
      notify("error", "Access Denied", (err as Error).message);
    }
  }

  async function handleDeleteDiscount(discount: DiscountDto) {
    try {
      const res = await fetch(`/api/discounts/${discount.id}`, {
        method: "DELETE",
        headers: { "x-user-role": role },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? `HTTP 403 Forbidden: ${data.error}`
            : data.error || "Failed to delete discount"
        );
      }
      notify("success", "Discount Deleted", data.message);
      await onRefresh();
    } catch (err) {
      notify("error", "Cannot Delete Discount", (err as Error).message);
    }
  }

  async function handleRunEvaluateDiscounts() {
    setEvaluating(true);
    try {
      const res = await fetch("/api/discounts/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({
          date: simDate,
          subscription: {
            lines: simLines.map((l) => ({
              productId: Number(l.productId),
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
            })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to evaluate discounts");
      }
      setEvalResult(data);
      notify(
        "info",
        "findApplicableDiscounts() Evaluated",
        data.bestDiscount
          ? `Best Discount: ${data.bestDiscount.name} (-${formatINR(data.appliedDiscountAmount)})`
          : "No eligible discounts matched this subscription"
      );
    } catch (err) {
      notify("error", "Evaluation Failed", (err as Error).message);
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Discount Campaigns & Eligibility Rules
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                ADMIN Only (HTTP 403 for STAFF)
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure FIXED & PERCENT discounts, PRODUCT vs SUBSCRIPTION scope, minimum purchase/quantity thresholds, and usage limits.
            </p>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition"
          >
            + New Discount Campaign
          </button>
        </div>

        {!permissions.canManageDiscounts && (
          <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-900 flex items-center justify-between gap-4">
            <div>
              <strong>RBAC Enforcement Active ({role}):</strong> Only <strong>ADMIN</strong> is permitted to manage discounts. Attempting to create or modify a discount as {role} will return <code>HTTP 403 Forbidden</code> from the backend API.
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              Test HTTP 403 Response
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search discount name..."
            className="px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/60 text-slate-900 max-w-sm focus:outline-none focus:ring-2 focus:ring-slate-600"
          />

          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(["ALL", "SUBSCRIPTION", "PRODUCT"] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setScopeFilter(sc)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  scopeFilter === sc
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {sc === "ALL" ? "All Scopes" : `${sc} Scope`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Discounts Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-sm text-slate-500">
          Loading discount campaigns...
        </div>
      ) : filteredDiscounts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-sm text-slate-500">
          {permissions.canManageDiscounts
            ? "No discounts match your filters. Create a discount campaign above."
            : "Discount management list is restricted to ADMIN role (HTTP 403 for STAFF). Use the Simulator below to test findApplicableDiscounts()."}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Campaign & Value</th>
                  <th className="py-3.5 px-4">Scope & Products</th>
                  <th className="py-3.5 px-4">Eligibility Thresholds</th>
                  <th className="py-3.5 px-4">Date Window & Usage</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDiscounts.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <td className="py-4 px-4 align-top">
                      <div className="font-bold text-slate-900">{d.name}</div>
                      <div className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
                        {d.type === "PERCENT" ? `${d.value}% OFF` : `${formatINR(d.value)} OFF`}
                      </div>
                    </td>

                    <td className="py-4 px-4 align-top">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                          d.scope === "SUBSCRIPTION"
                            ? "bg-purple-50 text-purple-700 border border-purple-200"
                            : "bg-sky-50 text-sky-700 border border-sky-200"
                        }`}
                      >
                        {d.scope}
                      </span>
                      {d.scope === "PRODUCT" && (
                        <div className="mt-1.5 flex flex-wrap gap-1 max-w-xs">
                          {d.products.map((p) => (
                            <span
                              key={p.productId}
                              className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-medium"
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4 align-top text-xs text-slate-600 space-y-1">
                      <div>
                        Min Purchase:{" "}
                        <strong className="text-slate-900">
                          {d.minPurchase !== null ? formatINR(d.minPurchase) : "None"}
                        </strong>
                      </div>
                      <div>
                        Min Quantity:{" "}
                        <strong className="text-slate-900">
                          {d.minQuantity !== null ? `${d.minQuantity} units` : "None"}
                        </strong>
                      </div>
                    </td>

                    <td className="py-4 px-4 align-top text-xs text-slate-600 space-y-1">
                      <div>
                        {formatShortDate(d.startDate)} → {formatShortDate(d.endDate)}
                      </div>
                      <div className="font-medium text-slate-800">
                        Used: {d.timesUsed} / {d.usageLimit !== null ? d.usageLimit : "∞"}
                      </div>
                    </td>

                    <td className="py-4 px-4 align-top">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(d)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          d.lifecycleStatus === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : d.lifecycleStatus === "SCHEDULED"
                            ? "bg-sky-100 text-sky-800 border-sky-200"
                            : "bg-slate-100 text-slate-600 border-slate-200"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {d.lifecycleStatus}
                      </button>
                    </td>

                    <td className="py-4 px-4 align-top text-right space-x-2">
                      <button
                        onClick={() => openEditModal(d)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteDiscount(d)}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interactive P3 Handover Simulator: findApplicableDiscounts(subscription, date) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900">
              <span>P2 → P3 Billing Handover Function</span>
              <code className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-900">
                findApplicableDiscounts(subscription, date)
              </code>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Pure Discount Eligibility & Non-Stacking Highest-Benefit Simulator
            </h3>
            <p className="text-xs text-slate-500">
              Evaluates active status, date range, usage limits, minimum purchase/quantity, and PRODUCT vs SUBSCRIPTION scope. Selects the single discount yielding the highest monetary benefit without mutating timesUsed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-600">Target Date:</span>
              <input
                type="date"
                value={simDate}
                onChange={(e) => setSimDate(e.target.value)}
                className="text-xs font-semibold text-slate-900 bg-transparent focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() =>
                setSimLines([
                  ...simLines,
                  {
                    productId: products[0]?.id ?? 1,
                    quantity: "1",
                    unitPrice: String(products[0]?.salesPrice ?? 1000),
                  },
                ])
              }
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              + Add Subscription Line
            </button>

            <button
              type="button"
              disabled={evaluating}
              onClick={handleRunEvaluateDiscounts}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm"
            >
              {evaluating ? "Evaluating..." : "▶ Run findApplicableDiscounts()"}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {simLines.map((line, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-slate-50 p-3 rounded-xl border border-slate-200/70"
            >
              <div className="sm:col-span-5">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Product
                </label>
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const pid = Number(e.target.value);
                    const prod = products.find((p) => p.id === pid);
                    const next = [...simLines];
                    next[idx].productId = pid;
                    if (prod) next[idx].unitPrice = String(prod.salesPrice);
                    setSimLines(next);
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatINR(p.salesPrice)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(e) => {
                    const next = [...simLines];
                    next[idx].quantity = e.target.value;
                    setSimLines(next);
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Unit Price (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => {
                    const next = [...simLines];
                    next[idx].unitPrice = e.target.value;
                    setSimLines(next);
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                />
              </div>

              <div className="sm:col-span-1 flex justify-end">
                {simLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSimLines(simLines.filter((_, i) => i !== idx))}
                    className="text-rose-500 hover:text-rose-700 font-bold text-xs px-2"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {evalResult && (
          <div className="mt-5 p-4 rounded-xl bg-slate-900 text-slate-100 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs text-slate-400 block">Stacking Policy</span>
                <code className="text-xs text-slate-400 font-mono">
                  {evalResult.stackingResult.policy}
                </code>
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-xs text-slate-400 block">Subscription Subtotal</span>
                  <span className="text-sm font-bold">
                    {formatINR(evalResult.subscriptionSubtotal)} ({evalResult.subscriptionQuantity} units)
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Selected Best Discount</span>
                  <span className="text-base font-extrabold text-emerald-400">
                    {evalResult.bestDiscount
                      ? `${evalResult.bestDiscount.name} (-${formatINR(evalResult.appliedDiscountAmount)})`
                      : "None (₹0.00)"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Net After Discount</span>
                  <span className="text-base font-extrabold text-white">
                    {formatINR(evalResult.stackingResult.subtotalAfterDiscount)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-bold text-emerald-400 mb-2">
                  Eligible Discounts ({evalResult.eligibleDiscounts.length})
                </div>
                {evalResult.eligibleDiscounts.length === 0 ? (
                  <div className="text-slate-400">No discounts met all requirements.</div>
                ) : (
                  <div className="space-y-1.5">
                    {evalResult.eligibleDiscounts.map((ed, i) => (
                      <div
                        key={ed.id}
                        className={`p-2.5 rounded-lg border flex items-center justify-between ${
                          i === 0
                            ? "bg-emerald-950/60 border-emerald-600/60 text-emerald-200"
                            : "bg-slate-800 border-slate-700 text-slate-300"
                        }`}
                      >
                        <div>
                          <span className="font-bold">{ed.name}</span>{" "}
                          <span className="text-[11px] opacity-80">({ed.scope})</span>
                          {i === 0 && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                              SELECTED WINNER
                            </span>
                          )}
                        </div>
                        <span className="font-bold">-{formatINR(ed.discountAmount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="font-bold text-amber-400 mb-2">
                  Ineligible Discounts ({evalResult.ineligibleDiscounts.length})
                </div>
                {evalResult.ineligibleDiscounts.length === 0 ? (
                  <div className="text-slate-400">All candidate discounts were eligible.</div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {evalResult.ineligibleDiscounts.map((idisc) => (
                      <div
                        key={idisc.id}
                        className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700"
                      >
                        <div className="font-semibold text-slate-200">{idisc.name}</div>
                        <div className="text-rose-300 mt-0.5">{idisc.reasons.join(" · ")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Discount Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingDiscount ? `Edit Discount: ${editingDiscount.name}` : "Create Discount Campaign"}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDiscount} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Discount Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Welcome 10%, Enterprise Flat ₹500"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Scope *
                  </label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as "SUBSCRIPTION" | "PRODUCT")}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  >
                    <option value="SUBSCRIPTION">SUBSCRIPTION (Entire Order)</option>
                    <option value="PRODUCT">PRODUCT (Specific Products)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Discount Type *
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  >
                    <option value="PERCENT">PERCENT (%)</option>
                    <option value="FIXED">FIXED (₹)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Discount Value ({type === "PERCENT" ? "%" : "₹"}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={type === "PERCENT" ? "100" : undefined}
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              {scope === "PRODUCT" && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    Select Applicable Products *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                    {products
                      .filter((p) => !p.isArchived)
                      .map((p) => {
                        const checked = selectedProductIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedProductIds([...selectedProductIds, p.id]);
                                } else {
                                  setSelectedProductIds(
                                    selectedProductIds.filter((id) => id !== p.id)
                                  );
                                }
                              }}
                              className="rounded border-slate-300 text-slate-900"
                            />
                            <span className="font-medium text-slate-800">{p.name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Min Purchase (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Optional"
                    value={minPurchase}
                    onChange={(e) => setMinPurchase(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Min Quantity
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="Optional"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Usage Limit
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="Unlimited"
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Discount is Active
                </span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
                >
                  {saving
                    ? "Saving..."
                    : editingDiscount
                    ? "Save Discount"
                    : "Create Discount"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

