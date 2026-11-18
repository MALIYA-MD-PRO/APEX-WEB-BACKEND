const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "https://puka-cine-production.up.railway.app").replace(/\/+$/, "");

module.exports = {
  name: "CineSubz Resolver",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/dl",
  handler: async (req, res) => {
    try {
      let targetUrl =
        req.query.url ||
        req.query.directUrl ||
        req.query.driveUrl ||
        req.query.ztUrl ||
        req.query.pageUrl;

      if (!targetUrl) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' (or 'directUrl', 'driveUrl', 'ztUrl') is required"
        });
      }

      try {
        targetUrl = decodeURIComponent(targetUrl).trim();
      } catch {
        targetUrl = String(targetUrl).trim();
      }

      const isSeasonBatch = /[?&]season=\d+/i.test(targetUrl);

      const response = await axios.get(`${NEW_CINE_API}/download`, {
        params: { url: targetUrl },
        timeout: isSeasonBatch ? 180000 : 75000
      });

      const data = response.data;
      if (!data || !data.success) {
        return res.status(500).json({
          success: false,
          error: data?.error || "Failed to resolve download link(s)"
        });
      }

      // 📺 Case 1: TV Show Season Link (?season=X)
      const rawEpisodes = Array.isArray(data.episodes)
        ? data.episodes
        : Array.isArray(data.results)
        ? data.results
        : null;

      if (isSeasonBatch || rawEpisodes) {
        const episodes = (rawEpisodes || []).map((ep, index) => ({
          episode: ep.episode || ep.episodeNumber || index + 1,
          title: ep.title || `Episode ${ep.episode || index + 1}`,
          quality: ep.quality || null,
          size: ep.size || null,
          driveUrl: ep.driveUrl || ep.ztUrl || null,
          directDownloadUrl: ep.downloadUrl || ep.directDownloadUrl || ep.url || null
        }));

        return res.json({
          success: true,
          type: "tvshow_season",
          season: data.season || (targetUrl.match(/[?&]season=(\d+)/i)?.[1] ?? null),
          seasonUrl: targetUrl,
          totalEpisodes: episodes.length,
          episodes,
          expiresIn: 3600
        });
      }

      // 🎬 Case 2: Single Movie Drive/ZT Link
      const directDownloadUrl = data.downloadUrl || data.directDownloadUrl;
      if (!directDownloadUrl) {
        return res.status(500).json({
          success: false,
          error: data?.error || "Failed to resolve direct R2 download link"
        });
      }

      return res.json({
        success: true,
        type: "movie",
        inputType: data.inputType || "driveUrl",
        driveUrl: data.driveUrl || targetUrl,
        directDownloadUrl,
        allLinks: [directDownloadUrl],
        expiresIn: 3600
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Resolve error: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
