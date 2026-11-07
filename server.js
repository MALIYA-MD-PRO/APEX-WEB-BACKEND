require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

const User = require("./models/User");
const { validateApiKey } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "apex_jwt_secret_default";
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "apex@admin2026";

// ─── Google OAuth config ────────────────────────────────────────
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/api/auth/google/callback`;
const FRONTEND_URL         = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const BACKEND_URL          = process.env.BACKEND_URL || `https://apex-web-backend-production.up.railway.app`;

// ─── Nodemailer SMTP Setup ─────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465, 
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

app.use(cors({ origin: "*" }));
app.use(express.json());

// DDoS Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, error: "Too many requests. Please try again later." }
});
app.use("/api/", globalLimiter);

// ══════════════════════════════════════════════════════════════
// DARKNESS SECURITY ENGINE (Backend)
// ══════════════════════════════════════════════════════════════
const darknessChallenges = new Map();
const darknessTokens = new Map();

// 1. Get PoW Challenge
app.get("/api/auth/darkness-challenge", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const difficulty = "00000"; // Harder PoW for bots
  darknessChallenges.set(nonce, { difficulty, createdAt: Date.now() });
  
  // Clean up old challenges
  for (let [key, val] of darknessChallenges.entries()) {
    if (Date.now() - val.createdAt > 300000) darknessChallenges.delete(key);
  }
  res.json({ nonce, difficulty });
});

// 2. Verify Browser & Return Master Token
app.post("/api/auth/darkness-verify", (req, res) => {
  try {
    const { nonce, solution, fingerprint } = req.body;
    const challenge = darknessChallenges.get(nonce);

    if (!challenge) return res.status(404).send("Not Found");
    darknessChallenges.delete(nonce);

    // Fingerprint Check
    const fp = fingerprint || {};
    const isBot = 
      fp.webdriver === true || 
      fp.plugins === 0 || 
      fp.hardwareConcurrency < 2 || 
      (fp.webglVendor && (fp.webglVendor.includes("SwiftShader") || fp.webglVendor.includes("Mesa"))) ||
      fp.timeTaken < 500;

    if (isBot) {
      console.warn("[Darkness] 🚫 Bot detected:", fp);
      return res.status(404).send("Not Found");
    }

    // Verify Proof of Work
    const hash = crypto.createHash("sha256").update(nonce + solution).digest("hex");
    if (!hash.startsWith(challenge.difficulty)) {
      return res.status(404).send("Not Found");
    }

    // Success! Issue Token (Valid for 2 days)
    const darknessToken = crypto.randomBytes(32).toString("hex");
    darknessTokens.set(darknessToken, Date.now() + 2 * 24 * 60 * 60 * 1000);

    res.json({ success: true, darknessToken });
  } catch (e) {
    res.status(404).send("Not Found");
  }
});

// ─── Email Verification Helper ───
async function sendVerificationEmail(user) {
  const verifyLink = `${BACKEND_URL}/api/auth/verify-email?token=${user.verificationToken}`;
  const mailOptions = {
    from: `"Apex API" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: "Verify your Apex API Account",
    html: `<div style="font-family:Arial;padding:20px;"><h2>Welcome to Apex API, ${user.name}!</h2><p>Click below to verify your email and activate your account.</p><a href="${verifyLink}" style="padding:10px 20px;background:#6366f1;color:white;text-decoration:none;border-radius:5px;">Verify Email</a><p style="font-size:12px;color:#888;">This link expires in 1 hour.</p></div>`
  };
  try { await transporter.sendMail(mailOptions); console.log(`[Email Sent] to ${user.email}`); } 
  catch (error) { console.error(`[Email Error]:`, error.message); }
}

// ==========================================
// AUTHENTICATION CONTROLLERS
// ==========================================

// 1. Register (With Email Verification)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: "Email and password are required" });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (user) {
      if (user.isVerified) return res.status(400).json({ success: false, error: "Email already registered. Please log in." });
      user.verificationToken = crypto.randomBytes(32).toString("hex");
      user.verificationTokenExpires = Date.now() + 3600000;
      await user.save();
      await sendVerificationEmail(user);
      return res.status(200).json({ success: true, message: "Verification email resent. Please check your inbox." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const generatedKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
    const verifyToken = crypto.randomBytes(32).toString("hex");

    user = await User.create({
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      password: hashedPassword,
      apiKey: generatedKey,
      authMethod: "email",
      isVerified: false,
      verificationToken: verifyToken,
      verificationTokenExpires: Date.now() + 3600000
    });

    await sendVerificationEmail(user);
    res.status(201).json({ success: true, message: "Account created! Please check your email to verify." });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 2. Verify Email Link
app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.redirect(`${FRONTEND_URL}/login.html?error=invalid_token`);

    const user = await User.findOne({ verificationToken: token, verificationTokenExpires: { $gt: Date.now() } });
    if (!user) return res.redirect(`${FRONTEND_URL}/login.html?error=expired_token`);

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.redirect(`${FRONTEND_URL}/login.html?verified=true`);
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);
  }
});

// 3. Login (Requires Darkness Token)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, darknessToken } = req.body;

    // ─── DARKNESS CHECK ───
    if (!darknessToken || !darknessTokens.has(darknessToken)) {
      return res.status(404).send("Not Found"); // Drop bot requests
    }
    if (darknessTokens.get(darknessToken) < Date.now()) {
      darknessTokens.delete(darknessToken);
      return res.status(404).send("Not Found");
    }

    // ─── NORMAL AUTH ───
    if (!email || !password) return res.status(400).json({ success: false, error: "Email and password required" });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials." });

    if (user.authMethod === "email") {
      if (!user.isVerified) return res.status(403).json({ success: false, error: "Please verify your email address first." });
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ success: false, error: "Invalid credentials." });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, apiKey: user.apiKey, user });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==========================================
// GOOGLE OAUTH (Same as before)
// ==========================================
app.get("/api/auth/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.redirect(`${FRONTEND_URL}/login.html?error=server_config`);
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_CALLBACK_URL, response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "select_account" });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${FRONTEND_URL}/login.html?error=cancelled`);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_CALLBACK_URL, grant_type: "authorization_code" }).toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const googleUser = await userRes.json();
    if (!googleUser.email) return res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`);

    const normalizedEmail = googleUser.email.toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({ email: normalizedEmail, name: googleUser.name || normalizedEmail.split("@")[0], apiKey: "apex_live_" + crypto.randomBytes(12).toString("hex"), googleId: googleUser.sub, avatar: googleUser.picture, authMethod: "google", isVerified: true });
    } else {
      user.lastUsed = new Date();
      if (!user.googleId) user.googleId = googleUser.sub;
      if (!user.avatar) user.avatar = googleUser.picture;
      if (!user.apiKey) user.apiKey = "apex_live_" + crypto.randomBytes(12).toString("hex");
      user.isVerified = true; 
      await user.save();
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    const handoff = new URLSearchParams({ token, apiKey: user.apiKey, user: JSON.stringify({ id: user._id.toString(), userId: user._id.toString(), name: user.name, email: user.email, apiKey: user.apiKey, avatar: user.avatar || null, authMethod: user.authMethod || "google" }) });
    res.redirect(`${FRONTEND_URL}/login.html?${handoff.toString()}`);
  } catch (err) { res.redirect(`${FRONTEND_URL}/login.html?error=oauth_failed`); }
});

app.get("/api/auth/google/status", (req, res) => { res.json({ enabled: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) }); });

// ==========================================
// PROFILE & ADMIN (Same as before)
// ==========================================
app.get("/api/user/profile", validateApiKey, async (req, res) => {
  const user = req.user;
  res.json({ success: true, user: { name: user.name, email: user.email, userId: user._id, tier: user.tier, totalRequests: user.totalRequests, requestsToday: user.requestsToday, status: user.status, joined: user.createdAt.toLocaleDateString("en-US", { month: "short", year: "numeric" }), lastLogin: "Active Now", region: "Asia Pacific · sg-1", successRate: 99.4, avatar: user.avatar || null, authMethod: user.authMethod || "email" }, key: { value: user.apiKey, lastRegenerated: "Active" } });
});

app.post("/api/user/regenerate-key", validateApiKey, async (req, res) => {
  try { const newKey = "apex_live_" + crypto.randomBytes(12).toString("hex"); req.user.apiKey = newKey; await req.user.save(); res.json({ success: true, apiKey: newKey }); } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/api/admin/verify", (req, res) => { if (req.body.secretKey === ADMIN_SECRET) return res.json({ success: true, message: "Authorized" }); return res.status(401).json({ success: false, error: "Access Denied" }); });
app.get("/api/admin/users", async (req, res) => { if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized" }); const users = await User.find().sort({ createdAt: -1 }); res.json({ success: true, users }); });
app.post("/api/admin/toggle-status", async (req, res) => { if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return res.status(403).json({ success: false, error: "Unauthorized" }); const user = await User.findById(req.body.userId); if (!user) return res.status(404).json({ success: false, error: "User not found" }); user.status = user.status === "Active" ? "Banned" : "Active"; await user.save(); res.json({ success: true, status: user.status }); });

// ==========================================
// DYNAMIC PLUGIN AUTOLOADER
// ==========================================
const pluginsDir = path.join(__dirname, "plugins");
if (fs.existsSync(pluginsDir)) {
  fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js")).forEach(file => {
    try {
      const plugin = require(path.join(pluginsDir, file));
      if (plugin.path && plugin.handler) { app[(plugin.method || "GET").toLowerCase()](plugin.path, validateApiKey, plugin.handler); console.log(`[Plugin Loaded] ${plugin.name}`); }
    } catch (err) { console.error(`[Plugin Error] ${file}:`, err.message); }
  });
}

// ==========================================
// DATABASE CONNECTION & BOOT
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/apex_api";
mongoose.connect(MONGODB_URI).then(() => {
  console.log("Connected to MongoDB Atlas successfully.");
  app.listen(PORT, () => console.log(`Apex API Modular Engine active on port ${PORT}`));
}).catch(err => {
  console.error("MongoDB Connection Failed:", err.message);
  app.listen(PORT, () => console.log(`Apex API running without database fallback on port ${PORT}`));
});
