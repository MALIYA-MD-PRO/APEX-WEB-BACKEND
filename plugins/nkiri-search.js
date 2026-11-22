const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

module.exports = {
  name: "Nkiri Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/nkiri/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const searchUrl = `https://thenkiri.org.ng/?s=${encodeURIComponent(query.trim())}`;
      const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(data);
      const results = [];

      $("article.entry").each((i, el) => {
        if (i >= 20) return false;
        const titleEl = $(el).find(".search-entry-title a");
        const title = titleEl.text().trim();
        const url = titleEl.attr("href");
        const thumbnail = $(el).find(".thumbnail img").attr("src") || null;
        const synopsis = $(el).find(".search-entry-summary p").text().trim() || null;

        if (title && url) {
          results.push({
            title,
            url,
            thumbnail,
            synopsis
          });
        }
      });

      return res.json({
        success: true,
        query: query.trim(),
        total: results.length,
        results
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Nkiri Search Failed: " + error.message });
    }
  }
};
