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

// Search එකෙන් ලැබෙන TMDB ID එකෙන් සැබෑ නම සහ වසර ලබා ගැනීම
async function fetchDetailsFromTMDB(id) {
  try {
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${id}?api_key=15d2ade7c014e3e4a017e4130a67a554`;
    const res = await fetch(tmdbUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.title || data.original_title)) {
        const title = data.title || data.original_title;
        const year = data.release_date ? data.release_date.slice(0, 4) : "";
        return { title, year };
      }
    }
  } catch (err) {
    console.warn("[TMDB Lookup Error]:", err.message);
  }

  // Fallback upstream detail check
  try {
    const ytsDetailUrl = `${BASE_URL}/?api=detail&mode=movie&id=${id}`;
    const res2 = await fetch(ytsDetailUrl, { headers: defaultHeaders });
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2 && (data2.title || data2.name)) {
        const title = data2.title || data2.name;
        const year = data2.release_date ? data2.release_date.slice(0, 4) : "";
        return { title, year };
      }
    }
  } catch (err2) {}

  return null;
}

module.exports = {
  name: "YTS Torrents & Magnets",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/yts/dl",
  handler: async (req, res) => {
    try {
      // 1. Raw URL හෝ parameters කියවා ගැනීම
      const rawUrlParam = req.query.url ? decodeURIComponent(req.query.url) : "";
      const rawFullUrl = req.originalUrl ? decodeURIComponent(req.originalUrl) : "";
      let movieId = req.query.id || "";
      let title = req.query.title || req.query.name || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // 2. ID එක extract කරගැනීම (Search එකෙන් ආ apexUrl එකෙන් හෝ query එකෙන්)
      if (!movieId) {
        const match = rawUrlParam.match(/id=(\d+)/i) || rawFullUrl.match(/id=(\d+)/i);
        if (match) {
          movieId = match[1];
        } else if (/^\d+$/.test(rawUrlParam.trim())) {
          movieId = rawUrlParam.trim();
        } else if (title && /^\d+$/.test(title.trim())) {
          movieId = title.trim();
          title = "";
        }
      }

      // 3. Movie ID එක තිබේ නම් TMDB හරහා සැබෑ නම සහ වසර ලබා ගැනීම
      if (movieId) {
        const meta = await fetchDetailsFromTMDB(movieId);
        if (meta) {
          title = meta.title;
          if (!year && meta.year) year = meta.year;
        }
      }

      // URL එකක් නොවන සරල title එකක් ආවේ නම් එය භාවිත කිරීම
      if (!title && rawUrlParam && !rawUrlParam.startsWith("http")) {
        title = rawUrlParam.trim();
      }

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Could not resolve movie. Provide a valid 'url', 'id', or 'title'."
        });
      }

      // 4. Title සහ Year සමඟ YTS Torrents සෙවීම
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=${encodeURIComponent(year.trim())}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });
      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // Fallback 1: Year එක නිසා torrents නොලැබුණහොත් Title එකෙන් පමණක් සෙවීම
      if (hits.length === 0 && year) {
        const fbUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=&quality=all`;
        const fbRes = await fetch(fbUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
        }
      }

      // Fallback 2: Subtitle හෝ colon (:) ඉවත් කර ප්‍රධාන නමෙන් සෙවීම
      if (hits.length === 0 && title.includes(":")) {
        const mainTitle = title.split(":")[0].trim();
        const fbUrl2 = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(mainTitle)}&year=&quality=all`;
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
        movieId: movieId || null,
        title,
        year: year || null,
        totalTorrents: torrents.length,
        torrents
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "YTS Torrent Fetch Failed: " + err.message });
    }
  }
};
