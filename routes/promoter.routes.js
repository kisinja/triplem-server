const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  getMyPromoterDashboard,
} = require("../controllers/promoter.controller");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Auth required — subscription NOT required
router.get("/me", requireAuth, asyncHandler(getMyPromoterDashboard));

module.exports = router;
