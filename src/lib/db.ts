import { PrismaClient } from "@prisma/client";

// Standard Next.js singleton: reuse one client across hot reloads in dev.
// For Neon serverless Postgres, cap connection_limit to 5 and increase connect/pool timeout
// so concurrent Promise.all queries do not exhaust Neon's connection limit or fail on cold starts.
function buildDatasources() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "5");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
    return { db: { url: u.toString() } };
  } catch {
    return undefined;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasources: buildDatasources() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
