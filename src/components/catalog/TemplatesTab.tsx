"use client";

import React, { useState } from "react";
import {
  formatINR,
  formatShortDate,
  PlanDto,
  ProductDto,
  QuotationTemplateDto,
  UserPermissions,
  UserRole,
} from "./types";

interface TemplatesTabProps {
  templates: QuotationTemplateDto[];
  plans: PlanDto[];
  products: ProductDto[];
  loading: boolean;
  role: UserRole;
  permissions: UserPermissions;
  onRefresh: () => Promise<void>;
  notify: (type: "success" | "error" | "info", title: string, description?: string) => void;
}

export default function TemplatesTab({
  templates,
  plans,
  products,
  loading,
  role,
  permissions,
  onRefresh,
  notify,
}: TemplatesTabProps) {
  const [search, setSearch] = useState("");

  // Create / Edit Template Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuotationTemplateDto | null>(null);
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState<number>(plans[0]?.id ?? 1);
  const [validityDays, setValidityDays] = useState("15");
  const [lines, setLines] = useState<
    { productId: number; variantId: number | null; quantity: string }[]
  >([]);
  const [saving, setSaving] = useState(false);

  // POST /quotation-templates/:id/use Handover Payload Modal
  const [draftPayload, setDraftPayload] = useState<Record<string, unknown> | null>(null);
  const [usingTemplateId, setUsingTemplateId] = useState<number | null>(null);

  const activeProducts = products.filter((p) => !p.isArchived);

  const filteredTemplates = templates.filter((t) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.plan.name.toLowerCase().includes(q) ||
      t.lines.some((l) => l.productName.toLowerCase().includes(q))
    );
  });

  function openCreateModal() {
    setEditingTemplate(null);
    setName("");
    setPlanId(plans[0]?.id ?? 1);
    setValidityDays("15");
    const firstProd = activeProducts[0];
    setLines(
      firstProd
        ? [
            {
              productId: firstProd.id,
              variantId: firstProd.variants[0]?.id ?? null,
              quantity: "1",
            },
          ]
        : []
    );
    setModalOpen(true);
  }

  function openEditModal(template: QuotationTemplateDto) {
    setEditingTemplate(template);
    setName(template.name);
    setPlanId(template.planId);
    setValidityDays(String(template.validityDays));
    setLines(
      template.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        quantity: String(l.quantity),
      }))
    );
    setModalOpen(true);
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name,
        planId: Number(planId),
        validityDays: Number(validityDays),
        lines: lines.map((l) => ({
          productId: Number(l.productId),
          variantId: l.variantId !== null ? Number(l.variantId) : null,
          quantity: Number(l.quantity),
        })),
      };

      const url = editingTemplate
        ? `/api/quotation-templates/${editingTemplate.id}`
        : "/api/quotation-templates";
      const method = editingTemplate ? "PUT" : "POST";

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
        throw new Error(data.error || "Failed to save quotation template");
      }

      notify(
        "success",
        editingTemplate ? "Quotation Template Updated" : "Quotation Template Created",
        data.message
      );
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify("error", "Template Validation Error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUseTemplate(template: QuotationTemplateDto) {
    setUsingTemplateId(template.id);
    try {
      const res = await fetch(`/api/quotation-templates/${template.id}/use`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate subscription draft payload");
      }
      setDraftPayload(data);
      notify(
        "success",
        "P3 Subscription Draft Generated",
        `POST /quotation-templates/${template.id}/use returned ${data.lines?.length ?? 0} pre-filled line(s)`
      );
    } catch (err) {
      notify("error", "Cannot Use Template", (err as Error).message);
    } finally {
      setUsingTemplateId(null);
    }
  }

  async function handleDeleteTemplate(template: QuotationTemplateDto) {
    try {
      const res = await fetch(`/api/quotation-templates/${template.id}`, {
        method: "DELETE",
        headers: { "x-user-role": role },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete template");
      }
      notify("success", "Template Deleted", data.message);
      await onRefresh();
    } catch (err) {
      notify("error", "Delete Failed", (err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Quotation Templates & Reusable Bundles
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                P3 Handover Ready
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Bundle a Subscription Plan with Products, Variants, Quantities, and Validity Days. Use <code>POST /quotation-templates/:id/use</code> to generate pre-filled subscription draft payloads for P3.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages, plans, products..."
              className="px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/60 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-600"
            />
            {permissions.canWriteTemplates && (
              <button
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition shrink-0"
              >
                + New Quotation Template
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-sm text-slate-500">
          Loading quotation templates...
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-base font-semibold text-slate-800">
            No quotation templates configured yet
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Create a reusable quotation package (e.g. Enterprise Package with Plan + Products + Variants) to test the P3 handover payload.
          </p>
          {permissions.canWriteTemplates && (
            <button
              onClick={openCreateModal}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
            >
              + Create First Quotation Template
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-300">
                        {template.plan.name} ({template.plan.billingPeriod})
                      </span>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        Validity: {template.validityDays} days
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-2">
                      {template.name}
                    </h3>
                  </div>

                  {template.isReadyToUse ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                      Check Availability
                    </span>
                  )}
                </div>

                {/* Package Product Lines */}
                <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase">
                        <th className="py-2 px-3">Product & Variant</th>
                        <th className="py-2 px-3 text-right">Qty</th>
                        <th className="py-2 px-3 text-right">Unit Price</th>
                        <th className="py-2 px-3 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {template.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 px-3">
                            <span className="font-semibold text-slate-900">
                              {line.productName}
                            </span>
                            {line.variantValue && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-medium">
                                {line.variantAttribute}: {line.variantValue} (+
                                {formatINR(line.variantExtraPrice)})
                              </span>
                            )}
                            {line.productIsArchived && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">
                                ARCHIVED
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-700">
                            × {line.quantity}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-600">
                            {formatINR(line.unitPrice)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">
                            {formatINR(line.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs bg-slate-50 px-3.5 py-2.5 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-slate-500">Products Subtotal: </span>
                    <strong className="text-slate-900">{formatINR(template.linesSubtotal)}</strong>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="text-slate-500">Plan Base: </span>
                    <strong className="text-slate-900">{formatINR(template.planPrice)}</strong>
                  </div>
                  <div className="font-bold text-slate-800">
                    Est. Cycle: {formatINR(template.estimatedCycleTotal)}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={usingTemplateId === template.id}
                  onClick={() => handleUseTemplate(template)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm transition"
                >
                  <span>
                    {usingTemplateId === template.id
                      ? "Generating..."
                      : "⚡ Use Template (POST /quotation-templates/" + template.id + "/use)"}
                  </span>
                </button>

                <div className="flex items-center gap-2">
                  {permissions.canWriteTemplates && (
                    <button
                      onClick={() => openEditModal(template)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                    >
                      Edit
                    </button>
                  )}
                  {permissions.canDeleteTemplates && (
                    <button
                      onClick={() => handleDeleteTemplate(template)}
                      className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Template Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editingTemplate
                    ? `Edit Quotation Template: ${editingTemplate.name}`
                    : "Create Quotation Template"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure reusable plan, product lines, optional variants, quantities, and quotation validity period.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Template Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Enterprise Package"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subscription Plan *
                  </label>
                  <select
                    value={planId}
                    onChange={(e) => setPlanId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.billingPeriod} - {formatINR(p.price)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Validity Period (Days) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    required
                    value={validityDays}
                    onChange={(e) => setValidityDays(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              {/* Lines Builder */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Package Product Lines *
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const first = activeProducts[0];
                      if (!first) return;
                      setLines([
                        ...lines,
                        {
                          productId: first.id,
                          variantId: null,
                          quantity: "1",
                        },
                      ]);
                    }}
                    className="text-xs font-semibold text-slate-900 hover:text-slate-900"
                  >
                    + Add Product Line
                  </button>
                </div>

                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {lines.map((line, idx) => {
                    const selectedProduct = activeProducts.find(
                      (p) => p.id === Number(line.productId)
                    );
                    const variants = selectedProduct?.variants ?? [];
                    const selectedVariant = variants.find(
                      (v) => v.id === Number(line.variantId)
                    );
                    const unitPrice =
                      (selectedProduct?.salesPrice ?? 0) +
                      (selectedVariant?.extraPrice ?? 0);
                    const lineTotal = unitPrice * (Number(line.quantity) || 0);

                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50 p-3 rounded-xl border border-slate-200/80"
                      >
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] font-semibold uppercase text-slate-400">
                            Product
                          </label>
                          <select
                            value={line.productId}
                            onChange={(e) => {
                              const nextPid = Number(e.target.value);
                              const next = [...lines];
                              next[idx].productId = nextPid;
                              next[idx].variantId = null;
                              setLines(next);
                            }}
                            className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                          >
                            {activeProducts.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({formatINR(p.salesPrice)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <label className="block text-[10px] font-semibold uppercase text-slate-400">
                            Variant (Optional)
                          </label>
                          <select
                            value={line.variantId ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              const next = [...lines];
                              next[idx].variantId = val ? Number(val) : null;
                              setLines(next);
                            }}
                            className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                          >
                            <option value="">Base / Standard (+₹0)</option>
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.attribute}: {v.value} (+{formatINR(v.extraPrice)} →{" "}
                                {formatINR(v.finalPrice)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-semibold uppercase text-slate-400">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            required
                            value={line.quantity}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx].quantity = e.target.value;
                              setLines(next);
                            }}
                            className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-between pt-3">
                          <span className="text-xs font-bold text-slate-800">
                            {formatINR(lineTotal)}
                          </span>
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLines(lines.filter((_, i) => i !== idx))
                              }
                              className="text-rose-500 hover:text-rose-700 font-bold text-xs px-1.5"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

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
                    : editingTemplate
                    ? "Save Template"
                    : "Create Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* P3 Subscription Draft Handover Payload Modal */}
      {draftPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                  P2 → P3 Handover Payload
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  Pre-Filled Subscription Draft Payload
                </h3>
                <p className="text-xs text-slate-500">
                  Generated by <code>POST /quotation-templates/:id/use</code> without creating a Subscription record directly in P2.
                </p>
              </div>
              <button
                onClick={() => setDraftPayload(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-400 block">Quotation Valid Until</span>
                <strong className="text-slate-900">
                  {formatShortDate(String(draftPayload.quotationValidUntil ?? ""))}
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block">Lines Subtotal</span>
                <strong className="text-slate-900">
                  {formatINR(Number(draftPayload.subtotal ?? 0))}
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block">Estimated Cycle Total</span>
                <strong className="text-slate-800">
                  {formatINR(Number(draftPayload.estimatedCycleTotal ?? 0))}
                </strong>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  JSON Response Payload for P3 Subscription Service
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(draftPayload, null, 2)
                    );
                    notify("info", "Copied to Clipboard", "Subscription draft JSON copied");
                  }}
                  className="text-xs font-semibold text-slate-900 hover:text-slate-900"
                >
                  📋 Copy JSON
                </button>
              </div>
              <pre className="p-4 rounded-xl bg-slate-900 text-emerald-300 text-xs font-mono overflow-x-auto max-h-80">
                {JSON.stringify(draftPayload, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setDraftPayload(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

