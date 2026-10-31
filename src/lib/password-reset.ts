import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { HttpError } from "@/lib/invoices/http-error";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const GENERIC_RESET_REQUEST_MESSAGE =
  "If an active account exists for that email address, password reset instructions have been sent.";

export function generateResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
}

async function sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromAddress = process.env.SMTP_FROM || "no-reply@brightloop.local";

  if (smtpHost) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    });

    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: "Reset your Brightloop password",
      text: `You requested a password reset for your Brightloop account.\n\nUse the link below within 60 minutes to set a new password:\n${resetUrl}\n\nIf you did not request this change, you can safely ignore this email.`,
      html: `<p>You requested a password reset for your <strong>Brightloop</strong> account.</p><p><a href="${resetUrl}">Click here to set a new password</a> (valid for 60 minutes).</p><p>If you did not request this change, you can safely ignore this email.</p>`,
    });
    return;
  }

  // Development-only local file outbox (inside gitignored .next/) when SMTP is not configured.
  // Never logs raw tokens to stdout/stderr and never exposes tokens in API responses.
  if (process.env.NODE_ENV === "development") {
    try {
      const outboxDir = path.join(process.cwd(), ".next");
      await fs.mkdir(outboxDir, { recursive: true });
      const outboxPath = path.join(outboxDir, "dev-email-outbox.json");
      const entry = {
        to: toEmail,
        subject: "Reset your Brightloop password",
        resetUrl,
        sentAt: new Date().toISOString(),
      };
      await fs.writeFile(outboxPath, JSON.stringify(entry, null, 2), "utf8");
    } catch {
      // Ignore file-write errors in read-only or restricted environments
    }
  }
}

/**
 * Initiates a password reset request:
 * - Always returns a generic response regardless of whether the email exists.
 * - Generates a CSPRNG token and stores ONLY its SHA-256 hash in PasswordResetToken.
 * - Sets an expiration timestamp.
 */
export async function requestPasswordReset(
  email: string,
  appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
): Promise<{ message: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: "insensitive" },
    },
    select: {
      id: true,
      email: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    return { message: GENERIC_RESET_REQUEST_MESSAGE };
  }

  const { rawToken, tokenHash } = generateResetToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const base = appBaseUrl.replace(/\/+$/, "");
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;

  await sendPasswordResetEmail(user.email, resetUrl);

  return { message: GENERIC_RESET_REQUEST_MESSAGE };
}

/**
 * Validates whether a raw password reset token is currently valid, unused, and unexpired.
 */
export async function validatePasswordResetToken(
  rawToken: string,
  now = new Date()
): Promise<{ valid: boolean; userId?: number }> {
  if (!rawToken || rawToken.trim().length < 16) {
    return { valid: false };
  }

  const tokenHash = hashResetToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, isActive: true },
      },
    },
  });

  if (!record) return { valid: false };
  if (record.usedAt !== null) return { valid: false };
  if (record.expiresAt <= now) return { valid: false };
  if (!record.user.isActive) return { valid: false };

  return { valid: true, userId: record.userId };
}

/**
 * Completes a password reset:
 * - Verifies the token hash exists, is unused, and has not expired.
 * - Hashes the new password using bcryptjs.
 * - Marks the token as used and updates the user's password atomically in a transaction,
 *   preventing token reuse.
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword: string,
  now = new Date()
): Promise<{ ok: true }> {
  if (!rawToken || rawToken.trim().length < 16) {
    throw new HttpError(400, "Invalid or expired password reset token");
  }

  const tokenHash = hashResetToken(rawToken);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt <= now || !record.user.isActive) {
    throw new HttpError(400, "Invalid or expired password reset token");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    // Atomic conditional update prevents concurrent token reuse
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now,
      },
    });

    if (claimed.count !== 1) {
      throw new HttpError(400, "Invalid or expired password reset token");
    }

    // Invalidate any other outstanding unused tokens for this user
    await tx.passwordResetToken.updateMany({
      where: {
        userId: record.userId,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: newPasswordHash },
    });
  });

  return { ok: true };
}

