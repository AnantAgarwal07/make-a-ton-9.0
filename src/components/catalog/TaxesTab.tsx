"use client";

import React, { useState } from "react";
import {
  formatINR,
  ProductDto,
  TaxDto,
  UserPermissions,
  UserRole,
} from "./types";

interface TaxesTabProps {
  taxes: TaxDto[];
  products: ProductDto[];
  loading: boolean;
  role: UserRole;
  permissions: UserPermissions;
  onRefresh: () => Promise<void>;
  notify: (type: "success" | "error" | "info", title: string, description?: string) => void;
}

interface SimLine {
  description: string;
  quantity: string;
  unitPrice: string;
  taxType: "PERCENT" | "FIXED" | "NONE";
  taxRate: string;
}

export default function TaxesTab({
  taxes,
  products,
  loading,
  role,
  permissions,
  onRefresh,
  notify,
}: TaxesTabProps) {
  // Tax Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxDto | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [rate, setRate] = useState("18");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Interactive calculateTax(lines) simulator state
  const [simLines, setSimLines] = useState<SimLine[]>([
    {
      description: products[0]?.name || "Brightloop CRM (Odoo Variant)",
      quantity: "2",
      unitPrice: "1560",
      taxType: "PERCENT",
      taxRate: "18",
    },
    {
      description: "Platform Onboarding Fee",
      quantity: "1",
      unitPrice: "500",
      taxType: "FIXED",
      taxRate: "75",
    },
    {
      description: "Tax-Exempt Documentation",
      quantity: "1",
      unitPrice: "250",
      taxType: "NONE",
      taxRate: "0",
    },
  ]);

  const [calcResult, setCalcResult] = useState<{
    lines: {
      index: number;
      quantity: number;
      unitPrice: number;
      taxableAmount: number;
      taxType: string | null;
      taxRate: number;
      taxAmount: number;
      lineTotal: number;
    }[];
    lineTaxes: number[];
    subtotal: number;
    totalTax: number;
    grandTotal: number;
  } | null>(null);
  const [calculating, setCalculating] = useState(false);

  function openCreateModal() {
    setEditingTax(null);
    setName("");
    setType("PERCENT");
    setRate("18");
    setIsActive(true);
    setModalOpen(true);
  }

  function openEditModal(tax: TaxDto) {
    setEditingTax(tax);
    setName(tax.name);
    setType(tax.type);
    setRate(String(tax.rate));
    setIsActive(tax.isActive);
    setModalOpen(true);
  }

  async function handleSaveTax(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editingTax ? `/api/taxes/${editingTax.id}` : "/api/taxes";
      const method = editingTax ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({
          name,
          type,
          rate: Number(rate),
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save tax rule");
      }

      notify(
        "success",
        editingTax ? "Tax Updated" : "Tax Created",
        data.message
      );
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify("error", "Tax Operation Blocked", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(tax: TaxDto) {
    try {
      const res = await fetch(`/api/taxes/${tax.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({ isActive: !tax.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to toggle tax status");
      }
      notify("success", "Tax Status Updated", `${tax.name} is now ${!tax.isActive ? "Active" : "Inactive"}`);
      await onRefresh();
    } catch (err) {
      notify("error", "Permission Denied", (err as Error).message);
    }
  }

  async function handleDeleteTax(tax: TaxDto) {
    try {
      const res = await fetch(`/api/taxes/${tax.id}`, {
        method: "DELETE",
        headers: { "x-user-role": role },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete tax");
      }
      notify("success", "Tax Removed", data.message);
      await onRefresh();
    } catch (err) {
      notify("error", "Delete Failed", (err as Error).message);
    }
  }

  async function handleRunCalculateTax() {
    setCalculating(true);
    try {
      const payloadLines = simLines.map((l) => ({
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        tax:
          l.taxType === "NONE"
            ? null
            : {
                type: l.taxType,
                rate: Number(l.taxRate),
                isActive: true,
              },
      }));

      const res = await fetch("/api/taxes/calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({ lines: payloadLines }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Tax calculation failed");
      }
      setCalcResult(data);
      notify(
        "info",
        "calculateTax(lines) Executed",
        `Total Tax: ${formatINR(data.totalTax)} across ${data.lines.length} line(s)`
      );
    } catch (err) {
      notify("error", "Tax Calculation Error", (err as Error).message);
    } finally {
      setCalculating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Section: Tax Configuration Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Tax Rules Configuration
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                ADMIN Only
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure PERCENT (e.g., GST 18%) and FIXED tax rules applied to subscription lines.
            </p>
          </div>

          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition"
          >
            + New Tax Rule
          </button>
        </div>

        {!permissions.canManageTaxes && (
          <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
            <strong>RBAC Notice:</strong> You are currently browsing as <strong>{role}</strong>. Tax management endpoints require <strong>ADMIN</strong> privileges and will return <code>HTTP 403 Forbidden</code> if invoked by {role}.
          </div>
        )}

        <div className="mt-5">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading tax rules...</div>
          ) : taxes.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200/60 text-sm text-slate-500">
              {permissions.canManageTaxes
                ? "No tax rules configured yet. Create your first tax rule above."
                : "Tax rules are restricted to ADMIN role."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Tax Name</th>
                    <th className="py-3 px-4">Calculation Type</th>
                    <th className="py-3 px-4">Rate</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Subscription Lines</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {taxes.map((tax) => (
                    <tr key={tax.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">{tax.name}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-md text-xs font-bold ${
                            tax.type === "PERCENT"
                              ? "bg-slate-100 text-slate-800 border border-slate-300"
                              : "bg-sky-50 text-sky-700 border border-sky-200"
                          }`}
                        >
                          {tax.type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        {tax.type === "PERCENT" ? `${tax.rate}%` : formatINR(tax.rate)}
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(tax)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                            tax.isActive
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              tax.isActive ? "bg-emerald-600" : "bg-slate-400"
                            }`}
                          />
                          {tax.isActive ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {tax._count?.lines ?? 0} line(s)
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          onClick={() => openEditModal(tax)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteTax(tax)}
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
          )}
        </div>
      </div>

      {/* Bottom Section: Interactive P3 Handover calculateTax(lines) Engine Sandbox */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-900">
              <span>P2 → P3 Billing Handover Function</span>
              <code className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-900">
                calculateTax(lines)
              </code>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Pure Multi-Line Tax Calculation Simulator
            </h3>
            <p className="text-xs text-slate-500">
              Test percentage taxes, fixed taxes, zero taxes, and 2-decimal currency rounding across multiple lines without database writes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setSimLines([
                  ...simLines,
                  {
                    description: "Additional Service Line",
                    quantity: "1",
                    unitPrice: "999.99",
                    taxType: "PERCENT",
                    taxRate: "18",
                  },
                ])
              }
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              + Add Line
            </button>
            <button
              type="button"
              disabled={calculating}
              onClick={handleRunCalculateTax}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm"
            >
              {calculating ? "Calculating..." : "▶ Run calculateTax(lines)"}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {simLines.map((line, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center bg-slate-50 p-3 rounded-xl border border-slate-200/70"
            >
              <div className="sm:col-span-4">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Line Description
                </label>
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) => {
                    const next = [...simLines];
                    next[idx].description = e.target.value;
                    setSimLines(next);
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Quantity
                </label>
                <input
                  type="number"
                  min="0"
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

              <div className="sm:col-span-2">
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

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-400">
                  Tax Type
                </label>
                <select
                  value={line.taxType}
                  onChange={(e) => {
                    const next = [...simLines];
                    next[idx].taxType = e.target.value as SimLine["taxType"];
                    if (next[idx].taxType === "NONE") next[idx].taxRate = "0";
                    setSimLines(next);
                  }}
                  className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                >
                  <option value="PERCENT">PERCENT (%)</option>
                  <option value="FIXED">FIXED (₹)</option>
                  <option value="NONE">ZERO / NO TAX</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold uppercase text-slate-400">
                    Rate
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={line.taxType === "NONE"}
                    value={line.taxRate}
                    onChange={(e) => {
                      const next = [...simLines];
                      next[idx].taxRate = e.target.value;
                      setSimLines(next);
                    }}
                    className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900 disabled:bg-slate-100"
                  />
                </div>
                {simLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSimLines(simLines.filter((_, i) => i !== idx))}
                    className="mb-1 text-rose-500 hover:text-rose-700 font-bold text-xs px-1.5"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {calcResult && (
          <div className="mt-5 p-4 rounded-xl bg-slate-900 text-slate-100 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <span className="text-xs text-slate-400 block">Per-Line Tax Array (lineTaxes)</span>
                <code className="text-xs text-slate-400 font-mono">
                  [{calcResult.lineTaxes.map((t) => formatINR(t)).join(", ")}]
                </code>
              </div>
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-xs text-slate-400 block">Subtotal</span>
                  <span className="text-sm font-bold">{formatINR(calcResult.subtotal)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Total Tax</span>
                  <span className="text-base font-extrabold text-emerald-400">
                    {formatINR(calcResult.totalTax)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-400 block">Grand Total</span>
                  <span className="text-base font-extrabold text-white">
                    {formatINR(calcResult.grandTotal)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              {calcResult.lines.map((cl) => (
                <div key={cl.index} className="p-3 rounded-lg bg-slate-800/90 border border-slate-700">
                  <div className="font-semibold text-white">
                    Line #{cl.index + 1}: {simLines[cl.index]?.description || "Item"}
                  </div>
                  <div className="text-slate-400 mt-1">
                    Taxable Base: {formatINR(cl.taxableAmount)} ({cl.taxType || "ZERO"}{" "}
                    {cl.taxType === "PERCENT" ? `${cl.taxRate}%` : cl.taxType === "FIXED" ? formatINR(cl.taxRate) : ""})
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-bold text-emerald-300">
                    <span>Tax: {formatINR(cl.taxAmount)}</span>
                    <span className="text-slate-200">Total: {formatINR(cl.lineTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Tax Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">
                {editingTax ? `Edit Tax: ${editingTax.name}` : "Create Tax Rule"}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTax} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tax Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., GST 18%, Cess Fixed ₹50"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tax Type *
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
                    Rate ({type === "PERCENT" ? "%" : "₹"}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={type === "PERCENT" ? "100" : undefined}
                    required
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-600"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Tax is Active and available for billing lines
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
                  {saving ? "Saving..." : editingTax ? "Save Tax" : "Create Tax"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

