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

module.exports = {
  name: "YouTube Audio DL",
  category: "media",
  method: "GET",
  path: "/api/v1/media/yt/audio",
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36",
        Origin: "https://ytshortdown.com",
        Referer: "https://ytshortdown.com/"
      };

      const cdnRes = await axios.get("https://media.savetube.vip/api/random-cdn", { headers, timeout: 10000 });
      const cdnHost = cdnRes.data?.cdn;
      if (!cdnHost) throw new Error("Could not acquire SaveTube CDN host");

      const infoRes = await axios.post(`https://${cdnHost}/v2/info`, { url: targetUrl }, { headers, timeout: 15000 });
      const decrypted = decryptSaveTube(infoRes.data.data);

      const dlRes = await axios.post(`https://${cdnHost}/download`, {
        id: decrypted.id,
        key: decrypted.key,
        downloadType: "audio",
        quality: "128"
      }, { headers, timeout: 15000 });

      if (dlRes.data?.status && dlRes.data?.data?.downloadUrl) {
        return res.json({
          success: true,
          title: decrypted.title,
          videoId: decrypted.id,
          duration: decrypted.durationLabel,
          audioUrl: dlRes.data.data.downloadUrl,
          bitrate: "128kbps",
          mimeType: "audio/mp4",
          expiresIn: 3600
        });
      }

      throw new Error("Direct audio stream generation failed");
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};