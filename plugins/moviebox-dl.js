const axios = require("axios");

const UPSTREAM_BASE = "https://moviebox-api-production-a558ac84.up.railway.app";
const CACHE_TTL_MS = 30 * 60 * 1000; // මිනිත්තු 30
const subCache = new Map();

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Referer": "https://123moviesfree.club/",
  "Origin": "https://123moviesfree.club"
};

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of subCache.entries()) {
    if (entry.expiresAt <= now) subCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  name: "MovieBox · Download",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/moviebox/dl",
  handler: async (req, res) => {
    try {
      // ── 1. Built-in 30-Minute Cached Subtitle Handler (?sub=en|si) ───────
      if (req.query.sub) {
        const subId = (req.query.id || "").trim();
        const lang = req.query.sub.trim().toLowerCase();
        const se = parseInt(req.query.se, 10) || 0;
        const ep = parseInt(req.query.ep, 10) || 0;

        if (!subId || (lang !== "en" && lang !== "si")) {
          return res.status(400).json({ success: false, error: "Invalid subtitle request" });
        }

        const cacheKey = `${subId}_${lang}_s${se}_e${ep}`;
        const now = Date.now();
        let srtContent = null;

        const cached = subCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          srtContent = cached.content;
        } else {
          const upstreamSubUrl = `${UPSTREAM_BASE}/sub/${encodeURIComponent(subId)}/${lang}.srt?se=${se}&ep=${ep}`;
          const subRes = await axios.get(upstreamSubUrl, {
            responseType: "text",
            timeout: 15000
          });
          srtContent = subRes.data;
          subCache.set(cacheKey, {
            content: srtContent,
            expiresAt: now + CACHE_TTL_MS
          });
        }

        const epTag = se > 0 ? `_S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")}` : "";
        const fileName = `Apex_${subId}${epTag}_${lang.toUpperCase()}.srt`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.send(srtContent);
      }

      // ── 2. Input Parsing (Movie ID OR Season Link) ───────────────────────
      let rawInput = (req.query.id || req.query.url || req.query.subject_id || "").trim();
      let season = parseInt(req.query.se || req.query.season, 10) || 0;

      if (!rawInput) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'id' (Movie ID or Season Link) is required"
        });
      }

      if (rawInput.startsWith("http://") || rawInput.startsWith("https://")) {
        try {
          const parsedUrl = new URL(rawInput);
          const urlId = parsedUrl.searchParams.get("id") || parsedUrl.searchParams.get("subject_id");
          const urlSe = parsedUrl.searchParams.get("se") || parsedUrl.searchParams.get("season");

          if (urlId) rawInput = urlId.trim();
          if (urlSe && !season) season = parseInt(urlSe, 10) || 0;

          if (!urlId) {
            const pathMatch = parsedUrl.pathname.match(/\/(?:dl|epi|detail|stream)\/(\d+)/);
            if (pathMatch) rawInput = pathMatch[1];
          }
        } catch (_) {}
      } else if (rawInput.includes("&") || rawInput.includes("=")) {
        const fakeParams = new URLSearchParams(rawInput.includes("=") ? rawInput : `id=${rawInput}`);
        const pId = fakeParams.get("id") || rawInput.split("&")[0];
        const pSe = fakeParams.get("se") || fakeParams.get("season");

        if (pId) rawInput = pId.trim();
        if (pSe && !season) season = parseInt(pSe, 10) || 0;
      }

      const subjectId = rawInput;
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const currentHost = `${protocol}://${req.get("host")}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const buildApexSubUrl = (rawSubUrl, lang, epNum) => {
        if (!rawSubUrl) return null;
        return `${currentHost}/api/v1/movies/moviebox/dl?id=${encodeURIComponent(subjectId)}&sub=${lang}&se=${season}&ep=${epNum}${apiKeyParam}`;
      };

      // ── CASE A: TV Series Season Download (season > 0) ───────────────────
      if (season > 0) {
        const { data } = await axios.get(`${UPSTREAM_BASE}/dl/${encodeURIComponent(subjectId)}`, {
          params: { se: season },
          timeout: 30000
        });

        const episodes = (data.episodes || []).map((epObj) => {
          const epNum = parseInt(epObj.episode, 10) || 0;
          const epDownloads = [];

          // 1. Upstream එකෙන් කෙලින්ම downloads හෝ streams array එකක් ආවොත්
          const existingList = epObj.downloads || epObj.streams;
          if (Array.isArray(existingList)) {
            existingList.forEach((item) => {
              const link = item.dl_link || item.link || item.url;
              if (link) {
                epDownloads.push({
                  quality: item.quality || "HD",
                  size: item.size || (item.size_mb ? `${item.size_mb} MB` : "Unknown"),
                  ...(item.cookie && { cookie: item.cookie }),
                  dl_link: link,
                  headers: item.headers || DEFAULT_HEADERS
                });
              }
            });
          }

          // 2. Object keys ලෙස ආවොත් ("1080p download", "720p", "480p_download" ආදී ඕනෑම format එකක්)
          Object.entries(epObj).forEach(([key, val]) => {
            if (!val || typeof val !== "object" || Array.isArray(val)) return;
            const link = val.link || val.dl_link || val.url;
            if (!link) return;

            const qMatch = key.match(/(\d{3,4}p|4k)/i);
            const qualityName = qMatch ? qMatch[1].toLowerCase() : key.replace(/download/i, "").trim();

            if (!epDownloads.some((d) => d.dl_link === link)) {
              epDownloads.push({
                quality: qualityName || "HD",
                size: val.size || (val.size_mb ? `${val.size_mb} MB` : "Unknown"),
                ...(val.cookie && { cookie: val.cookie }),
                dl_link: link,
                headers: val.headers || DEFAULT_HEADERS
              });
            }
          });

          // Quality අනුපිළිවෙළට සැකසීම (1080p -> 720p -> 480p -> 360p)
          epDownloads.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));

          const rawSi = epObj["sinhala subtitle"] || epObj.subtitles?.sinhala || null;
          const rawEn = epObj["english subtitle"] || epObj.subtitles?.english || null;

          return {
            episode: String(epObj.episode || String(epNum).padStart(2, "0")),
            downloads: epDownloads,
            subtitles: {
              sinhala: buildApexSubUrl(rawSi, "si", epNum),
              english: buildApexSubUrl(rawEn, "en", epNum)
            }
          };
        });

        return res.json({
          success: true,
          series: data.series || "TV Series",
          subject_id: String(subjectId),
          season: data.season || season,
          total_episodes: data.total_episodes || episodes.length,
          episodes
        });
      }

      // ── CASE B: Single Movie Download ────────────────────────────────────
      const { data } = await axios.get(`${UPSTREAM_BASE}/api/stream/${encodeURIComponent(subjectId)}`, {
        timeout: 15000
      });

      const downloads = (data.downloads || data.streams || []).map((d) => ({
        quality: d.quality,
        format: d.format,
        size: d.size || (d.size_mb ? `${d.size_mb} MB` : "Adaptive"),
        ...(d.cookie && { cookie: d.cookie }),
        dl_link: d.dl_link || d.url,
        headers: d.headers || DEFAULT_HEADERS
      }));

      const rawSubs = data.subtitles || {};
      const subtitles = {
        english: buildApexSubUrl(rawSubs.english, "en", 0),
        sinhala: buildApexSubUrl(rawSubs.sinhala, "si", 0)
      };

      return res.json({
        success: true,
        subject_id: String(data.subject_id || subjectId),
        title: data.title || "Movie",
        downloads,
        subtitles
      });
    } catch (err) {
      const rawErr = err.response?.data?.detail || err.response?.data?.message || err.message;
      return res.status(err.response?.status || 500).json({
        success: false,
        error: "MovieBox Download Failed: " + (typeof rawErr === "object" ? JSON.stringify(rawErr) : rawErr)
      });
    }
  }
};
