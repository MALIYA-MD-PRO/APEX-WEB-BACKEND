const yts = require("yt-search");

module.exports = {
  name: "YouTube Search",
  category: "media",
  method: "GET",
  path: "/api/v1/media/yt/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) return res.status(400).json({ success: false, error: "Parameter 'q' is required" });

      const search = await yts(query);
      const results = (search.videos || []).slice(0, 10).map(v => ({
        title: v.title,
        videoId: v.videoId,
        url: v.url || `https://www.youtube.com/watch?v=${v.videoId}`,
        duration: v.timestamp,
        channel: v.author?.name || "Unknown",
        views: v.views || 0,
        thumbnail: v.thumbnail
      }));

      res.json({ success: true, query, total: results.length, results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};
