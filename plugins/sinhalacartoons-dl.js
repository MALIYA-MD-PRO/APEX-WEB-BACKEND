const axios = require("axios");
const cheerio = require("cheerio");

module.exports = {
  name: "SinhalaCartoons DL",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/sinhalacartoons/dl",
  handler: async (req, res) => {
    try {
      const landingUrl = req.query.landingUrl;
      if (!landingUrl) return res.status(400).json({ success: false, error: "Parameter 'landingUrl' is required" });

      const clean = decodeURIComponent(landingUrl).replace(/&#038;/g, "&").replace(/&amp;/g, "&");
      const { data } = await axios.get(clean, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
          Referer: "https://sinhalacartoons.com/"
        },
        timeout: 10000
      });

      const $ = cheerio.load(data);
      let actualDl = $("a.dl-card-landing.force-download-btn").attr("href") || $("a.force-download-btn").attr("href");

      if (!actualDl) {
        const urlObj = new URL(clean, "https://sinhalacartoons.com");
        const scData = urlObj.searchParams.get("sc_data");
        if (scData) {
          const decoded = JSON.parse(Buffer.from(scData, "base64").toString("utf-8"));
          if (decoded.direct) actualDl = decoded.direct;
        }
      }

      if (!actualDl) throw new Error("Could not extract streamable URL");

      res.json({
        success: true,
        title: $("title").text().trim() || "Cartoon Episode",
        downloadUrl: actualDl
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};