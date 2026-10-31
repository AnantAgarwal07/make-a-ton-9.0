"use client";

import React, { useState, useMemo } from "react";
import {
  formatINR,
  ProductDto,
  ProductVariantDto,
  UserPermissions,
  UserRole,
} from "./types";

interface ProductsTabProps {
  products: ProductDto[];
  loading: boolean;
  role: UserRole;
  permissions: UserPermissions;
  onRefresh: () => Promise<void>;
  notify: (type: "success" | "error" | "info", title: string, description?: string) => void;
}

const PRODUCT_TYPES = ["Software", "SaaS", "Cloud Storage", "Security", "Service", "Hardware", "Add-on"];

export default function ProductsTab({
  products,
  loading,
  role,
  permissions,
  onRefresh,
  notify,
}: ProductsTabProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("active");

  // Product Create / Edit modal state
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("Software");
  const [salesPrice, setSalesPrice] = useState("1000");
  const [costPrice, setCostPrice] = useState("400");
  const [notes, setNotes] = useState("");
  const [initialVariants, setInitialVariants] = useState<
    { attribute: string; value: string; extraPrice: string }[]
  >([]);
  const [savingProduct, setSavingProduct] = useState(false);

  // Archive Confirmation modal state
  const [archiveTarget, setArchiveTarget] = useState<ProductDto | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Variant Manager modal state
  const [variantProduct, setVariantProduct] = useState<ProductDto | null>(null);
  const [editingVariant, setEditingVariant] = useState<ProductVariantDto | null>(null);
  const [varAttribute, setVarAttribute] = useState("Edition");
  const [varValue, setVarValue] = useState("");
  const [varExtraPrice, setVarExtraPrice] = useState("0");
  const [savingVariant, setSavingVariant] = useState(false);

  const uniqueTypes = useMemo(() => {
    const set = new Set<string>(PRODUCT_TYPES);
    products.forEach((p) => {
      if (p.type) set.add(p.type);
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (statusFilter === "active" && p.isArchived) return false;
      if (statusFilter === "archived" && !p.isArchived) return false;
      if (typeFilter !== "all" && p.type.toLowerCase() !== typeFilter.toLowerCase()) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchType = p.type.toLowerCase().includes(q);
        const matchNotes = (p.notes ?? "").toLowerCase().includes(q);
        const matchVariant = p.variants.some(
          (v) =>
            v.attribute.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
        );
        if (!matchName && !matchType && !matchNotes && !matchVariant) return false;
      }
      return true;
    });
  }, [products, statusFilter, typeFilter, search]);

  function openCreateProductModal() {
    setEditingProduct(null);
    setName("");
    setType("Software");
    setSalesPrice("1000");
    setCostPrice("400");
    setNotes("");
    setInitialVariants([
      { attribute: "Tier", value: "Standard", extraPrice: "0" },
      { attribute: "Tier", value: "Odoo", extraPrice: "560" },
    ]);
    setProductModalOpen(true);
  }

  function openEditProductModal(product: ProductDto) {
    setEditingProduct(product);
    setName(product.name);
    setType(product.type);
    setSalesPrice(String(product.salesPrice));
    setCostPrice(String(product.costPrice));
    setNotes(product.notes ?? "");
    setInitialVariants([]);
    setProductModalOpen(true);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    setSavingProduct(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        type,
        salesPrice: Number(salesPrice),
        costPrice: Number(costPrice),
        notes: notes.trim() || null,
      };

      if (!editingProduct && initialVariants.length > 0) {
        payload.variants = initialVariants
          .filter((v) => v.attribute.trim() && v.value.trim())
          .map((v) => ({
            attribute: v.attribute.trim(),
            value: v.value.trim(),
            extraPrice: Number(v.extraPrice || 0),
          }));
      }

      const url = editingProduct
        ? `/api/products/${editingProduct.id}`
        : "/api/products";
      const method = editingProduct ? "PUT" : "POST";

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
        throw new Error(data.error || "Failed to save product");
      }

      notify(
        "success",
        editingProduct ? "Product Updated" : "Product Created",
        data.message
      );
      setProductModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify("error", "Product Operation Failed", (err as Error).message);
    } finally {
      setSavingProduct(false);
    }
  }

  async function handleConfirmArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const restore = archiveTarget.isArchived;
      const res = await fetch(
        `/api/products/${archiveTarget.id}${restore ? "?restore=true" : ""}`,
        {
          method: "DELETE",
          headers: { "x-user-role": role },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to change archive status");
      }

      notify(
        "success",
        restore ? "Product Restored" : "Product Archived",
        data.message
      );
      setArchiveTarget(null);
      await onRefresh();
    } catch (err) {
      notify("error", "Archive Action Failed", (err as Error).message);
    } finally {
      setArchiving(false);
    }
  }

  function openVariantManager(product: ProductDto) {
    setVariantProduct(product);
    setEditingVariant(null);
    setVarAttribute("Edition");
    setVarValue("");
    setVarExtraPrice("0");
  }

  // Keep variantProduct synced when products list updates
  const currentVariantProduct = useMemo(() => {
    if (!variantProduct) return null;
    return products.find((p) => p.id === variantProduct.id) ?? variantProduct;
  }, [products, variantProduct]);

  async function handleSaveVariant(e: React.FormEvent) {
    e.preventDefault();
    if (!currentVariantProduct) return;
    setSavingVariant(true);
    try {
      const url = editingVariant
        ? `/api/products/${currentVariantProduct.id}/variants/${editingVariant.id}`
        : `/api/products/${currentVariantProduct.id}/variants`;
      const method = editingVariant ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({
          attribute: varAttribute,
          value: varValue,
          extraPrice: Number(varExtraPrice || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save variant");
      }

      notify(
        "success",
        editingVariant ? "Variant Updated" : "Variant Added",
        `${varAttribute}: ${varValue} → Final Price ${formatINR(data.variant.finalPrice)}`
      );
      setEditingVariant(null);
      setVarValue("");
      setVarExtraPrice("0");
      await onRefresh();
    } catch (err) {
      notify("error", "Variant Error", (err as Error).message);
    } finally {
      setSavingVariant(false);
    }
  }

  async function handleDeleteVariant(variant: ProductVariantDto) {
    if (!currentVariantProduct) return;
    try {
      const res = await fetch(
        `/api/products/${currentVariantProduct.id}/variants/${variant.id}`,
        {
          method: "DELETE",
          headers: { "x-user-role": role },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete variant");
      }
      notify("success", "Variant Deleted", data.message);
      await onRefresh();
    } catch (err) {
      notify("error", "Cannot Delete Variant", (err as Error).message);
    }
  }

  const previewSales = Number(salesPrice) || 0;
  const previewCost = Number(costPrice) || 0;
  const previewMargin = previewSales - previewCost;
  const previewMarginPct = previewSales > 0 ? ((previewMargin / previewSales) * 100).toFixed(1) : "0.0";

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              Products & Variant Pricing Catalog
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {filteredProducts.length} shown
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure base products, cost margins, and multi-tier attribute variants (Final Price = Base Sales Price + Variant Extra Price).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {permissions.canWriteProducts ? (
              <button
                onClick={openCreateProductModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition"
              >
                <span>+ New Product</span>
              </button>
            ) : (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                Read-Only Mode ({role}) — ADMIN required to create/edit products
              </span>
            )}
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products, types, notes, or variant values (e.g. Odoo)..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 bg-slate-50/60"
            />
            <span className="absolute left-3 top-2.5 text-slate-400 text-sm">🔍</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All Types</option>
              {uniqueTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {(["active", "archived", "all"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition ${
                    statusFilter === status
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Products Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-r-transparent" />
          <p className="mt-3 text-sm text-slate-500">Loading product catalog...</p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <p className="text-base font-semibold text-slate-800">No matching products found</p>
          <p className="text-sm text-slate-500 mt-1">
            Try clearing your search filters or create a new catalog product.
          </p>
          {permissions.canWriteProducts && (
            <button
              onClick={openCreateProductModal}
              className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            >
              + Create First Product
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Product</th>
                  <th className="py-3.5 px-4">Base Pricing & Margin</th>
                  <th className="py-3.5 px-4">Variants (Base + Extra = Final)</th>
                  <th className="py-3.5 px-4">Status & Usage</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className={`transition hover:bg-slate-50/70 ${
                      product.isArchived ? "bg-slate-50/40 opacity-75" : ""
                    }`}
                  >
                    <td className="py-4 px-4 align-top">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold shrink-0">
                          {product.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            {product.name}
                            <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                              {product.type}
                            </span>
                          </div>
                          {product.notes ? (
                            <p className="text-xs text-slate-500 mt-1 max-w-xs line-clamp-2">
                              {product.notes}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400 mt-1 italic">No notes</p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4 align-top">
                      <div className="font-semibold text-slate-900">
                        {formatINR(product.salesPrice)}{" "}
                        <span className="text-xs font-normal text-slate-500">sales</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Cost: {formatINR(product.costPrice)}
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        Margin: {formatINR(product.margin)} ({product.marginPercent}%)
                      </div>
                    </td>

                    <td className="py-4 px-4 align-top">
                      {product.variants.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          Standard only ({formatINR(product.salesPrice)})
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-w-md">
                          {product.variants.map((v) => (
                            <div
                              key={v.id}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs"
                            >
                              <span className="font-medium text-slate-700">
                                {v.attribute}: {v.value}
                              </span>
                              <span className="text-slate-400">
                                (+{formatINR(v.extraPrice)})
                              </span>
                              <span className="font-bold text-indigo-700">
                                = {formatINR(v.finalPrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {permissions.canManageVariants && (
                        <button
                          onClick={() => openVariantManager(product)}
                          className="mt-2 block text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          ⚙ Manage Variants ({product.variants.length})
                        </button>
                      )}
                    </td>

                    <td className="py-4 px-4 align-top">
                      {product.isArchived ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                          Archived
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                          Active
                        </span>
                      )}
                      {product._count && (
                        <div className="text-xs text-slate-500 mt-1.5 space-y-0.5">
                          <div>{product._count.subscriptionLines ?? 0} subscriptions</div>
                          <div>{product._count.templateLines ?? 0} templates</div>
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-4 align-top text-right">
                      {permissions.canWriteProducts ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openEditProductModal(product)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-semibold text-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setArchiveTarget(product)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                              product.isArchived
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            }`}
                          >
                            {product.isArchived ? "Restore" : "Archive"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Product Modal */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {editingProduct ? `Edit Product: ${editingProduct.name}` : "Create New Catalog Product"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure product pricing, cost structure, and optional variants.
                </p>
              </div>
              <button
                onClick={() => setProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Business Software"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product Type *
                  </label>
                  <input
                    type="text"
                    required
                    list="product-type-suggestions"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="e.g., Software, Cloud Storage"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <datalist id="product-type-suggestions">
                    {PRODUCT_TYPES.map((pt) => (
                      <option key={pt} value={pt} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200/70">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Base Sales Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={salesPrice}
                    onChange={(e) => setSalesPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cost Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <span className="text-xs font-semibold text-slate-500">Projected Margin</span>
                  <span
                    className={`text-sm font-bold mt-1 ${
                      previewMargin >= 0 ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {formatINR(previewMargin)} ({previewMarginPct}%)
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Notes / Description
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional internal notes or specifications..."
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Initial Variants Builder when creating a new product */}
              {!editingProduct && (
                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Initial Product Variants (Optional)
                      </span>
                      <p className="text-xs text-slate-500">
                        Final Price = Base Sales Price ({formatINR(previewSales)}) + Variant Extra Price
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setInitialVariants([
                          ...initialVariants,
                          { attribute: "Tier", value: "", extraPrice: "0" },
                        ])
                      }
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      + Add Variant Row
                    </button>
                  </div>

                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {initialVariants.map((iv, idx) => {
                      const extra = Number(iv.extraPrice) || 0;
                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-xl border border-slate-200/70"
                        >
                          <div className="col-span-3">
                            <input
                              type="text"
                              placeholder="Attribute (e.g. Brand)"
                              value={iv.attribute}
                              onChange={(e) => {
                                const next = [...initialVariants];
                                next[idx].attribute = e.target.value;
                                setInitialVariants(next);
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                            />
                          </div>
                          <div className="col-span-4">
                            <input
                              type="text"
                              placeholder="Value (e.g. Odoo, Premium)"
                              value={iv.value}
                              onChange={(e) => {
                                const next = [...initialVariants];
                                next[idx].value = e.target.value;
                                setInitialVariants(next);
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Extra ₹"
                              value={iv.extraPrice}
                              onChange={(e) => {
                                const next = [...initialVariants];
                                next[idx].extraPrice = e.target.value;
                                setInitialVariants(next);
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
                            />
                          </div>
                          <div className="col-span-2 flex items-center justify-between text-xs font-semibold text-indigo-700">
                            <span>{formatINR(previewSales + extra)}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setInitialVariants(initialVariants.filter((_, i) => i !== idx))
                              }
                              className="text-rose-500 hover:text-rose-700 px-1"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm"
                >
                  {savingProduct
                    ? "Saving..."
                    : editingProduct
                    ? "Save Changes"
                    : "Create Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Variant Management Modal */}
      {currentVariantProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Variant Pricing Matrix — {currentVariantProduct.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Base Sales Price: <strong className="text-slate-800">{formatINR(currentVariantProduct.salesPrice)}</strong>.
                  Final Variant Price = Base Sales Price + Variant Extra Price.
                </p>
              </div>
              <button
                onClick={() => setVariantProduct(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>

            {/* Existing Variants List */}
            <div className="mt-4">
              {currentVariantProduct.variants.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200/70 text-sm text-slate-500">
                  No variants configured yet for this product. Add one below (e.g., Standard +₹0, Odoo +₹560, Premium +₹1,000).
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase">
                        <th className="py-2.5 px-3">Attribute</th>
                        <th className="py-2.5 px-3">Value</th>
                        <th className="py-2.5 px-3">Extra Price</th>
                        <th className="py-2.5 px-3">Final Unit Price</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentVariantProduct.variants.map((v) => (
                        <tr key={v.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-medium text-slate-700">{v.attribute}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{v.value}</td>
                          <td className="py-2.5 px-3 text-slate-600">+{formatINR(v.extraPrice)}</td>
                          <td className="py-2.5 px-3 font-bold text-indigo-700">
                            {formatINR(v.finalPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingVariant(v);
                                setVarAttribute(v.attribute);
                                setVarValue(v.value);
                                setVarExtraPrice(String(v.extraPrice));
                              }}
                              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteVariant(v)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800"
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

            {/* Add / Update Variant Form */}
            <form
              onSubmit={handleSaveVariant}
              className="mt-5 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                  {editingVariant ? `Editing Variant #${editingVariant.id}` : "Add New Variant"}
                </span>
                {editingVariant && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingVariant(null);
                      setVarValue("");
                      setVarExtraPrice("0");
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Attribute *
                  </label>
                  <input
                    type="text"
                    required
                    value={varAttribute}
                    onChange={(e) => setVarAttribute(e.target.value)}
                    placeholder="e.g., Brand, Tier"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Value *
                  </label>
                  <input
                    type="text"
                    required
                    value={varValue}
                    onChange={(e) => setVarValue(e.target.value)}
                    placeholder="e.g., Standard, Odoo, Premium"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Extra Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={varExtraPrice}
                    onChange={(e) => setVarExtraPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={savingVariant}
                    className="w-full py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm"
                  >
                    {savingVariant
                      ? "Saving..."
                      : editingVariant
                      ? "Update Variant"
                      : "+ Add Variant"}
                  </button>
                </div>
              </div>

              <div className="text-xs text-indigo-800 font-medium">
                Live Final Price Preview: {formatINR(currentVariantProduct.salesPrice)} (Base) +{" "}
                {formatINR(Number(varExtraPrice) || 0)} (Extra) ={" "}
                <strong>
                  {formatINR(currentVariantProduct.salesPrice + (Number(varExtraPrice) || 0))}
                </strong>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive / Restore Confirmation Dialog */}
      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900">
              {archiveTarget.isArchived
                ? `Restore "${archiveTarget.name}"?`
                : `Archive "${archiveTarget.name}"?`}
            </h3>
            <p className="text-sm text-slate-600 mt-2">
              {archiveTarget.isArchived
                ? "Restoring this product makes it available again for new quotation templates, discounts, and subscriptions."
                : "Products are archived rather than permanently deleted so historical subscriptions, lines, and invoices remain 100% valid."}
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setArchiveTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiving}
                onClick={handleConfirmArchive}
                className={`px-4 py-2 rounded-xl text-white text-sm font-semibold ${
                  archiveTarget.isArchived
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {archiving
                  ? "Processing..."
                  : archiveTarget.isArchived
                  ? "Confirm Restore"
                  : "Confirm Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

