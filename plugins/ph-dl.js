const axios = require("axios");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function extractMediaDefinitions(s) {
  const start = s.indexOf("mediaDefinitions");
  if (start === -1) return null;
  const arrStart = s.indexOf("[", start);
  if (arrStart === -1) return null;
  let depth = 0, end = -1;
  for (let i = arrStart; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  try {
    return JSON.parse(s.slice(arrStart, end + 1).replace(/\\\//g, "/"));
  } catch {
    return null;
  }
}

// තත්පර ගණන MM:SS හෝ HH:MM:SS බවට පත් කිරීම
function formatDuration(seconds) {
  const secNum = parseInt(seconds, 10);
  if (isNaN(secNum) || secNum <= 0) return "Unknown";
  const hours = Math.floor(secNum / 3600);
  const minutes = Math.floor((secNum % 3600) / 60);
  const secs = secNum % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// Bytes අගය MB හෝ GB බවට පත් කිරීම
function formatFileSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b <= 0) return "Unknown";
  const mb = b / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(2)} MB`;
}

// CDN එකෙන් වීඩියෝව download නොකර File Size එක පමණක් ඉක්මනින් ලබා ගැනීම
async function fetchVideoSize(mp4Url, refererUrl) {
  try {
    const res = await axios({
      method: "GET",
      url: mp4Url,
      responseType: "stream",
      headers: {
        "User-Agent": UA,
        "Referer": refererUrl,
        "Origin": "https://www.pornhub.com",
        "Range": "bytes=0-1"
      },
      timeout: 8000,
      validateStatus: (status) => status >= 200 && status < 400
    });

    let totalBytes = 0;
    const contentRange = res.headers["content-range"]; // e.g., "bytes 0-1/45829104"
    if (contentRange && contentRange.includes("/")) {
      totalBytes = parseInt(contentRange.split("/")[1], 10);
    } else if (res.headers["content-length"]) {
      totalBytes = parseInt(res.headers["content-length"], 10);
    }

    // Stream එක වහාම අවසන් කිරීම (Data download වීම නැවැත්වීමට)
    if (res.data && typeof res.data.destroy === "function") {
      res.data.destroy();
    }

    return formatFileSize(totalBytes);
  } catch (_) {
    return "Unknown";
  }
}

module.exports = {
  name: "PH · Direct & Stream Downloader",
  category: "adult",
  method: "GET",
  path: "/api/v1/adult/ph/dl",
  handler: async (req, res) => {
    try {
      // ── 1. Dedicated Stream Proxy Gateway (Force Auto-Download) ──────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const refererUrl = req.query.ref ? decodeURIComponent(req.query.ref) : "https://www.pornhub.com/";
        const fileName = req.query.filename || `Video_${Date.now()}.mp4`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        const videoStream = await axios({
          method: "GET",
          url: streamTargetUrl,
          responseType: "stream",
          headers: {
            "User-Agent": UA,
            "Referer": refererUrl,
            "Origin": "https://www.pornhub.com",
            "Accept": "*/*"
          }
        });

        if (videoStream.headers["content-length"]) {
          res.setHeader("Content-Length", videoStream.headers["content-length"]);
        }

        return videoStream.data.pipe(res);
      }

      // ── 2. Video Metadata, Duration & Qualities Extractor ────────────────
      const rawUrl = (req.query.url || "").trim();
      if (!rawUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required"
        });
      }

      const url = rawUrl.replace(/\/\/(m|cn|de|fr|es|it|jp|nl|pl|pt|ru)\.pornhub\.com/i, "//www.pornhub.com");
      let sessionCookies = "accessAgeDisclaimerPH=1";

      const client = axios.create({
        timeout: 20000,
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          "Cookie": sessionCookies
        }
      });

      client.interceptors.response.use((response) => {
        const setCookie = response.headers["set-cookie"];
        if (setCookie) {
          const parsed = setCookie.map((c) => c.split(";")[0]).join("; ");
          sessionCookies = `${sessionCookies}; ${parsed}`;
        }
        return response;
      });

      const { data } = await client.get(url);
      const $ = cheerio.load(data);

      const title = $("h1.title span").first().text().trim() || $("title").text().replace("- Pornhub.com", "").trim();
      const thumbnail = $('meta[property="og:image"]').attr("content") || null;

      // Duration නිස්සාරණය කිරීම (Script variable හෝ Meta tag වලින්)
      let durationSeconds = 0;
      const durationMatch = data.match(/"video_duration"\s*:\s*"?(\d+)"?/i);
      if (durationMatch) {
        durationSeconds = parseInt(durationMatch[1], 10);
      } else {
        const metaDuration = $('meta[property="video:duration"]').attr("content");
        if (metaDuration) durationSeconds = parseInt(metaDuration, 10);
      }
      const durationFormatted = formatDuration(durationSeconds);

      const scripts = $("script").map((_, el) => $(el).html()).get();
      let mediaDefinitions = null;

      for (const s of scripts) {
        if (s && s.includes("mediaDefinitions")) {
          mediaDefinitions = extractMediaDefinitions(s);
          if (mediaDefinitions) break;
        }
      }

      if (!mediaDefinitions) {
        return res.status(404).json({
          success: false,
          error: "Could not extract media definitions from this page."
        });
      }

      const mp4Endpoint = mediaDefinitions.find((d) => d.format === "mp4" && d.videoUrl);
      if (!mp4Endpoint) {
        return res.status(404).json({
          success: false,
          error: "MP4 stream endpoint not found."
        });
      }

      const mp4Res = await client.get(mp4Endpoint.videoUrl, {
        headers: {
          "Referer": url,
          "Cookie": sessionCookies,
          "X-Requested-With": "XMLHttpRequest"
        }
      });

      const validQualities = (mp4Res.data || []).filter((d) => d.videoUrl);

      if (!validQualities.length) {
        return res.status(404).json({
          success: false,
          error: "No downloadable MP4 resolutions found."
        });
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const currentPath = req.originalUrl.split("?")[0];
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

      // සියලුම Qualities වල File Sizes එකවර (Parallel) ලබා ගැනීම
      const downloads = await Promise.all(
        validQualities.map(async (q) => {
          const qualityLabel = `${q.quality}p`;
          const fileName = `${safeTitle}_${qualityLabel}.mp4`;
          const sizeFormatted = await fetchVideoSize(q.videoUrl, url);

          return {
            quality: qualityLabel,
            size: sizeFormatted,
            directUrl: q.videoUrl,
            streamUrl: `${currentHost}${currentPath}?stream=${encodeURIComponent(q.videoUrl)}&ref=${encodeURIComponent(url)}&filename=${fileName}${apiKeyParam}`
          };
        })
      );

      return res.json({
        success: true,
        title,
        duration: durationFormatted,
        durationSeconds: durationSeconds || null,
        thumbnail,
        pageUrl: url,
        totalQualities: downloads.length,
        downloads
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Extraction Failed: " + err.message
      });
    }
  }
};
