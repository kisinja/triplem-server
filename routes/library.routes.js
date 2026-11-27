const express = require("express");

const {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  clearWatchlist,
  getWatchHistory,
  saveWatchHistory,
  removeWatchHistory,
  clearWatchHistory,
} = require("../controllers/library.controller");

const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// All library endpoints require authentication
router.use(requireAuth);

// Prevent private library responses from being cached
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ==========================
// MY LIST
// ==========================

router.get("/my-list", getWatchlist);

router.put("/my-list/:type/:id", addToWatchlist);

router.delete("/my-list/:type/:id", removeFromWatchlist);

router.delete("/my-list", clearWatchlist);

// ==========================
// CONTINUE WATCHING
// ==========================

router.get("/continue-watching", getWatchHistory);

router.put("/continue-watching/:type/:id", saveWatchHistory);

router.delete("/continue-watching/:type/:id", removeWatchHistory);

router.delete("/continue-watching", clearWatchHistory);

module.exports = router;
