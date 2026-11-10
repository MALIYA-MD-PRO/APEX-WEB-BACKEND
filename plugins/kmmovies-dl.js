const axios = require("axios");
const cheerio = require("cheerio");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CLI script එකෙහි සාර්ථක වූ 4-Step SkyDrop Session Resolver
 */
async function bypassSkydrop(magicLinkUrl, gotScraping) {
  try {
    // 1. MagicLinks පිටුව ලබා ගැනීම
    const magicRes = await gotScraping.get(magicLinkUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://kmmovies.beer/"
      },
      timeout: { request: 12000 }
    });

    const $ = cheerio.load(magicRes.body);

    // Button text හෝ href එකෙන් SKYDROP URL එක සෙවීම
    let skydropUrl = "";
    $(".download-button").each((_, el) => {
      const text = $(el).text().trim().toUpperCase();
      const href = $(el).attr("href");
      if (text.includes("SKYDROP") && href) {
        skydropUrl = href;
      }
    });

    // Fallback search
    if (!skydropUrl) {
      $('a[href*="skydrop"]').each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("http")) skydropUrl = href;
      });
    }

    if (!skydropUrl) return null;

    const baseUrl = new URL(skydropUrl).origin; // https://w1.skydrop.sbs

    // Step 1: Initial load to get the session cookie
    const res1 = await gotScraping.get(skydropUrl, {
      headers: { "User-Agent": USER_AGENT },
      timeout: { request: 10000 }
    });

    const rawCookies = res1.headers["set-cookie"];
    const cookies = rawCookies
      ? rawCookies.map((c) => c.split(";")[0]).join("; ")
      : "";

    // Step 2: POST to /resolve/ (This registers the file ID to the session)
    const resolveUrl = new URL("/resolve/", baseUrl).href;
    await axios.post(resolveUrl, "", {
      headers: {
        Origin: baseUrl,
        Referer: skydropUrl,
        Cookie: cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      timeout: 10000
    });

    // Step 3: GET /id/ (Simulating browser redirection)
    const idUrl = new URL("/id/", baseUrl).href;
    await gotScraping.get(idUrl, {
      headers: {
        Referer: skydropUrl,
        Cookie: cookies,
        "User-Agent": USER_AGENT
      },
      timeout: 10000
    });

    // Step 4: POST to /fetch/ to get the final Google link
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
      timeout: 15000
    });

    if ((postRes.status === 302 || postRes.status === 303) && postRes.headers.location) {
      if (postRes.headers.location !== "/id/") {
        return postRes.headers.location;
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  name: "KMMovies · WEB-DL All Qualities",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/kmmovies/dl",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Dedicated Proxy Force Auto-Download Streamer ──────────────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `KMMovies_${Date.now()}.mp4`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        return gotScraping.stream(streamTargetUrl, {
          headers: {
            "User-Agent": USER_AGENT
          }
        }).pipe(res);
      }

      // ── 2. Movie Link Resolution ─────────────────────────────────────────
      let movieUrl = (req.query.url || "").trim();
      if (!movieUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. https://kmmovies.beer/leo-2023/)"
        });
      }

      // Trailing slash නිවැරදි කිරීම (WordPress query break නොවීමට)
      if (!movieUrl.endsWith("/")) {
        movieUrl += "/";
      }

      const moviePageRes = await gotScraping.get(movieUrl, {
        headers: { "User-Agent": USER_AGENT },
        timeout: { request: 15000 }
      });
      const $ = cheerio.load(moviePageRes.body);

      const title = $("h1.entry-title").first().text().trim() || $("title").text().trim();
      const rawWebDlItems = [];

      // WEB-DL Versions පමණක් වෙන් කර ගැනීම
      $(".download-category.webdl .dl-btn").each((_, el) => {
        const resQuality = $(el).find(".dl-res").text().trim() || "WEB-DL";
        const size = $(el).find(".dl-size").text().trim() || "Unknown";
        const magicUrl = $(el).attr("href");

        if (magicUrl) {
          rawWebDlItems.push({
            quality: resQuality,
            size,
            magicUrl
          });
        }
      });

      if (rawWebDlItems.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No WEB-DL download links found on this movie page."
        });
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // SkyDrop එක Block නොවීමට sequential loop එකකින් resolve කිරීම
      const resolvedDownloads = [];
      for (let i = 0; i < rawWebDlItems.length; i++) {
        const item = rawWebDlItems[i];
        const directGoogleUrl = await bypassSkydrop(item.magicUrl, gotScraping);

        const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
        const fileName = `${safeTitle}_${item.quality.replace(/\s+/g, "_")}_${i + 1}.mp4`;

        resolvedDownloads.push({
          quality: item.quality,
          size: item.size,
          directDownloadUrl: directGoogleUrl,
          autoDownloadUrl: directGoogleUrl
            ? `${currentHost}/api/v1/movies/kmmovies/dl?stream=${encodeURIComponent(directGoogleUrl)}&filename=${fileName}${apiKeyParam}`
            : null
        });

        // Request sessions අතර කෙටි delay එකක් (SkyDrop spam-block නොවීමට)
        if (i < rawWebDlItems.length - 1) {
          await sleep(500);
        }
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
        error: "KMMovies WEB-DL Processing Failed: " + err.message
      });
    }
  }
};
