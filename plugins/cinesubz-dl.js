const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const CINESUBZ_API = process.env.CINESUBZ_API || "https://feeling-higher-defense-certain.trycloudflare.com";

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

async function resolveDirectLink(rawLink) {
  try {
    const cleanUrl = String(rawLink).replace(/cinesubz\.net/gi, "cinesubz.co");
    const startRes = await axios.post(`${CINESUBZ_API}/start-resolve?own=maliya`, {
      directUrl: cleanUrl,
      pageUrl: cleanUrl
    }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });

    const jobId = startRes.data?.jobId;
    if (!jobId) return rawLink;

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const check = await axios.get(`${CINESUBZ_API}/check-status/${jobId}?own=maliya`, { timeout: 10000 });
      if (check.data?.status === "done") {
        const links = check.data.links || [];
        return links.find(l => l.includes("terracloud") || l.includes("skylines") || l.includes("pixeldrain") || l.includes("supercloud")) ||
               links.find(l => !l.includes("telegram.me") && !l.includes("t.me")) || links[0] || rawLink;
      }
      if (check.data?.status === "failed") break;
    }
    return rawLink;
  } catch (e) {
    return rawLink;
  }
}

module.exports = {
  name: "CineSubz Movie All Qualities DL",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/movie-dl",
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

      const btnRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*(?:movie-download-button|download-button)[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const downloadLinks = [];

      while ((match = btnRegex.exec(html)) !== null) {
        const rawLink = match[1].trim();
        const inner = match[2];
        const metaMatch = inner.match(/class=['"][^'"]*(?:movie-download-meta|download-meta)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
        const quality = metaMatch ? decodeHtml(metaMatch[1]) : "Standard";

        downloadLinks.push({ quality, rawLink });
      }

      // සියලුම qualities සඳහා direct CDN links resolve කිරීම
      const resolvedDownloads = await Promise.all(
        downloadLinks.map(async (item) => ({
          quality: item.quality,
          downloadUrl: await resolveDirectLink(item.rawLink)
        }))
      );

      res.json({
        success: true,
        title,
        totalQualities: resolvedDownloads.length,
        downloads: resolvedDownloads
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Movie DL extraction failed: " + err.message });
    }
  }
};