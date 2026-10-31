"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CurrentUser, Role } from "@/lib/auth";

interface NavItem {
  label: string;
  href: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Admin Dashboard", href: "/admin", roles: ["ADMIN"] },
  { label: "Staff Management", href: "/admin/staff", roles: ["ADMIN"] },
  { label: "Staff Dashboard", href: "/staff", roles: ["STAFF"] },
  { label: "Customer Management", href: "/customers", roles: ["ADMIN", "STAFF"] },
  { label: "Catalog & Pricing", href: "/catalog", roles: ["ADMIN", "STAFF"] },
  { label: "Subscriptions", href: "/subscriptions", roles: ["ADMIN", "STAFF"] },
  { label: "Finance Dashboard", href: "/dashboard", roles: ["ADMIN", "STAFF"] },
  { label: "Invoices", href: "/invoices", roles: ["ADMIN", "STAFF"] },
  { label: "Payments", href: "/payments", roles: ["ADMIN", "STAFF"] },
  { label: "My Account & Profile", href: "/customer", roles: ["CUSTOMER"] },
  { label: "My Subscriptions", href: "/portal/subscriptions", roles: ["CUSTOMER"] },
  { label: "My Invoices", href: "/portal/invoices", roles: ["CUSTOMER"] },
];

const ROLE_BADGE_STYLES: Record<Role, string> = {
  ADMIN: "bg-purple-100 text-purple-800 border-purple-200",
  STAFF: "bg-blue-100 text-blue-800 border-blue-200",
  CUSTOMER: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function AppShell({
  user,
  title,
  subtitle,
  actions,
  children,
}: {
  user: CurrentUser;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  function isActiveLink(href: string) {
    if (href === "/admin") return pathname === "/admin";
    if (href === "/staff") return pathname === "/staff";
    if (href === "/customer") return pathname === "/customer";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
              >
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                )}
              </svg>
            </button>

            <Link
              href={
                user.role === "ADMIN"
                  ? "/admin"
                  : user.role === "STAFF"
                    ? "/staff"
                    : "/customer"
              }
              className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
                BL
              </span>
              <span>
                Brightloop <span className="font-normal text-slate-500">Subscriptions</span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="flex items-center justify-end gap-2">
                <span className="text-xs font-semibold text-slate-900">{user.name}</span>
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ROLE_BADGE_STYLES[user.role]}`}
                >
                  {user.role}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">{user.email}</div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
            <div className="mb-3 border-b border-slate-100 pb-2 sm:hidden">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">{user.name}</span>
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ROLE_BADGE_STYLES[user.role]}`}
                >
                  {user.role}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">{user.email}</div>
            </div>
            <nav className="flex flex-col space-y-1">
              {visibleNav.map((item) => {
                const active = isActiveLink(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-md px-3 py-2 text-xs font-medium ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Navigation
            </div>
            <nav className="space-y-1">
              {visibleNav.map((item) => {
                const active = isActiveLink(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
              {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
