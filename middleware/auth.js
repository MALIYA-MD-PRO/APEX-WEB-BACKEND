const User = require("../models/User");

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
    const rawKey = req.query.api || (req.headers.authorization && req.headers.authorization.replace("Bearer ", "").trim());
    
    // Strict Lock: Login නොවී key එකක් නැතිව access ප්‍රතික්ෂේප කරයි
    if (!rawKey) {
      return res.status(401).json({ 
        success: false, 
        error: "Unauthorized: You must be logged in with a valid API key to use Apex API services." 
      });
    }

    const user = await User.findOne({ apiKey: rawKey });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: "Access Denied: Invalid or revoked API Key." 
      });
    }

    if (user.status === "Banned") {
      return res.status(403).json({ 
        success: false, 
        error: "Forbidden: Your account has been suspended by the administrator." 
      });
    }

    checkDailyReset(user);

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

    user.endpointStats.set(endpointPath, currentCount + 1);
    user.totalRequests += 1;
    user.requestsToday += 1;
    user.lastUsed = new Date();
    await user.save();

    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: "Internal Auth Error: " + err.message });
  }
}

module.exports = { validateApiKey };