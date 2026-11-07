const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://animeheaven.me";

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  Referer: "https://animeheaven.me/"
};

module.exports = {
  name: "AnimeHeaven All Episodes DL",
  category: "media",
  method: "GET",
  path: "/api/v1/media/animeheaven/dl",
  handler: async (req, res) => {
    try {
      const pageUrl = req.query.url;
      if (!pageUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' is required (Anime URL)" });
      }

      const fullUrl = pageUrl.startsWith("http") ? pageUrl : `${BASE_URL}/${pageUrl.replace(/^\//, "")}`;

      const response = await axios.get(fullUrl, {
        headers: defaultHeaders,
        timeout: 15000
      });

      const html = String(response.data || "");
      const $ = cheerio.load(html);

      const title = $(".infotitle").first().text().trim() || $("title").text().replace("Anime | AnimeHeaven.Me", "").trim();
      const poster = $(".posterimg").attr("src") || $("meta[property='og:image']").attr("content") || null;
      const description = $(".infodes").first().text().trim() || null;

      const episodes = [];
      const seenKeys = new Set();

      // Episode cards තුළ ඇති hash token හඳුනාගැනීම
      $(".linetitle2 a, a[id]").each((_, el) => {
        const key = $(el).attr("id") || "";
        const epNum = $(el).find(".watch2, div.watch2").text().trim();
        const timeAgo = $(el).find(".watch1").last().text().trim();

        if (key && /^[a-f0-9]{32}$/i.test(key) && !seenKeys.has(key)) {
          seenKeys.add(key);
          episodes.push({
            episode: epNum ? parseInt(epNum, 10) : episodes.length + 1,
            token: key,
            uploaded: timeAgo || null,
            downloadUrl: `https://f1.animeheaven.me/video.mp4?${key}&d`,
            streamUrl: `https://f1.animeheaven.me/video.mp4?${key}`
          });
        }
      });

      // Default key fallback එක පරීක්ෂා කිරීම (HTML script regex මඟින්)
      if (episodes.length === 0) {
        const dfKeyMatch = html.match(/var\s+dfkey\s*=\s*["']([a-f0-9]{32})["']/i);
        if (dfKeyMatch) {
          const key = dfKeyMatch[1];
          episodes.push({
            episode: 1,
            token: key,
            downloadUrl: `https://f1.animeheaven.me/video.mp4?${key}&d`,
            streamUrl: `https://f1.animeheaven.me/video.mp4?${key}`
          });
        }
      }

      // Episodes පිළිවෙළට සකස් කිරීම (Episode 1 සිට ඉහළට)
      episodes.sort((a, b) => a.episode - b.episode);

      return res.json({
        success: true,
        title,
        poster,
        description,
        totalEpisodes: episodes.length,
        episodes
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "AnimeHeaven DL Failed: " + err.message });
    }
  }
};
