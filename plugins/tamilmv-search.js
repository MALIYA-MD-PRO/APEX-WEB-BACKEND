const cheerio = require("cheerio");

const TAMILMV_BASE = "https://www.1tamilmv.lease";

const REQUEST_OPTIONS = {
  headerGeneratorOptions: {
    browsers: [{ name: "chrome", minVersion: 120 }],
    devices: ["desktop"],
    operatingSystems: ["windows"]
  }
};

function makeSeoSlug(title) {
  return String(title)
    .toLowerCase()
    .replace(/&amp;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRelevantMoviePost(title, query) {
  const lowerTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const queryWords = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const word of queryWords) {
    if (!lowerTitle.includes(word)) return false;
  }
  if (
    lowerTitle.includes("soundtrack") ||
    lowerTitle.includes("flac") ||
    lowerTitle.includes("glimpse") ||
    lowerTitle.includes("video song") ||
    lowerTitle.includes("mp3")
  ) {
    return false;
  }
  return true;
}

module.exports = {
  name: "1TamilMV Search",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/tamilmv/search",
  handler: async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const formattedQuery = encodeURIComponent(query.trim()).replace(/%20/g, "+");
      const apiUrl = `${TAMILMV_BASE}/search/api/search.php?q=${formattedQuery}&priority=1&sort=title_asc&page=1&per_page=40`;

      const response = await gotScraping({
        url: apiUrl,
        ...REQUEST_OPTIONS,
        headers: {
          Referer: `${TAMILMV_BASE}/search/?q=${formattedQuery}`,
          Accept: "application/json, text/plain, */*"
        }
      });

      let data;
      try {
        data = JSON.parse(response.body);
      } catch (e) {
        data = [];
      }

      const results = [];
      let list = Array.isArray(data)
        ? data
        : (data && typeof data === "object" ? Object.values(data).find(Array.isArray) || [] : []);

      list.forEach((item) => {
        if (!item) return;
        let title = item.title || item.topic_title || item.name;
        if (!title) return;

        const cleanTitle = cheerio.load(String(title)).text().replace(/\s+/g, " ").trim();
        if (!isRelevantMoviePost(cleanTitle, query)) return;

        let link = null;
        for (const k of ["url", "topic_url", "link", "href", "seo_url", "full_url"]) {
          if (item[k] && typeof item[k] === "string") {
            link = item[k];
            break;
          }
        }

        let tid = item.tid || item.topic_id || item.id;
        let slug = item.title_seo || item.seo_title || item.slug || makeSeoSlug(cleanTitle);

        if (!link && tid) link = `${TAMILMV_BASE}/index.php?/forums/topic/${tid}-${slug}/`;
        else if (link && !link.startsWith("http")) link = link.startsWith("/") ? `${TAMILMV_BASE}${link}` : `${TAMILMV_BASE}/${link}`;

        if (cleanTitle && link && !results.some(r => r.url === link)) {
          results.push({
            title: cleanTitle,
            url: String(link)
          });
        }
      });

      return res.json({
        success: true,
        query,
        total: results.length,
        results: results.slice(0, 20)
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "1TamilMV Search Failed: " + err.message });
    }
  }
};
