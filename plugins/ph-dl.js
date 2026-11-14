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

      // ── 2. Video Metadata & All Qualities Extractor ──────────────────────
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
