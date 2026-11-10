const https = require("https");

const BASE_URL = 'https://cinesub.lk';
const FIREBASE_BUCKET = 'cinezubz.firebasestorage.app';
const TMDB_API_KEY = '8265bd1679663a7ea12ac168da84d2e8';

// Native HTTPS මඟින් Firebase එකෙන් කෙලින්ම Subtitle එක Fetch කරගැනීම
function fetchFirebaseBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Redirects හැසිරවීම (301, 302, 307)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchFirebaseBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Firebase returned status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

module.exports = {
  name: "CineSub · Resolve Links",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesub/resolve",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Dedicated Direct Subtitle Downloader ──────────────────────────
      // tmdbId හෝ subUrl හරහා සෘජුවම බාගත කිරීම
      if (req.query.download === "sub" || req.query.stream) {
        let targetSubUrl = "";

        if (req.query.subUrl) {
          targetSubUrl = decodeURIComponent(req.query.subUrl);
        } else if (req.query.tmdbId) {
          const tId = req.query.tmdbId;
          const token = req.query.token || (String(tId) === '557' ? 'af5c973c-3a2a-4938-ba6a-72ce86057df1' : '');
          targetSubUrl = token
            ? `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tId}.vtt?alt=media&token=${token}`
            : `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tId}.vtt?alt=media`;
        } else if (req.query.stream) {
          targetSubUrl = decodeURIComponent(req.query.stream);
        }

        const fileName = req.query.filename || `CineSub_${req.query.tmdbId || Date.now()}_Sinhala.vtt`;

        try {
          const subBuffer = await fetchFirebaseBuffer(targetSubUrl);

          if (!subBuffer || subBuffer.length === 0) {
            return res.status(404).send("Subtitle content empty.");
          }

          // Force Download Headers
          res.setHeader("Content-Type", "text/vtt; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
          res.setHeader("Content-Length", subBuffer.length);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "public, max-age=86400");

          return res.end(subBuffer);
        } catch (streamErr) {
          return res.status(502).send("Failed to stream subtitle: " + streamErr.message);
        }
      }

      // ── 2. Parameter Normalization ────────────────────────────────────────
      let inputParam = (req.query.tmdbId || req.query.id || req.query.url || req.query.slug || "").trim();

      if (!inputParam) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'tmdbId' or 'url' is required."
        });
      }

      let tmdbId = "";
      let pageUrl = "";
      let slug = "";

      if (inputParam.startsWith("http://") || inputParam.startsWith("https://")) {
        pageUrl = inputParam;
        const urlObj = new URL(pageUrl);
        slug = urlObj.pathname.replace(/^\/|\/$/g, "");
      } else if (isNaN(Number(inputParam))) {
        slug = inputParam;
        pageUrl = `${BASE_URL}/${slug}`;
      } else {
        tmdbId = inputParam;
      }

      // ── 3. Page Scrape & Token Resolver ──────────────────────────────────
      let token = null;

      if (pageUrl) {
        try {
          const pageRes = await gotScraping.get(pageUrl, {
            headers: {
              'Referer': `${BASE_URL}/`,
              'Origin': BASE_URL
            },
            responseType: 'text',
            timeout: { request: 9000 }
          });

          const html = pageRes.body;
          const tokenMatch = html.match(/token=([a-f0-9\-]{36})/i) || html.match(/token=([a-f0-9\-]+)/i);
          if (tokenMatch) {
            token = tokenMatch[1];
          }

          if (!tmdbId) {
            const tmdbMatch = html.match(/vidlink\.pro\/movie\/(\d+)/i) || html.match(/\/movie\/(\d+)/i);
            if (tmdbMatch) {
              tmdbId = tmdbMatch[1];
            }
          }
        } catch (_) {}
      }

      // TMDB search fallback using slug
      if (!tmdbId && slug) {
        try {
          const cleanName = slug
            .replace(/-sinhala-subtitles/i, "")
            .replace(/-\d{4}$/, "")
            .replace(/-/g, " ");

          const yearMatch = slug.match(/\b(19\d\d|20\d\d)\b/);
          const year = yearMatch ? yearMatch[1] : "";

          const tmdbSearchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanName)}&year=${year}`;
          const searchRes = await gotScraping.get(tmdbSearchUrl, { responseType: 'json', timeout: { request: 6000 } });
          const firstResult = searchRes.body?.results?.[0];
          if (firstResult) {
            tmdbId = String(firstResult.id);
          }
        } catch (_) {}
      }

      // Spider-Man (2002) fallback token
      if (!token && String(tmdbId) === '557') {
        token = 'af5c973c-3a2a-4938-ba6a-72ce86057df1';
      }

      if (!tmdbId) {
        return res.status(404).json({
          success: false,
          error: "Could not resolve a valid TMDB ID."
        });
      }

      // ── 4. Firebase Subtitle Verification ─────────────────────────────────
      const potentialSubUrl = token
        ? `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tmdbId}.vtt?alt=media&token=${token}`
        : `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_BUCKET}/o/sinhala_subtitles%2Fmovies%2F${tmdbId}.vtt?alt=media`;

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

      const encodedFallback = encodeURIComponent(`https://cinesub.lk/player-fallback?to=${encodeURIComponent(pageUrl || `${BASE_URL}/`)}`);

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
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";

      // පිරිසිදු, කිසිදා නොකැඩෙන අපගේම Direct Download Link එක
      const cleanDownloadUrl = hasSub
        ? `${currentHost}/api/v1/movies/cinesub/resolve?download=sub&tmdbId=${tmdbId}${tokenParam}&filename=CineSub_${tmdbId}_Sinhala.vtt${apiKeyParam}`
        : null;

      return res.json({
        success: true,
        tmdbId: String(tmdbId),
        pageUrl: pageUrl || `${BASE_URL}/`,
        hasSinhalaSubtitle: hasSub,
        statusMessage: hasSub ? "සිංහල උපසිරැසි (Sinhala Subtitle) පවතී." : "මෙම චිත්‍රපටය සඳහා සිංහල උපසිරැසි (Subtitle) නොමැත.",
        downloads: {
          DirectDownloadSubtitleUrl: cleanDownloadUrl,
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
