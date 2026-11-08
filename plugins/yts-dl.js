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

module.exports = {
  name: "YTS Torrents & Magnets",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/yts/dl",
  handler: async (req, res) => {
    try {
      // 1. ලැබෙන ඕනෑම query parameter එකකින් input එක ලබා ගැනීම
      let movieId = req.query.id || "";
      let rawUrl = req.query.url || "";
      let title = req.query.title || req.query.name || req.query.q || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // Original URL එකෙන් හෝ query parameters වලින් Movie ID එක extract කර ගැනීම
      const fullOriginalUrl = req.originalUrl || "";
      
      if (!movieId) {
        // req.originalUrl එකේ id= හෝ id< ඇත්නම් එය සෙවීම
        const match = fullOriginalUrl.match(/id[=:<%3D]?\s*(\d+)/i) || rawUrl.match(/id[=:<%3D]?\s*(\d+)/i);
        if (match) {
          movieId = match[1];
        } else if (rawUrl && /^\d+$/.test(rawUrl.trim())) {
          movieId = rawUrl.trim();
        } else if (title && /^\d+$/.test(title.trim())) {
          movieId = title.trim();
          title = "";
        }
      }

      // ID එකක් නැතිව raw URL එකක් හෝ title එකක් පමණක් ආවේ නම් title එක පිරිසිදු කිරීම
      if (!movieId && !title && rawUrl && !rawUrl.startsWith("http")) {
        title = rawUrl.trim();
      }

      // 2. Movie ID එකක් තිබේ නම් TMDB / YTS Detail API එකෙන් සැබෑ Title සහ Year ලබා ගැනීම
      if (movieId) {
        try {
          const detailUrl = `${BASE_URL}/?api=detail&mode=${encodeURIComponent(mode)}&id=${encodeURIComponent(movieId)}`;
          const detailRes = await fetch(detailUrl, { headers: defaultHeaders });
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData) {
              title = detailData.title || detailData.name || title;
              const date = detailData.release_date || detailData.first_air_date || "";
              if (date) year = date.slice(0, 4);
            }
          }
        } catch (detailErr) {
          console.warn("[YTS Detail Fetch Error]:", detailErr.message);
        }
      }

      // Year parameter එකේ {year} placeholders හෝ අක්‍රමිකතා පිරිසිදු කිරීම
      if (year && (year.includes("{") || year.includes("api=") || isNaN(parseInt(year, 10)))) {
        const matchYear = String(year).match(/\b(19\d\d|20\d\d)\b/);
        year = matchYear ? matchYear[1] : "";
      }

      // Title එක තවමත් සොයාගත නොහැකි නම් Error එකක් යැවීම
      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Could not resolve movie. Provide a valid 'url', 'id', or 'title'."
        });
      }

      // 3. Torrents සෙවීම (Title සහ Year සමඟ)
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });
      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // Fallback 1: Year එක නිසා torrents නොලැබුණහොත් Title එකෙන් පමණක් සෙවීම
      if (hits.length === 0 && year) {
        const fbUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title)}&year=&quality=all`;
        const fbRes = await fetch(fbUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
        }
      }

      // Fallback 2: Title එකේ Colon (:) ඇත්නම් ප්‍රධාන නමෙන් සෙවීම (e.g. "Avatar: The Way of Water" -> "Avatar")
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
