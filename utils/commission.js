/**
 * Commission helpers — integer-cent math only (no floats for money).
 */

/** @param {string|number|import('@prisma/client').Prisma.Decimal} amountKes */
function toCents(amountKes) {
  const n = Number(amountKes);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * @param {string|number} paymentAmountKes
 * @param {number} rateBps  e.g. 2500 = 25%
 * @returns {{ amountKes: string, amountCents: number }}
 */
function calculateCommissionAmount(paymentAmountKes, rateBps) {
  const bps = Math.max(0, Math.min(10000, Number(rateBps) || 0));
  const paymentCents = toCents(paymentAmountKes);
  const commissionCents = Math.round((paymentCents * bps) / 10000);
  return {
    amountCents: commissionCents,
    amountKes: (commissionCents / 100).toFixed(2),
  };
}

/**
 * Normalize promoter code for storage / lookup.
 * @param {unknown} raw
 */
function normalizePromoterCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (code.length < 2 || code.length > 32) return null;
  return code;
}

const MIN_PAYOUT_KES = 200;
const REF_COOKIE_DAYS = 30;

module.exports = {
  toCents,
  calculateCommissionAmount,
  normalizePromoterCode,
  MIN_PAYOUT_KES,
  REF_COOKIE_DAYS,
};
