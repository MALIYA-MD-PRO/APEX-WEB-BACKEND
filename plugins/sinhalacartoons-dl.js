const axios = require("axios");
const cheerio = require("cheerio");

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Connection: "keep-alive"
};

function extractDirectFromScData(urlStr) {
  try {
    const urlObj = new URL(urlStr, "https://sinhalacartoons.com");
    const scData = urlObj.searchParams.get("sc_data");
    if (scData) {
      const decoded = JSON.parse(Buffer.from(scData, "base64").toString("utf-8"));
      return {
        direct: decoded.direct || null,
        telegram: decoded.telegram || null,
        title: decoded.title || null
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

module.exports = {
  name: "SinhalaCartoons DL",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/sinhalacartoons/dl",
  handler: async (req, res) => {
    try {
      const inputUrl = req.query.url || req.query.landingUrl;
      if (!inputUrl) {
        return res.status(400).json({ 
          success: false, 
          error: "Parameter 'url' or 'landingUrl' is required" 
        });
      }

      const cleanTargetUrl = decodeURIComponent(inputUrl).replace(/&#038;/g, "&").replace(/&amp;/g, "&");

      // පියවර 1: inputUrl එක තුළම sc_data පවතීදැයි පරීක්ෂා කිරීම
      let directUrl = null;
      let telegramUrl = null;
      let title = null;

      const fastExtract = extractDirectFromScData(cleanTargetUrl);
      if (fastExtract && fastExtract.direct) {
        directUrl = fastExtract.direct;
        telegramUrl = fastExtract.telegram;
        title = fastExtract.title;
      }

      // පියවර 2: inputUrl එක ප්‍රධාන පිටුවක් නම්, පිටුව scrape කර සබැඳි ලබාගැනීම
      if (!directUrl) {
        const { data } = await axios.get(cleanTargetUrl, {
          headers: { ...defaultHeaders, Referer: "https://sinhalacartoons.com/" },
          timeout: 15000
        });

        const $ = cheerio.load(data);
        title = $("h1.movie-title").first().text().trim() || $("title").text().trim() || "Cartoon";

        // a) .sc-player-downloads a.sc-download-links-btn සෙවීම
        const landingBtnHref = $(".sc-player-downloads a.sc-download-links-btn").attr("href") || $("a.sc-download-links-btn").attr("href");
        
        if (landingBtnHref) {
          const cleanLanding = landingBtnHref.replace(/&#038;/g, "&").replace(/&amp;/g, "&");
          const landingExtract = extractDirectFromScData(cleanLanding);
          if (landingExtract && landingExtract.direct) {
            directUrl = landingExtract.direct;
            telegramUrl = landingExtract.telegram;
            if (!title && landingExtract.title) title = landingExtract.title;
          } else {
            // Landing page එක වෙත request යවා a.dl-card-landing.force-download-btn ලබාගැනීම
            try {
              const landingRes = await axios.get(cleanLanding, {
                headers: { ...defaultHeaders, Referer: cleanTargetUrl },
                timeout: 10000
              });
              const $landing = cheerio.load(landingRes.data);
              directUrl = $landing("a.dl-card-landing.force-download-btn").attr("href") || $landing("a.force-download-btn").attr("href");
            } catch (err) {}
          }
        }

        // b) Landing link එකෙන් නොලැබුණහොත් video source ටැගය පරීක්ෂා කිරීම
        if (!directUrl) {
          const videoSrc = $("video#mainPlayer source").attr("src") || $("video source").attr("src");
          if (videoSrc) {
            directUrl = videoSrc;
          }
        }

        // c) a.force-download-btn එක කෙලින්ම පිටුවේ ඇත්නම් එය ලබාගැනීම
        if (!directUrl) {
          directUrl = $("a.dl-card-landing.force-download-btn").attr("href") || $("a.force-download-btn").attr("href");
        }
      }

      if (!directUrl) {
        throw new Error("Could not extract direct streamable download URL from SinhalaCartoons");
      }

      return res.json({
        success: true,
        title: title ? title.replace(/&#8217;/g, "'").replace(/&#038;/g, "&") : "Cartoon Movie",
        downloadUrl: directUrl,
        telegramUrl: telegramUrl || null,
        source: "Cloudflare R2 High Speed Direct Access"
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        error: "SinhalaCartoons DL extraction failed: " + err.message 
      });
    }
  }
};
