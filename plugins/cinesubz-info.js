const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const sslAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

function decodeHtml(str = "") {
  return String(str)
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&#8217;|&#8216;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#038;|&amp;/g, "&")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function parseSizeToBytes(str) {
  if (!str) return null;
  const match = String(str).match(/([\d.]+)\s*(KB|MB|GB|TB)/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const map = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return val * (map[unit] || 1);
}

module.exports = {
  name: "CineSubz Info",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/info",
  handler: async (req, res) => {
    try {
      const pageUrl = req.query.url;
      if (!pageUrl) return res.status(400).json({ success: false, error: "Parameter 'url' is required" });

      const response = await axios.get(pageUrl, {
        httpsAgent: sslAgent,
        timeout: 15000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
          Referer: "https://cinesubz.co/"
        }
      });

      const html = String(response.data || "");
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? decodeHtml(titleMatch[1].replace(/- CineSubz.*$/i, "")) : "Movie";

      const downloadLinks = [];
      const btnRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*(?:movie-download-button|download-button)[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
      let match;

      while ((match = btnRegex.exec(html)) !== null) {
        const rawLink = match[1].trim();
        const inner = match[2];
        const metaMatch = inner.match(/class=['"][^'"]*(?:movie-download-meta|download-meta)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
        const quality = metaMatch ? decodeHtml(metaMatch[1]) : "Standard";

        const bytes = parseSizeToBytes(quality);
        // Strict 2GB check (< 2GB)
        if (bytes === null || bytes < 2147483648) {
          downloadLinks.push({ quality, directUrl: rawLink });
        }
      }

      res.json({
        success: true,
        title,
        qualities: downloadLinks,
        filterApplied: "<2GB",
        totalQualities: downloadLinks.length
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};