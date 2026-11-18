const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "https://puka-cine-production.up.railway.app").replace(/\/+$/, "");
const FALLBACK_IMG = "https://github.com/MALIYA-MD-PRO/images/blob/main/Gemini_Generated_Image_ljlmxoljlmxoljlm%20(1).jpg?raw=true";

module.exports = {
  name: "CineSubz Info",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/info",
  handler: async (req, res) => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required" });
      }

      const cleanUrl = targetUrl.trim();
      const response = await axios.get(`${NEW_CINE_API}/info`, {
        params: { url: cleanUrl },
        timeout: 35000
      });

      const data = response.data;
      if (!data || !data.success) {
        return res.status(500).json({
          success: false,
          error: data?.error || "Failed to fetch details from upstream API"
        });
      }

      const content = data.movie || data.tvshow || data.show || data.data || {};
      const details = content.details || {};
      const rawDownloads = Array.isArray(data.downloads) ? data.downloads : [];
      const rawSeasons = Array.isArray(data.seasons)
        ? data.seasons
        : Array.isArray(content.seasons)
        ? content.seasons
        : [];

      const isTvShow =
        data.type === "tvshow" ||
        rawSeasons.length > 0 ||
        cleanUrl.includes("/tvshows/") ||
        cleanUrl.includes("/series/");

      const downloadLinks = rawDownloads.map((item) => ({
        label: item.label || item.quality || "Quality",
        quality: item.quality || item.label || "Quality",
        size: item.size || null,
        language: item.language || null,
        ztUrl: item.ztUrl || null,
        driveUrl: item.driveUrl || null,
        pageUrl: item.ztUrl || cleanUrl,
        directUrl: item.driveUrl || item.ztUrl
      }));

      const seasons = rawSeasons.map((s, idx) => {
        const seasonNum = s.season || s.seasonNumber || idx + 1;
        const seasonUrl =
          s.url ||
          s.seasonUrl ||
          `${cleanUrl.replace(/\/+$/, "")}/?season=${seasonNum}`;

        return {
          season: seasonNum,
          title: s.title || s.name || `Season ${seasonNum}`,
          episodeCount: s.episodeCount || (Array.isArray(s.episodes) ? s.episodes.length : null),
          url: seasonUrl,
          episodes: Array.isArray(s.episodes) ? s.episodes : undefined
        };
      });

      return res.json({
        success: true,
        type: isTvShow ? "tvshow" : "movie",
        title: content.title || data.title || "Title",
        tagline: content.tagline || null,
        url: content.url || cleanUrl,
        poster: content.poster || data.poster || FALLBACK_IMG,
        backdrop: content.backdrop || null,
        synopsis: content.synopsis || data.synopsis || null,
        details: {
          imdbId: details.imdbId || null,
          imdbRating: details.imdbRating || null,
          siteRating: details.siteRating || null,
          quality: details.quality || null,
          releaseDate: details.releaseDate || null,
          year: details.year || null,
          duration: details.duration || null,
          director: details.director || null,
          subtitleBy: details.subtitleBy || null,
          country: details.country || null,
          genres: Array.isArray(details.genres) ? details.genres : []
        },
        cast: Array.isArray(content.cast) ? content.cast : [],
        gallery: Array.isArray(content.gallery) ? content.gallery : [],
        ...(isTvShow
          ? {
              totalSeasons: seasons.length,
              seasons
            }
          : {
              totalQualities: downloadLinks.length,
              downloadLinks,
              downloads: rawDownloads
            })
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Failed to scrape content details: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
