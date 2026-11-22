const axios = require("axios");
const cheerio = require("cheerio");

const CF_WORKER_URL = "https://apex-api-ph.malindunadith52.workers.dev";

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
      if (depth === 0) { end = i; break; }
    }
  }
  try {
    return JSON.parse(s.slice(arrStart, end + 1).replace(/\\\//g, "/"));
  } catch {
    return null;
  }
}

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

function formatFileSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b <= 0) return "Unknown";
  const mb = b / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(2)} MB`;
}

// Single-shot Worker stream URL එකෙන් Range 0-1 check කරලා size එක ගැනීම
async function fetchVideoSizeFromWorker(workerStreamUrl) {
  try {
    const res = await axios({
      method: "GET",
      url: workerStreamUrl,
      responseType: "stream",
      headers: { "Range": "bytes=0-1" },
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 400
    });

    let totalBytes = 0;
    const contentRange = res.headers["content-range"];
    if (contentRange && contentRange.includes("/")) {
      totalBytes = parseInt(contentRange.split("/")[1], 10);
    } else if (res.headers["content-length"]) {
      totalBytes = parseInt(res.headers["content-length"], 10);
    }

    if (res.data && typeof res.data.destroy === "function") {
      res.data.destroy();
    }
    return formatFileSize(totalBytes);
  } catch (_) {
    return "Unknown";
  }
}

module.exports = {
  name: "PH · Cloudflare Edge Downloader",
  category: "adult",
  method: "GET",
  path: "/api/v1/adult/ph/dl",
  handler: async (req, res) => {
    try {
      const rawUrl = (req.query.url || "").trim();
      if (!rawUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required" });
      }

      const url = rawUrl.replace(/\/\/(m|cn|de|fr|es|it|jp|nl|pl|pt|ru)\.pornhub\.com/i, "//www.pornhub.com");
      let sessionCookies = "accessAgeDisclaimerPH=1; age_verified=1";

      const pageWorkerUrl = `${CF_WORKER_URL}/?url=${encodeURIComponent(url)}&ref=${encodeURIComponent("https://www.pornhub.com/")}&cookie=${encodeURIComponent(sessionCookies)}`;
      const pageRes = await axios.get(pageWorkerUrl, { timeout: 20000 });
      const data = pageRes.data;

      if (pageRes.headers["x-upstream-cookies"]) {
        sessionCookies = `${sessionCookies}; ${pageRes.headers["x-upstream-cookies"]}`;
      }

      const $ = cheerio.load(data);
      const title = $("h1.title span").first().text().trim() || $("title").text().replace("- Pornhub.com", "").trim();
      const thumbnail = $('meta[property="og:image"]').attr("content") || null;

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
        return res.status(404).json({ success: false, error: "Could not extract media definitions from this page." });
      }

      let validQualities = mediaDefinitions.filter(
        (d) => d.format === "mp4" && d.videoUrl && !d.videoUrl.includes("/video/get_media")
      );

      if (!validQualities.length) {
        const mp4Endpoint = mediaDefinitions.find((d) => d.format === "mp4" && d.videoUrl);
        if (mp4Endpoint) {
          const mp4JsonWorkerUrl = `${CF_WORKER_URL}/?url=${encodeURIComponent(mp4Endpoint.videoUrl)}&ref=${encodeURIComponent(url)}&cookie=${encodeURIComponent(sessionCookies)}&xhr=1`;
          const mp4Res = await axios.get(mp4JsonWorkerUrl, { timeout: 15000 });
          const rawList = Array.isArray(mp4Res.data) ? mp4Res.data : [];
          validQualities = rawList.filter((d) => d.videoUrl);
        }
      }

      if (!validQualities.length) {
        return res.status(404).json({
          success: false,
          error: "No downloadable MP4 resolutions found.",
          availableFormats: mediaDefinitions.map((d) => ({ format: d.format, quality: d.quality }))
        });
      }

      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

      const downloads = await Promise.all(
        validQualities.map(async (q) => {
          const qualityLabel = `${q.quality}p`;
          const fileName = `${safeTitle}_${qualityLabel}.mp4`;
          // Single-Shot Worker Stream URL (Zero IP Mismatch!)
          const streamUrl = `${CF_WORKER_URL}/?page=${encodeURIComponent(url)}&q=${encodeURIComponent(q.quality)}&filename=${encodeURIComponent(fileName)}`;
          const sizeFormatted = await fetchVideoSizeFromWorker(streamUrl);

          return {
            quality: qualityLabel,
            size: sizeFormatted,
            directUrl: q.videoUrl,
            streamUrl
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
      return res.status(500).json({ success: false, error: "Extraction Failed: " + err.message });
    }
  }
};
