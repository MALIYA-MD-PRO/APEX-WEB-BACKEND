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
      const rawUrlParam = req.query.url ? decodeURIComponent(req.query.url) : "";
      const rawFullUrl = req.originalUrl ? decodeURIComponent(req.originalUrl) : "";
      let title = req.query.title || req.query.name || req.query.q || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // 1. URL එකෙන් Title එක ලබා ගැනීම (e.g. ?title=Spider-Man... හෝ name=...)
      if (!title) {
        const titleMatch = rawUrlParam.match(/title=([^&]+)/i) || rawFullUrl.match(/title=([^&]+)/i);
        if (titleMatch) {
          title = decodeURIComponent(titleMatch[1]).trim();
        } else if (rawUrlParam && !rawUrlParam.startsWith("http")) {
          title = rawUrlParam.trim();
        }
      }

      // Year placeholders ඇත්නම් ඉවත් කිරීම
      if (year && (year.includes("{") || year.includes("api=") || isNaN(parseInt(year, 10)))) {
        const matchYear = String(year).match(/\b(19\d\d|20\d\d)\b/);
        year = matchYear ? matchYear[1] : "";
      }

      if (!title) {
        return res.status(400).json({
          success: false,
          error: "Movie title not found. Provide a valid 'url' with ?title=... or direct 'title' parameter."
        });
      }

      // 2. YTS වෙතින් Torrents සෙවීම
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=${encodeURIComponent(year.trim())}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });
      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // Fallback 1: Year එක නිසා hits 0 වුවහොත් Title එකෙන් පමණක් සෙවීම
      if (hits.length === 0 && year) {
        const fbUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=&quality=all`;
        const fbRes = await fetch(fbUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
        }
      }

      // Fallback 2: Title එකේ Colon (:) ඇත්නම් ප්‍රධාන නමෙන් සෙවීම (e.g. "Spider-Man: Brand New Day" -> "Spider-Man Brand New Day")
      if (hits.length === 0 && title.includes(":")) {
        const cleanTitle = title.replace(/:/g, "").trim();
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
        totalTorrents: torrents.length,
        torrents
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "YTS Torrent Fetch Failed: " + err.message });
    }
  }
};
