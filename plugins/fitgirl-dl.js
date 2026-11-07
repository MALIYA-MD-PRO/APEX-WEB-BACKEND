const axios = require("axios");
const cheerio = require("cheerio");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFuckingFastLinks(gameUrl) {
  try {
    const { gotScraping } = await import("got-scraping");
    const { body } = await gotScraping.get(gameUrl);
    const $ = cheerio.load(body);
    const links = [];

    $('a[href*="fuckingfast.co"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) links.push(href);
    });
    return [...new Set(links)];
  } catch (error) {
    return [];
  }
}

async function getDirectUrl(ffUrl) {
  try {
    const urlObj = new URL(ffUrl);
    const fileId = urlObj.pathname.replace("/", "");
    const postEndpoint = `https://fuckingfast.co/f/${fileId}/go`;

    const { gotScraping } = await import("got-scraping");
    const response = await gotScraping.post(postEndpoint, {
      headers: {
        "HX-Request": "true",
        Referer: ffUrl,
        Origin: "https://fuckingfast.co"
      },
      followRedirect: false,
      throwHttpErrors: false
    });

    const redirectUrl = response.headers["hx-redirect"] || response.headers["location"];
    if (redirectUrl) {
      return redirectUrl.startsWith("http") ? redirectUrl : `https://fuckingfast.co${redirectUrl}`;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function checkFileSizeGB(directUrl) {
  try {
    const response = await axios({
      method: "GET",
      url: directUrl,
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Encoding": "identity"
      },
      timeout: 10000
    });
    const contentLength = response.headers["content-length"];
    response.data.destroy();

    if (contentLength) {
      return Number((parseInt(contentLength, 10) / (1024 * 1024 * 1024)).toFixed(2));
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

module.exports = {
  name: "FitGirl Direct DL",
  category: "game",
  method: "GET",
  path: "/api/v1/games/fitgirl/dl",
  handler: async (req, res) => {
    try {
      const gameUrl = req.query.url;
      if (!gameUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required" });
      }

      const ffLinks = await getFuckingFastLinks(gameUrl);
      if (!ffLinks.length) {
        return res.status(404).json({ success: false, error: "No FuckingFast links found on this game page." });
      }

      const directParts = [];
      for (let i = 0; i < ffLinks.length; i++) {
        const directUrl = await getDirectUrl(ffLinks[i]);
        if (directUrl) {
          const sizeGB = await checkFileSizeGB(directUrl);
          directParts.push({
            part: i + 1,
            downloadUrl: directUrl,
            sizeGB: sizeGB > 0 ? sizeGB : "Unknown",
            originalFfUrl: ffLinks[i]
          });
        }
        await sleep(1000);
      }

      if (!directParts.length) {
        return res.status(502).json({ success: false, error: "Failed to bypass FuckingFast links." });
      }

      return res.json({
        success: true,
        gameUrl,
        totalParts: directParts.length,
        parts: directParts
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "FitGirl Download Extraction Failed: " + err.message });
    }
  }
};
