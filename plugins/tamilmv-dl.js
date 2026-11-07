const cheerio = require("cheerio");

const REQUEST_OPTIONS = {
  headerGeneratorOptions: {
    browsers: [{ name: "chrome", minVersion: 120 }],
    devices: ["desktop"],
    operatingSystems: ["windows"]
  }
};

async function resolveDirectCdnUrl(shortUrl) {
  try {
    const { gotScraping } = await import("got-scraping");
    const step1 = await gotScraping({ url: shortUrl, ...REQUEST_OPTIONS, followRedirect: true });
    let $ = cheerio.load(step1.body);
    let messyBody = step1.body;

    let outUrl = $("#cta").attr("href") || (step1.body.match(/https?:\/\/[^"'\s]*\/out\?t=[^"'\s]+/i) || [])[0];
    if (outUrl) {
      const step2 = await gotScraping({
        url: outUrl,
        ...REQUEST_OPTIONS,
        followRedirect: true,
        headers: { Referer: shortUrl }
      });
      messyBody = step2.body;
      $ = cheerio.load(messyBody);
    }

    let cdnUrl = null;
    $(".download-grid a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && (href.includes("cdn.") || href.includes("juicybits") || href.includes("/files/"))) {
        cdnUrl = href;
        return false;
      }
    });

    if (!cdnUrl) {
      const match = messyBody.match(/https?:\/\/cdn\.[^"'\s]+\/files\/[^"'\s]+/i);
      if (match) cdnUrl = match[0];
    }

    let rawFilename = $("h1").text().trim() || "Movie_File.mkv";
    return { downloadUrl: cdnUrl || shortUrl, fileName: rawFilename };
  } catch (e) {
    return { downloadUrl: shortUrl, fileName: "Movie_File.mkv" };
  }
}

module.exports = {
  name: "1TamilMV DL & Magnets",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/tamilmv/dl",
  handler: async (req, res) => {
    try {
      const topicUrl = req.query.url;
      if (!topicUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' (topic URL) is required" });
      }

      const { gotScraping } = await import("got-scraping");
      const response = await gotScraping({
        url: topicUrl,
        ...REQUEST_OPTIONS,
        followRedirect: true,
        timeout: { request: 20000 }
      });

      const $ = cheerio.load(response.body);

      let poster = null;
      $("div[data-role='commentContent'] img").each((_, imgEl) => {
        const src = $(imgEl).attr("src");
        if (src && !src.includes("torrborder") && !src.includes("uTorrent") && !src.includes("emojis")) {
          poster = src;
          return false;
        }
      });

      const pageTitle = $("h1.ipsType_pageTitle").text().trim() || $("title").text().trim() || "TamilMV Movie";

      const downloadOptions = [];
      const seenLinks = new Set();

      $("a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript")) return;
        const btnText = $(el).text().replace(/\s+/g, " ").trim().toUpperCase();

        const isDirect = $(el).hasClass("download-button") ||
          btnText.includes("DIRECT LINK") ||
          href.includes("cyberloom") ||
          href.includes("messycloud");

        const isMagnet = href.startsWith("magnet:");

        if (!isDirect && !isMagnet) return;

        let qualityTitle = "";
        let prevEl = $(el).prev();

        while (prevEl.length && !qualityTitle) {
          let prevHref = prevEl.attr("href") || prevEl.find("a").attr("href");
          if (prevHref && prevHref.startsWith("magnet:")) {
            const dnMatch = prevHref.match(/[?&]dn=([^&]+)/i);
            if (dnMatch && dnMatch[1]) {
              qualityTitle = decodeURIComponent(dnMatch[1].replace(/\+/g, " "))
                .replace(/^www\.1TamilMV\.[a-z]+\s*-\s*/i, "")
                .trim();
              break;
            }
          }
          const txt = prevEl.text().replace(/\s+/g, " ").trim();
          if (
            txt.includes("1080p") ||
            txt.includes("720p") ||
            txt.includes("480p") ||
            txt.includes("2160p") ||
            txt.includes("4K") ||
            txt.includes("WEB-DL") ||
            txt.includes("HDRip") ||
            txt.includes("BluRay")
          ) {
            qualityTitle = txt
              .replace(/^www\.1TamilMV\.[a-z]+\s*-\s*/i, "")
              .replace(/\.torrent$/i, "")
              .replace(/[:\-]$/, "")
              .trim();
            break;
          }
          prevEl = prevEl.prev();
        }

        if (!qualityTitle) {
          qualityTitle = `Option ${downloadOptions.length + 1}`;
        }

        if (!seenLinks.has(href)) {
          seenLinks.add(href);
          downloadOptions.push({
            quality: qualityTitle,
            type: isMagnet ? "magnet" : "direct",
            link: href
          });
        }
      });

      // Direct download links Cyberloom/Messycloud වෙතින් සෘජු CDN links ලෙස resolve කර ගැනීම
      const resolvedOptions = await Promise.all(
        downloadOptions.map(async (opt) => {
          if (opt.type === "direct") {
            const resolved = await resolveDirectCdnUrl(opt.link);
            return {
              quality: opt.quality,
              type: "direct_cdn",
              downloadUrl: resolved.downloadUrl,
              fileName: resolved.fileName
            };
          }
          return {
            quality: opt.quality,
            type: "magnet",
            magnet: opt.link
          };
        })
      );

      return res.json({
        success: true,
        title: pageTitle,
        poster,
        totalLinks: resolvedOptions.length,
        downloads: resolvedOptions
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "1TamilMV DL Failed: " + err.message });
    }
  }
};
