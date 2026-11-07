const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://www.slmix.lk";

module.exports = {
  name: "SLMix Direct DL",
  category: "media",
  method: "GET",
  path: "/api/v1/media/slmix/dl",
  handler: async (req, res) => {
    try {
      const pageUrl = req.query.url;
      if (!pageUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' (SLMix Track Page URL) is required" });
      }

      const { data } = await axios.get(pageUrl.trim(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);
      const title = $("h1.text-3xl").text().trim() || $("title").text().split("|")[0].trim() || "Track";

      let audioPath = $("audio source").attr("src");
      if (!audioPath) {
        const matched = data.match(/src=["'](\/uploads\/[^"']+\.mp3)["']/i);
        if (matched) audioPath = matched[1];
      }

      if (!audioPath) {
        return res.status(404).json({ success: false, error: "Direct audio stream link not found on this track page" });
      }

      const directAudioUrl = audioPath.startsWith("http")
        ? audioPath
        : `${BASE_URL}${encodeURI(audioPath)}`;

      let thumbnail = $("meta[property='og:image']").attr("content") || $("div.relative img.z-10").attr("src");
      if (thumbnail && !thumbnail.startsWith("http")) {
        thumbnail = `${BASE_URL}${thumbnail}`;
      }

      let artist = "Unknown Artist";
      $("div.space-y-3 div").each((_, row) => {
        const label = $(row).find("span.text-gray-500").text().trim().toLowerCase();
        const val = $(row).find("span.text-gray-200, span.text-sky-400").text().trim();
        if (label.includes("artist")) artist = val;
      });

      return res.json({
        success: true,
        title,
        artist,
        thumbnail: thumbnail || null,
        downloadUrl: directAudioUrl,
        pageUrl,
        mimeType: "audio/mpeg",
        format: "MP3"
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "SLMix DL Failed: " + err.message });
    }
  }
};
