require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const { validateApiKey } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "apex_jwt_secret_default";
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "apex@admin2026";

// ─── Proxy Fix for Railway / Reverse Proxies ───
app.set("trust proxy", 1);

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/api/auth/google/callback`;
const FRONTEND_URL         = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

app.use(cors({ origin: "*" }));
app.use(express.json());

// Global Rate Limiter
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
    version: "3.0.0",
    uptime: process.uptime()
  });
});

// ══════════════════════════════════════════════════════════════
// REGISTERED ENDPOINTS CATALOG (100 DAILY QUOTA EACH)
// ══════════════════════════════════════════════════════════════
const SYSTEM_ENDPOINTS = [
  { id: 'cinesubz-search', name: 'CineSubz · Search', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/cinesubz/search' },
  { id: 'cinesubz-info', name: 'CineSubz · Info & Links', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/cinesubz/info' },
  { id: 'cinesubz-dl', name: 'CineSubz · Direct DL', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/cinesubz/dl' },
  { id: 'sinhalacartoons-search', name: 'SinhalaCartoons · Search', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/sinhalacartoons/search' },
  { id: 'sinhalacartoons-dl', name: 'SinhalaCartoons · DL', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/sinhalacartoons/dl' },
  { id: 'tamilmv-search', name: '1TamilMV · Search', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/tamilmv/search' },
  { id: 'tamilmv-dl', name: '1TamilMV · DL & Magnets', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/tamilmv/dl' },
  { id: 'fitgirl-search', name: 'FitGirl · Search', category: 'game', categoryLabel: 'Game', path: '/api/v1/games/fitgirl/search' },
  { id: 'fitgirl-dl', name: 'FitGirl · Direct DL', category: 'game', categoryLabel: 'Game', path: '/api/v1/games/fitgirl/dl' },
  { id: 'slmix-search', name: 'SLMix · Search', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/slmix/search' },
  { id: 'slmix-dl', name: 'SLMix · Direct DL', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/slmix/dl' },
  { id: 'animeheaven-search', name: 'AnimeHeaven · Search', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/animeheaven/search' },
  { id: 'animeheaven-dl', name: 'AnimeHeaven · All Episodes DL', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/animeheaven/dl' },
  { id: 'yts-search', name: 'YTS · Search', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/yts/search' },
  { id: 'yts-dl', name: 'YTS · Torrents & Magnets', category: 'movie', categoryLabel: 'Movie', path: '/api/v1/movies/yts/dl' },
  { id: 'yt-search', name: 'YouTube · Search', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/yt/search' },
  { id: 'yt-audio-dl', name: 'YouTube · Audio DL', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/yt/audio' },
  { id: 'yt-video-dl', name: 'YouTube · Video DL', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/yt/video' },
  { id: 'an1-search', name: 'AN1 · Search', category: 'app', categoryLabel: 'App', path: '/api/v1/apps/an1/search' },
  { id: 'an1-dl', name: 'AN1 · Direct DL', category: 'app', categoryLabel: 'App', path: '/api/v1/apps/an1/dl' },
  { id: 'ai-tts', name: 'Apex AI · Text to Speech', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/ai/tts' },
  { id: 'facebook-dl', name: 'Facebook · Video DL', category: 'media', categoryLabel: 'Media', path: '/api/v1/media/facebook/dl' }
];

// ══════════════════════════════════════════════════════════════
// CLOUDFLARE TURNSTILE VERIFICATION
// ══════════════════════════════════════════════════════════════
async function verifyTurnstile(token, ip) {
  try {
    const formData = new URLSearchParams();
    formData.append("secret", process.env.TURNSTILE_SECRET_KEY);
    formData.append("response", token);
    if (ip) formData.append("remoteip", ip);

    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });
    
    const outcome = await result.json();
    return outcome.success;
  } catch (error) {
    console.error("[Turnstile Verify Error]:", error.message);
    return false;
  }
}

// ─── Brevo API Email Sender ───
async function sendVerificationEmail(user, code) {
  const emailPayload = {
    sender: { name: "Apex API", email: process.env.SENDER_EMAIL },
    to: [{ email: user.email }],
    subject: `${code} is your Apex API Verification Code`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
        <h2 style="color: #0f172a; margin: 0 0 10px;">Verify your email</h2>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 30px;">Welcome to Apex API, ${user.name}!<br>Use the code below to verify your account.</p>
        <div style="background: #ffffff; border: 2px dashed #c7d2fe; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6366f1;">${code}</span>
        </div>
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">This code will expire in 15 minutes.</p>
      </div>
    `
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY
      },
      body: JSON.stringify(emailPayload)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[Email Error] Brevo API rejected:`, data);
      throw new Error(data.message || "Brevo API Error");
    }
    console.log(`[Email Sent] ✅ Code to ${user.email}`);
  } catch (error) {
    console.error(`[Email Error] Failed to send to ${user.email}:`, error.message);
  }
}

// ==========================================
// AUTHENTICATION CONTROLLERS
// ==========================================

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    console.log(`[Register] Attempt: ${email}`);

    if (!email || !password) return res.status(400).json({ success: false, error: "Email and password are required" });

    const gmailRegex = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
    if (!gmailRegex.test(email.toLowerCase())) {
      return res.status(400).json({ success: false, error: "Only @gmail.com email addresses are allowed." });
    }

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      if (user.isVerified) return res.status(400).json({ success: false, error: "Email already registered. Please log in." });
      
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      user.verificationToken = newCode;
      user.verificationTokenExpires = Date.now() + 900000;
      await user.save();
      
      sendVerificationEmail(user, newCode).catch(e => console.error(e));
      return res.status(200).json({ success: true, message: "Verification code resent." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const generatedKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

    user = await User.create({
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      password: hashedPassword,
      apiKey: generatedKey,
      authMethod: "email",
      isVerified: false,
      verificationToken: verifyCode,
      verificationTokenExpires: Date.now() + 900000
    });

    console.log(`[Register] User created: ${user.email}, OTP: ${verifyCode}`);

    sendVerificationEmail(user, verifyCode).catch(e => console.error(e));
    res.status(201).json({ success: true, message: "Account created! Check your email for the 6-digit code." });
  } catch (e) {
    console.error("[Register Error]:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/api/auth/verify-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success: false, error: "Email and code required." });

    const user = await User.findOne({ 
      email: email.toLowerCase(), 
      verificationToken: code,
      verificationTokenExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ success: false, error: "Invalid or expired code." });

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, message: "Verified!", token, apiKey: user.apiKey, user });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// LOGIN ROUTE with Turnstile Verification
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, turnstileToken } = req.body;
    console.log(`[Login] Attempt: ${email}`);

    // Cloudflare Turnstile Check
    if (!turnstileToken) {
      console.log("[Login] ❌ Turnstile token missing");
      return res.status(400).json({ success: false, error: "Security check missing. Please refresh." }); 
    }

    const isHuman = await verifyTurnstile(turnstileToken, req.ip);
    if (!isHuman) {
      console.log("[Login] ❌ Turnstile validation failed");
      return res.status(403).json({ success: false, error: "Security check failed. Are you a robot?" }); 
    }

    if (!email || !password) return res.status(400).json({ success: false, error: "Email and password required" });
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log("[Login] ❌ User not found");
      return res.status(401).json({ success: false, error: "Invalid email or password." });
    }

    if (user.authMethod === "email") {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        console.log("[Login] ❌ Incorrect password");
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    console.log(`[Login] ✅ Success: ${user.email}`);
    res.json({ success: true, token, apiKey: user.apiKey, user });
  } catch (e) {
    console.error("[Login Error]:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Google OAuth Controllers
app.get("/api/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.redirect(`${FRONTEND_URL}/login.html?error=server_config`);
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account"
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${FRONTEND_URL}/login.html?error=cancelled`);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL,
        grant_type: "authorization_code"
      }).toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const googleUser = await userRes.json();
    if (!googleUser.email) return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);

    const normalizedEmail = googleUser.email.toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        email: normalizedEmail,
        name: googleUser.name || normalizedEmail.split("@")[0],
        apiKey: "apex_live_" + crypto.randomBytes(12).toString("hex"),
        googleId: googleUser.sub,
        avatar: googleUser.picture,
        authMethod: "google",
        isVerified: true
      });
    } else {
      user.lastUsed = new Date();
      if (!user.googleId) user.googleId = googleUser.sub;
      if (!user.avatar) user.avatar = googleUser.picture;
      if (!user.apiKey) user.apiKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
      user.isVerified = true; 
      await user.save();
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    const handoff = new URLSearchParams({
      token,
      apiKey: user.apiKey,
      user: JSON.stringify({
        id: user._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        apiKey: user.apiKey,
        avatar: user.avatar || null,
        authMethod: user.authMethod || "google"
      })
    });
    res.redirect(`${FRONTEND_URL}/login.html?${handoff.toString()}`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
  }
});

app.get("/api/auth/google/status", (req, res) => {
  res.json({ enabled: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
});

// ==========================================
// USER PROFILE & QUOTA TELEMETRY CONTROLLER
// ==========================================

app.get("/api/user/profile", validateApiKey, async (req, res) => {
  try {
    const user = req.user;
    const statsMap = user.endpointStats || new Map();

    // Map each registered endpoint with its daily 100 limit
    const endpointsData = SYSTEM_ENDPOINTS.map(ep => {
      const usedToday = statsMap.get(ep.path) || 0;
      const remainingToday = Math.max(0, 100 - usedToday);
      return {
        id: ep.id,
        name: ep.name,
        category: ep.category,
        categoryLabel: ep.categoryLabel,
        path: ep.path,
        usedToday: usedToday,
        remainingToday: remainingToday,
        dailyLimit: 100,
        totalRequests: usedToday
      };
    });

    // Populate live activity streams
    const recentRequests = [];
    endpointsData.filter(e => e.usedToday > 0).slice(0, 6).forEach(e => {
      recentRequests.push({
        endpoint: e.name,
        status: 200,
        latency: Math.floor(Math.random() * 80) + 120,
        time: "Today"
      });
    });

    if (recentRequests.length === 0) {
      recentRequests.push({
        endpoint: "API Mesh Gateway",
        status: 200,
        latency: 38,
        time: "Active now"
      });
    }

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        userId: user._id,
        tier: user.tier,
        totalRequests: user.totalRequests || 0,
        requestsToday: user.requestsToday || 0,
        status: user.status,
        joined: user.createdAt ? user.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "Recently",
        lastLogin: "Active Now",
        region: "Asia Pacific · sg-1",
        successRate: 99.4,
        avatar: user.avatar || null,
        authMethod: user.authMethod || "email"
      },
      key: {
        value: user.apiKey,
        lastRegenerated: "Active"
      },
      endpoints: endpointsData,
      recentRequests: recentRequests
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Regenerate Master API Key
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

// ==========================================
// ADMIN CONTROLLERS
// ==========================================

app.post("/api/admin/verify", (req, res) => {
  if (req.body.secretKey === ADMIN_SECRET) {
    return res.json({ success: true, message: "Authorized" });
  }
  return res.status(401).json({ success: false, error: "Access Denied: Invalid Master Secret Key" });
});

app.get("/api/admin/users", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = (authHeader && authHeader.replace("Bearer ", "").trim()) || req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized access" });

  const users = await User.find().sort({ createdAt: -1 });
  res.json({ success: true, users });
});

app.post("/api/admin/toggle-status", async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = (authHeader && authHeader.replace("Bearer ", "").trim()) || req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized access" });

  const user = await User.findById(req.body.userId);
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
  fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js")).forEach(file => {
    try {
      const plugin = require(path.join(pluginsDir, file));
      if (plugin.path && plugin.handler) {
        const method = (plugin.method || "GET").toLowerCase();
        app[method](plugin.path, validateApiKey, plugin.handler);
        console.log(`[Plugin Loaded] ${plugin.name} -> [${plugin.method || "GET"}] ${plugin.path}`);
      }
    } catch (err) {
      console.error(`[Plugin Error] Failed to load ${file}:`, err.message);
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
mongoose.connect(MONGODB_URI).then(() => {
  console.log("Connected to MongoDB Atlas successfully.");
  app.listen(PORT, () => console.log(`Apex API Modular Engine active on port ${PORT}`));
}).catch(err => {
  console.error("MongoDB Connection Failed:", err.message);
  app.listen(PORT, () => console.log(`Apex API running without database fallback on port ${PORT}`));
});
