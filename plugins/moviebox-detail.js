const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";

module.exports = {
  name: "MovieBox · Info & Episodes",
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
      let seasons = [];

      if (isSeries) {
        try {
          const { data: epData } = await axios.get(`${UPSTREAM_BASE}/episodes/${encodeURIComponent(subjectId)}`, {
            timeout: 12000
          });
          seasons = epData.seasons || [];
        } catch (_) {}
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      return res.json({
        success: true,
        subjectId: String(detail.subject_id),
        title: detail.title,
        type: detail.type || (isSeries ? "Series" : "Movie"),
        description: detail.description || "",
        releaseDate: detail.release_date || null,
        duration: detail.duration || null,
        imdbRating: detail.imdb_rating || null,
        genre: detail.genre || null,
        country: detail.country || null,
        language: detail.language || null,
        cover: detail.cover || null,
        detailPath: detail.detail_path || null,
        dubs: (detail.dubs || []).map((d) => ({
          subjectId: String(d.subject_id),
          langName: d.lang_name,
          language: d.language || null,
          streamEndpoint: isSeries
            ? `${currentHost}/api/v1/movies/moviebox/dl?id=${d.subject_id}&se=1&ep=1${apiKeyParam}`
            : `${currentHost}/api/v1/movies/moviebox/dl?id=${d.subject_id}${apiKeyParam}`
        })),
        seasons,
        streamEndpoint: isSeries
          ? `${currentHost}/api/v1/movies/moviebox/dl?id=${subjectId}&se=1&ep=1${apiKeyParam}`
          : `${currentHost}/api/v1/movies/moviebox/dl?id=${subjectId}${apiKeyParam}`
      });
    } catch (err) {
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "MovieBox Detail Failed: " + (err.response?.data?.detail || err.message)
      });
    }
  }
};
