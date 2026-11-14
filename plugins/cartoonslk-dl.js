const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://cartoons.lk";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
  },
  timeout: 12000,
});

async function resolveSingleOption(details, option) {
  try {
    // 2nd script එකේ වගේම FormData පාවිච්චි කරන්න
    const formData = new FormData();
    formData.append("action", "get_movie_link");
    formData.append("nonce", details.nonce);
    formData.append("post_id", details.postId);
    formData.append("type", details.type);
    formData.append("action_type", "download");
    formData.append("link_index", String(option.link_index));

    // Step A: Call admin-ajax.php
    const ajaxRes = await client.post("/wp-admin/admin-ajax.php", formData, {
      headers: {
        "Referer": details.movieUrl,
        "Origin": BASE_URL,
        ...(details.cookies && { "Cookie": details.cookies }),
      },
    });

    const ajaxData = ajaxRes.data;
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

    // Step B: cartoons.lk/dl/... -> workers.dev/d/...
    const step1 = await axios.get(dlTokenUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": details.movieUrl,
        ...(combinedCookies && { "Cookie": combinedCookies }),
      },
      timeout: 10000,
    });

    const workerDUrl = step1.headers.location;
    if (!workerDUrl) return { provider, finalUrl: dlTokenUrl };

    // Step C: workers.dev/d/... -> workers.dev/s/...
    const step2 = await axios.get(workerDUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent": USER_AGENT,
      },
      timeout: 10000,
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
      // ── 1. Dedicated Proxy Force Auto-Download Streamer ──────────────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `CartoonsLK_${Date.now()}.mp4`;

        const streamResponse = await axios.get(streamTargetUrl, {
          responseType: "stream",
          headers: {
            "User-Agent": USER_AGENT,
            // Range header එක pass කළොත් pause/resume (IDM වගේ) වැඩ කරනවා
            ...(req.headers.range && { Range: req.headers.range }),
          },
        });

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", streamResponse.headers["content-type"] || "video/mp4");
        if (streamResponse.headers["content-length"]) {
          res.setHeader("Content-Length", streamResponse.headers["content-length"]);
        }
        if (streamResponse.headers["content-range"]) {
          res.setHeader("Content-Range", streamResponse.headers["content-range"]);
          res.status(206);
        }

        return streamResponse.data.pipe(res);
      }

      // ── 2. Fetch Movie Details & Resolve All Qualities ───────────────────
      const movieUrl = (req.query.url || "").trim();
      if (!movieUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. https://cartoons.lk/movies/...)",
        });
      }

      const pageRes = await client.get(movieUrl);
      const html = pageRes.data;
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
          link_index: parseInt(dlBtn.attr("data-link-index") || "0", 10),
        });
      }

      if (!postId || !nonce || rawLinks.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No direct download options found (might be a TV Series with episodes).",
        });
      }

      const details = { postId, type, nonce, movieUrl, cookies };
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

      // Promise.all වෙනුවට එකින් එක (Sequential) resolve කිරීම
      const resolvedResults = [];
      for (let idx = 0; idx < rawLinks.length; idx++) {
        const opt = rawLinks[idx];
        const resolved = await resolveSingleOption(details, opt);
        const qualityLabel = opt.label || `Quality_${idx + 1}`;
        const fileName = `${safeTitle}_${qualityLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`;

        resolvedResults.push({
          quality: qualityLabel,
          size: opt.file_size || "Unknown",
          provider: (resolved?.provider || opt.provider || "direct").toUpperCase(),
          directDownloadUrl: resolved?.finalUrl || null,
          autoDownloadUrl: resolved?.finalUrl
            ? `${currentHost}/api/v1/movies/cartoonslk/dl?stream=${encodeURIComponent(resolved.finalUrl)}&filename=${fileName}${apiKeyParam}`
            : null,
        });
      }

      return res.json({
        success: true,
        title,
        poster,
        movieUrl,
        totalLinks: resolvedResults.length,
        downloads: resolvedResults,
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Cartoons.lk Download Resolution Failed: " + err.message,
      });
    }
  },
};
