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

// CORS configuration (Frontend access සඳහා)
app.use(cors({ origin: "*" }));
app.use(express.json());

// DDoS & Brute Force Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, error: "Too many requests. Please try again later." }
});
app.use("/api/", globalLimiter);

// Root route (Health check)
app.get("/", (req, res) => {
  res.json({
    status: "online",
    system: "Apex API Production Mesh",
    version: "2.5.0",
    uptime: process.uptime()
  });
});

// ==========================================
// AUTHENTICATION & USER CONTROLLERS
// ==========================================

// 1. User Registration (Explicit Register Endpoint)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email address is required" });
    }

    let existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: "This email is already registered. Please sign in instead." 
      });
    }

    // Unified API key එකක් generate කිරීම
    const generatedKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
    const user = await User.create({
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      password: password || "",
      apiKey: generatedKey
    });

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });

    return res.status(201).json({
      success: true,
      token,
      apiKey: user.apiKey,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        apiKey: user.apiKey,
        tier: user.tier,
        status: user.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Registration failed: " + err.message });
  }
});

// 2. User Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // පරිශීලකයා නොමැති නම් auto register කර Key එකක් ලබාදීම
      const generatedKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
      user = await User.create({
        email: email.toLowerCase(),
        name: name || email.split("@")[0],
        password: password || "",
        apiKey: generatedKey
      });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    return res.json({
      success: true,
      token,
      apiKey: user.apiKey,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        apiKey: user.apiKey,
        tier: user.tier,
        status: user.status
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Login failed: " + err.message });
  }
});

// 3. User Profile Telemetry
app.get("/api/user/profile", validateApiKey, async (req, res) => {
  const user = req.user;
  return res.json({
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

// 4. Regenerate Master API Key
app.post("/api/user/regenerate-key", validateApiKey, async (req, res) => {
  try {
    const newKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
    req.user.apiKey = newKey;
    await req.user.save();
    return res.json({ success: true, apiKey: newKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Key regeneration failed: " + err.message });
  }
});

// ==========================================
// ADMIN DASHBOARD CONTROLLERS
// ==========================================

// 1. Verify Admin Master Secret Key
app.post("/api/admin/verify", (req, res) => {
  const { secretKey } = req.body;
  if (secretKey === ADMIN_SECRET) {
    return res.json({ success: true, message: "Authorized" });
  }
  return res.status(401).json({ success: false, error: "Access Denied: Invalid Master Secret Key" });
});

// 2. Get All Users (Admin Protected)
app.get("/api/admin/users", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = (authHeader && authHeader.replace("Bearer ", "").trim()) || req.headers["x-admin-secret"];

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: "Unauthorized admin access" });
  }

  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Toggle User Ban / Active Status
app.post("/api/admin/toggle-status", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = (authHeader && authHeader.replace("Bearer ", "").trim()) || req.headers["x-admin-secret"];

  if (secret !== ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: "Unauthorized admin access" });
  }

  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    user.status = user.status === "Active" ? "Banned" : "Active";
    await user.save();
    return res.json({ success: true, status: user.status });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
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
        
        // සෑම microservice plugin එකකටම API key validation middleware එක යොදයි
        app[method](plugin.path, validateApiKey, plugin.handler);
        console.log(`[Plugin Mounted] ${plugin.name} -> [${plugin.method || "GET"}] ${plugin.path}`);
      }
    } catch (err) {
      console.error(`[Plugin Load Error] Failed to mount ${file}:`, err.message);
    }
  });
}

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Endpoint '${req.method} ${req.originalUrl}' not found on Apex API Gateway.`
  });
});

// ==========================================
// DATABASE CONNECTION & SERVER BOOT
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/apex_api";

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB Atlas successfully.");
    app.listen(PORT, () => console.log(`Apex API Production Mesh active on port ${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB Connection Failed:", err.message);
    app.listen(PORT, () => console.log(`Apex API running without database fallback on port ${PORT}`));
  });
