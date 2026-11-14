const cheerio = require("cheerio");

const BASE_URL = "https://www.pornhub.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

module.exports = {
  name: "PH · Video Search (Top 25)",
  category: "adult",
  method: "GET",
  path: "/api/v1/adult/ph/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q || req.query.query;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const searchUrl = `${BASE_URL}/video/search?search=${encodeURIComponent(query.trim())}`;

      const response = await gotScraping.get(searchUrl, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          "Cookie": "accessAgeDisclaimerPH=1"
        },
        timeout: { request: 15000 }
      });

      const $ = cheerio.load(response.body);
      const results = [];

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      $("li.pcVideoListItem, div.phimage").each((_, el) => {
        if (results.length >= 25) return false;

        const container = $(el).hasClass("pcVideoListItem") ? $(el) : $(el).closest("li");
        const vkey = container.attr("data-video-vkey");
        const linkEl = container.find("a[href*='view_video.php']").first();
        const href = linkEl.attr("href");

        if (!href) return;

        const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        const title = container.find(".title a").text().trim() || linkEl.attr("title") || "Untitled";
        const duration = container.find(".duration").text().trim() || "0:00";
        const views = container.find(".views var").text().trim() || "0";
        const rating = container.find(".rating-container .value").text().trim() || "N/A";
        const imgEl = container.find("img").first();
        const thumbnail = imgEl.attr("data-src") || imgEl.attr("data-mediumthumb") || imgEl.attr("src") || null;

        // Avoid duplicates
        if (!results.some((r) => r.url === fullUrl)) {
          results.push({
            index: results.length + 1,
            vkey: vkey || null,
            title,
            duration,
            views,
            rating,
            thumbnail,
            url: fullUrl,
            dlEndpoint: `${currentHost}/api/v1/media/ph/dl?url=${encodeURIComponent(fullUrl)}${apiKeyParam}`
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
        error: "Search Failed: " + err.message
      });
    }
  }
};
