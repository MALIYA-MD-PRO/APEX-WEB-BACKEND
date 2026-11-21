const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";

module.exports = {
  name: "MovieBox · Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/search",
  handler: async (req, res) => {
    try {
      const query = (req.query.q || req.query.query || "").trim();
      const page = parseInt(req.query.page, 10) || 1;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'q' is required"
        });
      }

      const { data } = await axios.get(`${UPSTREAM_BASE}/search`, {
        params: { q: query, page },
        timeout: 15000
      });

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const results = (data.results || []).map((item) => {
        const isSeries = item.subject_type === 2 || item.type?.toLowerCase() === "series";
        return {
          subject_id: String(item.subject_id),
          title: item.title,
          type: item.type || (isSeries ? "Series" : "Movie"),
          release_date: item.release_date || null,
          imdb_rating: item.imdb_rating || null,
          genre: item.genre || null,
          language: item.language || null,
          cover: item.cover || null,
          info_endpoint: `${currentHost}/api/v1/movies/moviebox/detail?id=${item.subject_id}${apiKeyParam}`,
          next_endpoint: isSeries
            ? `${currentHost}/api/v1/movies/moviebox/epi?id=${item.subject_id}${apiKeyParam}`
            : `${currentHost}/api/v1/movies/moviebox/dl?id=${item.subject_id}${apiKeyParam}`
        };
      });

      return res.json({
        success: true,
        query: data.query || query,
        page: data.page || page,
        total: results.length,
        results
      });
    } catch (err) {
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "MovieBox Search Failed: " + (err.response?.data?.message || err.message)
      });
    }
  }
};
