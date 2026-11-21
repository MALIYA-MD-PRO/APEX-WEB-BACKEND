const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";

module.exports = {
  name: "MovieBox · Full Metadata & Dubs",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/detail",
  handler: async (req, res) => {
    try {
      const subjectId = (req.query.id || req.query.subject_id || "").trim();

      if (!subjectId) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id' (subject_id) is required"
        });
      }

      const { data: detail } = await axios.get(`${UPSTREAM_BASE}/detail/${encodeURIComponent(subjectId)}`, {
        timeout: 15000
      });

      const isSeries = detail.subject_type === 2 || detail.type?.toLowerCase() === "series";
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const dubs = (detail.dubs || []).map((d) => ({
        subject_id: String(d.subject_id),
        lang_name: d.lang_name,
        language: d.language || null,
        endpoint: isSeries
          ? `${currentHost}/api/v1/movies/moviebox/epi?id=${d.subject_id}${apiKeyParam}`
          : `${currentHost}/api/v1/movies/moviebox/dl?id=${d.subject_id}${apiKeyParam}`
      }));

      return res.json({
        success: true,
        subject_id: String(detail.subject_id),
        title: detail.title,
        subject_type: detail.subject_type,
        type: detail.type || (isSeries ? "Series" : "Movie"),
        description: detail.description || "",
        release_date: detail.release_date || null,
        duration: detail.duration || null,
        imdb_rating: detail.imdb_rating || null,
        genre: detail.genre || null,
        country: detail.country || null,
        language: detail.language || null,
        cover: detail.cover || null,
        dubs,
        next_step_endpoint: isSeries
          ? `${currentHost}/api/v1/movies/moviebox/epi?id=${subjectId}${apiKeyParam}`
          : `${currentHost}/api/v1/movies/moviebox/dl?id=${subjectId}${apiKeyParam}`
      });
    } catch (err) {
      const rawErr = err.response?.data?.detail || err.message;
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "MovieBox Detail Failed: " + (typeof rawErr === "object" ? JSON.stringify(rawErr) : rawErr)
      });
    }
  }
};
