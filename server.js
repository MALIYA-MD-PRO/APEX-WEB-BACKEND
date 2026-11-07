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

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL  = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${PORT}/api/auth/google/callback`;
const FRONTEND_URL         = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

// ─── Nodemailer Setup ─────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465, 
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

app.use(cors({ origin: "*" }));
app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: { success: false, error: "Too many requests." }
});
app.use("/api/", globalLimiter);

// ══════════════════════════════════════════════════════════════
// DARKNESS SECURITY ENGINE (Backend Check)
// ══════════════════════════════════════════════════════════════
const darknessChallenges = new Map();
const darknessTokens = new Map();

// 1. Challenge එක දෙන Endpoint එක
app.get("/api/auth/darkness-challenge", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const difficulty = "00000"; // හෙඩ්ලස් බ්‍රව්සර් වලට solve කරන්න අමාරු වෙන්න මට්ටම වැඩි කරලා
  darknessChallenges.set(nonce, { difficulty, createdAt: Date.now() });
  for (let [key, val] of darknessChallenges.entries()) {
    if (Date.now() - val.createdAt > 300000) darknessChallenges.delete(key);
  }
  res.json({ nonce, difficulty });
});

// 2. Browser Fingerprint & PoW Verify කරන Endpoint එක
app.post("/api/auth/darkness-verify", (req, res) => {
  try {
    const { nonce, solution, fingerprint } = req.body;
    const challenge = darknessChallenges.get(nonce);
    if (!challenge) return res.status(404).send("Not Found");
    darknessChallenges.delete(nonce);

    // ── Bot Detection (Headless / Scripts) ──
    const fp = fingerprint || {};
    const isBot = 
      fp.webdriver === true || // Puppeteer / Selenium
      fp.plugins === 0 || // හෙඩ්ලස් බ්‍රව්සර් වල plugins නැහැ
      fp.hardwareConcurrency < 2 || // වර්චුවල් මැෂින් (VM) වල cores අඩුයි
      (fp.webglVendor && (fp.webglVendor.includes("SwiftShader") || fp.webglVendor.includes("Mesa"))) || // VM Graphics
      fp.timeTaken < 500; // ඉතා ඉක්මනින් ආවොත් (500ms ට අඩු) bot එකක්

    if (isBot) {
      console.warn("[Darkness Security] 🚫 Bot Blocked:", fp);
      return res.status(404).send("Not Found");
    }

    // ── Proof of Work Check ──
    const hash = crypto.createHash("sha256").update(nonce + solution).digest("hex");
    if (!hash.startsWith(challenge.difficulty)) return res.status(404).send("Not Found");

    // ── Issue Token (Valid 2 Days) ──
    const darknessToken = crypto.randomBytes(32).toString("hex");
    darknessTokens.set(darknessToken, Date.now() + 2 * 24 * 60 * 60 * 1000);
    res.json({ success: true, darknessToken });
  } catch (e) { res.status(404).send("Not Found"); }
});

// ─── Email OTP Sender ───
async function sendVerificationEmail(user, code) {
  const mailOptions = {
    from: `"Apex API Security" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `${code} is your Apex API Verification Code`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
        <div style="width: 50px; height: 50px; background: #6366f1; border-radius: 12px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold;">A</div>
        <h2 style="color: #0f172a; margin: 0 0 10px; font-size: 22px;">Verify your email</h2>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 30px;">Welcome to Apex API, ${user.name}!<br>Use the code below to verify your account.</p>
        
        <div style="background: #ffffff; border: 2px dashed #c7d2fe; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #6366f1;">${code}</span>
        </div>
        
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">This code will expire in 15 minutes.<br>If you didn't request this, please ignore this email.</p>
      </div>
    `
  };
  try { await transporter.sendMail(mailOptions); console.log(`[Email Sent] Code to ${user.email}`); } 
  catch (error) { console.error(`[Email Error]:`, error.message); }
}

// ==========================================
// AUTHENTICATION CONTROLLERS
// ==========================================

// 1. Register (Gmail Check + OTP)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, name, password } = req.body;
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
      await sendVerificationEmail(user, newCode);
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

    await sendVerificationEmail(user, verifyCode);
    res.status(201).json({ success: true, message: "Account created! Check your email for the 6-digit code." });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 2. Verify OTP Code
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

// 3. Login (Requires Darkness Security)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, darknessToken } = req.body;

    // ── DARKNESS SECURITY CHECK ──
    if (!darknessToken || !darknessTokens.has(darknessToken)) {
      return res.status(404).send("Not Found"); // Bots get 404
    }
    if (darknessTokens.get(darknessToken) < Date.now()) {
      darknessTokens.delete(darknessToken);
      return res.status(404).send("Not Found");
    }

    // ── NORMAL AUTH ──
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
// GOOGLE OAUTH
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

// ==========================================
// PROFILE & ADMIN & PLUGINS
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

const pluginsDir = path.join(__dirname, "plugins");
if (fs.existsSync(pluginsDir)) {
  fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js")).forEach(file => {
    try {
      const plugin = require(path.join(pluginsDir, file));
      if (plugin.path && plugin.handler) { app[(plugin.method || "GET").toLowerCase()](plugin.path, validateApiKey, plugin.handler); console.log(`[Plugin Loaded] ${plugin.name}`); }
    } catch (err) { console.error(`[Plugin Error] ${file}:`, err.message); }
  });
}

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/apex_api";
mongoose.connect(MONGODB_URI).then(() => {
  console.log("Connected to MongoDB Atlas successfully.");
  app.listen(PORT, () => console.log(`Apex API Modular Engine active on port ${PORT}`));
}).catch(err => {
  console.error("MongoDB Connection Failed:", err.message);
  app.listen(PORT, () => console.log(`Apex API running without database fallback on port ${PORT}`));
});
