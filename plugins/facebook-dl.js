const axios = require("axios");

const HEADERS_DESKTOP = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
};

async function resolveShortUrl(url) {
  const isRedirectUrl = url.includes("fb.watch") || url.includes("fb.com") || url.includes("facebook.com/share/");
  if (!isRedirectUrl) return url;

  try {
    const res = await axios.get(url, {
      headers: HEADERS_DESKTOP,
      maxRedirects: 5,
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return res.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
}

function extractVideoUrls(html) {
  const results = { hd: null, sd: null, title: "Facebook Video" };
  const unescape = (s) =>
    s
      .replace(/\\u0025/g, "%")
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, "&");

  let hdMatch = html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/) || html.match(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/);
  let sdMatch = html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/) || html.match(/"playable_url"\s*:\s*"([^"]+)"/);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);

  if (hdMatch) results.hd = unescape(hdMatch[1]);
  if (sdMatch) results.sd = unescape(sdMatch[1]);
  if (titleMatch) {
    results.title = titleMatch[1].replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/ \| Facebook/gi, "").trim();
  }

  return results;
}

module.exports = {
  name: "Facebook Video DL",
  category: "media",
  method: "GET",
  path: "/api/v1/media/facebook/dl",
  handler: async (req, res) => {
    try {
      const videoUrl = req.query.url;
      if (!videoUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' (Facebook Video/Reel URL) is required" });
      }

      const fullUrl = await resolveShortUrl(videoUrl.trim());
      let result = null;

      // 1. ruhend-scraper හරහා උත්සාහ කිරීම (install කර ඇත්නම්)
      try {
        const pkg = await import("ruhend-scraper");
        if (pkg?.fbdown) {
          const data = await pkg.fbdown(fullUrl);
          if (data && (data.hd || data.sd || data.normal)) {
            result = {
              title: data.title || "Facebook Video",
              hd: data.hd || null,
              sd: data.sd || data.normal || null
            };
          }
        }
      } catch (pkgErr) {}

      // 2. Direct Scrape Fallback
      if (!result || (!result.hd && !result.sd)) {
        const pageRes = await axios.get(fullUrl, {
          headers: HEADERS_DESKTOP,
          timeout: 12000,
        });
        const parsed = extractVideoUrls(pageRes.data);
        if (parsed.hd || parsed.sd) {
          result = parsed;
        }
      }

      if (!result || (!result.hd && !result.sd)) {
        return res.status(404).json({ success: false, error: "Could not extract video streams. Make sure the video is public." });
      }

      return res.json({
        success: true,
        title: result.title,
        originalUrl: videoUrl,
        downloadUrl: result.hd || result.sd,
        qualities: {
          hd: result.hd || null,
          sd: result.sd || null
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "Facebook DL Failed: " + err.message });
    }
  }
};
