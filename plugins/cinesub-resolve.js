const BASE_URL = 'https://cinesub.lk';
const FIREBASE_BUCKET = 'cinezubz.firebasestorage.app';

module.exports = {
  name: "CineSub · Resolve Links",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesub/resolve",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Dedicated Proxy Force Auto-Download Streamer ──────────────────
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `CineSub_${Date.now()}.bin`;

        let contentType = "application/octet-stream";
        if (fileName.endsWith(".vtt")) contentType = "text/vtt";
        else if (fileName.endsWith(".mp4")) contentType = "video/mp4";

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");

        return gotScraping.stream(streamTargetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": `${BASE_URL}/`
          }
        }).pipe(res);
      }

      // ── 2. Link & Subtitle Existence Resolver ────────────────────────────
      const tmdbId = req.query.tmdbId || req.query.id;
      let slug = req.query.slug || "";
      let pageUrl = req.query.url || "";

      if (!tmdbId) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'tmdbId' is required."
        });
      }

      if (!pageUrl && slug) {
        pageUrl = `${BASE_URL}/${slug}`;
      }

      let token = null;

      if (pageUrl) {
        try {
          const pageRes = await gotScraping.get(pageUrl, {
            headers: {
              'Referer': `${BASE_URL}/`,
              'Origin': BASE_URL
            },
            responseType: 'text',
            timeout: { request: 8000 }
          });

          const html = pageRes.body;
          const tokenMatch = html.match(/token=([a-f0-9\-]{36})/i) || html.match(/token=([a-f0-9\-]+)/i);
          if (tokenMatch) {
            token = tokenMatch[1];
          }
        } catch (_) {}
      }

      // Spider-Man (2002) TMDB fallback
      if (!token && String(tmdbId) === '557') {
        token = 'af5c973c-3a2a-4938-ba6a-72ce86057df1';
      }

      const potentialSubUrl = token
        ? `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tmdbId}.vtt?alt=media&token=${token}`
        : `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tmdbId}.vtt?alt=media`;

      // Check Subtitle existence
      let hasSub = false;
      try {
        const headRes = await gotScraping.head(potentialSubUrl, {
          throwHttpErrors: false,
          timeout: { request: 6000 }
        });
        hasSub = headRes.statusCode === 200;
      } catch (_) {
        hasSub = false;
      }

      const encodedFallback = encodeURIComponent(`https://cinesub.lk/player-fallback?to=${encodeURIComponent(pageUrl || BASE_URL)}`);

      let rawPlayerUrl = "";
      if (hasSub) {
        const encodedSub = encodeURIComponent(potentialSubUrl);
        rawPlayerUrl = `https://vidlink.pro/movie/${tmdbId}?sub_file=${encodedSub}&sub_label=Sinhala&fallback_url=${encodedFallback}`;
      } else {
        rawPlayerUrl = `https://vidlink.pro/movie/${tmdbId}?fallback_url=${encodedFallback}`;
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // ── අපගේම Domain Gateway එක හරහා Direct Auto-Download වෙන Links ──
      const autoDownloadSubUrl = hasSub
        ? `${currentHost}/api/v1/movies/cinesub/resolve?stream=${encodeURIComponent(potentialSubUrl)}&filename=CineSub_${tmdbId}_Sinhala.vtt${apiKeyParam}`
        : null;

      return res.json({
        success: true,
        tmdbId: String(tmdbId),
        pageUrl: pageUrl || null,
        hasSinhalaSubtitle: hasSub,
        statusMessage: hasSub ? "සිංහල උපසිරැසි (Sinhala Subtitle) පවතී." : "මෙම චිත්‍රපටය සඳහා සිංහල උපසිරැසි (Subtitle) නොමැත.",
        downloads: {
          subtitleVttUrl: autoDownloadSubUrl, // Direct auto download .vtt file
          rawSubtitleUrl: hasSub ? potentialSubUrl : null
        },
        player: {
          webPlayerUrl: rawPlayerUrl
        }
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "CineSub Resolve Failed: " + err.message
      });
    }
  }
};
