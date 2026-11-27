const { calculateCommissionAmount } = require("./commission");

/**
 * Create a PENDING commission for a SUCCEEDED payment, if eligible.
 * Safe to call from fulfillReference / reconcilePayment inside a transaction.
 * Duplicate paymentId → no-op (Daraja retries).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ id: number, userId: string, amount: unknown, paidAt?: Date|null, status: string }} payment
 *        payment must already be SUCCEEDED in this transaction
 */
async function earnCommissionForPayment(db, payment) {
  if (!payment?.id || !payment.userId) return null;
  if (payment.status && payment.status !== "SUCCEEDED") return null;

  const user = await db.user.findUnique({
    where: { id: payment.userId },
    select: { id: true, referredByPromoterId: true },
  });
  if (!user?.referredByPromoterId) return null;

  const promoter = await db.promoter.findUnique({
    where: { id: user.referredByPromoterId },
  });
  // Deactivated → no new commissions (already earned stay)
  if (!promoter || !promoter.active) return null;

  // Window: from referred user's first SUCCEEDED payment
  const first = await db.payment.findFirst({
    where: { userId: user.id, status: "SUCCEEDED" },
    orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    select: { paidAt: true, createdAt: true },
  });

  const firstAt =
    first?.paidAt || first?.createdAt || payment.paidAt || new Date();
  const windowEnd = new Date(firstAt);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + promoter.windowDays);

  const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
  if (paidAt.getTime() > windowEnd.getTime()) return null;

  const { amountKes } = calculateCommissionAmount(
    payment.amount,
    promoter.commissionBps,
  );
  if (Number(amountKes) <= 0) return null;

  try {
    return await db.commission.create({
      data: {
        promoterId: promoter.id,
        userId: user.id,
        paymentId: payment.id,
        paymentAmount: payment.amount,
        rateBps: promoter.commissionBps,
        amount: amountKes,
        status: "PENDING",
        earnedAt: paidAt,
      },
    });
  } catch (err) {
    // Unique on paymentId — repeated callbacks / double fulfill
    if (err && err.code === "P2002") return null;
    throw err;
  }
}

/**
 * Refund side-effects for commissions.
 * - PENDING → CANCELLED
 * - PAID → negative adjustment row (applied on next payout)
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} paymentId
 */
async function reverseCommissionForPayment(db, paymentId) {
  const commission = await db.commission.findFirst({
    where: { paymentId, adjustmentOfId: null },
  });
  if (!commission) return null;

  if (commission.status === "PENDING") {
    return db.commission.update({
      where: { id: commission.id },
      data: { status: "CANCELLED" },
    });
  }

  if (commission.status === "PAID") {
    const already = await db.commission.findFirst({
      where: {
        adjustmentOfId: commission.id,
        status: "PENDING",
      },
    });
    if (already) return already;

    const neg = (Number(commission.amount) * -1).toFixed(2);
    return db.commission.create({
      data: {
        promoterId: commission.promoterId,
        userId: commission.userId,
        paymentId: null,
        paymentAmount: commission.paymentAmount,
        rateBps: commission.rateBps,
        amount: neg,
        status: "PENDING",
        adjustmentOfId: commission.id,
        earnedAt: new Date(),
      },
    });
  }

  return commission;
}

module.exports = {
  earnCommissionForPayment,
  reverseCommissionForPayment,
};
