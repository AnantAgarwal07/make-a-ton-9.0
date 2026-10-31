"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Role = "ADMIN" | "STAFF" | "CUSTOMER";

export interface SiteHeaderUser {
  name: string;
  email: string;
  role: Role;
}

interface NavItem {
  label: string;
  href: string;
  roles: Role[];
  /** Match only the exact path (used for dashboards that have child routes). */
  exact?: boolean;
}

/** Single source of truth for navigation across P1 / P2 / P3 / P4. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Admin", href: "/admin", roles: ["ADMIN"], exact: true },
  { label: "Staff", href: "/admin/staff", roles: ["ADMIN"] },
  { label: "Home", href: "/staff", roles: ["STAFF"], exact: true },
  { label: "Customers", href: "/customers", roles: ["ADMIN", "STAFF"] },
  { label: "Catalog", href: "/catalog", roles: ["ADMIN", "STAFF"] },
  { label: "Subscriptions", href: "/subscriptions", roles: ["ADMIN", "STAFF"] },
  { label: "Finance", href: "/dashboard", roles: ["ADMIN", "STAFF"] },
  { label: "Invoices", href: "/invoices", roles: ["ADMIN", "STAFF"], exact: true },
  { label: "Overdue", href: "/invoices/overdue", roles: ["ADMIN", "STAFF"] },
  { label: "Payments", href: "/payments", roles: ["ADMIN", "STAFF"] },
  { label: "My Account", href: "/customer", roles: ["CUSTOMER"], exact: true },
  { label: "My Subscriptions", href: "/portal/subscriptions", roles: ["CUSTOMER"] },
  { label: "My Invoices", href: "/portal/invoices", roles: ["CUSTOMER"] },
];

const ROLE_BADGE_STYLES: Record<Role, string> = {
  ADMIN: "bg-purple-100 text-purple-800 border-purple-200",
  STAFF: "bg-blue-100 text-blue-800 border-blue-200",
  CUSTOMER: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function homeFor(role: Role | undefined) {
  return role === "ADMIN" ? "/admin" : role === "STAFF" ? "/staff" : role === "CUSTOMER" ? "/customer" : "/";
}

/**
 * Shared top navigation bar used by every page in the app.
 * Pass `user` when it is known on the server; otherwise it is loaded from `/api/auth/me`.
 */
export function SiteHeader({ user: initialUser }: { user?: SiteHeaderUser | null }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [user, setUser] = useState<SiteHeaderUser | null>(initialUser ?? null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (initialUser) return;
    let mounted = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mounted && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [initialUser]);

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

  const visibleNav = user ? NAV_ITEMS.filter((item) => item.roles.includes(user.role)) : [];

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href || (item.href === "/invoices" && /^\/invoices\/\d+/.test(pathname));
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  const linkClass = (active: boolean) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const roleBadge = user && (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ROLE_BADGE_STYLES[user.role]}`}
    >
      {user.role}
    </span>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 xl:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>

          <Link
            href={homeFor(user?.role)}
            className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight text-slate-900"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
              BL
            </span>
            <span>Brightloop</span>
          </Link>

          <nav className="hidden items-center gap-1 xl:flex">
            {visibleNav.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(isActive(item))}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {user ? (
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="flex items-center justify-end gap-2">
                <span className="text-xs font-semibold text-slate-900">{user.name}</span>
                {roleBadge}
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
        ) : (
          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Sign in
          </Link>
        )}
      </div>

      {mobileOpen && user && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 xl:hidden">
          <div className="mb-3 border-b border-slate-100 pb-2 sm:hidden">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-900">{user.name}</span>
              {roleBadge}
            </div>
            <div className="text-[11px] text-slate-500">{user.email}</div>
          </div>
          <nav className="flex flex-col gap-1">
            {visibleNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={linkClass(isActive(item))}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

/** Standard page title row, matching across every module. */
export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
