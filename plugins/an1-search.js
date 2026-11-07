const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

module.exports = {
  name: "AN1 Search",
  category: "app",
  method: "GET",
  path: "/api/v1/apps/an1/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const searchUrl = `https://an1.com/?story=${encodeURIComponent(query.trim())}&do=search&subaction=search`;
      const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(data);
      const results = [];

      $(".item_app").each((i, el) => {
        if (i >= 15) return false;
        const title = $(el).find(".name a span").text().trim() || $(el).find(".name a").text().trim();
        const appUrl = $(el).find(".name a").attr("href");
        const img = $(el).find(".img img").attr("src");
        const developer = $(el).find(".developer").text().trim();

        if (title && appUrl) {
          results.push({
            title,
            url: appUrl,
            img: img || null,
            developer: developer || "Unknown"
          });
        }
      });

      return res.json({
        success: true,
        query,
        total: results.length,
        results
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "AN1 Search Failed: " + error.message });
    }
  }
};
