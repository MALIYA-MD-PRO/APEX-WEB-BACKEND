const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function parseKey(url) {
  const m = url.match(/mediafire\.com\/file\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

function deduplicateName(raw) {
  const clean = String(raw || "").trim().replace(/\s+/g, " ");
  const half = Math.ceil(clean.length / 2);
  const first = clean.slice(0, half);
  const second = clean.slice(half).trim();
  return second.startsWith(first.trim()) ? first.trim() : clean;
}

function getMimeType(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    ".exe": "application/x-msdownload",
    ".rar": "application/vnd.rar",
    ".zip": "application/zip",
    ".7z": "application/x-7z-compressed",
    ".apk": "application/vnd.android.package-archive",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".iso": "application/x-iso9660-image"
  };
  return mimeMap[ext] || "application/octet-stream";
}

async function tryPage(url) {
  const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
  const $ = cheerio.load(res.data);
  const link = $("a#downloadButton").attr("href") || $("a.input").attr("href");
  if (!link) throw new Error("Download button link not found on page");
  const name = deduplicateName($("div.filename").text() || $("div.file-name").text() || "");
  const size = $("ul.details li").first().text().replace("File size:", "").trim();
  return { link, name, size };
}

async function tryAPI(key) {
  const res = await axios.get(
    `https://www.mediafire.com/api/1.5/file/get_links.php?quick_key=${key}&link_type=normal_download&response_format=json`,
    { headers: HEADERS, timeout: 15000 }
  );
  const data = res.data?.response;
  if (data?.result !== "Success") throw new Error("API: " + (data?.message || "No result"));
  const dl = data?.links?.[0]?.normal_download;
  if (!dl) throw new Error("API: No download link");
  return dl;
}

module.exports = {
  name: "MediaFire Direct DL",
  category: "media",
  method: "GET",
  path: "/api/v1/media/mediafire/dl",
  handler: async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || !url.includes("mediafire.com")) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required and must be a valid MediaFire link"
        });
      }

      const key = parseKey(url);
      let info = null;
      const errors = [];

      // 1. Scraping direct webpage
      try {
        info = await tryPage(url.trim());
      } catch (e) {
        errors.push("Page scrape: " + e.message);
      }

      // 2. Fallback Mediafire API
      if (!info?.link && key) {
        try {
          const directLink = await tryAPI(key);
          info = { ...(info || {}), link: directLink };
        } catch (e) {
          errors.push("API lookup: " + e.message);
        }
      }

      if (!info?.link) {
        return res.status(502).json({
          success: false,
          error: "Could not extract download link. " + errors.join(" | ")
        });
      }

      const fileName = info.name || "downloaded_file";
      const mimeType = getMimeType(fileName);

      return res.json({
        success: true,
        fileName,
        size: info.size || "Unknown",
        mimeType,
        downloadUrl: info.link,
        originalUrl: url
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "MediaFire DL Failed: " + err.message
      });
    }
  }
};
