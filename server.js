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

// ─── Nodemailer Setup with Timeouts (හිරවෙන එක නවත්තන්න) ───
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465, 
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000
});

app.use(cors({ origin: "*" }));
app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { success: false, error: "Too many requests." }
});
app.use("/api/", globalLimiter);

// ══════════════════════════════════════════════════════════════
// DARKNESS SECURITY ENGINE
// ══════════════════════════════════════════════════════════════
const darknessChallenges = new Map();
const darknessTokens = new Map();

app.get("/api/auth/darkness-challenge", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const difficulty = "00000"; 
  darknessChallenges.set(nonce, { difficulty, createdAt: Date.now() });
  for (let [key, val] of darknessChallenges.entries()) {
    if (Date.now() - val.createdAt > 300000) darknessChallenges.delete(key);
  }
  res.json({ nonce, difficulty });
});

app.post("/api/auth/darkness-verify", (req, res) => {
  try {
    const { nonce, solution, fingerprint } = req.body;
    const challenge = darknessChallenges.get(nonce);
    if (!challenge) {
      console.log("[Darkness] ❌ Challenge not found or expired");
      return res.status(404).send("Not Found");
    }
    darknessChallenges.delete(nonce);

    const fp = fingerprint || {};
    // Bot Check එක ලිහිල් කළා (සමහර සාමාන්‍ය browsers වලත් මේවා අඩුයි)
    const isBot = 
      fp.webdriver === true || 
      fp.timeTaken < 200; 

    if (isBot) {
      console.warn("[Darkness] 🚫 Bot Blocked:", fp);
      return res.status(404).send("Not Found");
    }

    const hash = crypto.createHash("sha256").update(nonce + solution).digest("hex");
    if (!hash.startsWith(challenge.difficulty)) {
      console.log("[Darkness] ❌ PoW Failed");
      return res.status(404).send("Not Found");
    }

    const darknessToken = crypto.randomBytes(32).toString("hex");
    darknessTokens.set(darknessToken, Date.now() + 2 * 24 * 60 * 60 * 1000);
    res.json({ success: true, darknessToken });
  } catch (e) { 
    console.error("[Darkness] Error:", e);
    res.status(404).send("Not Found"); 
  }
});

// ─── Email OTP Sender ───
async function sendVerificationEmail(user, code) {
  const mailOptions = {
    from: `"Apex API Security" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `${code} is your Apex API Verification Code`,
    html: `
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
    await transporter.sendMail(mailOptions); 
    console.log(`[Email Sent] Code to ${user.email}`); 
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
      
      // Non-blocking email send
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

    // Non-blocking email send (Frontend එක හිර නොවෙන්න)
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

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password, darknessToken } = req.body;
    console.log(`[Login] Attempt: ${email}`);

    if (!darknessToken || !darknessTokens.has(darknessToken)) {
      console.log("[Login] ❌ Darkness Token Missing/Invalid");
      return res.status(404).send("Not Found"); 
    }
    if (darknessTokens.get(darknessToken) < Date.now()) {
      darknessTokens.delete(darknessToken);
      return res.status(404).send("Not Found");
    }

    if (!email || !password) return res.status(400).json({ success: false, error: "Email and password required" });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials." });

    if (user.authMethod === "email") {
      if (!user.isVerified) return res.status(403).json({ success: false, error: "Please verify your email address first." });
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return res.status(401).json({ success: false, error: "Invalid credentials." });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    console.log(`[Login] ✅ Success: ${user.email}`);
    res.json({ success: true, token, apiKey: user.apiKey, user });
  } catch (e) {
    console.error("[Login Error]:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// (Google OAuth & Profile Code ටික එහෙමම තියෙන්න දෙන්න)

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
