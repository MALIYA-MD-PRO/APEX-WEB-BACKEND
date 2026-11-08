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
      const inputUrl = req.query.url || "";
      let movieId = req.query.id || "";
      let title = req.query.title || req.query.name || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // 1. URL එකක් ලබා දී ඇත්නම් එයින් Movie ID එක Extract කරගැනීම
      if (inputUrl) {
        // ?id=12345 හෝ &=id12345 හෝ id=12345 ආදී formats සියල්ලටම support කරයි
        const idMatch = inputUrl.match(/id[=:]?(\d+)/i);
        if (idMatch) {
          movieId = idMatch[1];
        }
      }

      // 2. Movie ID එක තිබේ නම් TMDB/YTS API එකෙන් Title සහ Year නිවැරදිව සොයා ගැනීම
      if (movieId && (!title || !year)) {
        try {
          const detailUrl = `${BASE_URL}/?api=detail&mode=${encodeURIComponent(mode)}&id=${encodeURIComponent(movieId)}`;
          const detailRes = await fetch(detailUrl, { headers: defaultHeaders });
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData && (detailData.title || detailData.name)) {
              title = detailData.title || detailData.name;
              const date = detailData.release_date || detailData.first_air_date || "";
              year = date ? date.slice(0, 4) : "";
            }
          }
        } catch (detailErr) {
          console.warn("[YTS Detail Fetch Skipped]:", detailErr.message);
        }
      }

      // Year parameter එකේ {year} වැනි placeholders ඇත්නම් ඉවත් කිරීම
      if (year && (year.includes("{") || year.includes("api=") || isNaN(parseInt(year, 10)))) {
        const matchYear = String(year).match(/\b(19\d\d|20\d\d)\b/);
        year = matchYear ? matchYear[1] : "";
      }

      if (!title) {
        return res.status(400).json({ 
          success: false, 
          error: "Could not resolve movie. Please pass 'url' (e.g. https://apex-api-pro.vercel.app/yts?id=12345), 'id', or 'title'." 
        });
      }

      // 3. Primary Torrent Fetch: Title සහ Year සමඟ
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=${encodeURIComponent(year.trim())}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });

      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // 4. Secondary Fallback: Year එක නිසා torrents නොලැබුණහොත් Title එකෙන් පමණක් සෙවීම
      if (hits.length === 0 && year) {
        const fallbackUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=&quality=all`;
        const fbRes = await fetch(fallbackUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
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
