const cheerio = require("cheerio");

const BASE_URL = "https://kmmovies.autos";

module.exports = {
  name: "KMMovies · Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/kmmovies/search",
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: { request: 12000 }
      });

      const $ = cheerio.load(response.body);
      const results = [];

      $(".movie-card").each((_, el) => {
        const title = $(el).find(".movie-title").text().trim();
        const link = $(el).find("a").attr("href");
        const poster = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || null;

        if (title && link) {
          results.push({
            title,
            movieUrl: link,
            poster,
            dlEndpoint: `/api/v1/movies/kmmovies/dl?url=${encodeURIComponent(link)}`
          });
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
        error: "KMMovies Search Failed: " + err.message
      });
    }
  }
};
