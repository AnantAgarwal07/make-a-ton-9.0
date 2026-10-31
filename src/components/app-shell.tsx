"use client";

import React from "react";
import type { CurrentUser } from "@/lib/auth";
import { PageTitle, SiteHeader } from "@/components/site-header";

/** Page frame for P1 pages: shared top navigation + standard title row. */
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
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader user={{ name: user.name, email: user.email, role: user.role }} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <PageTitle title={title} subtitle={subtitle} actions={actions} />
        {children}
      </main>
    </div>
  );
}
