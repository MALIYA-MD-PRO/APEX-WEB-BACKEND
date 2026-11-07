require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");

const User = require("./models/User");
const { validateApiKey } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "apex_jwt_secret_default";
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "apex@admin2026";

// ─── Google OAuth config ────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL
  || `http://localhost:${PORT}/api/auth/google/callback`;
const FRONTEND_URL         = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

app.use(cors({ origin: "*" }));
app.use(express.json());

// DDoS Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: "Too many requests. Please try again later." }
});
app.use("/api/", globalLimiter);

// ==========================================
// AUTHENTICATION & ADMIN CONTROLLERS
// ==========================================

// Login / Registration: generate API key + JWT
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      const generatedKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
      user = await User.create({
        email: email.toLowerCase(),
        name: name || email.split("@")[0],
        apiKey: generatedKey
      });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, apiKey: user.apiKey, user });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ============================================================
   GOOGLE OAUTH — STEP 1: Redirect user to Google
   Frontend `login.html` Google button links to:
       <a href="https://your-backend/api/auth/google">
   ============================================================ */
app.get("/api/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error("[Google OAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return res.redirect(`${FRONTEND_URL}/login.html?error=server_config`);
  }

  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "offline",
    prompt:        "select_account"
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/* ============================================================
   GOOGLE OAUTH — STEP 2: Handle callback from Google
   Google redirects here with ?code=<auth-code>
   ============================================================ */
app.get("/api/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.warn("[Google OAuth] No code received:", error);
    return res.redirect(`${FRONTEND_URL}/login.html?error=cancelled`);
  }

  try {
    // ── 1) Exchange authorization code for access token ──
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_CALLBACK_URL,
        grant_type:    "authorization_code"
      }).toString()
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[Google OAuth] Token exchange failed:", tokenData);
      return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
    }

    // ── 2) Fetch Google user info ──
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const googleUser = await userRes.json();

    if (!googleUser.email) {
      console.error("[Google OAuth] No email from Google");
      return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
    }

    const normalizedEmail = googleUser.email.toLowerCase();

    // ── 3) Find or create user ──
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      // New signup via Google
      const apiKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
      user = await User.create({
        email:        normalizedEmail,
        name:         googleUser.name || normalizedEmail.split("@")[0],
        apiKey:       apiKey,
        googleId:     googleUser.sub,
        avatar:       googleUser.picture,
        authMethod:   "google"
      });
      console.log("[Google OAuth] New user created:", normalizedEmail);
    } else {
      // Existing user — refresh last seen, backfill optional fields
      user.lastUsed = new Date();
      if (!user.googleId)  user.googleId  = googleUser.sub;
      if (!user.avatar)    user.avatar    = googleUser.picture;
      if (!user.apiKey)    user.apiKey    = "apex_live_" + crypto.randomBytes(12).toString("hex");
      try { await user.save(); }
      catch (e) { console.warn("[Google OAuth] Optional save skipped:", e.message); }
      console.log("[Google OAuth] Existing user logged in:", normalizedEmail);
    }

    // ── 4) Issue our own JWT ──
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // ── 5) Redirect to frontend with handoff params ──
    const handoff = new URLSearchParams({
      token,
      apiKey: user.apiKey,
      user: JSON.stringify({
        id:         user._id.toString(),
        userId:     user._id.toString(),
        name:       user.name,
        email:      user.email,
        apiKey:     user.apiKey,
        avatar:     user.avatar || null,
        authMethod: user.authMethod || "google"
      })
    });

    res.redirect(`${FRONTEND_URL}/login.html?${handoff.toString()}`);

  } catch (err) {
    console.error("[Google OAuth] Callback error:", err.message);
    res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
  }
});

/* Optional: status endpoint (useful for hiding the Google button if not configured) */
app.get("/api/auth/google/status", (req, res) => {
  res.json({ enabled: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
});

// Profile Controller
app.get("/api/user/profile", validateApiKey, async (req, res) => {
  const user = req.user;
  res.json({
    success: true,
    user: {
      name: user.name,
      email: user.email,
      userId: user._id,
      tier: user.tier,
      totalRequests: user.totalRequests,
      requestsToday: user.requestsToday,
      status: user.status,
      joined: user.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      lastLogin: "Active Now",
      region: "Asia Pacific · sg-1",
      successRate: 99.4,
      avatar: user.avatar || null,
      authMethod: user.authMethod || "email"
    },
    key: {
      value: user.apiKey,
      lastRegenerated: "Active"
    }
  });
});

// Regenerate API Key
app.post("/api/user/regenerate-key", validateApiKey, async (req, res) => {
  try {
    const newKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
    req.user.apiKey = newKey;
    await req.user.save();
    res.json({ success: true, apiKey: newKey });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin Controllers
app.post("/api/admin/verify", (req, res) => {
  const { secretKey } = req.body;
  if (secretKey === ADMIN_SECRET) {
    return res.json({ success: true, message: "Authorized" });
  }
  return res.status(401).json({ success: false, error: "Access Denied: Invalid Master Secret Key" });
});

app.get("/api/admin/users", async (req, res) => {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized access" });

  const users = await User.find().sort({ createdAt: -1 });
  res.json({ success: true, users });
});

app.post("/api/admin/toggle-status", async (req, res) => {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized access" });

  const { userId } = req.body;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  user.status = user.status === "Active" ? "Banned" : "Active";
  await user.save();
  res.json({ success: true, status: user.status });
});

// ==========================================
// DYNAMIC PLUGIN AUTOLOADER
// ==========================================
const pluginsDir = path.join(__dirname, "plugins");
if (fs.existsSync(pluginsDir)) {
  const pluginFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js"));

  pluginFiles.forEach(file => {
    try {
      const plugin = require(path.join(pluginsDir, file));
      if (plugin.path && plugin.handler) {
        const method = (plugin.method || "GET").toLowerCase();
        app[method](plugin.path, validateApiKey, plugin.handler);
        console.log(`[Plugin Loaded] ${plugin.name} -> ${plugin.method || "GET"} ${plugin.path}`);
      }
    } catch (err) {
      console.error(`[Plugin Error] Failed to load ${file}:`, err.message);
    }
  });
}

// ==========================================
// DATABASE CONNECTION & BOOT
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/apex_api";
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB Atlas successfully.");
    app.listen(PORT, () => console.log(`Apex API Modular Engine active on port ${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB Connection Failed:", err.message);
    app.listen(PORT, () => console.log(`Apex API running without database fallback on port ${PORT}`));
  });
