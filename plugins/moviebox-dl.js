const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";
const CDN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Referer": "https://123moviesfree.club/",
  "Origin": "https://123moviesfree.club"
};

module.exports = {
  name: "MovieBox · Streams & Subtitles DL",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/dl",
  handler: async (req, res) => {
    try {
      // ── 1. Dedicated Proxy Force Auto-Download Gateway (Bypasses CDN Referer Block) ──
      if (req.query.stream) {
        const targetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `MovieBox_${Date.now()}.mp4`;
        const isSubtitle = fileName.endsWith(".srt") || fileName.endsWith(".vtt");

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", isSubtitle ? "application/x-subrip; charset=utf-8" : "video/mp4");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=86400");

        const cdnStream = await axios({
          method: "GET",
          url: targetUrl,
          responseType: "stream",
          headers: CDN_HEADERS,
          timeout: 30000
        });

        if (cdnStream.headers["content-length"]) {
          res.setHeader("Content-Length", cdnStream.headers["content-length"]);
        }

        return cdnStream.data.pipe(res);
      }

      // ── 2. Fetch Streams & Subtitles Metadata ────────────────────────────
      const subjectId = (req.query.id || req.query.subject_id || "").trim();
      const season = parseInt(req.query.se || req.query.season, 10) || 0;
      const episode = parseInt(req.query.ep || req.query.episode, 10) || 0;

      if (!subjectId) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id' (subject_id) is required"
        });
      }

      const [streamRes, captionRes] = await Promise.allSettled([
        axios.get(`${UPSTREAM_BASE}/api/stream/${encodeURIComponent(subjectId)}`, {
          params: { se: season, ep: episode },
          timeout: 15000
        }),
        axios.get(`${UPSTREAM_BASE}/api/stream/${encodeURIComponent(subjectId)}/captions`, {
          params: { se: season, ep: episode },
          timeout: 12000
        })
      ]);

      if (streamRes.status === "rejected") {
        const errObj = streamRes.reason;
        return res.status(errObj.response?.status || 500).json({
          success: false,
          error: "Failed to fetch streams: " + (errObj.response?.data?.detail || errObj.message)
        });
      }

      const streamData = streamRes.value.data;
      const captionData = captionRes.status === "fulfilled" ? captionRes.value.data : { captions: [] };

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";
      const epTag = season > 0 ? `_S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` : "";

      // Filter & Map Video Streams
      const streams = (streamData.streams || []).map((s) => {
        const isMp4 = s.format === "MP4";
        const fileName = `MovieBox_${subjectId}${epTag}_${s.quality_value || "HD"}p.mp4`;

        return {
          quality: s.quality,
          qualityValue: s.quality_value,
          format: s.format,
          sizeMB: s.size_mb || 0,
          codec: s.codec,
          durationSeconds: s.duration_sec || null,
          directUrl: s.url,
          requiredHeaders: s.headers || CDN_HEADERS,
          autoDownloadUrl: isMp4
            ? `${currentHost}/api/v1/movies/moviebox/dl?stream=${encodeURIComponent(s.url)}&filename=${fileName}${apiKeyParam}`
            : null
        };
      });

      // Map Subtitles (.srt)
      const subtitles = (captionData.captions || []).map((c) => {
        const subFileName = `MovieBox_${subjectId}${epTag}_${c.code || "sub"}.srt`;
        return {
          id: c.id,
          language: c.language,
          code: c.code,
          sizeBytes: c.size || null,
          directUrl: c.url,
          autoDownloadUrl: `${currentHost}/api/v1/movies/moviebox/dl?stream=${encodeURIComponent(c.url)}&filename=${subFileName}${apiKeyParam}`
        };
      });

      return res.json({
        success: true,
        subjectId: String(subjectId),
        season,
        episode,
        totalStreams: streams.length,
        streams,
        totalSubtitles: subtitles.length,
        subtitles
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "MovieBox DL Processing Failed: " + err.message
      });
    }
  }
};
