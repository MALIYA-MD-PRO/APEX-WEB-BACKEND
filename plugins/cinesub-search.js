const BASE_URL = 'https://cinesub.lk';
const TMDB_API_KEY = '8265bd1679663a7ea12ac168da84d2e8';

module.exports = {
  name: "CineSub · Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesub/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q || req.query.query;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const tmdbUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query.trim())}&page=1`;

      const response = await gotScraping.get(tmdbUrl, {
        responseType: "json",
        timeout: { request: 10000 }
      });

      const rawResults = response.body?.results || [];

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const results = rawResults.slice(0, 10).map((movie) => {
        const year = movie.release_date ? movie.release_date.split('-')[0] : '';
        const cleanTitle = movie.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        const slug = year ? `${cleanTitle}-${year}-sinhala-subtitles` : `${cleanTitle}-sinhala-subtitles`;
        const pageUrl = `${BASE_URL}/${slug}`;

        return {
          id: movie.id,
          title: movie.title,
          year: year || "N/A",
          displayTitle: `${movie.title} (${year || 'N/A'})`,
          overview: movie.overview || "",
          rating: movie.vote_average ? Number(movie.vote_average.toFixed(1)) : 0,
          poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
          backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : null,
          slug,
          pageUrl,
          resolveEndpoint: `${currentHost}/api/v1/movies/cinesub/resolve?tmdbId=${movie.id}&slug=${encodeURIComponent(slug)}${apiKeyParam}`
        };
      });

      return res.json({
        success: true,
        query: query.trim(),
        total: results.length,
        results
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "CineSub Search Failed: " + err.message
      });
    }
  }
};
