const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");

function toMoney(value) {
  return Number(value || 0);
}

/**
 * GET /api/promoter/me
 * Linked promoter account only. No referred-user PII.
 */
async function getMyPromoterDashboard(req, res) {
  const promoter = await prisma.promoter.findUnique({
    where: { userId: req.userId },
    select: {
      id: true,
      code: true,
      name: true,
      commissionBps: true,
      windowDays: true,
      active: true,
      mpesaPhone: true,
      createdAt: true,
    },
  });

  if (!promoter) {
    throw new AppError(404, "No promoter profile is linked to this account.");
  }

  const link = `https://watchtriplem.co.ke/?ref=${encodeURIComponent(promoter.code)}`;

  const [
    signups,
    pendingAgg,
    paidAgg,
    cancelledAgg,
    payingDistinct,
    recentCommissions,
    recentPayouts,
  ] = await Promise.all([
    prisma.user.count({ where: { referredByPromoterId: promoter.id } }),
    prisma.commission.aggregate({
      where: { promoterId: promoter.id, status: "PENDING" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { promoterId: promoter.id, status: "PAID" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.commission.aggregate({
      where: { promoterId: promoter.id, status: "CANCELLED" },
      _count: true,
    }),
    prisma.commission.findMany({
      where: {
        promoterId: promoter.id,
        status: { in: ["PENDING", "PAID"] },
        userId: { not: null },
        adjustmentOfId: null,
      },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.commission.findMany({
      where: { promoterId: promoter.id, adjustmentOfId: null },
      orderBy: { earnedAt: "desc" },
      take: 30,
      select: {
        id: true,
        paymentAmount: true,
        rateBps: true,
        amount: true,
        status: true,
        earnedAt: true,
      },
    }),
    prisma.payout.findMany({
      where: { promoterId: promoter.id },
      orderBy: { paidAt: "desc" },
      take: 20,
      select: {
        id: true,
        amount: true,
        mpesaReceipt: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);

  // Sales = sum of payment amounts on non-adjustment commissions (PENDING+PAID)
  const salesAgg = await prisma.commission.aggregate({
    where: {
      promoterId: promoter.id,
      adjustmentOfId: null,
      status: { in: ["PENDING", "PAID"] },
    },
    _sum: { paymentAmount: true },
  });

  res.json({
    success: true,
    promoter: {
      code: promoter.code,
      name: promoter.name,
      active: promoter.active,
      commissionBps: promoter.commissionBps,
      commissionPercent: promoter.commissionBps / 100,
      windowDays: promoter.windowDays,
      mpesaPhone: promoter.mpesaPhone,
      link,
      createdAt: promoter.createdAt,
    },
    stats: {
      signups,
      payingUsers: payingDistinct.length,
      salesKes: toMoney(salesAgg._sum.paymentAmount),
      earnedKes: toMoney(pendingAgg._sum.amount) + toMoney(paidAgg._sum.amount),
      pendingKes: toMoney(pendingAgg._sum.amount),
      paidKes: toMoney(paidAgg._sum.amount),
      pendingCount: pendingAgg._count,
      paidCount: paidAgg._count,
      cancelledCount: cancelledAgg._count,
    },
    recentCommissions: recentCommissions.map((c) => ({
      id: c.id,
      paymentAmount: toMoney(c.paymentAmount),
      rateBps: c.rateBps,
      amount: toMoney(c.amount),
      status: c.status,
      earnedAt: c.earnedAt,
    })),
    recentPayouts: recentPayouts.map((p) => ({
      id: p.id,
      amount: toMoney(p.amount),
      mpesaReceipt: p.mpesaReceipt,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
  });
}

module.exports = { getMyPromoterDashboard };
