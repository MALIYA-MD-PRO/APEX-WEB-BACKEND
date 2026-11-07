const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const sslAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  Connection: "keep-alive"
};

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
        headers: { ...defaultHeaders, Referer: "https://cinesubz.co/" }
      });

      const html = String(response.data || "");
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? decodeHtml(titleMatch[1].replace(/- CineSubz.*$/i, "")) : "Movie";

      const btnRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*(?:movie-download-button|download-button)[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      const downloadButtons = [];

      while ((match = btnRegex.exec(html)) !== null) {
        const rawLink = match[1].trim();
        const inner = match[2];
        const metaMatch = inner.match(/class=['"][^'"]*(?:movie-download-meta|download-meta)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
        const quality = metaMatch ? decodeHtml(metaMatch[1]) : "Standard Quality";

        downloadButtons.push({ quality, rawLink });
      }

      // zt link එක හරහා drive.csplayer link එක extract කිරීම (2GB limit නැත)
      const resolvedList = await Promise.all(
        downloadButtons.map(async (btn) => {
          let csplayerLink = "";
          try {
            const pageRes = await axios.get(btn.rawLink, {
              httpsAgent: sslAgent,
              headers: { ...defaultHeaders, Referer: pageUrl },
              timeout: 10000,
            });

            const finalUrl = pageRes.request?.res?.responseUrl || "";
            if (finalUrl.includes("csplayer") || finalUrl.includes("sonic-cloud")) {
              csplayerLink = finalUrl;
            } else {
              const pData = String(pageRes.data || "");
              const pathMatch = pData.match(
                /(?:https?:\/\/(?:drive\.csplayer2\.space|sonic-cloud\.online))?\/(server\d+\/[^\s'"<>]+)/i
              );
              if (pathMatch) {
                let cleanPath = pathMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
                csplayerLink = `https://drive.csplayer2.space/${cleanPath}`;
              }
            }
          } catch (e) {
            const errorUrl = e.response?.request?.res?.responseUrl || e.config?.url || "";
            if (errorUrl.includes("csplayer") || errorUrl.includes("sonic-cloud")) {
              csplayerLink = errorUrl;
            }
          }

          return {
            quality: btn.quality,
            pageUrl: btn.rawLink,
            csplayerUrl: csplayerLink || btn.rawLink
          };
        })
      );

      res.json({
        success: true,
        title,
        totalQualities: resolvedList.length,
        qualities: resolvedList
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "Failed to scrape CineSubz info: " + err.message });
    }
  }
};
