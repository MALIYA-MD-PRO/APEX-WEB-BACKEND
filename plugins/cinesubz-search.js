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

module.exports = {
  name: "CineSubz Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) return res.status(400).json({ success: false, error: "Parameter 'q' is required" });

      const searchUrl = `https://cinesubz.co/?s=${encodeURIComponent(query).replace(/%20/g, "+")}`;
      const response = await axios.get(searchUrl, {
        httpsAgent: sslAgent,
        timeout: 12000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
          Referer: "https://cinesubz.co/"
        }
      });

      const html = String(response.data || "");
      const results = [];
      const seenUrls = new Set();
      const parts = html.split(/<div id="item-\d+"\s+class="display-item">/i).slice(1);

      for (const block of parts) {
        const linkMatch = block.match(/<a\s+href="([^"]+)"[^>]*?(?:title="([^"]*)")?/i);
        const h3Match = block.match(/<div class="item-desc-title">\s*<h3>([\s\S]*?)<\/h3>/i) || block.match(/<h3>([\s\S]*?)<\/h3>/i);
        const imgMatch = block.match(/<img[^>]+(?:data-original|src)="([^"]+)"/i);
        const imdbMatch = block.match(/<span class="imdb-score">([^<]+)<\/span>/i);
        const qualityMatch = block.match(/<span class="badge-(?:quality|season)-corner">([^<]+)<\/span>/i);

        const url = linkMatch ? linkMatch[1].trim() : null;
        const rawTitle = (h3Match && h3Match[1]) || (linkMatch && linkMatch[2]) || "";
        const title = decodeHtml(rawTitle);

        if (url && title && !seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({
            title,
            url,
            image: imgMatch ? imgMatch[1].trim() : "",
            rating: imdbMatch ? imdbMatch[1].trim() : null,
            quality: qualityMatch ? qualityMatch[1].trim() : "HD"
          });
        }
      }

      res.json({ success: true, query, total: results.length, results: results.slice(0, 15) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};