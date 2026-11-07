const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://animeheaven.me";

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  Referer: "https://animeheaven.me/"
};

module.exports = {
  name: "AnimeHeaven Search",
  category: "media",
  method: "GET",
  path: "/api/v1/media/animeheaven/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const searchUrl = `${BASE_URL}/search.php?s=${encodeURIComponent(query.trim())}`;
      const response = await axios.get(searchUrl, {
        headers: defaultHeaders,
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const results = [];

      $(".similarimg .p1, .info3 .similarimg").each((_, el) => {
        const linkEl = $(el).find("a[href^='anime.php']").first();
        const href = linkEl.attr("href");
        const title = $(el).find(".similarname, a.c").first().text().trim() || linkEl.text().trim();
        let image = $(el).find("img").attr("src");

        if (image && !image.startsWith("http")) {
          image = `${BASE_URL}/${image.replace(/^\//, "")}`;
        }

        if (href && title && !results.some(r => r.url.includes(href))) {
          results.push({
            title,
            url: href.startsWith("http") ? href : `${BASE_URL}/${href}`,
            image: image || null
          });
        }
      });

      return res.json({
        success: true,
        query,
        total: results.length,
        results
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "AnimeHeaven Search Failed: " + err.message });
    }
  }
};
