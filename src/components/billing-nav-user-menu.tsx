"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface NavUser {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF" | "CUSTOMER";
}

export function BillingNavUserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
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
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!user) return null;

  const homeHref =
    user.role === "ADMIN" ? "/admin" : user.role === "STAFF" ? "/staff" : "/customer";
  const homeLabel =
    user.role === "ADMIN"
      ? "Admin Dashboard"
      : user.role === "STAFF"
        ? "Staff Dashboard"
        : "My Account";

  return (
    <div className="flex items-center gap-3">
      <Link
        href={homeHref}
        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
      >
        {homeLabel}
      </Link>
      {user.role !== "CUSTOMER" && (
        <Link
          href="/customers"
          className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Customers
        </Link>
      )}
      <div className="hidden text-right sm:block">
        <div className="text-xs font-semibold text-slate-900">
          {user.name}{" "}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
            {user.role}
          </span>
        </div>
        <div className="text-[11px] text-slate-500">{user.email}</div>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

