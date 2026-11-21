const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";

module.exports = {
  name: "MovieBox · TV Series Seasons",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/epi",
  handler: async (req, res) => {
    try {
      const subjectId = (req.query.id || req.query.subject_id || "").trim();

      if (!subjectId) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id' (subject_id) is required"
        });
      }

      const { data } = await axios.get(`${UPSTREAM_BASE}/epi/${encodeURIComponent(subjectId)}`, {
        timeout: 15000
      });

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // Upstream dl_endpoint එක වෙනුවට අපගේ Apex API link එක ලබා දීම
      const seasons = (data.seasons || []).map((s) => ({
        season: s.season,
        episodes_count: s.episodes_count,
        dl_endpoint: `${currentHost}/api/v1/movies/moviebox/dl?id=${encodeURIComponent(subjectId)}&se=${s.season}${apiKeyParam}`
      }));

      return res.json({
        success: true,
        subject_id: String(data.subject_id || subjectId),
        title: data.title || "TV Series",
        total_seasons: data.total_seasons || seasons.length,
        seasons
      });
    } catch (err) {
      const rawErr = err.response?.data?.detail || err.message;
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "MovieBox Episodes Fetch Failed: " + (typeof rawErr === "object" ? JSON.stringify(rawErr) : rawErr)
      });
    }
  }
};
