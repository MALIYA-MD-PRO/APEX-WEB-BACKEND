const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: "" },
  apiKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ["Active", "Banned", "Rate Limited"], default: "Active" },
  tier: { type: String, default: "Unlimited Developer" },
  totalRequests: { type: Number, default: 0 },
  requestsToday: { type: Number, default: 0 },
  lastResetDate: { type: String, default: () => new Date().toISOString().split("T")[0] },
  endpointStats: { type: Map, of: Number, default: {} },
  lastUsed: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);