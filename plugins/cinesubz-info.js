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

      const response = await axios.get(`${NEW_CINE_API}/qualities`, {
        params: { url: targetUrl.trim() },
        timeout: 30000
      });

      const data = response.data;
      if (!data || !data.success) {
        return res.status(500).json({
          success: false,
          error: data?.error || "Failed to fetch details from upstream API"
        });
      }

      const movie = data.movie || {};
      const details = movie.details || {};
      const rawDownloads = Array.isArray(data.downloads) ? data.downloads : [];

      const downloadLinks = rawDownloads.map((item) => ({
        label: item.label || item.quality || "Quality",
        quality: item.quality || item.label || "Quality",
        size: item.size || null,
        language: item.language || null,
        ztUrl: item.ztUrl || null,
        driveUrl: item.driveUrl || null,
        pageUrl: item.ztUrl || targetUrl.trim(),
        directUrl: item.driveUrl || item.ztUrl
      }));

      return res.json({
        success: true,
        title: movie.title || "Title",
        tagline: movie.tagline || null,
        url: movie.url || targetUrl.trim(),
        poster: movie.poster || FALLBACK_IMG,
        backdrop: movie.backdrop || null,
        synopsis: movie.synopsis || null,
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
        cast: Array.isArray(movie.cast) ? movie.cast : [],
        gallery: Array.isArray(movie.gallery) ? movie.gallery : [],
        totalQualities: downloadLinks.length,
        downloadLinks,
        downloads: rawDownloads
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Failed to scrape content details: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
