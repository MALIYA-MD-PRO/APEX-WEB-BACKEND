const cheerio = require("cheerio");

module.exports = {
  name: "FitGirl Search",
  category: "game",
  method: "GET",
  path: "/api/v1/games/fitgirl/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const searchUrl = `https://fitgirl-repacks.site/?s=${encodeURIComponent(query.trim())}`;
      const { body } = await gotScraping.get(searchUrl);
      const $ = cheerio.load(body);
      const results = [];

      $("article .entry-title a").each((_, el) => {
        if (results.length < 15) {
          const title = $(el).text().trim();
          const url = $(el).attr("href");
          if (title && url) {
            results.push({ title, url });
          }
        }
      });

      return res.json({
        success: true,
        query,
        total: results.length,
        results
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "FitGirl Search Failed: " + err.message });
    }
  }
};
