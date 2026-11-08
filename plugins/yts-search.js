const BASE_URL = "https://en.yts-official.com";

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": `${BASE_URL}/`,
  "Accept": "application/json"
};

module.exports = {
  name: "YTS Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/yts/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      const mode = req.query.mode || "movie";

      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const searchUrl = `${BASE_URL}/?api=search&mode=${encodeURIComponent(mode)}&q=${encodeURIComponent(query.trim())}&page=1`;
      const response = await fetch(searchUrl, { headers: defaultHeaders });

      if (!response.ok) {
        throw new Error(`Upstream returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawResults = data.results || [];

      const results = rawResults.map((item) => {
        // Title එකේ ඇති colon (:) ඇතුළු නියම නම එලෙසම තබා ගැනීම
        const exactTitle = item.title || item.name || "Unknown";
        const date = item.release_date || item.first_air_date || "";
        const year = date ? date.slice(0, 4) : "";
        const rating = item.vote_average ? Number(item.vote_average.toFixed(1)) : 0;
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
        const backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null;

        // Title එකේ colon (:) ආරක්ෂා වන පරිදි encode කර URL එක සෑදීම
        const apexUrl = `https://apex-api-pro.vercel.app/yts?title=${encodeURIComponent(exactTitle)}`;

        return {
          id: item.id,
          title: exactTitle, // "Spider-Man: Brand New Day"
          year,
          mediaType: item.media_type || mode,
          rating,
          votes: item.vote_count || 0,
          overview: item.overview || "",
          poster,
          backdrop,
          apexUrl,
          dlEndpoint: `/api/v1/movies/yts/dl?url=${encodeURIComponent(apexUrl)}`
        };
      });

      return res.json({
        success: true,
        query,
        mode,
        total: results.length,
        results
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "YTS Search Failed: " + err.message });
    }
  }
};
