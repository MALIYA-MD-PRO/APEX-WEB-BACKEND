const axios = require("axios");
const cheerio = require("cheerio");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bypassSkydrop(magicLinkUrl, gotScraping) {
  try {
    const magicRes = await gotScraping.get(magicLinkUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://kmmovies.beer/"
      },
      timeout: { request: 10000 }
    });

    const $ = cheerio.load(magicRes.body);
    let skydropUrl = "";

    $(".download-button").each((_, el) => {
      const text = $(el).text().trim().toUpperCase();
      const href = $(el).attr("href");
      if (text.includes("SKYDROP") && href) skydropUrl = href;
    });

    if (!skydropUrl) {
      $('a[href*="skydrop"]').each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("http")) skydropUrl = href;
      });
    }

    if (!skydropUrl) return null;

    const baseUrl = new URL(skydropUrl).origin;

    const res1 = await gotScraping.get(skydropUrl, {
      headers: { "User-Agent": USER_AGENT },
      timeout: { request: 8000 }
    });

    const rawCookies = res1.headers["set-cookie"];
    const cookies = rawCookies ? rawCookies.map((c) => c.split(";")[0]).join("; ") : "";

    const resolveUrl = new URL("/resolve/", baseUrl).href;
    await axios.post(resolveUrl, "", {
      headers: {
        Origin: baseUrl,
        Referer: skydropUrl,
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      timeout: 8000
    });

    const idUrl = new URL("/id/", baseUrl).href;
    await gotScraping.get(idUrl, {
      headers: {
        Referer: skydropUrl,
        Cookie: cookies,
        "User-Agent": USER_AGENT
      },
      timeout: 8000
    });

    const fetchUrl = new URL("/fetch/", baseUrl).href;
    const postRes = await axios.post(fetchUrl, "", {
      headers: {
        Origin: baseUrl,
        Referer: idUrl,
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status <= 303,
      timeout: 12000
    });

    if ((postRes.status === 302 || postRes.status === 303) && postRes.headers.location) {
      if (postRes.headers.location !== "/id/") {
        return postRes.headers.location;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

// KMCLOUD / Encoded Direct Link Resolver (Server IP Safe)
async function resolveEncodedDirect(kmUrl, gotScraping) {
  try {
    const res = await gotScraping.get(kmUrl, {
      headers: { "User-Agent": USER_AGENT },
      timeout: { request: 10000 }
    });
    const $ = cheerio.load(res.body);

    const rootz = $('#rootz-direct-download').attr('href');
    const primary = $('.btn-download-primary').attr('href');
    return rootz || primary || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  name: "KMMovies · All Qualities Downloader",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/kmmovies/dl",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Streaming Proxy Gateway ───────────────────────────────────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `KMMovies_${Date.now()}.mp4`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        return gotScraping.stream(streamTargetUrl, {
          headers: { "User-Agent": USER_AGENT }
        }).pipe(res);
      }

      // ── 2. Movie Link Resolution ─────────────────────────────────────────
      let movieUrl = (req.query.url || "").trim();
      if (!movieUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required" });
      }

      if (!movieUrl.endsWith("/")) movieUrl += "/";

      const moviePageRes = await gotScraping.get(movieUrl, {
        headers: { "User-Agent": USER_AGENT },
        timeout: { request: 15000 }
      });
      const $ = cheerio.load(moviePageRes.body);
      const title = $("h1.entry-title").first().text().trim() || $("title").text().trim();

      const allItems = [];

      // WEB-DL Versions
      $(".download-category.webdl .dl-btn").each((_, el) => {
        const resQuality = $(el).find(".dl-res").text().trim() || "WEB-DL";
        const size = $(el).find(".dl-size").text().trim() || "Unknown";
        const url = $(el).attr("href");
        if (url) allItems.push({ type: "WEB-DL", quality: resQuality, size, url });
      });

      // Encoded Versions (Fallback / Direct Rootz Support)
      $(".download-category.encoded .dl-btn").each((_, el) => {
        const resQuality = $(el).find(".dl-res").text().trim() || "Encoded";
        const size = $(el).find(".dl-size").text().trim() || "Unknown";
        const url = $(el).attr("href");
        if (url) allItems.push({ type: "Encoded (Rootz Direct)", quality: resQuality, size, url });
      });

      if (allItems.length === 0) {
        return res.status(404).json({ success: false, error: "No download links found on this movie page." });
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const resolvedDownloads = [];

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        let directUrl = null;

        if (item.type === "WEB-DL") {
          directUrl = await bypassSkydrop(item.url, gotScraping);
        } else {
          directUrl = await resolveEncodedDirect(item.url, gotScraping);
        }

        const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
        const fileName = `${safeTitle}_${item.quality.replace(/\s+/g, "_")}.mp4`;

        resolvedDownloads.push({
          type: item.type,
          quality: item.quality,
          size: item.size,
          directDownloadUrl: directUrl,
          autoDownloadUrl: directUrl
            ? `${currentHost}/api/v1/movies/kmmovies/dl?stream=${encodeURIComponent(directUrl)}&filename=${fileName}${apiKeyParam}`
            : null
        });

        await sleep(350);
      }

      return res.json({
        success: true,
        title,
        movieUrl,
        totalQualities: resolvedDownloads.length,
        downloads: resolvedDownloads
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "KMMovies Resolution Failed: " + err.message
      });
    }
  }
};
