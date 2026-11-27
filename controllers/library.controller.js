const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");

function validateIdentity(type, id) {
  const tmdbId = Number(id);

  if (!["movie", "tv"].includes(type)) {
    throw new AppError(400, "Invalid media type.");
  }

  if (
    !/^\d+$/.test(String(id)) ||
    !Number.isInteger(tmdbId) ||
    tmdbId <= 0 ||
    tmdbId > 2147483647
  ) {
    throw new AppError(400, "Invalid TMDB ID.");
  }

  return { type, tmdbId };
}

function optionalString(value, maxLength) {
  if (value == null) return null;

  if (typeof value !== "string" || value.length > maxLength) {
    throw new AppError(400, "Invalid title metadata.");
  }

  return value;
}

function validateMetadata(body) {
  const { title, year, poster, voteAverage } = body || {};

  if (typeof title !== "string" || !title.trim() || title.length > 500) {
    throw new AppError(400, "A valid title is required.");
  }

  const rating = voteAverage == null ? null : Number(voteAverage);

  if (
    rating !== null &&
    (!Number.isFinite(rating) || rating < 0 || rating > 10)
  ) {
    throw new AppError(400, "Invalid vote average.");
  }

  return {
    title: title.trim(),
    year: optionalString(year == null ? null : String(year), 20),
    poster: optionalString(poster, 2048),
    voteAverage: rating,
  };
}

function validateEpisode(type, body) {
  if (type === "movie") {
    return {
      season: null,
      episode: null,
    };
  }

  const season = Number(body.season);
  const episode = Number(body.episode);

  if (
    body.season == null ||
    !Number.isInteger(season) ||
    season < 0 ||
    season > 100000
  ) {
    throw new AppError(400, "Invalid season number.");
  }

  if (
    body.episode == null ||
    !Number.isInteger(episode) ||
    episode < 1 ||
    episode > 100000
  ) {
    throw new AppError(400, "Invalid episode number.");
  }

  return { season, episode };
}

async function findWatchlist(userId) {
  return prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function getWatchlist(req, res, next) {
  try {
    const items = await findWatchlist(req.userId);

    return res.json({
      success: true,
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function addToWatchlist(req, res, next) {
  try {
    const userId = req.userId;

    const { type, tmdbId } = validateIdentity(req.params.type, req.params.id);

    const metadata = validateMetadata(req.body);

    await prisma.watchlistItem.upsert({
      where: {
        userId_type_tmdbId: {
          userId,
          type,
          tmdbId,
        },
      },
      create: {
        userId,
        type,
        tmdbId,
        ...metadata,
      },
      update: metadata,
    });

    const items = await findWatchlist(userId);

    return res.json({
      success: true,
      message: "Title added to My List.",
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function removeFromWatchlist(req, res, next) {
  try {
    const userId = req.userId;

    const { type, tmdbId } = validateIdentity(req.params.type, req.params.id);

    await prisma.watchlistItem.deleteMany({
      where: {
        userId,
        type,
        tmdbId,
      },
    });

    const items = await findWatchlist(userId);

    return res.json({
      success: true,
      message: "Title removed from My List.",
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function clearWatchlist(req, res, next) {
  try {
    await prisma.watchlistItem.deleteMany({
      where: {
        userId: req.userId,
      },
    });

    return res.json({
      success: true,
      message: "My List cleared.",
      items: [],
    });
  } catch (error) {
    next(error);
  }
}

async function findWatchHistory(userId) {
  return prisma.watchHistoryItem.findMany({
    where: { userId },
    orderBy: {
      updatedAt: "desc",
    },
    take: 12,
  });
}

async function getWatchHistory(req, res, next) {
  try {
    const items = await findWatchHistory(req.userId);

    return res.json({
      success: true,
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function saveWatchHistory(req, res, next) {
  try {
    const userId = req.userId;

    const { type, tmdbId } = validateIdentity(req.params.type, req.params.id);

    const metadata = validateMetadata(req.body);

    const episodeData = validateEpisode(type, req.body || {});

    await prisma.watchHistoryItem.upsert({
      where: {
        userId_type_tmdbId: {
          userId,
          type,
          tmdbId,
        },
      },
      create: {
        userId,
        type,
        tmdbId,
        ...metadata,
        ...episodeData,
      },
      update: {
        ...metadata,
        ...episodeData,
        updatedAt: new Date(),
      },
    });

    const items = await findWatchHistory(userId);

    return res.json({
      success: true,
      message: "Watch history updated.",
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function removeWatchHistory(req, res, next) {
  try {
    const userId = req.userId;

    const { type, tmdbId } = validateIdentity(req.params.type, req.params.id);

    await prisma.watchHistoryItem.deleteMany({
      where: {
        userId,
        type,
        tmdbId,
      },
    });

    const items = await findWatchHistory(userId);

    return res.json({
      success: true,
      message: "Title removed from Continue Watching.",
      items,
    });
  } catch (error) {
    next(error);
  }
}

async function clearWatchHistory(req, res, next) {
  try {
    await prisma.watchHistoryItem.deleteMany({
      where: {
        userId: req.userId,
      },
    });

    return res.json({
      success: true,
      message: "Watch history cleared.",
      items: [],
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  clearWatchlist,
  getWatchHistory,
  saveWatchHistory,
  removeWatchHistory,
  clearWatchHistory,
};
