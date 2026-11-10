const axios = require("axios");
const cheerio = require("cheerio");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * MagicLinks -> SkyDrop -> Final Direct CDN Link Resolver
 */
async function bypassSkydrop(magicLinkUrl, gotScraping) {
  try {
    // 1. MagicLinks පිටුව ලබා ගැනීම
    const magicRes = await gotScraping.get(magicLinkUrl, {
      timeout: { request: 12000 },
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://kmmovies.beer/"
      }
    });

    const $ = cheerio.load(magicRes.body);

    // SkyDrop Link එක හඳුනා ගැනීම (Button text හෝ href attribute එකෙන්)
    let skydropUrl = "";
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().toLowerCase();

      if (href.includes("skydrop") || text.includes("skydrop") || $(el).hasClass("download-button")) {
        if (href.startsWith("http")) {
          skydropUrl = href;
        }
      }
    });

    if (!skydropUrl) {
      // Fallback: Form action එකක් ඇත්නම් සෙවීම
      const formAction = $("form").attr("action");
      if (formAction && formAction.includes("skydrop")) {
        skydropUrl = formAction;
      }
    }

    if (!skydropUrl) return null;

    const urlObj = new URL(skydropUrl);
    const baseUrl = urlObj.origin;

    // 2. SkyDrop Session Cookie එක ලබා ගැනීම
    const res1 = await gotScraping.get(skydropUrl, {
      timeout: { request: 10000 },
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": magicLinkUrl
      }
    });

    const rawCookies = res1.headers["set-cookie"] || [];
    const cookies = Array.isArray(rawCookies)
      ? rawCookies.map((c) => c.split(";")[0]).join("; ")
      : "";

    // 3. Step 2: Register session (/resolve/)
    const resolveUrl = `${baseUrl}/resolve/`;
    await axios.post(resolveUrl, "", {
      headers: {
        "Origin": baseUrl,
        "Referer": skydropUrl,
        "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      timeout: 10000
    }).catch(() => null);

    // 4. Step 3: GET /id/
    const idUrl = `${baseUrl}/id/`;
    await gotScraping.get(idUrl, {
      headers: {
        "Referer": skydropUrl,
        "Cookie": cookies,
        "User-Agent": USER_AGENT
      },
      timeout: 10000
    }).catch(() => null);

    // 5. Step 4: Final Fetch (/fetch/) -> Redirect Location (Direct CDN)
    const fetchUrl = `${baseUrl}/fetch/`;
    const postRes = await axios.post(fetchUrl, "", {
      headers: {
        "Origin": baseUrl,
        "Referer": idUrl,
        "Cookie": cookies,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status <= 303,
      timeout: 15000
    });

    if ((postRes.status === 302 || postRes.status === 303) && postRes.headers.location) {
      const finalLoc = postRes.headers.location;
      if (finalLoc !== "/id/" && !finalLoc.includes("failed")) {
        return finalLoc.startsWith("http") ? finalLoc : `${baseUrl}${finalLoc}`;
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
      const movieUrl = req.query.url;
      if (!movieUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. movie page link)"
        });
      }

      const moviePageRes = await gotScraping.get(movieUrl, {
        headers: { "User-Agent": USER_AGENT },
        timeout: { request: 15000 }
      });
      const $ = cheerio.load(moviePageRes.body);

      const title = $("h1.entry-title").first().text().trim() || $("title").text().trim();
      const rawWebDlItems = [];

      // WEB-DL බටන් හඳුනා ගැනීම (Class සහ Structure flexibility එක සහිතව)
      $(".download-category.webdl .dl-btn, .webdl a.dl-btn, a[href*='magiclinks']").each((_, el) => {
        const resQuality = $(el).find(".dl-res").text().trim() || $(el).text().match(/\b(480p|720p|1080p|2160p|4K)\b/i)?.[0] || "WEB-DL";
        const size = $(el).find(".dl-size").text().trim() || $(el).text().match(/\b(\d+(?:\.\d+)?\s*(?:MB|GB))\b/i)?.[0] || "Unknown";
        const magicUrl = $(el).attr("href");

        if (magicUrl && !rawWebDlItems.some((item) => item.magicUrl === magicUrl)) {
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

      // සියලුම Qualities එකවර Bypass කර Direct Links ජනනය කිරීම
      const resolvedDownloads = await Promise.all(
        rawWebDlItems.map(async (item) => {
          const directCdnUrl = await bypassSkydrop(item.magicUrl, gotScraping);
          const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
          const fileName = `${safeTitle}_${item.quality.replace(/\s+/g, "_")}.mp4`;

          return {
            quality: item.quality,
            size: item.size,
            directDownloadUrl: directCdnUrl,
            autoDownloadUrl: directCdnUrl
              ? `${currentHost}/api/v1/movies/kmmovies/dl?stream=${encodeURIComponent(directCdnUrl)}&filename=${fileName}${apiKeyParam}`
              : null
          };
        })
      );

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
