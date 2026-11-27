const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");
const { writeAudit } = require("../utils/audit");
const {
  normalizePromoterCode,
  MIN_PAYOUT_KES,
  calculateCommissionAmount,
} = require("../utils/commission");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Please provide a valid JSON object.");
  }
}

function assertAllowedKeys(value, allowed) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new AppError(400, `Unsupported field: ${unexpected}.`);
}

function requiredString(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength
  ) {
    throw new AppError(
      400,
      `${label} must be a non-empty string of at most ${maxLength} characters.`,
    );
  }
  return value.trim();
}

function getUuid(value, label = "id") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError(400, `${label} must be a valid UUID.`);
  }
  return value;
}

function getPagination(query, sortValues) {
  const parseInteger = (value, fallback, label) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
      throw new AppError(400, `${label} must be an integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new AppError(400, `${label} is out of range.`);
    }
    return parsed;
  };
  const page = parseInteger(query.page, 1, "page");
  if (page < 1 || page > 1000000) {
    throw new AppError(400, "page must be between 1 and 1000000.");
  }
  const requestedLimit = parseInteger(query.limit, 20, "limit");
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const sort = query.sort === undefined ? sortValues[0] : query.sort;
  if (typeof sort !== "string" || !sortValues.includes(sort)) {
    throw new AppError(400, "sort is not supported.");
  }
  const [sortField, sortOrder] = sort.split(":");
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    orderBy: { [sortField]: sortOrder },
  };
}

function paginationResponse(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function parseBps(value, label = "commissionBps") {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new AppError(400, `${label} must be an integer between 0 and 10000.`);
  }
  return value;
}

function parseWindowDays(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 730) {
    throw new AppError(400, "windowDays must be an integer between 1 and 730.");
  }
  return value;
}

function optionalPhone(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 20) {
    throw new AppError(
      400,
      "mpesaPhone must be a string of at most 20 characters.",
    );
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 9) {
    throw new AppError(400, "mpesaPhone looks invalid.");
  }
  return value.trim();
}

function toMoney(value) {
  return Number(value || 0);
}

function publicPromoter(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    userId: row.userId,
    commissionBps: row.commissionBps,
    commissionPercent: row.commissionBps / 100,
    windowDays: row.windowDays,
    active: row.active,
    mpesaPhone: row.mpesaPhone,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row.user || undefined,
    _count: row._count,
  };
}

/**
 * POST /api/admin/promoters
 * Body: { code, name, commissionBps?, windowDays?, userId?, mpesaPhone?, notes?, active? }
 */
async function createPromoter(req, res) {
  assertObject(req.body);
  assertAllowedKeys(req.body, [
    "code",
    "name",
    "commissionBps",
    "windowDays",
    "userId",
    "mpesaPhone",
    "notes",
    "active",
  ]);

  const code = normalizePromoterCode(req.body.code);
  if (!code) {
    throw new AppError(
      400,
      "code must be 2–32 characters (letters, numbers, _ or -).",
    );
  }
  const name = requiredString(req.body.name, "name", 120);
  const commissionBps = parseBps(req.body.commissionBps) ?? 2500;
  const windowDays = parseWindowDays(req.body.windowDays) ?? 90;
  const mpesaPhone = optionalPhone(req.body.mpesaPhone);
  let notes = null;
  if (req.body.notes !== undefined && req.body.notes !== null) {
    if (typeof req.body.notes !== "string" || req.body.notes.length > 1000) {
      throw new AppError(
        400,
        "notes must be a string of at most 1000 characters.",
      );
    }
    notes = req.body.notes.trim() || null;
  }
  const active =
    req.body.active === undefined ? true : req.body.active === true;
  if (req.body.active !== undefined && typeof req.body.active !== "boolean") {
    throw new AppError(400, "active must be a boolean.");
  }

  let userId = null;
  if (req.body.userId !== undefined && req.body.userId !== null) {
    userId = getUuid(req.body.userId, "userId");
  }

  const promoter = await prisma.$transaction(async (db) => {
    if (userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) throw new AppError(404, "Linked user not found.");
      const taken = await db.promoter.findUnique({ where: { userId } });
      if (taken) {
        throw new AppError(409, "That user is already linked to a promoter.");
      }
    }

    const created = await db.promoter.create({
      data: {
        code,
        name,
        commissionBps,
        windowDays,
        active,
        mpesaPhone: mpesaPhone ?? null,
        notes,
        userId,
        createdByAdminId: req.userId,
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
        _count: {
          select: { referrals: true, commissions: true, payouts: true },
        },
      },
    });

    await writeAudit(db, {
      adminId: req.userId,
      action: "promoter.created",
      targetType: "promoter",
      targetId: created.id,
      details: { code: created.code, name: created.name },
    });

    return created;
  });

  res.status(201).json({ success: true, promoter: publicPromoter(promoter) });
}

/**
 * GET /api/admin/promoters
 */
async function listPromoters(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
    "name:asc",
    "name:desc",
    "code:asc",
  ]);

  const where = {};
  if (req.query.active !== undefined) {
    if (!["true", "false"].includes(String(req.query.active))) {
      throw new AppError(400, "active must be true or false.");
    }
    where.active = req.query.active === "true";
  }
  if (req.query.q !== undefined) {
    if (typeof req.query.q !== "string" || req.query.q.length > 200) {
      throw new AppError(400, "q must be a string of at most 200 characters.");
    }
    const q = req.query.q.trim();
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const [total, rows] = await prisma.$transaction([
    prisma.promoter.count({ where }),
    prisma.promoter.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        user: { select: { id: true, email: true, name: true } },
        _count: {
          select: { referrals: true, commissions: true, payouts: true },
        },
      },
    }),
  ]);

  // Aggregate pending / paid commission totals per page
  const ids = rows.map((r) => r.id);
  const aggregates =
    ids.length === 0
      ? []
      : await prisma.commission.groupBy({
          by: ["promoterId", "status"],
          where: { promoterId: { in: ids } },
          _sum: { amount: true },
        });

  const moneyByPromoter = new Map();
  for (const row of aggregates) {
    const cur = moneyByPromoter.get(row.promoterId) || {
      pendingKes: 0,
      paidKes: 0,
    };
    const amt = toMoney(row._sum.amount);
    if (row.status === "PENDING") cur.pendingKes += amt;
    if (row.status === "PAID") cur.paidKes += amt;
    moneyByPromoter.set(row.promoterId, cur);
  }

  const data = rows.map((row) => {
    const money = moneyByPromoter.get(row.id) || {
      pendingKes: 0,
      paidKes: 0,
    };
    return {
      ...publicPromoter(row),
      stats: {
        referrals: row._count.referrals,
        commissions: row._count.commissions,
        payouts: row._count.payouts,
        pendingKes: Number(money.pendingKes.toFixed(2)),
        paidKes: Number(money.paidKes.toFixed(2)),
      },
    };
  });

  res.json({
    success: true,
    data,
    pagination: paginationResponse(page, limit, total),
  });
}

/**
 * GET /api/admin/promoters/:id
 */
async function getPromoter(req, res) {
  const id = getUuid(req.params.id, "Promoter id");

  const promoter = await prisma.promoter.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true } },
      _count: { select: { referrals: true, commissions: true, payouts: true } },
    },
  });
  if (!promoter) throw new AppError(404, "Promoter not found.");

  const [pending, paid, cancelled, referralCount, payingUsers] =
    await Promise.all([
      prisma.commission.aggregate({
        where: { promoterId: id, status: "PENDING" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.commission.aggregate({
        where: { promoterId: id, status: "PAID" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.commission.aggregate({
        where: { promoterId: id, status: "CANCELLED" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.user.count({ where: { referredByPromoterId: id } }),
      prisma.commission.findMany({
        where: {
          promoterId: id,
          status: { in: ["PENDING", "PAID"] },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

  const recentCommissions = await prisma.commission.findMany({
    where: { promoterId: id },
    orderBy: { earnedAt: "desc" },
    take: 20,
    select: {
      id: true,
      paymentId: true,
      paymentAmount: true,
      rateBps: true,
      amount: true,
      status: true,
      earnedAt: true,
      userId: true,
    },
  });

  const recentPayouts = await prisma.payout.findMany({
    where: { promoterId: id },
    orderBy: { paidAt: "desc" },
    take: 10,
  });

  res.json({
    success: true,
    promoter: publicPromoter(promoter),
    stats: {
      referrals: referralCount,
      payingUsers: payingUsers.length,
      pendingKes: toMoney(pending._sum.amount),
      pendingCount: pending._count,
      paidKes: toMoney(paid._sum.amount),
      paidCount: paid._count,
      cancelledKes: toMoney(cancelled._sum.amount),
      cancelledCount: cancelled._count,
    },
    recentCommissions: recentCommissions.map((c) => ({
      ...c,
      paymentAmount: toMoney(c.paymentAmount),
      amount: toMoney(c.amount),
    })),
    recentPayouts: recentPayouts.map((p) => ({
      ...p,
      amount: toMoney(p.amount),
    })),
  });
}

/**
 * PATCH /api/admin/promoters/:id
 * Body: { name?, commissionBps?, windowDays?, userId?, mpesaPhone?, notes?, active? }
 * Note: code is immutable after create (attribution history).
 */
async function updatePromoter(req, res) {
  const id = getUuid(req.params.id, "Promoter id");
  assertObject(req.body);
  assertAllowedKeys(req.body, [
    "name",
    "commissionBps",
    "windowDays",
    "userId",
    "mpesaPhone",
    "notes",
    "active",
  ]);

  const data = {};
  if (Object.hasOwn(req.body, "name")) {
    data.name = requiredString(req.body.name, "name", 120);
  }
  if (Object.hasOwn(req.body, "commissionBps")) {
    data.commissionBps = parseBps(req.body.commissionBps);
  }
  if (Object.hasOwn(req.body, "windowDays")) {
    data.windowDays = parseWindowDays(req.body.windowDays);
  }
  if (Object.hasOwn(req.body, "active")) {
    if (typeof req.body.active !== "boolean") {
      throw new AppError(400, "active must be a boolean.");
    }
    data.active = req.body.active;
  }
  if (Object.hasOwn(req.body, "mpesaPhone")) {
    data.mpesaPhone = optionalPhone(req.body.mpesaPhone);
  }
  if (Object.hasOwn(req.body, "notes")) {
    if (req.body.notes === null || req.body.notes === "") {
      data.notes = null;
    } else {
      if (typeof req.body.notes !== "string" || req.body.notes.length > 1000) {
        throw new AppError(
          400,
          "notes must be a string of at most 1000 characters.",
        );
      }
      data.notes = req.body.notes.trim() || null;
    }
  }
  if (Object.hasOwn(req.body, "userId")) {
    if (req.body.userId === null || req.body.userId === "") {
      data.userId = null;
    } else {
      data.userId = getUuid(req.body.userId, "userId");
    }
  }

  if (!Object.keys(data).length) {
    throw new AppError(400, "Provide at least one field to update.");
  }

  const promoter = await prisma.$transaction(async (db) => {
    const current = await db.promoter.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "Promoter not found.");

    if (data.userId) {
      const user = await db.user.findUnique({
        where: { id: data.userId },
        select: { id: true },
      });
      if (!user) throw new AppError(404, "Linked user not found.");
      const taken = await db.promoter.findFirst({
        where: { userId: data.userId, NOT: { id } },
      });
      if (taken) {
        throw new AppError(409, "That user is already linked to a promoter.");
      }
    }

    const updated = await db.promoter.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, email: true, name: true } },
        _count: {
          select: { referrals: true, commissions: true, payouts: true },
        },
      },
    });

    await writeAudit(db, {
      adminId: req.userId,
      action:
        data.active === false ? "promoter.deactivated" : "promoter.updated",
      targetType: "promoter",
      targetId: id,
      details: {
        before: { active: current.active, name: current.name },
        changes: data,
      },
    });

    return updated;
  });

  res.json({ success: true, promoter: publicPromoter(promoter) });
}

/**
 * GET /api/admin/promoters/:id/referrals
 * Returns counts only — no emails/phones of referred users in list detail beyond admin need.
 * Admin may see anonymized signup dates + whether they paid.
 */
async function listPromoterReferrals(req, res) {
  const id = getUuid(req.params.id, "Promoter id");
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "referredAt:desc",
    "referredAt:asc",
    "createdAt:desc",
  ]);

  const promoter = await prisma.promoter.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!promoter) throw new AppError(404, "Promoter not found.");

  const where = { referredByPromoterId: id };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy:
        orderBy.referredAt !== undefined
          ? { referredAt: orderBy.referredAt }
          : { createdAt: orderBy.createdAt || "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        name: true,
        referredAt: true,
        createdAt: true,
        subscriptionExpiresAt: true,
        _count: {
          select: {
            payments: {
              where: { status: "SUCCEEDED" },
            },
          },
        },
      },
    }),
  ]);

  res.json({
    success: true,
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      referredAt: u.referredAt,
      createdAt: u.createdAt,
      hasPaid: u._count.payments > 0,
      subscriptionExpiresAt: u.subscriptionExpiresAt,
    })),
    pagination: paginationResponse(page, limit, total),
  });
}

/**
 * GET /api/admin/promoters/:id/commissions
 */
async function listPromoterCommissions(req, res) {
  const id = getUuid(req.params.id, "Promoter id");
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "earnedAt:desc",
    "earnedAt:asc",
    "amount:desc",
    "amount:asc",
  ]);

  const promoter = await prisma.promoter.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!promoter) throw new AppError(404, "Promoter not found.");

  const where = { promoterId: id };
  if (req.query.status !== undefined) {
    if (!["PENDING", "PAID", "CANCELLED"].includes(req.query.status)) {
      throw new AppError(400, "status is invalid.");
    }
    where.status = req.query.status;
  }

  const [total, rows] = await prisma.$transaction([
    prisma.commission.count({ where }),
    prisma.commission.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        paymentId: true,
        paymentAmount: true,
        rateBps: true,
        amount: true,
        status: true,
        earnedAt: true,
        payoutId: true,
        adjustmentOfId: true,
        userId: true,
      },
    }),
  ]);

  res.json({
    success: true,
    data: rows.map((c) => ({
      ...c,
      paymentAmount: toMoney(c.paymentAmount),
      amount: toMoney(c.amount),
    })),
    pagination: paginationResponse(page, limit, total),
  });
}

/**
 * POST /api/admin/promoters/:id/payouts
 * Body: { amount, mpesaReceipt, paidAt?, notes?, commissionIds? }
 * If commissionIds omitted, pays oldest PENDING commissions up to amount (FIFO).
 * Minimum total payout: KES 200.
 */
async function recordPromoterPayout(req, res) {
  const id = getUuid(req.params.id, "Promoter id");
  assertObject(req.body);
  assertAllowedKeys(req.body, [
    "amount",
    "mpesaReceipt",
    "paidAt",
    "notes",
    "commissionIds",
  ]);

  const mpesaReceipt = requiredString(
    req.body.mpesaReceipt,
    "mpesaReceipt",
    100,
  );
  const amountRaw = req.body.amount;
  if (
    typeof amountRaw !== "number" ||
    !Number.isFinite(amountRaw) ||
    amountRaw <= 0
  ) {
    throw new AppError(400, "amount must be a positive number.");
  }
  const amountKes = Math.round(amountRaw * 100) / 100;
  if (amountKes < MIN_PAYOUT_KES) {
    throw new AppError(400, `Minimum payout is KES ${MIN_PAYOUT_KES}.`);
  }

  let paidAt = new Date();
  if (req.body.paidAt !== undefined) {
    const d = new Date(req.body.paidAt);
    if (Number.isNaN(d.getTime())) {
      throw new AppError(400, "paidAt must be a valid ISO date.");
    }
    paidAt = d;
  }

  let notes = null;
  if (req.body.notes !== undefined && req.body.notes !== null) {
    if (typeof req.body.notes !== "string" || req.body.notes.length > 1000) {
      throw new AppError(
        400,
        "notes must be a string of at most 1000 characters.",
      );
    }
    notes = req.body.notes.trim() || null;
  }

  let commissionIds = null;
  if (req.body.commissionIds !== undefined) {
    if (
      !Array.isArray(req.body.commissionIds) ||
      req.body.commissionIds.length === 0
    ) {
      throw new AppError(
        400,
        "commissionIds must be a non-empty array of integers.",
      );
    }
    commissionIds = req.body.commissionIds.map((cid) => {
      if (!Number.isInteger(cid) || cid < 1) {
        throw new AppError(
          400,
          "Each commission id must be a positive integer.",
        );
      }
      return cid;
    });
  }

  const result = await prisma.$transaction(async (db) => {
    const promoter = await db.promoter.findUnique({ where: { id } });
    if (!promoter) throw new AppError(404, "Promoter not found.");

    let toPay;
    if (commissionIds) {
      toPay = await db.commission.findMany({
        where: {
          id: { in: commissionIds },
          promoterId: id,
          status: "PENDING",
        },
        orderBy: { earnedAt: "asc" },
      });
      if (toPay.length !== commissionIds.length) {
        throw new AppError(
          409,
          "One or more commissions are missing, not pending, or not owned by this promoter.",
        );
      }
    } else {
      // FIFO pending (includes negative adjustments)
      const pending = await db.commission.findMany({
        where: { promoterId: id, status: "PENDING" },
        orderBy: { earnedAt: "asc" },
      });
      toPay = [];
      let running = 0;
      for (const c of pending) {
        const next = running + toMoney(c.amount);
        if (toPay.length && next > amountKes + 0.001) break;
        toPay.push(c);
        running = next;
        if (running >= amountKes - 0.001) break;
      }
    }

    if (!toPay.length) {
      throw new AppError(409, "No pending commissions to pay out.");
    }

    const sum = toPay.reduce((acc, c) => acc + toMoney(c.amount), 0);
    const sumRounded = Math.round(sum * 100) / 100;
    if (Math.abs(sumRounded - amountKes) > 0.01) {
      throw new AppError(
        409,
        `Payout amount KES ${amountKes} does not match selected commissions total KES ${sumRounded}.`,
      );
    }
    if (sumRounded < MIN_PAYOUT_KES) {
      throw new AppError(400, `Minimum payout is KES ${MIN_PAYOUT_KES}.`);
    }

    const payout = await db.payout.create({
      data: {
        promoterId: id,
        amount: sumRounded.toFixed(2),
        mpesaReceipt,
        paidAt,
        notes,
        recordedById: req.userId,
      },
    });

    await db.commission.updateMany({
      where: { id: { in: toPay.map((c) => c.id) }, status: "PENDING" },
      data: { status: "PAID", payoutId: payout.id },
    });

    // Guard: ensure none stayed PENDING (race)
    const stillPending = await db.commission.count({
      where: { id: { in: toPay.map((c) => c.id) }, status: "PENDING" },
    });
    if (stillPending > 0) {
      throw new AppError(
        409,
        "Payout conflicted with another update. Please retry.",
      );
    }

    await writeAudit(db, {
      adminId: req.userId,
      action: "promoter.payout_recorded",
      targetType: "promoter",
      targetId: id,
      details: {
        payoutId: payout.id,
        amount: sumRounded,
        mpesaReceipt,
        commissionIds: toPay.map((c) => c.id),
      },
    });

    return payout;
  });

  res.status(201).json({
    success: true,
    payout: { ...result, amount: toMoney(result.amount) },
  });
}

module.exports = {
  createPromoter,
  listPromoters,
  getPromoter,
  updatePromoter,
  listPromoterReferrals,
  listPromoterCommissions,
  recordPromoterPayout,
};
