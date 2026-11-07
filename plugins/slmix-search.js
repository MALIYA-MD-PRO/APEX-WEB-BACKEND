const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://www.slmix.lk";

module.exports = {
  name: "SLMix Search",
  category: "media",
  method: "GET",
  path: "/api/v1/media/slmix/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const searchUrl = `${BASE_URL}/search.php?q=${encodeURIComponent(query.trim())}`;
      const { data } = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);
      const results = [];

      $("div.grid > a.group.block").each((_, el) => {
        const pagePath = $(el).attr("href");
        if (!pagePath || !pagePath.includes("/")) return;

        const title = $(el).find("h3").text().trim();
        const artist = $(el).find("p").text().trim();
        const downloads = $(el).find("span.text-sky-400").text().trim();
        let thumbnail = $(el).find("img").attr("src");

        if (thumbnail && !thumbnail.startsWith("http")) {
          thumbnail = `${BASE_URL}${thumbnail}`;
        }

        if (title && pagePath) {
          results.push({
            title,
            artist: artist || "Unknown Artist",
            downloads: downloads || "0",
            thumbnail: thumbnail || "",
            pageUrl: pagePath.startsWith("http") ? pagePath : `${BASE_URL}${pagePath}`
          });
        }
      });

      return res.json({
        success: true,
        query,
        total: results.length,
        results: results.slice(0, 15)
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "SLMix Search Failed: " + err.message });
    }
  }
};
