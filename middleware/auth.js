const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "apex_jwt_secret_default";

function checkDailyReset(user) {
  const today = new Date().toISOString().split("T")[0];
  if (user.lastResetDate !== today) {
    user.requestsToday = 0;
    user.lastResetDate = today;
    user.endpointStats = new Map();
  }
}

async function validateApiKey(req, res, next) {
  try {
    /* ═══════════════════════════════════════════════════════════
       STRICT MODE — ?api=<key> query param is MANDATORY.
       Requests with only Authorization: Bearer header will be
       REJECTED with 401. This is the requirement.
       ═══════════════════════════════════════════════════════════ */
    const rawKey = req.query.api;

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: The 'api' query parameter is required. Append ?api=YOUR_KEY (or &api=YOUR_KEY) to every request."
      });
    }

    // ── Resolve user: API key first, then JWT fallback ──
    let user = await User.findOne({ apiKey: rawKey });

    if (!user) {
      // Fallback: support JWT passed as ?api=<token> (for profile page compatibility)
      try {
        const decoded = jwt.verify(rawKey, JWT_SECRET);
        if (decoded && decoded.userId) {
          user = await User.findById(decoded.userId);
        }
      } catch (jwtErr) {
        // Not a valid JWT — will fall through to 401
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Access Denied: Invalid or revoked API Key."
      });
    }

    // ── Banned check ──
    if (user.status === "Banned") {
      return res.status(403).json({
        success: false,
        error: "Forbidden: Your account has been suspended by the administrator."
      });
    }

    // ── Daily reset + endpoint rate limit ──
    checkDailyReset(user);

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

    // ── Increment counters ──
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
