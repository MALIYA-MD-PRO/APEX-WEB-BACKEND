const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "http://puka-cine-production.up.railway.app").replace(/\/+$/, "");

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
        timeout: 25000
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
      const isTvShow = Boolean(data.isTvShow || (Array.isArray(data.seasons) && data.seasons.length > 0));

      // Downloads mapping (පරණ format එකයි අලුත් details සියල්ලයි ඇතුළත්ව)
      const rawDownloads = Array.isArray(data.downloads) ? data.downloads : [];
      const downloadLinks = rawDownloads.map((item) => ({
        label: item.label || item.quality || "Quality",
        quality: item.quality || item.label || "Quality",
        size: item.size || null,
        language: item.language || null,
        ztUrl: item.ztUrl || null,
        driveUrl: item.driveUrl || null,
        pageUrl: item.ztUrl || targetUrl,
        directUrl: item.driveUrl || item.ztUrl
      }));

      const seasons = Array.isArray(data.seasons) ? data.seasons : [];

      return res.json({
        success: true,
        isTvShow,
        title: movie.title || "Title",
        tagline: movie.tagline || null,
        url: movie.url || targetUrl.trim(),
        poster: movie.poster || null,
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
          genres: Array.isArray(details.genres) ? details.genres : [],
          ...details // Upstream එකෙන් තවත් අමතර fields ආවොත් ඒවාත් ඉබේම එකතු වේ
        },
        cast: Array.isArray(movie.cast) ? movie.cast : [],
        gallery: Array.isArray(movie.gallery) ? movie.gallery : [],
        ...(isTvShow
          ? {
              totalSeasons: seasons.length,
              seasons
            }
          : {}),
        totalQualities: downloadLinks.length,
        downloadLinks,
        downloads: rawDownloads // අලුත් API එකේ raw downloads array එකත් ඒ විදියටම
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Failed to scrape content details: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
