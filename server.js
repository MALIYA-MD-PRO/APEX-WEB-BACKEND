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

// Login / Registration: Key එකක් generate කර JWT return කරයි
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
      successRate: 99.4
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
        
        // සෑම plugin එකකටම auth middleware එක mount කර ඇත
        app[method](plugin.path, validateApiKey, plugin.handler);
        console.log(`[Plugin Loaded] ${plugin.name} -> ${plugin.method || "GET"} ${plugin.path}`);
      }
    } catch (err) {
      console.error(`[Plugin Error] Failed to load ${file}:`, err.message);
    }
  });
}

// Database Connection & Boot
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