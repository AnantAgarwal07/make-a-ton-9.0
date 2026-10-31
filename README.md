# Brightloop — Subscription Management System

Enterprise Subscription, Identity, Customer, Staff, Invoice, and Payment Management System built with **Next.js 14 (App Router)**, **TypeScript**, **PostgreSQL (Neon)**, **Prisma**, **Tailwind CSS**, **Zod**, **bcryptjs**, and **jose**.

---

## 1. Installation & Setup

### Install Dependencies
```bash
cd brightloop
npm install
```

### Configure Environment Variables
Copy `.env.example` to `.env` and fill in your values (never commit `.env`):
```bash
cp .env.example .env
```

Required and optional variables in `.env`:
- `DATABASE_URL`: PostgreSQL connection string (Neon).
- `JWT_SECRET`: Secret key (at least 32 random characters) used to sign HTTP-only session JWTs.
- `NEXT_PUBLIC_APP_URL`: Base URL of the app (defaults to `http://localhost:3000`).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: Optional Nodemailer SMTP credentials for sending password reset emails.
  - **Development-Only Email Fallback**: When `NODE_ENV=development` and `SMTP_HOST` is not configured, password reset emails are written to `.next/dev-email-outbox.json` (gitignored) instead of being logged to stdout or exposed in API responses.

### Generate Prisma Client & Validate Schema
```bash
npx prisma validate
npx prisma generate
```

---

## 2. Creating the Initial Administrator Securely

There is **no public administrator registration route**. Public registration (`/register` and `POST /api/auth/register`) strictly creates `CUSTOMER` accounts on the server.

To provision the initial `ADMIN` (along with sample `STAFF` and `CUSTOMER` accounts), run the Prisma seed script:
```bash
npx prisma db seed
```

Default seeded accounts in `prisma/seed.ts` (password for all seeded accounts: `Admin@1234`):
- **Administrator**: `admin@brightloop.test` (`ADMIN` -> redirects to `/admin`)
- **Staff**: `staff@brightloop.test` (`STAFF` -> redirects to `/staff`)
- **Customer 1**: `acme@customer.test` (`CUSTOMER` -> redirects to `/customer`)
- **Customer 2**: `zen@customer.test` (`CUSTOMER` -> redirects to `/customer`)

---

## 3. Running the Application

### Development Server
```bash
npm run dev
```
Open `http://localhost:3000`. Unauthenticated requests redirect to `/login`.

### Production Build
```bash
npm run build
npm start
```

---

## 4. Architecture & Role Permissions (P1 + P4)

### Authentication & Sessions
- **Login (`/login`, `POST /api/auth/login`)**: Unified sign-in for `ADMIN`, `STAFF`, and `CUSTOMER`. Verifies credentials with `bcryptjs`, rejects inactive accounts (`isActive === false`), reads the role from PostgreSQL, and issues an `HS256` JWT stored in an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie (`bl_session`).
- **Logout (`POST /api/auth/logout`)**: Clears the `bl_session` cookie and redirects to `/login`.
- **Password Reset (`/forgot-password`, `/reset-password`)**:
  - Generates a 32-byte CSPRNG token (`crypto.randomBytes(32)`), stores only its SHA-256 hash in `PasswordResetToken.tokenHash` with a 60-minute expiry (`expiresAt`), and marks `usedAt` atomically in a transaction on completion to prevent token reuse.

### Role-Based Access Control
Enforced on the server via `src/middleware.ts` and `src/lib/auth.ts` (`getCurrentUser`, `requireUser`, `requireRole`, `requirePageAuth`):
- **`ADMIN` (`/admin`, `/admin/staff`, `/customers`, `/dashboard`, `/invoices`, `/payments`)**:
  - Full access to Staff Management (`GET/POST /api/staff`, `PATCH /api/staff/[id]`), Customer Management, and Finance/Billing operations.
  - Prevents deactivating the last active `ADMIN` account.
- **`STAFF` (`/staff`, `/customers`, `/dashboard`, `/invoices`, `/payments`)**:
  - Access to Customer Management (`GET/POST /api/customers`, `GET/PATCH /api/customers/[id]`) and Billing/Invoice operations. Cannot access `/admin` or manage staff/admin accounts.
- **`CUSTOMER` (`/customer`, `/portal/invoices`)**:
  - Strictly isolated to their own linked `Customer` record (`user.customerId`). Cannot view or edit other customers' profiles or invoices, and cannot access `/admin`, `/staff`, `/customers`, or internal billing dashboards.

---

## 5. Testing & Verification

Run the unit and domain test suite (Vitest):
```bash
npm test
```

Run schema validation, Prisma Client generation, TypeScript typechecking, and ESLint:
```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm run lint
```
