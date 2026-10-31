"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function verify() {
      if (!token) {
        setTokenValid(false);
        setCheckingToken(false);
        return;
      }
      try {
        const res = await fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (active) {
          setTokenValid(Boolean(res.ok && data?.valid));
        }
      } catch {
        if (active) setTokenValid(false);
      } finally {
        if (active) setCheckingToken(false);
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data?.issues?.[0]?.message ||
            data?.error ||
            "Invalid or expired password reset token."
        );
        return;
      }

      router.push("/login?reset=success");
    } catch (err) {
      setError((err as Error).message || "Network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
          BL
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
          Set New Password
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Choose a strong password for your Brightloop account
        </p>
      </div>

      {checkingToken ? (
        <div className="py-6 text-center text-xs text-slate-500">
          Validating password reset link...
        </div>
      ) : !tokenValid ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700">
            This password reset link is invalid, has expired, or has already been used.
          </div>
          <Link
            href="/forgot-password"
            className="block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-xs font-semibold text-white hover:bg-slate-800"
          >
            Request a new reset link
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-slate-700">
                New Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-xs font-medium text-slate-700"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Updating password..." : "Update Password"}
            </button>
          </form>
        </>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5 text-center text-xs text-slate-600">
        <Link href="/login" className="font-semibold text-blue-600 hover:underline">
          Back to Sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-900">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 shadow-sm">
            Loading password reset form...
          </div>
        }
      >
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}

