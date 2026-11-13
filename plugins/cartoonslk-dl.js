const cheerio = require("cheerio");

const BASE_URL = "https://cartoons.lk";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function resolveSingleOption(details, option, gotScraping) {
  try {
    const formBody = new URLSearchParams({
      action: "get_movie_link",
      nonce: details.nonce,
      post_id: details.postId,
      type: details.type,
      action_type: "download",
      link_index: String(option.link_index)
    }).toString();

    // Step A: Call admin-ajax.php
    const ajaxRes = await gotScraping.post(`${BASE_URL}/wp-admin/admin-ajax.php`, {
      body: formBody,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "Referer": details.movieUrl,
        "Origin": BASE_URL,
        ...(details.cookies && { "Cookie": details.cookies })
      },
      responseType: "json",
      timeout: { request: 12000 }
    });

    const ajaxData = ajaxRes.body;
    if (!ajaxData || !ajaxData.success || !ajaxData.data?.url) {
      return null;
    }

    const dlTokenUrl = ajaxData.data.url;
    const provider = ajaxData.data.provider || option.provider || "direct";

    const ajaxCookies = ajaxRes.headers["set-cookie"]
      ? ajaxRes.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
      : "";
    const combinedCookies = [details.cookies, ajaxCookies].filter(Boolean).join("; ");

    if (provider === "gdrive") {
      return { provider, finalUrl: dlTokenUrl };
    }

    // Step B: Follow 302 redirect from cartoons.lk/dl/... -> workers.dev/d/...
    const step1 = await gotScraping.get(dlTokenUrl, {
      followRedirect: false,
      throwHttpErrors: false,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": details.movieUrl,
        ...(combinedCookies && { "Cookie": combinedCookies })
      },
      timeout: { request: 10000 }
    });

    const workerDUrl = step1.headers.location;
    if (!workerDUrl) return { provider, finalUrl: dlTokenUrl };

    // Step C: Follow 302 redirect from workers.dev/d/... -> workers.dev/s/... (Final MP4)
    const step2 = await gotScraping.get(workerDUrl, {
      followRedirect: false,
      throwHttpErrors: false,
      headers: {
        "User-Agent": USER_AGENT
      },
      timeout: { request: 10000 }
    });

    const finalDirectUrl = step2.headers.location || workerDUrl;
    return { provider, finalUrl: finalDirectUrl };

  } catch (_) {
    return null;
  }
}

module.exports = {
  name: "Cartoons.lk · Direct DL All Links",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cartoonslk/dl",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Dedicated Proxy Force Auto-Download Streamer ──────────────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `CartoonsLK_${Date.now()}.mp4`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        return gotScraping.stream(streamTargetUrl, {
          headers: { "User-Agent": USER_AGENT }
        }).pipe(res);
      }

      // ── 2. Fetch Movie Details & Resolve All Qualities ───────────────────
      const movieUrl = (req.query.url || "").trim();
      if (!movieUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. https://cartoons.lk/movies/...)"
        });
      }

      const pageRes = await gotScraping.get(movieUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: { request: 12000 }
      });

      const html = pageRes.body;
      const $ = cheerio.load(html);

      const cookies = pageRes.headers["set-cookie"]
        ? pageRes.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
        : "";

      const nonceMatch = html.match(/nonce:\s*"([a-f0-9]+)"/i);
      const nonce = nonceMatch ? nonceMatch[1] : null;

      const dlBtn = $(".direct-download-btn");
      const postId = dlBtn.attr("data-post-id");
      const type = dlBtn.attr("data-type") || "single";
      const isMulti = dlBtn.attr("data-multi") === "1";

      const title = $(".movie-title").first().text().split("|")[0]?.trim() || $("h1").first().text().trim() || "Cartoons.lk Video";
      const poster = $(".movie-poster img").attr("src") || $("meta[property='og:image']").attr("content") || null;

      let rawLinks = [];
      if (isMulti) {
        try {
          rawLinks = JSON.parse(dlBtn.attr("data-multi-links") || "[]");
        } catch (_) {}
      } else if (dlBtn.length) {
        rawLinks.push({
          label: $(".movie-title").text().split("|")[2]?.trim() || "Default Quality",
          file_size: $(".movie-title").text().split("|")[3]?.trim() || "Unknown",
          provider: dlBtn.attr("data-provider") || "direct",
          link_index: parseInt(dlBtn.attr("data-link-index") || "0", 10)
        });
      }

      if (!postId || !nonce || rawLinks.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No direct download options found (might be a TV Series with episodes)."
        });
      }

      const details = { postId, type, nonce, movieUrl, cookies };
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

      // සියලුම Qualities එකවර resolve කිරීම
      const resolvedResults = await Promise.all(
        rawLinks.map(async (opt, idx) => {
          const resolved = await resolveSingleOption(details, opt, gotScraping);
          const qualityLabel = opt.label || `Quality_${idx + 1}`;
          const fileName = `${safeTitle}_${qualityLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;

          return {
            quality: qualityLabel,
            size: opt.file_size || "Unknown",
            provider: (resolved?.provider || opt.provider || "direct").toUpperCase(),
            directDownloadUrl: resolved?.finalUrl || null,
            autoDownloadUrl: resolved?.finalUrl
              ? `${currentHost}/api/v1/movies/cartoonslk/dl?stream=${encodeURIComponent(resolved.finalUrl)}&filename=${fileName}${apiKeyParam}`
              : null
          };
        })
      );

      return res.json({
        success: true,
        title,
        poster,
        movieUrl,
        totalLinks: resolvedResults.length,
        downloads: resolvedResults
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Cartoons.lk Download Resolution Failed: " + err.message
      });
    }
  }
};
