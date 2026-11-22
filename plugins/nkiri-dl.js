const axios = require("axios");
const cheerio = require("cheerio");

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function formatBytes(bytes, decimals = 2) {
  if (!bytes || isNaN(bytes) || bytes === 0) return "Unknown";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// Direct Download Link එක Verify කරලා Exact Size එක ගන්න Function එක
async function verifyDirectLink(url, referer = "") {
  if (!url || !url.startsWith("http")) {
    return { isValid: false, size: "Unknown", contentType: null };
  }

  try {
    const response = await axios.get(url, {
      headers: {
        ...HEADERS,
        ...(referer && { Referer: referer }),
        Range: "bytes=0-0",
      },
      maxRedirects: 5,
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = response.headers["content-type"] || "";
    const contentDisposition = response.headers["content-disposition"] || "";
    const contentRange = response.headers["content-range"] || "";
    const contentLength = response.headers["content-length"] || "";

    if (contentType.includes("text/html")) {
      return { isValid: false, size: "Unknown", contentType: "text/html" };
    }

    let totalBytes = 0;
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match && match[1]) totalBytes = parseInt(match[1], 10);
    } else if (contentLength) {
      totalBytes = parseInt(contentLength, 10);
    }

    const isFile =
      contentDisposition.includes("attachment") ||
      contentType.includes("video/") ||
      contentType.includes("application/octet-stream") ||
      contentType.includes("application/x-matroska") ||
      totalBytes > 1024 * 1024;

    return {
      isValid: isFile,
      size: formatBytes(totalBytes),
      contentType: contentType.split(";")[0] || null,
    };
  } catch {
    return { isValid: false, size: "Unknown", contentType: null };
  }
}

// 1. Wideshares Resolver
async function resolveWideshares(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(data);

    let directLink = null;
    let fallbackSize = "Unknown";

    const oldMatch = data.match(/link\.href\s*=\s*["']([^"']+force_download\.php[^"']+)["']/);
    const newMatch = data.match(/FORCE_URL\s*=\s*["']([^"']+)["']/);

    if (oldMatch && oldMatch[1]) {
      directLink = oldMatch[1];
    } else if (newMatch && newMatch[1]) {
      directLink = newMatch[1].replace(/\\\//g, "/");
    } else {
      directLink = $("#fallback a").attr("href") || null;
    }

    $("dt, p").each((i, el) => {
      if ($(el).text().trim().toLowerCase() === "size") {
        const sizeText = $(el).next().text().trim();
        if (sizeText) fallbackSize = sizeText;
      }
    });

    return { downloadUrl: directLink, fallbackSize, host: "wideshares" };
  } catch {
    return { downloadUrl: null, fallbackSize: "Unknown", host: "wideshares" };
  }
}

// 2. Downloadwella Resolver
async function resolveDownloadwella(url) {
  try {
    const getRes = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const $ = cheerio.load(getRes.data);

    let fallbackSize = "Unknown";
    $(".statd").each((i, el) => {
      if ($(el).text().trim().toLowerCase() === "size") {
        const sizeText = $(el).next("span").text().trim();
        if (sizeText) fallbackSize = sizeText;
      }
    });

    const form = $('form[name="F1"]');
    if (!form.length) return { downloadUrl: null, fallbackSize, host: "downloadwella" };

    const formData = new URLSearchParams();
    form.find("input").each((i, el) => {
      const name = $(el).attr("name");
      const val = $(el).attr("value") || "";
      if (name) formData.append(name, val);
    });

    const postRes = await axios.post(url, formData.toString(), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://downloadwella.com",
        Referer: url,
      },
      timeout: 15000,
    });

    const $post = cheerio.load(postRes.data);
    const directLink = $post("#direct_link").closest("a").attr("href") || null;

    return { downloadUrl: directLink, fallbackSize, host: "downloadwella" };
  } catch {
    return { downloadUrl: null, fallbackSize: "Unknown", host: "downloadwella" };
  }
}

// 3. Loadedfiles Resolver
async function resolveLoadedfiles(url) {
  try {
    const res1 = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    let cookies = res1.headers["set-cookie"]
      ? res1.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
      : "";

    const $1 = cheerio.load(res1.data);
    const fallbackSize = $1(".nv-dl__size").first().text().trim() || "Unknown";

    let step2Html = res1.data;
    let step2Referer = url;

    const proceedHref = $1("a.nv-btn--primary")
      .filter((i, el) => $1(el).text().toLowerCase().includes("proceed"))
      .attr("href");

    if (proceedHref) {
      const res2 = await axios.get(proceedHref, {
        headers: {
          ...HEADERS,
          Referer: url,
          ...(cookies && { Cookie: cookies }),
        },
        timeout: 15000,
      });
      if (res2.headers["set-cookie"]) {
        cookies = res2.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
      }
      step2Html = res2.data;
      step2Referer = proceedHref;
    }

    const linkMatch = step2Html.match(/link:\s*'([^']+)'/);
    if (!linkMatch || !linkMatch[1]) return { downloadUrl: null, fallbackSize, host: "loadedfiles" };

    const tokenUrl = JSON.parse(`"${linkMatch[1]}"`);

    const res3 = await axios.get(tokenUrl, {
      headers: {
        ...HEADERS,
        Referer: step2Referer,
        ...(cookies && { Cookie: cookies }),
      },
      maxRedirects: 0,
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return { downloadUrl: res3.headers["location"] || null, fallbackSize, host: "loadedfiles" };
  } catch {
    return { downloadUrl: null, fallbackSize: "Unknown", host: "loadedfiles" };
  }
}

// 4. Wildshare Resolver
async function resolveWildshare(url) {
  try {
    const res1 = await axios.get(url, { headers: HEADERS, timeout: 15000 });
    const cookies = res1.headers["set-cookie"]
      ? res1.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ")
      : "";

    const $ = cheerio.load(res1.data);
    const fallbackSize = $(".nv-dl__size").first().text().trim() || "Unknown";
    const onclickAttr = $(".wildbutton").attr("onclick") || "";

    const match = onclickAttr.match(/window\.location\s*=\s*['"]([^'"]+)['"]/);
    const tokenUrl = match ? match[1] : null;
    if (!tokenUrl) return { downloadUrl: null, fallbackSize, host: "wildshare" };

    const res2 = await axios.get(tokenUrl, {
      headers: {
        ...HEADERS,
        Referer: url,
        ...(cookies && { Cookie: cookies }),
      },
      maxRedirects: 0,
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return { downloadUrl: res2.headers["location"] || tokenUrl, fallbackSize, host: "wildshare" };
  } catch {
    return { downloadUrl: null, fallbackSize: "Unknown", host: "wildshare" };
  }
}

module.exports = {
  name: "Nkiri Direct DL",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/nkiri/dl",
  handler: async (req, res) => {
    try {
      const pageUrl = req.query.url;
      if (!pageUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'url' (Nkiri Page URL) is required" });
      }

      const { data } = await axios.get(pageUrl.trim(), { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(data);

      const title = $("h2.single-post-title").text().trim() || $("h1").first().text().trim() || "Unknown Title";
      const synopsis = $(".entry-content p.wp-block-paragraph").first().text().trim() || null;

      const rawLinks = [];
      $(".entry-content a.shortc-button").each((i, el) => {
        const name = $(el).text().trim();
        const url = $(el).attr("href");
        if (name && url) {
          rawLinks.push({ name, url });
        }
      });

      if (rawLinks.length === 0) {
        return res.status(404).json({ success: false, error: "No download links found on this Nkiri page" });
      }

      // Parallel විදිහට ඔක්කොම resolve + verify කරනවා
      const downloads = await Promise.all(
        rawLinks.map(async (item) => {
          let resolved = { downloadUrl: item.url, fallbackSize: "Unknown", host: "direct" };
          let referer = "";

          if (item.url.includes("wideshares.org")) {
            referer = item.url;
            resolved = await resolveWideshares(item.url);
          } else if (item.url.includes("downloadwella.com")) {
            referer = "https://downloadwella.com/";
            resolved = await resolveDownloadwella(item.url);
          } else if (item.url.includes("loadedfiles.net")) {
            referer = "https://loadedfiles.net/";
            resolved = await resolveLoadedfiles(item.url);
          } else if (item.url.includes("wildshare.net")) {
            referer = "https://wildshare.net/";
            resolved = await resolveWildshare(item.url);
          }

          // හැම link එකක්ම verify කරලා exact size එක ගන්නවා
          const check = await verifyDirectLink(resolved.downloadUrl, referer);

          return {
            episode: item.name,
            verified: check.isValid,
            size: check.size !== "Unknown" ? check.size : resolved.fallbackSize,
            contentType: check.contentType,
            host: resolved.host,
            downloadUrl: resolved.downloadUrl,
            sourceUrl: item.url,
          };
        })
      );

      return res.json({
        success: true,
        title,
        synopsis,
        total: downloads.length,
        pageUrl: pageUrl.trim(),
        downloads,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: "Nkiri DL Failed: " + error.message });
    }
  },
};
