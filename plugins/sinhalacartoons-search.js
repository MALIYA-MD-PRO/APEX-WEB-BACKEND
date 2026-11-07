const axios = require("axios");
const cheerio = require("cheerio");

module.exports = {
  name: "SinhalaCartoons Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/sinhalacartoons/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) return res.status(400).json({ success: false, error: "Parameter 'q' is required" });

      const url = `https://sinhalacartoons.com/?s=${encodeURIComponent(query)}`;
      const { data } = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36" },
        timeout: 10000
      });

      const $ = cheerio.load(data);
      const results = [];

      $(".post, article, .search-result, .movie-item").each((i, el) => {
        const link = $(el).find('a[href*="sinhalacartoons.com"]').first();
        const href = link.attr("href");
        let title = $(el).find("h2, h3").first().text().trim() || link.attr("title");
        if (href && title && !results.some(r => r.url === href)) {
          results.push({ title: title.replace(/^(HD|FHD)\s*[:|-]?\s*/i, "").trim(), url: href });
        }
      });

      res.json({ success: true, query, total: results.length, results: results.slice(0, 15) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};