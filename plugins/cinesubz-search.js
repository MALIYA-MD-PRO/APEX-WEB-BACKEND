const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "https://puka-cine-production.up.railway.app").replace(/\/+$/, "");

module.exports = {
  name: "CineSubz Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const response = await axios.get(`${NEW_CINE_API}/search`, {
        params: { q: query.trim() },
        timeout: 20000
      });

      if (!response.data || !response.data.success) {
        return res.status(500).json({
          success: false,
          error: response.data?.error || "Failed to fetch search results"
        });
      }

      const rawResults = Array.isArray(response.data.results) ? response.data.results : [];

      const results = rawResults.map((item) => {
        const title = item.title || "";
        const url = item.url || "";
        const yearMatch = title.match(/\((\d{4})\)/);
        const detectedType =
          item.type ||
          (url.includes("/tvshows/") || url.includes("/series/") ? "tvshow" : "movie");

        return {
          title,
          type: detectedType,
          year: item.year || (yearMatch ? yearMatch[1] : null),
          poster: item.poster || item.thumbnail || null,
          url
        };
      });

      return res.json({
        success: true,
        query: query.trim(),
        total: results.length,
        results
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "CineSubz search failed: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
