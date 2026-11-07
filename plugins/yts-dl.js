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
      let title = req.query.title || req.query.name || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // 1. Search එකෙන් ලැබුණු ආවේණික token එක ලබා දී ඇත්නම් එයින් දත්ත කියවීම
      if (req.query.token) {
        try {
          const decoded = JSON.parse(Buffer.from(req.query.token, "base64url").toString("utf-8"));
          if (decoded.title) title = decoded.title;
          if (decoded.year) year = decoded.year;
          if (decoded.mode) mode = decoded.mode;
        } catch (e) {
          return res.status(400).json({ success: false, error: "Invalid token provided" });
        }
      }

      // Year parameter එකේ {year} වැනි placeholder හෝ වැරදි අගයන් ඇත්නම් පිරිසිදු කිරීම
      if (year && (year.includes("{") || year.includes("api=") || isNaN(parseInt(year, 10)))) {
        const matchYear = String(year).match(/\b(19\d\d|20\d\d)\b/);
        year = matchYear ? matchYear[1] : "";
      }

      if (!title) {
        return res.status(400).json({ success: false, error: "Parameter 'token' or 'title' is required" });
      }

      // Primary Search: Title සහ Year සමඟ
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(title.trim())}&year=${encodeURIComponent(year.trim())}&quality=all`;
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });

      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // Secondary Fallback: Year එක නිසා torrents නොලැබුණහොත් title එකෙන් පමණක් සෙවීම
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
        totalTorrents: torrents.length,
        torrents
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "YTS Torrent Fetch Failed: " + err.message });
    }
  }
};
