const cheerio = require("cheerio");

const BASE_URL = "https://cartoons.lk";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

module.exports = {
  name: "Cartoons.lk · Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cartoonslk/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q || req.query.query;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query.trim())}`;

      const response = await gotScraping.get(searchUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: { request: 12000 }
      });

      const $ = cheerio.load(response.body);
      const results = [];

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      $(".cl-grid .cl-grid__item").each((_, el) => {
        const card = $(el).find("article.cl-card a.cl-card__link");
        if (card.length) {
          const title = card.find(".cl-card__title").text().trim();
          const url = card.attr("href");
          const meta = card.find(".cl-card__meta").text().trim();
          const quality = card.find(".cl-badge--quality").text().trim();
          const poster = card.find("img").attr("src") || card.find("img").attr("data-src") || null;

          if (title && url) {
            results.push({
              title,
              quality: quality || null,
              meta: meta || null,
              poster,
              movieUrl: url,
              dlEndpoint: `${currentHost}/api/v1/movies/cartoonslk/dl?url=${encodeURIComponent(url)}${apiKeyParam}`
            });
          }
        }
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
        error: "Cartoons.lk Search Failed: " + err.message
      });
    }
  }
};
