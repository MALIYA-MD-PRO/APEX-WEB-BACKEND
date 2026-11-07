const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "apex_jwt_secret_default";

/**
 * Reset daily counters if the date has changed.
 * Called on every authenticated request.
 */
function checkDailyReset(user) {
  const today = new Date().toISOString().split("T")[0];
  if (user.lastResetDate !== today) {
    user.requestsToday = 0;
    user.lastResetDate = today;
    user.endpointStats = new Map();
  }
}

/**
 * Validate requests using EITHER:
 *   1. A query param `?api=apex_live_...` (API key)
 *   2. An `Authorization: Bearer <apiKey>` header
 *   3. An `Authorization: Bearer <JWT>` header (from /api/auth/login or Google OAuth)
 *
 * This dual-mode auth is what prevents the "profile page logs me out"
 * loop that happened when the frontend sent a JWT but the middleware
 * only knew how to look up API keys.
 */
async function validateApiKey(req, res, next) {
  try {
    // ---- 1. Extract credential ----
    let rawKey = req.query.api;
    if (!rawKey && req.headers.authorization) {
      rawKey = req.headers.authorization.replace(/^Bearer\s+/i, "").trim();
    }

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: You must be logged in with a valid API key to use Apex API services."
      });
    }

    // ---- 2. Resolve user (API key first, then JWT) ----
    let user = null;

    // Try as API key
    user = await User.findOne({ apiKey: rawKey });

    // Fall back: try as JWT
    if (!user) {
      try {
        const decoded = jwt.verify(rawKey, JWT_SECRET);
        if (decoded && decoded.userId) {
          user = await User.findById(decoded.userId);
        }
      } catch (jwtErr) {
        // Not a valid JWT either — will fall through to 401 below
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Access Denied: Invalid or revoked API Key."
      });
    }

    // ---- 3. Banned check ----
    if (user.status === "Banned") {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Your account has been suspended by the administrator."
      });
    }

    // ---- 4. Daily reset + rate limiting ----
    checkDailyReset(user);

    // Safety: ensure endpointStats is a Map (schema may have been reset)
    if (!user.endpointStats || typeof user.endpointStats.get !== "function") {
      user.endpointStats = new Map();
    }

    const endpointPath = req.baseUrl + req.path;
    const currentCount = user.endpointStats.get(endpointPath) || 0;

    if (currentCount >= 100 && user.tier !== "Unlimited Developer") {
      user.status = "Rate Limited";
      await user.save();
      return res.status(429).json({
        success: false,
        error: "Limit Reached: Maximum 100 requests/day per endpoint exceeded for your tier."
      });
    }

    // ---- 5. Increment counters ----
    user.endpointStats.set(endpointPath, currentCount + 1);
    user.totalRequests += 1;
    user.requestsToday += 1;
    user.lastUsed = new Date();
    await user.save();

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Internal Auth Error: " + err.message
    });
  }
}

module.exports = { validateApiKey, checkDailyReset };
