const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "http://puka-cine-production.up.railway.app").replace(/\/+$/, "");
const FALLBACK_IMG = "https://github.com/MALIYA-MD-PRO/images/blob/main/Gemini_Generated_Image_ljlmxoljlmxoljlm%20(1).jpg?raw=true";

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
        timeout: 15000
      });

      const rawResults = response.data?.results || [];

      const results = rawResults.slice(0, 15).map((item) => ({
        title: item.title || "",
        url: item.url || "",
        image: item.poster || FALLBACK_IMG,
        year: item.year || null,
        imdb: item.imdb || null,
        quality: item.quality || null
      }));

      return res.json({
        success: true,
        query,
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
