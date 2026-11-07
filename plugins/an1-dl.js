const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

module.exports = {
  name: "AN1 Direct DL",
  category: "app",
  method: "GET",
  path: "/api/v1/apps/an1/dl",
  handler: async (req, res) => {
    try {
      const appUrl = req.query.url;
      if (!appUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' (AN1 App URL) is required" });
      }

      // 1. App page එකෙන් version, size සහ download page link එක ලබා ගැනීම
      const { data: pageData } = await axios.get(appUrl.trim(), { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(pageData);

      const title = $('h1[itemprop="name"]').text().trim() || $("h1").first().text().trim() || "Application";
      const version = $('span[itemprop="softwareVersion"]').text().trim() || "Unknown";
      const size = $('span[itemprop="fileSize"]').text().trim() || "Unknown";
      let dlPagePath = $('a.btn-green[href*="file_"]').attr("href");

      if (!dlPagePath) {
        return res.status(404).json({ success: false, error: "Download button page not found on this app page" });
      }

      const dlPageUrl = dlPagePath.startsWith("http") ? dlPagePath : `https://an1.com${dlPagePath}`;

      // 2. Download page එකෙන් සෘජු file link එක (#pre_download href) extract කිරීම
      const { data: dlPageData } = await axios.get(dlPageUrl, { headers: HEADERS, timeout: 15000 });
      const $dl = cheerio.load(dlPageData);
      const directDownloadUrl = $dl("#pre_download").attr("href");

      if (!directDownloadUrl) {
        return res.status(502).json({ success: false, error: "Failed to extract direct download link from pre-download page" });
      }

      return res.json({
        success: true,
        title,
        version,
        size,
        downloadUrl: directDownloadUrl,
        pageUrl: appUrl
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "AN1 DL Failed: " + error.message });
    }
  }
};
