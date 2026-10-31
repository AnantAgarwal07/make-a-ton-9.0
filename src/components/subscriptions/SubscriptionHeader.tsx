"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  Layers,
  PlusCircle,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

interface UserOption {
  id: number;
  email: string;
  role: "ADMIN" | "STAFF" | "CUSTOMER";
  customerId: number | null;
  customer?: { id: number; name: string; email: string } | null;
}

export function SubscriptionHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<{
    userId: number;
    email: string;
    role: "ADMIN" | "STAFF" | "CUSTOMER";
    customerId: number | null;
  } | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [switching, setSwitching] = useState(false);

  const handleSwitchUser = useCallback(
    async (email: string) => {
      setSwitching(true);
      try {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          const data = await res.json();
          setSession(data.session);
          window.dispatchEvent(new CustomEvent("brightloop-auth-changed", { detail: data.session }));
          router.refresh();
        }
      } finally {
        setSwitching(false);
      }
    },
    [router]
  );

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        setSession(data.session || null);
        setUsers(data.availableUsers || []);
        if (!data.session && data.availableUsers?.length > 0) {
          const isPortal = window.location.pathname.startsWith("/portal");
          const defaultUser = isPortal
            ? data.availableUsers.find((u: UserOption) => u.role === "CUSTOMER") || data.availableUsers[0]
            : data.availableUsers.find((u: UserOption) => u.role === "STAFF" || u.role === "ADMIN") ||
              data.availableUsers[0];
          if (defaultUser) {
            handleSwitchUser(defaultUser.email);
          }
        }
      })
      .catch(() => {});
  }, [handleSwitchUser]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/subscriptions" className="flex items-center gap-2.5 font-bold text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <span className="text-base tracking-tight">Brightloop</span>
              <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                Subscriptions
              </span>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center gap-1 text-sm font-medium">
            <Link
              href="/subscriptions"
              className={`rounded-md px-3 py-1.5 transition ${
                pathname === "/subscriptions"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              Subscriptions
            </Link>
            <Link
              href="/subscriptions/new"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                pathname === "/subscriptions/new"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <PlusCircle className="h-4 w-4" />
              New Subscription
            </Link>
            <Link
              href="/customers"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                pathname.startsWith("/customers")
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Users className="h-4 w-4" />
              Customers
            </Link>
            <Link
              href="/catalog"
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${
                pathname.startsWith("/catalog")
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Boxes className="h-4 w-4" />
              Catalog & Pricing (Admin)
            </Link>
            <Link
              href="/portal/subscriptions"
              className={`rounded-md px-3 py-1.5 transition ${
                pathname.startsWith("/portal")
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              Customer Portal
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {session && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              {session.role === "CUSTOMER" ? (
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
              )}
              <span>{session.role}</span>
            </span>
          )}

          {users.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="role-switcher" className="text-slate-500">
                Active User:
              </label>
              <select
                id="role-switcher"
                disabled={switching}
                value={session?.email ?? ""}
                onChange={(e) => handleSwitchUser(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.role}: {u.customer ? `${u.customer.name} (${u.email})` : u.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
