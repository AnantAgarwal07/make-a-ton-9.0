"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  CatalogSummaryDto,
  DiscountDto,
  PlanDto,
  ProductDto,
  QuotationTemplateDto,
  TaxDto,
  ToastMessage,
  UserPermissions,
  UserRole,
} from "./types";
import ProductsTab from "./ProductsTab";
import PlansTab from "./PlansTab";
import TaxesTab from "./TaxesTab";
import DiscountsTab from "./DiscountsTab";
import TemplatesTab from "./TemplatesTab";

type ActiveTab = "products" | "plans" | "taxes" | "discounts" | "templates";

const DEFAULT_PERMISSIONS: Record<UserRole, UserPermissions> = {
  ADMIN: {
    canReadProducts: true,
    canWriteProducts: true,
    canManageVariants: true,
    canReadPlans: true,
    canWritePlans: true,
    canManageTaxes: true,
    canManageDiscounts: true,
    canReadTemplates: true,
    canWriteTemplates: true,
    canDeleteTemplates: true,
    canUseTemplates: true,
  },
  STAFF: {
    canReadProducts: true,
    canWriteProducts: false,
    canManageVariants: false,
    canReadPlans: true,
    canWritePlans: false,
    canManageTaxes: false,
    canManageDiscounts: false,
    canReadTemplates: true,
    canWriteTemplates: true,
    canDeleteTemplates: false,
    canUseTemplates: true,
  },
  CUSTOMER: {
    canReadProducts: false,
    canWriteProducts: false,
    canManageVariants: false,
    canReadPlans: false,
    canWritePlans: false,
    canManageTaxes: false,
    canManageDiscounts: false,
    canReadTemplates: false,
    canWriteTemplates: false,
    canDeleteTemplates: false,
    canUseTemplates: false,
  },
};

export default function CatalogDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("products");
  const [role, setRole] = useState<UserRole>("ADMIN");
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<CatalogSummaryDto>({
    totalProducts: 0,
    activeProducts: 0,
    archivedProducts: 0,
    totalVariants: 0,
    totalPlans: 0,
    availablePlans: 0,
    totalTaxes: 0,
    activeTaxes: 0,
    totalDiscounts: 0,
    activeDiscounts: 0,
    totalTemplates: 0,
  });

  const [products, setProducts] = useState<ProductDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [taxes, setTaxes] = useState<TaxDto[]>([]);
  const [discounts, setDiscounts] = useState<DiscountDto[]>([]);
  const [templates, setTemplates] = useState<QuotationTemplateDto[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const permissions = DEFAULT_PERMISSIONS[role];

  const notify = useCallback(
    (type: "success" | "error" | "info", title: string, description?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [{ id, type, title, description }, ...prev.slice(0, 3)]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const fetchAllCatalogData = useCallback(
    async (activeRole: UserRole = role) => {
      setLoading(true);
      const headers = { "x-user-role": activeRole };

      try {
        const [sumRes, prodRes, planRes, taxRes, discRes, tplRes] = await Promise.all([
          fetch("/api/catalog/summary", { headers }),
          fetch("/api/products", { headers }),
          fetch("/api/plans", { headers }),
          fetch("/api/taxes", { headers }),
          fetch("/api/discounts", { headers }),
          fetch("/api/quotation-templates", { headers }),
        ]);

        if (sumRes.ok) {
          const sumData = await sumRes.json();
          if (sumData.summary) setSummary(sumData.summary);
        }

        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProducts(prodData.products ?? []);
        } else {
          setProducts([]);
        }

        if (planRes.ok) {
          const planData = await planRes.json();
          setPlans(planData.plans ?? []);
        } else {
          setPlans([]);
        }

        if (taxRes.ok) {
          const taxData = await taxRes.json();
          setTaxes(taxData.taxes ?? []);
        } else {
          setTaxes([]);
        }

        if (discRes.ok) {
          const discData = await discRes.json();
          setDiscounts(discData.discounts ?? []);
        } else {
          setDiscounts([]);
        }

        if (tplRes.ok) {
          const tplData = await tplRes.json();
          setTemplates(tplData.templates ?? []);
        } else {
          setTemplates([]);
        }
      } catch (err) {
        notify("error", "Failed to load catalog data", (err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [role, notify]
  );

  useEffect(() => {
    fetchAllCatalogData(role);
  }, [role, fetchAllCatalogData]);

  async function handleSwitchRole(nextRole: UserRole) {
    setRole(nextRole);
    try {
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      notify(
        "info",
        `Switched Active Role to ${nextRole}`,
        nextRole === "ADMIN"
          ? "Full Catalog & Pricing administrative access enabled."
          : nextRole === "STAFF"
          ? "STAFF access: Read Products/Plans, Manage & Use Quotation Templates. Discounts/Taxes/Writes restricted (HTTP 403)."
          : "CUSTOMER access: Administrative catalog endpoints are restricted (HTTP 403)."
      );
    } catch {
      // Fallback to state role
    }
  }

  const navItems: {
    id: ActiveTab;
    label: string;
    badge: string | number;
    restricted?: boolean;
  }[] = [
    {
      id: "products",
      label: "Products & Variants",
      badge: `${summary.activeProducts} (${summary.totalVariants} var)`,
    },
    {
      id: "plans",
      label: "Subscription Plans",
      badge: `${summary.availablePlans}/${summary.totalPlans}`,
    },
    {
      id: "taxes",
      label: "Taxes & calculateTax()",
      badge: summary.activeTaxes,
      restricted: !permissions.canManageTaxes,
    },
    {
      id: "discounts",
      label: "Discounts & Eligibility",
      badge: summary.activeDiscounts,
      restricted: !permissions.canManageDiscounts,
    },
    {
      id: "templates",
      label: "Quotation Templates",
      badge: summary.totalTemplates,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top SaaS Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
              B
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-slate-900">
                  Brightloop
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200">
                  P2 · Catalog & Pricing
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Products, Variants, Plans, Taxes, Discounts & Quotation Templates
              </p>
            </div>
          </div>

          {/* Role Switcher & Refresh */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 px-2 hidden md:inline">
                Active Role (P1 RBAC):
              </span>
              {(["ADMIN", "STAFF", "CUSTOMER"] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleSwitchRole(r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    role === r
                      ? r === "ADMIN"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : r === "STAFF"
                        ? "bg-amber-600 text-white shadow-xs"
                        : "bg-rose-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => fetchAllCatalogData(role)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
              title="Refresh from Neon PostgreSQL"
            >
              ↻ Sync DB
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div
            onClick={() => setActiveTab("products")}
            className="cursor-pointer bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:border-indigo-300 transition"
          >
            <span className="text-xs font-semibold text-slate-500">Active Products</span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {summary.activeProducts}
              <span className="text-xs font-medium text-slate-400 ml-1.5">
                ({summary.archivedProducts} archived)
              </span>
            </div>
            <div className="text-xs text-indigo-600 font-medium mt-1">
              {summary.totalVariants} configured variant(s)
            </div>
          </div>

          <div
            onClick={() => setActiveTab("plans")}
            className="cursor-pointer bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:border-indigo-300 transition"
          >
            <span className="text-xs font-semibold text-slate-500">Subscription Plans</span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {summary.availablePlans}
              <span className="text-xs font-medium text-slate-400 ml-1.5">
                / {summary.totalPlans} available
              </span>
            </div>
            <div className="text-xs text-emerald-600 font-medium mt-1">
              4 P3 lifecycle flags tracked
            </div>
          </div>

          <div
            onClick={() => setActiveTab("taxes")}
            className="cursor-pointer bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:border-indigo-300 transition"
          >
            <span className="text-xs font-semibold text-slate-500">Active Taxes</span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {summary.activeTaxes}
              <span className="text-xs font-medium text-slate-400 ml-1.5">
                / {summary.totalTaxes} total
              </span>
            </div>
            <div className="text-xs text-slate-500 font-medium mt-1">
              PERCENT & FIXED supported
            </div>
          </div>

          <div
            onClick={() => setActiveTab("discounts")}
            className="cursor-pointer bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:border-indigo-300 transition"
          >
            <span className="text-xs font-semibold text-slate-500">Eligible Campaigns</span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {summary.activeDiscounts}
              <span className="text-xs font-medium text-slate-400 ml-1.5">
                / {summary.totalDiscounts} total
              </span>
            </div>
            <div className="text-xs text-purple-600 font-medium mt-1">
              Highest-benefit non-stacking
            </div>
          </div>

          <div
            onClick={() => setActiveTab("templates")}
            className="cursor-pointer bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs hover:border-indigo-300 transition col-span-2 sm:col-span-1"
          >
            <span className="text-xs font-semibold text-slate-500">Quotation Templates</span>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              {summary.totalTemplates}
            </div>
            <div className="text-xs text-indigo-600 font-medium mt-1">
              Draft payload endpoint ready
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-1.5 shadow-xs flex flex-wrap gap-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
                  isActive
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <span>{item.label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : item.restricted
                      ? "bg-rose-100 text-rose-700"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {item.restricted ? "ADMIN" : item.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Customer Role Notice */}
        {role === "CUSTOMER" && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-900">
            <h3 className="text-base font-bold">
              HTTP 403 Forbidden — Catalog Administration Restricted for CUSTOMER Role
            </h3>
            <p className="text-sm mt-1">
              In accordance with Section 11 RBAC rules, <strong>CUSTOMER</strong> accounts cannot read or modify administrative catalog endpoints. Switch to <strong>STAFF</strong> or <strong>ADMIN</strong> in the top bar to manage catalog items.
            </p>
          </div>
        )}

        {/* Active Module Tab */}
        {activeTab === "products" && (
          <ProductsTab
            products={products}
            loading={loading}
            role={role}
            permissions={permissions}
            onRefresh={() => fetchAllCatalogData(role)}
            notify={notify}
          />
        )}

        {activeTab === "plans" && (
          <PlansTab
            plans={plans}
            loading={loading}
            role={role}
            permissions={permissions}
            onRefresh={() => fetchAllCatalogData(role)}
            notify={notify}
          />
        )}

        {activeTab === "taxes" && (
          <TaxesTab
            taxes={taxes}
            products={products}
            loading={loading}
            role={role}
            permissions={permissions}
            onRefresh={() => fetchAllCatalogData(role)}
            notify={notify}
          />
        )}

        {activeTab === "discounts" && (
          <DiscountsTab
            discounts={discounts}
            products={products}
            loading={loading}
            role={role}
            permissions={permissions}
            onRefresh={() => fetchAllCatalogData(role)}
            notify={notify}
          />
        )}

        {activeTab === "templates" && (
          <TemplatesTab
            templates={templates}
            plans={plans}
            products={products}
            loading={loading}
            role={role}
            permissions={permissions}
            onRefresh={() => fetchAllCatalogData(role)}
            notify={notify}
          />
        )}
      </main>

      {/* Floating Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-lg transition ${
              t.type === "success"
                ? "bg-emerald-950 border-emerald-700 text-emerald-50"
                : t.type === "error"
                ? "bg-rose-950 border-rose-700 text-rose-50"
                : "bg-slate-900 border-slate-700 text-slate-50"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-bold">{t.title}</div>
              <button
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                className="text-xs opacity-70 hover:opacity-100"
              >
                ✕
              </button>
            </div>
            {t.description && (
              <div className="text-xs opacity-90 mt-1 leading-relaxed">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

