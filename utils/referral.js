const prisma = require("../lib/prisma");
const { normalizePromoterCode } = require("./commission");

/**
 * Resolve an active promoter by public code.
 * @returns {Promise<import('@prisma/client').Promoter | null>}
 */
async function findActivePromoterByCode(rawCode) {
  const code = normalizePromoterCode(rawCode);
  if (!code) return null;

  return prisma.promoter.findFirst({
    where: { code, active: true },
  });
}

/**
 * Attribution payload for User.create / update at registration only.
 * Never call this for existing users after signup.
 *
 * @param {object} opts
 * @param {string|undefined|null} opts.refCode - from request body
 * @param {string} opts.newUserEmail - email being registered (self-referral check)
 * @param {string|null} [opts.linkedPromoterUserId] - unused at create; self-check uses promoter.userId after lookup
 */
async function resolveRegistrationAttribution({ refCode, newUserEmail }) {
  const promoter = await findActivePromoterByCode(refCode);
  if (!promoter) {
    return {
      referredByCode: null,
      referredByPromoterId: null,
      referredAt: null,
    };
  }

  // Self-referral: registering email matches the linked promoter account email
  if (promoter.userId) {
    const linked = await prisma.user.findUnique({
      where: { id: promoter.userId },
      select: { email: true },
    });
    if (
      linked?.email &&
      linked.email.toLowerCase() === String(newUserEmail).toLowerCase().trim()
    ) {
      return {
        referredByCode: null,
        referredByPromoterId: null,
        referredAt: null,
      };
    }
  }

  return {
    referredByCode: promoter.code,
    referredByPromoterId: promoter.id,
    referredAt: new Date(),
  };
}

module.exports = {
  findActivePromoterByCode,
  resolveRegistrationAttribution,
};
