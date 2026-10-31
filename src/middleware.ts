import { NextResponse, type NextRequest } from "next/server";
import {
  getRoleDashboardPath,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/session";

const AUTH_PAGES = ["/login", "/register"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  const session = token ? await verifySessionToken(token) : null;

  // Redirect already-authenticated users away from /login and /register
  if (AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (session) {
      return NextResponse.redirect(new URL(getRoleDashboardPath(session.role), req.url));
    }
    return NextResponse.next();
  }

  // Role-specific dashboards: prevent users from accessing dashboards belonging to other roles
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "ADMIN") {
      return NextResponse.redirect(new URL(getRoleDashboardPath(session.role), req.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "STAFF") {
      return NextResponse.redirect(new URL(getRoleDashboardPath(session.role), req.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/customer" || pathname.startsWith("/customer/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "CUSTOMER") {
      return NextResponse.redirect(new URL(getRoleDashboardPath(session.role), req.url));
    }
    return NextResponse.next();
  }

  // Customer management routes: ADMIN and STAFF only
  if (pathname === "/customers" || pathname.startsWith("/customers/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role !== "ADMIN" && session.role !== "STAFF") {
      return NextResponse.redirect(new URL(getRoleDashboardPath(session.role), req.url));
    }
    return NextResponse.next();
  }

  // Internal billing & finance routes: ADMIN and STAFF only
  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/invoices" ||
    pathname.startsWith("/invoices/") ||
    pathname === "/payments" ||
    pathname.startsWith("/payments/")
  ) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (session.role === "CUSTOMER") {
      return NextResponse.redirect(new URL("/customer", req.url));
    }
    return NextResponse.next();
  }

  // Customer portal routes: require authentication
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/admin/:path*",
    "/staff/:path*",
    "/customer/:path*",
    "/customers/:path*",
    "/dashboard/:path*",
    "/invoices/:path*",
    "/payments/:path*",
    "/portal/:path*",
  ],
};

