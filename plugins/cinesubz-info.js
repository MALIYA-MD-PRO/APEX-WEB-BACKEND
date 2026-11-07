const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const sslAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive"
};

function decodeHtmlEntities(str = "") {
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
      const targetUrl = req.query.url;
      if (!targetUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required" });
      }

      const response = await axios.get(targetUrl, {
        httpsAgent: sslAgent,
        timeout: 15000,
        headers: { ...defaultHeaders, Referer: "https://cinesubz.co/" }
      });

      const html = String(response.data || "");
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      const title = titleMatch
        ? decodeHtmlEntities(titleMatch[1].replace(/- CineSubz.*$/i, ""))
        : "Title";

      const isTvShow = /class=['"][^'"]*season-btn/i.test(html);

      // --- TV SERIES DETECTED ---
      if (isTvShow) {
        const seasons = [];
        const seasonRegex = /<ul\s+id=['"]season-listep-(\d+)['"][^>]*>([\s\S]*?)<\/ul>/gi;
        let sMatch;

        while ((sMatch = seasonRegex.exec(html)) !== null) {
          const seasonNum = sMatch[1];
          const epHtml = sMatch[2];
          const episodes = [];

          const epRegex = /<a[^>]+class=['"]episode-link['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
          let epMatch;

          while ((epMatch = epRegex.exec(epHtml)) !== null) {
            const epUrl = epMatch[1];
            const epInner = epMatch[2];

            const numMatch = epInner.match(/<span[^>]*class=['"]ep-num['"][^>]*>(\d+)<\/span>/i);
            const epTitleMatch = epInner.match(/<span[^>]*class=['"]ep-title['"][^>]*>([^<]+)<\/span>/i);

            episodes.push({
              episodeNum: numMatch ? numMatch[1] : "",
              title: epTitleMatch ? decodeHtmlEntities(epTitleMatch[1]) : "Episode",
              url: epUrl
            });
          }

          if (episodes.length > 0) {
            seasons.push({ seasonNum, episodes });
          }
        }

        return res.json({
          success: true,
          isTvShow: true,
          title,
          totalSeasons: seasons.length,
          seasons
        });
      }

      // --- MOVIE DETECTED (2GB LIMIT REMOVED) ---
      const downloadLinks = [];
      const seenUrls = new Set();
      const btnRegex = /<a[^>]+href=['"]([^'"]+)['"][^>]*class=['"][^'"]*(?:movie-download-button|download-button)[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
      let match;

      while ((match = btnRegex.exec(html)) !== null) {
        const rawLink = match[1].trim();
        const innerHtml = match[2];

        const metaMatch = innerHtml.match(/class=['"][^'"]*(?:movie-download-meta|download-meta)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
        const typeMatch = innerHtml.match(/class=['"][^'"]*(?:movie-download-type|download-type)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);

        const qualityLabel = metaMatch
          ? decodeHtmlEntities(metaMatch[1])
          : typeMatch
          ? decodeHtmlEntities(typeMatch[1])
          : "Quality";

        let directCsLink = "";

        try {
          const pageRes = await axios.get(rawLink, {
            httpsAgent: sslAgent,
            headers: { ...defaultHeaders, Referer: targetUrl },
            timeout: 10000,
          });

          const finalUrl = pageRes.request?.res?.responseUrl || "";
          if (finalUrl.includes("csplayer") || finalUrl.includes("sonic-cloud")) {
            directCsLink = finalUrl;
          } else {
            const pData = String(pageRes.data || "");
            const pathMatch = pData.match(
              /(?:https?:\/\/(?:drive\.csplayer2\.space|sonic-cloud\.online))?\/(server\d+\/[^\s'"<>]+)/i
            );
            if (pathMatch) {
              let cleanPath = pathMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              directCsLink = `https://drive.csplayer2.space/${cleanPath}`;
            }
          }
        } catch (e) {
          const errorUrl = e.response?.request?.res?.responseUrl || e.config?.url || "";
          if (errorUrl.includes("csplayer") || errorUrl.includes("sonic-cloud")) {
            directCsLink = errorUrl;
          }
        }

        const linkKey = directCsLink || rawLink;
        if (linkKey && !seenUrls.has(linkKey)) {
          seenUrls.add(linkKey);
          downloadLinks.push({
            quality: qualityLabel,
            pageUrl: rawLink,
            directUrl: directCsLink || rawLink
          });
        }
      }

      return res.json({
        success: true,
        isTvShow: false,
        title,
        totalQualities: downloadLinks.length,
        downloadLinks
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "Failed to scrape content details: " + err.message });
    }
  }
};
