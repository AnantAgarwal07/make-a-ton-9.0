"use client";

import React, { useState, useMemo } from "react";
import {
  BillingPeriodType,
  formatINR,
  formatShortDate,
  PlanDto,
  toDateInputValue,
  UserPermissions,
  UserRole,
} from "./types";

interface PlansTabProps {
  plans: PlanDto[];
  loading: boolean;
  role: UserRole;
  permissions: UserPermissions;
  onRefresh: () => Promise<void>;
  notify: (type: "success" | "error" | "info", title: string, description?: string) => void;
}

const BILLING_PERIODS: BillingPeriodType[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export default function PlansTab({
  plans,
  loading,
  role,
  permissions,
  onRefresh,
  notify,
}: PlansTabProps) {
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<string>("ALL");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [checkDate, setCheckDate] = useState<string>(() => new Date().toISOString().split("T")[0]);

  // Create / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanDto | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("1000");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriodType>("MONTHLY");
  const [minQuantity, setMinQuantity] = useState("1");
  const [availableFrom, setAvailableFrom] = useState("2026-01-01");
  const [availableTo, setAvailableTo] = useState("");
  const [autoClose, setAutoClose] = useState(false);
  const [closable, setClosable] = useState(true);
  const [pausable, setPausable] = useState(false);
  const [renewable, setRenewable] = useState(true);
  const [saving, setSaving] = useState(false);

  const evaluatedPlans = useMemo(() => {
    const target = checkDate ? new Date(checkDate) : new Date();
    return plans.map((plan) => {
      const from = new Date(plan.availableFrom);
      const to = plan.availableTo ? new Date(plan.availableTo) : null;
      let isAvailableOnDate = true;
      let reason: string | null = null;

      if (target < from) {
        isAvailableOnDate = false;
        reason = `Starts ${formatShortDate(plan.availableFrom)}`;
      } else if (to && target > to) {
        isAvailableOnDate = false;
        reason = `Expired ${formatShortDate(plan.availableTo)}`;
      }

      return {
        ...plan,
        isAvailableOnDate,
        dateCheckReason: reason,
      };
    });
  }, [plans, checkDate]);

  const filteredPlans = useMemo(() => {
    return evaluatedPlans.filter((p) => {
      if (periodFilter !== "ALL" && p.billingPeriod !== periodFilter) return false;
      if (availableOnly && !p.isAvailableOnDate) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.billingPeriod.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [evaluatedPlans, periodFilter, availableOnly, search]);

  function openCreateModal() {
    setEditingPlan(null);
    setName("");
    setPrice("1000");
    setBillingPeriod("MONTHLY");
    setMinQuantity("1");
    setAvailableFrom("2026-01-01");
    setAvailableTo("");
    setAutoClose(false);
    setClosable(true);
    setPausable(true);
    setRenewable(true);
    setModalOpen(true);
  }

  function openEditModal(plan: PlanDto) {
    setEditingPlan(plan);
    setName(plan.name);
    setPrice(String(plan.price));
    setBillingPeriod(plan.billingPeriod);
    setMinQuantity(String(plan.minQuantity));
    setAvailableFrom(toDateInputValue(plan.availableFrom));
    setAvailableTo(toDateInputValue(plan.availableTo));
    setAutoClose(plan.autoClose);
    setClosable(plan.closable);
    setPausable(plan.pausable);
    setRenewable(plan.renewable);
    setModalOpen(true);
  }

  async function handleSavePlan(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name,
        price: Number(price),
        billingPeriod,
        minQuantity: Number(minQuantity),
        availableFrom,
        availableTo: availableTo ? availableTo : null,
        autoClose,
        closable,
        pausable,
        renewable,
      };

      const url = editingPlan ? `/api/plans/${editingPlan.id}` : "/api/plans";
      const method = editingPlan ? "PUT" : "POST";

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
        throw new Error(data.error || "Failed to save subscription plan");
      }

      notify(
        "success",
        editingPlan ? "Plan Updated" : "Plan Created",
        data.message
      );
      setModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify("error", "Plan Validation Failed", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickToggleFlag(
    plan: PlanDto,
    flag: "autoClose" | "closable" | "pausable" | "renewable"
  ) {
    if (!permissions.canWritePlans) return;
    try {
      const nextVal = !plan[flag];
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({ [flag]: nextVal }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to toggle plan flag");
      }
      notify(
        "success",
        "Lifecycle Flag Updated",
        `${plan.name}: ${flag} set to ${nextVal ? "Enabled" : "Disabled"}`
      );
      await onRefresh();
    } catch (err) {
      notify("error", "Flag Update Failed", (err as Error).message);
    }
  }

  async function handleDeletePlan(plan: PlanDto) {
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "DELETE",
        headers: { "x-user-role": role },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete plan");
      }
      notify("success", "Plan Deleted", data.message);
      await onRefresh();
    } catch (err) {
      notify("error", "Cannot Delete Plan", (err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Subscription Plans & Lifecycle Configuration
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
                {filteredPlans.length} plans
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage DAILY, WEEKLY, MONTHLY, and YEARLY billing cycles, availability windows, and P3 subscription lifecycle flags.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {permissions.canWritePlans ? (
              <button
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition"
              >
                + New Subscription Plan
              </button>
            ) : (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                Read-Only Mode ({role}) — ADMIN required to modify plans
              </span>
            )}
          </div>
        </div>

        {/* Filters & Availability Date Simulator */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plan name..."
              className="px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/60 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-600"
            />

            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {["ALL", ...BILLING_PERIODS].map((bp) => (
                <button
                  key={bp}
                  onClick={() => setPeriodFilter(bp)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition ${
                    periodFilter === bp
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {bp}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-600">Validate Availability On:</span>
              <input
                type="date"
                value={checkDate}
                onChange={(e) => setCheckDate(e.target.value)}
                className="text-xs font-semibold text-slate-900 bg-transparent focus:outline-none"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(e) => setAvailableOnly(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-600"
              />
              Show Available Only
            </label>
          </div>
        </div>
      </div>

      {/* Plans Grid & Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-slate-900 border-r-transparent" />
          <p className="mt-3 text-sm text-slate-500">Loading subscription plans...</p>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-base font-semibold text-slate-800">No subscription plans match your filters</p>
          <p className="text-sm text-slate-500 mt-1">
            Adjust the billing period filter or availability check date.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredPlans.map((plan) => (
            <div
              key={plan.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-300">
                      {plan.billingPeriod}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-2">{plan.name}</h3>
                  </div>

                  {plan.isAvailableOnDate ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                      {plan.dateCheckReason || "Unavailable"}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-slate-900">
                    {formatINR(plan.price)}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    / {plan.billingPeriod.toLowerCase()}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-slate-400 block">Min Quantity</span>
                    <strong className="text-slate-800">{plan.minQuantity} unit(s)</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Availability Window</span>
                    <strong className="text-slate-800">
                      {formatShortDate(plan.availableFrom)} → {formatShortDate(plan.availableTo)}
                    </strong>
                  </div>
                </div>

                {/* 4 P3 Lifecycle Flags */}
                <div className="mt-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    P3 Subscription Lifecycle Flags
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: "autoClose", label: "Auto Close" },
                        { key: "closable", label: "Closable" },
                        { key: "pausable", label: "Pausable" },
                        { key: "renewable", label: "Renewable" },
                      ] as const
                    ).map(({ key, label }) => {
                      const active = plan[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!permissions.canWritePlans}
                          onClick={() => handleQuickToggleFlag(plan, key)}
                          className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-semibold transition ${
                            active
                              ? "bg-slate-100/70 border-slate-300 text-slate-950"
                              : "bg-slate-50 border-slate-200 text-slate-500"
                          } ${permissions.canWritePlans ? "hover:border-slate-500 cursor-pointer" : "cursor-default"}`}
                        >
                          <span>{label}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              active
                                ? "bg-slate-900 text-white"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {active ? "ON" : "OFF"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {plan._count?.subscriptions ?? 0} subscriptions · {plan._count?.templates ?? 0} templates
                </div>

                {permissions.canWritePlans && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(plan)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeletePlan(plan)}
                      className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Plan Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editingPlan ? `Edit Plan: ${editingPlan.name}` : "Create Subscription Plan"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure recurring billing interval, availability dates, and P3 lifecycle rules.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Plan Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Enterprise Yearly"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Billing Period *
                  </label>
                  <select
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value as BillingPeriodType)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  >
                    {BILLING_PERIODS.map((bp) => (
                      <option key={bp} value={bp}>
                        {bp}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Plan Base Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Minimum Quantity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Available From *
                  </label>
                  <input
                    type="date"
                    required
                    value={availableFrom}
                    onChange={(e) => setAvailableFrom(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Available To (Optional)
                  </label>
                  <input
                    type="date"
                    value={availableTo}
                    onChange={(e) => setAvailableTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900"
                  />
                </div>
              </div>

              {/* 4 Lifecycle Flags */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Subscription Lifecycle Flags (Required by P3)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      label: "Auto Close",
                      desc: "Automatically close when validity expires",
                      val: autoClose,
                      set: setAutoClose,
                    },
                    {
                      label: "Closable",
                      desc: "Allow manual subscription cancellation",
                      val: closable,
                      set: setClosable,
                    },
                    {
                      label: "Pausable",
                      desc: "Allow temporary pausing of billing",
                      val: pausable,
                      set: setPausable,
                    },
                    {
                      label: "Renewable",
                      desc: "Allow recurring renewal at cycle end",
                      val: renewable,
                      set: setRenewable,
                    },
                  ].map((item) => (
                    <label
                      key={item.label}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-slate-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={item.val}
                        onChange={(e) => item.set(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-600"
                      />
                      <div>
                        <div className="text-xs font-bold text-slate-900">{item.label}</div>
                        <div className="text-[11px] text-slate-500">{item.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm"
                >
                  {saving ? "Saving..." : editingPlan ? "Save Plan" : "Create Plan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

