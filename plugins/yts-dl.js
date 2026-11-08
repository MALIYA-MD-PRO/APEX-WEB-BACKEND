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
      let rawTitle = req.query.title || "";
      const rawUrl = req.query.url || req.originalUrl || "";
      let year = req.query.year || "";
      let mode = req.query.mode || "movie";

      // 1. URL එකෙන් හෝ query parameters වලින් exact title එක (with colon) ගැනීම
      if (!rawTitle && rawUrl) {
        const decodedUrl = decodeURIComponent(rawUrl);
        const match = decodedUrl.match(/title=([^&]+)/i);
        if (match) {
          rawTitle = match[1].trim();
        } else if (!rawUrl.startsWith("http")) {
          rawTitle = decodeURIComponent(rawUrl).trim();
        }
      }

      // Title එක පිරිසිදු කර exact string එක ගැනීම
      const exactTitle = rawTitle.trim();

      if (!exactTitle) {
        return res.status(400).json({
          success: false,
          error: "Movie title is required. Ensure 'title' parameter or 'url?title=...' is passed."
        });
      }

      // 2. YTS වෙතින් හරියටම එම නමෙන් Torrents සෙවීම
      const searchTargetName = encodeURIComponent(exactTitle);
      let torrentsUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${searchTargetName}&year=&quality=all`;
      
      let response = await fetch(torrentsUrl, { headers: defaultHeaders });
      let data = response.ok ? await response.json() : { hits: [] };
      let hits = data.hits || [];

      // 3. Fallback: Upstream YTS එක colon ලකුණ නිසා සොයා ගැනීමට අපොහොසත් වුවහොත් පමණක් space එකක් දමා සෙවීම
      if (hits.length === 0 && exactTitle.includes(":")) {
        const spaceTitle = encodeURIComponent(exactTitle.replace(/:/g, " ").replace(/\s+/g, " ").trim());
        const fbUrl = `${BASE_URL}/?api=torrents&mode=${encodeURIComponent(mode)}&name=${spaceTitle}&year=&quality=all`;
        const fbRes = await fetch(fbUrl, { headers: defaultHeaders });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          hits = fbData.hits || [];
        }
      }

      const torrents = hits.map((t, index) => ({
        index: index + 1,
        title: t.title || exactTitle,
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
        title: exactTitle, // හරියටම "Spider-Man: Brand New Day" ලෙසම return වේ
        year: year || null,
        totalTorrents: torrents.length,
        torrents
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "YTS Torrent Fetch Failed: " + err.message
      });
    }
  }
};
