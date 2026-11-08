const BASE_URL = "https://en.yts-official.com";

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": `${BASE_URL}/`,
  "Accept": "application/json"
};

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

// TMDB ID එකෙන් සැබෑ නම සහ වසර ලබා ගැනීමේ Helper function එක
async function resolveDetailsFromId(id) {
  try {
    // 1. Upstream YTS Detail endpoint
    const url1 = `${BASE_URL}/?api=detail&mode=movie&id=${id}`;
    const res1 = await fetch(url1, { headers: defaultHeaders });
    if (res1.ok) {
      const data = await res1.json();
      if (data && (data.title || data.name)) {
        const title = data.title || data.name;
        const date = data.release_date || data.first_air_date || "";
        const year = date ? date.slice(0, 4) : "";
        return { title, year };
      }
    }
  } catch (e) {}

  try {
    // 2. Public TMDB Fallback Mirror (ID lookup සඳහා)
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${id}?api_key=15d2ade7c014e3e4a017e4130a67a554`;
    const res2 = await fetch(tmdbUrl);
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2 && data2.title) {
        return {
          title: data2.title,
          year: data2.release_date ? data2.release_date.slice(0, 4) : ""
        };
      }
    }
  } catch (e) {}

  return null;
}

module.exports = {
  name: "YTS Torrents & Magnets",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/yts/dl",
  handler: async (req, res) => {
    try {
      // 1. Query parameters හෝ Full Raw URL එකෙන් Movie ID එක හඳුනා ගැනීම
      let movieId = req.query.id || "";
      let title = req.query.title || req.query.name || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // req.originalUrl එකේ හෝ query parameters වල අඩංගු URL එකෙන් id අගය සොයා ගැනීම
      const rawFullUrl = req.originalUrl || "";
      const urlParam = req.query.url || "";

      if (!movieId) {
        const idMatch = rawFullUrl.match(/id[=:<%3D]?\s*(\d+)/i) || urlParam.match(/id[=:<%3D]?\s*(\d+)/i);
        if (idMatch) {
          movieId = idMatch[1];
        } else if (/^\d+$/.test(urlParam.trim())) {
          movieId = urlParam.trim();
        } else if (/^\d+$/.test(title.trim())) {
          movieId = title.trim();
          title = "";
        }
      }

      // 2. Movie ID එකෙන් නිශ්චිත Title සහ Year එක සොයා ගැනීම
      if (movieId) {
        const resolved = await resolveDetailsFromId(movieId);
        if (resolved) {
          title = resolved.title;
          if (!year && resolved.year) year = resolved.year;
        }
      }

      // Title එකට URL එකක් ආවා නම් එය පිරිසිදු කිරීම
      if (!title && urlParam && !urlParam.startsWith("http")) {
        title = urlParam.trim();
      }

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Could not resolve movie. Provide a valid 'url', 'id', or 'title'."
        });
      }

      // 3. YTS වෙතින් Torrents සෙවීම
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });
      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // Fallback 1: Year එක නිසා hits 0 වුවහොත් Title එකෙන් පමණක් සෙවීම
      if (hits.length === 0 && year) {
        const fbUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title)}&year=&quality=all`;
        const fbRes = await fetch(fbUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
        }
      }

      // Fallback 2: Title එකේ Subtitles හෝ Colon (:) තිබේ නම් මුල් නමෙන් සෙවීම
      if (hits.length === 0 && title.includes(":")) {
        const cleanTitle = title.split(":")[0].trim();
        const fbUrl2 = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(cleanTitle)}&year=&quality=all`;
        const fbRes2 = await fetch(fbUrl2, { headers: defaultHeaders });
        if (fbRes2.ok) {
          const fbData2 = await fbRes2.json();
          hits = fbData2.hits || [];
        }
      }

      const torrents = hits.map((t, index) => ({
        index: index + 1,
        title: t.title || title,
        size: formatBytes(t.bytes),
        bytes: t.bytes || 0,
        seeds: t.seeds || 0,
        peers: t.peers || 0,
        source: t.source || "YTS",
        torrentUrl: t.url || null,
        magnetUrl: t.magnetUrl || null
      }));

      return res.json({
        success: true,
        title,
        year: year || null,
        movieId: movieId || null,
        totalTorrents: torrents.length,
        torrents
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "YTS Torrent Fetch Failed: " + err.message });
    }
  }
};
