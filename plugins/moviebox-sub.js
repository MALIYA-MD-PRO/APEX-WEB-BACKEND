const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";
const CACHE_TTL_MS = 30 * 60 * 1000; // මිනිත්තු 30
const subCache = new Map();

// Expired cache entries ස්වයංක්‍රීයව ඉවත් කිරීම
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of subCache.entries()) {
    if (entry.expiresAt <= now) {
      subCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  name: "MovieBox · Subtitle Cache Server",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/sub",
  handler: async (req, res) => {
    try {
      const subjectId = (req.query.id || "").trim();
      const lang = (req.query.lang || "en").trim().toLowerCase(); // 'en' or 'si'
      const se = parseInt(req.query.se, 10) || 0;
      const ep = parseInt(req.query.ep, 10) || 0;

      if (!subjectId || (lang !== "en" && lang !== "si")) {
        return res.status(400).json({
          success: false,
          error: "Valid 'id' and 'lang' ('en' or 'si') parameters are required."
        });
      }

      const cacheKey = `${subjectId}_${lang}_s${se}_e${ep}`;
      const now = Date.now();
      let srtContent = null;

      // 1. 30-minute Cache පරීක්ෂා කිරීම
      const cached = subCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        srtContent = cached.content;
      } else {
        // 2. Upstream server එකෙන් SRT එක ලබාගෙන Cache කිරීම
        const upstreamSubUrl = `${UPSTREAM_BASE}/sub/${encodeURIComponent(subjectId)}/${lang}.srt?se=${se}&ep=${ep}`;
        const response = await axios.get(upstreamSubUrl, {
          responseType: "text",
          timeout: 15000
        });

        srtContent = response.data;
        subCache.set(cacheKey, {
          content: srtContent,
          expiresAt: now + CACHE_TTL_MS
        });
      }

      const epTag = se > 0 ? `_S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")}` : "";
      const fileName = `Apex_${subjectId}${epTag}_${lang.toUpperCase()}.srt`;

      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Subtitle-Cache", cached && cached.expiresAt > now ? "HIT (30m)" : "MISS (CACHED 30m)");

      return res.send(srtContent);
    } catch (err) {
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "Subtitle Fetch Failed: " + err.message
      });
    }
  }
};
