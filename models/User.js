const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Google login එකට මේක අවශ්‍ය නැහැ
  apiKey: { type: String, required: true },
  googleId: { type: String },
  avatar: { type: String },
  authMethod: { type: String, default: "email" },
  
  // ─── Email Verification Fields ───
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String },
  verificationTokenExpires: { type: Date },
  
  // ─── Existing Fields ───
  tier: { type: String, default: "Basic" },
  status: { type: String, default: "Active" },
  totalRequests: { type: Number, default: 0 },
  requestsToday: { type: Number, default: 0 },
  lastResetDate: { type: String, default: new Date().toISOString().split("T")[0] },
  endpointStats: { type: Map, of: Number, default: {} },
  lastUsed: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
