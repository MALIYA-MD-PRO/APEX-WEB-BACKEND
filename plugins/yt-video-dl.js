const axios = require("axios");
const crypto = require("crypto");
const yts = require("yt-search");

const SAVETUBE_KEY = Buffer.from("C5D58EF67A7584E4A29F6C35BBC4EB12", "hex");

function decryptSaveTube(encryptedData) {
  const rawBuffer = Buffer.from(encryptedData.replace(/\s/g, ""), "base64");
  const iv = rawBuffer.subarray(0, 16);
  const data = rawBuffer.subarray(16);
  const decipher = crypto.createDecipheriv("aes-128-cbc", SAVETUBE_KEY, iv);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8"));
}

async function fetchSaveTubeQualityUrl(cdnHost, videoId, downloadKey, quality) {
  try {
    const dlRes = await axios.post(
      `https://${cdnHost}/download`,
      {
        id: videoId,
        key: downloadKey,
        downloadType: "video",
        quality: String(quality)
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );
    if (dlRes.data?.status && dlRes.data?.data?.downloadUrl) {
      return dlRes.data.data.downloadUrl;
    }
  } catch (e) {
    return null;
  }
  return null;
}

module.exports = {
  name: "YouTube Video DL (All Qualities)",
  category: "media",
  method: "GET",
  path: "/api/v1/media/yt/video",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) return res.status(400).json({ success: false, error: "Parameter 'q' is required" });

      let targetUrl = query;
      if (!/(youtube\.com|youtu\.be)/i.test(query)) {
        const s = await yts(query);
        if (!s?.videos?.length) return res.status(404).json({ success: false, error: "No video found" });
        targetUrl = s.videos[0].url;
      }

      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0 Safari/537.36",
        Origin: "https://ytshortdown.com",
        Referer: "https://ytshortdown.com/"
      };

      const cdnRes = await axios.get("https://media.savetube.vip/api/random-cdn", { headers, timeout: 15000 });
      const cdnHost = cdnRes.data?.cdn;
      if (!cdnHost) throw new Error("Could not acquire SaveTube CDN host");

      const infoRes = await axios.post(`https://${cdnHost}/v2/info`, { url: targetUrl }, { headers, timeout: 20000 });
      const decrypted = decryptSaveTube(infoRes.data.data);
      const videoId = decrypted.id;
      const downloadKey = decrypted.key;

      // 480p, 720p, 1080p එකවර resolve කිරීම
      const qualities = ["480", "720", "1080"];
      const resolvedQualities = await Promise.all(
        qualities.map(async (q) => ({
          quality: `${q}p`,
          url: await fetchSaveTubeQualityUrl(cdnHost, videoId, downloadKey, q)
        }))
      );

      res.json({
        success: true,
        title: decrypted.title,
        videoId: decrypted.id,
        duration: decrypted.durationLabel,
        thumbnail: decrypted.thumbnail,
        downloads: resolvedQualities.filter(item => item.url !== null),
        expiresIn: 3600
      });
    } catch (err) {
      res.status(500).json({ success: false, error: "YouTube MP4 resolve failed: " + err.message });
    }
  }
};