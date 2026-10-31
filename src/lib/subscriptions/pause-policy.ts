import { BillingPeriod } from "@prisma/client";

/**
 * TEAM-EDITABLE STARTING VALUES — Pause Duration Policy
 *
 * Expresses the maximum allowed pause duration per billing period as a number
 * of billing cycles:
 * - DAILY:   2 cycles = 2 days
 * - WEEKLY:  2 cycles = 2 weeks (14 days)
 * - MONTHLY: 2 cycles = 2 months
 * - YEARLY:  2 cycles = 2 years
 *
 * The team can adjust each value in this single configuration object without
 * modifying service logic or the database schema.
 */
export type PausePolicyConfig = Record<BillingPeriod, number>;

export const PAUSE_POLICY_CYCLES: PausePolicyConfig = {
  DAILY: 2,   // Team-editable starting value: 2 days
  WEEKLY: 2,  // Team-editable starting value: 2 weeks
  MONTHLY: 2, // Team-editable starting value: 2 months
  YEARLY: 2,  // Team-editable starting value: 2 years
};

export const pausePolicy = PAUSE_POLICY_CYCLES;

export const PAUSE_ACTION_NOTE = "ACTION:PAUSED";
export const RESUME_ACTION_NOTE = "ACTION:RESUMED";
export const RENEW_ACTION_NOTE = "ACTION:RENEWED";

/**
 * Adds a specified number of billing cycles to a base date.
 */
export function addBillingCycles(
  baseDate: Date,
  billingPeriod: BillingPeriod,
  cycles: number
): Date {
  const result = new Date(baseDate.getTime());
  switch (billingPeriod) {
    case "DAILY":
      result.setUTCDate(result.getUTCDate() + cycles);
      break;
    case "WEEKLY":
      result.setUTCDate(result.getUTCDate() + cycles * 7);
      break;
    case "MONTHLY":
      result.setUTCMonth(result.getUTCMonth() + cycles);
      break;
    case "YEARLY":
      result.setUTCFullYear(result.getUTCFullYear() + cycles);
      break;
  }
  return result;
}

/**
 * Calculates the maximum allowed pause end date and whether a paused subscription
 * has reached or exceeded the configured pause limit.
 */
export interface PauseStatusEvaluation {
  isPaused: boolean;
  pausedAt: Date | null;
  maxAllowedCycles: number;
  maxPauseUntil: Date | null;
  elapsedMs: number;
  elapsedDays: number;
  limitReached: boolean;
  warningMessage: string | null;
}

export function evaluatePauseDuration(params: {
  isPaused: boolean;
  billingPeriod: BillingPeriod;
  history: Array<{ note: string | null; changedAt: Date }>;
  asOfDate?: Date;
  policyOverride?: PausePolicyConfig;
}): PauseStatusEvaluation {
  const {
    isPaused,
    billingPeriod,
    history,
    asOfDate = new Date(),
    policyOverride = PAUSE_POLICY_CYCLES,
  } = params;

  const maxAllowedCycles = policyOverride[billingPeriod];

  if (!isPaused) {
    return {
      isPaused: false,
      pausedAt: null,
      maxAllowedCycles,
      maxPauseUntil: null,
      elapsedMs: 0,
      elapsedDays: 0,
      limitReached: false,
      warningMessage: null,
    };
  }

  // Find the most recent ACTION:PAUSED event in history
  const sortedPauseEvents = [...history]
    .filter((h) => h.note && h.note.startsWith(PAUSE_ACTION_NOTE))
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());

  const latestPause = sortedPauseEvents[0];
  const pausedAt = latestPause ? new Date(latestPause.changedAt) : null;

  if (!pausedAt) {
    return {
      isPaused: true,
      pausedAt: null,
      maxAllowedCycles,
      maxPauseUntil: null,
      elapsedMs: 0,
      elapsedDays: 0,
      limitReached: false,
      warningMessage: null,
    };
  }

  const maxPauseUntil = addBillingCycles(pausedAt, billingPeriod, maxAllowedCycles);
  const elapsedMs = Math.max(0, asOfDate.getTime() - pausedAt.getTime());
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
  const limitReached = asOfDate.getTime() >= maxPauseUntil.getTime();

  const periodUnitLabel =
    billingPeriod === "DAILY"
      ? "day(s)"
      : billingPeriod === "WEEKLY"
      ? "week(s)"
      : billingPeriod === "MONTHLY"
      ? "month(s)"
      : "year(s)";

  const warningMessage = limitReached
    ? `Maximum pause limit of ${maxAllowedCycles} ${periodUnitLabel} reached (paused since ${pausedAt.toISOString().slice(0, 10)}). Please apply the team's resume or close policy.`
    : null;

  return {
    isPaused: true,
    pausedAt,
    maxAllowedCycles,
    maxPauseUntil,
    elapsedMs,
    elapsedDays,
    limitReached,
    warningMessage,
  };
}

/**
 * Adjusts nextInvoiceDate upon resuming a paused subscription so the paused duration
 * does not consume the customer's paid/usable period.
 */
export function calculateResumedNextInvoiceDate(params: {
  currentNextInvoiceDate: Date | null;
  pausedAt: Date | null;
  resumedAt?: Date;
}): Date | null {
  const { currentNextInvoiceDate, pausedAt, resumedAt = new Date() } = params;
  if (!currentNextInvoiceDate) return null;
  if (!pausedAt) return currentNextInvoiceDate;

  const pausedDurationMs = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return new Date(currentNextInvoiceDate.getTime() + pausedDurationMs);
}

