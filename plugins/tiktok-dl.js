module.exports = {
  name: "TikTok No-Watermark Downloader",
  category: "media",
  method: "GET",
  path: "/api/v1/media/tiktok/dl",
  handler: async (req, res) => {
    try {
      const { gotScraping } = await import("got-scraping");

      // ── 1. Dedicated Stream / Force Auto-Download Handler ──────────────────
      // පරිශීලකයා autoDownload link එක open කළ විට ක්‍රියාත්මක වන කොටස
      if (req.query.stream) {
        const streamTargetUrl = decodeURIComponent(req.query.stream);
        const fileName = req.query.filename || `TikTok_${Date.now()}.mp4`;

        // Direct Stream Header Injection
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", fileName.endsWith(".mp3") ? "audio/mpeg" : "video/mp4");
        res.setHeader("Cache-Control", "public, max-age=86400");

        // TikTok CDN එකෙන් video stream එක ගෙන direct download එකක් ලෙස client වෙත pipe කිරීම
        return gotScraping.stream(streamTargetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/"
          }
        }).pipe(res);
      }

      // ── 2. Metadata Scraper & Auto-Download Link Generator ──────────────────
      const url = req.query.url || req.query.link || req.query.q;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. https://www.tiktok.com/@user/video/123456789)"
        });
      }

      const targetApi = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}&hd=1`;

      const response = await gotScraping({
        url: targetApi,
        responseType: "json",
        headerGeneratorOptions: {
          browsers: [{ name: "chrome", minVersion: 120 }],
          devices: ["desktop"],
          locales: ["en-US", "en"],
          operatingSystems: ["windows"]
        },
        timeout: { request: 15000 }
      });

      const data = response.body;

      if (!data || data.code !== 0 || !data.data) {
        return res.status(404).json({
          success: false,
          error: data?.msg || "Could not resolve TikTok video. Ensure the video is public and valid."
        });
      }

      const item = data.data;

      // Real CDN target streams
      const rawHdVideo = item.hdplay 
        ? (item.hdplay.startsWith("http") ? item.hdplay : `https://www.tikwm.com${item.hdplay}`) 
        : null;

      const rawStandardVideo = item.play 
        ? (item.play.startsWith("http") ? item.play : `https://www.tikwm.com${item.play}`) 
        : null;

      const rawAudio = item.music 
        ? (item.music.startsWith("http") ? item.music : `https://www.tikwm.com${item.music}`) 
        : null;

      const coverImage = item.cover 
        ? (item.cover.startsWith("http") ? item.cover : `https://www.tikwm.com${item.cover}`) 
        : null;

      const videoId = item.id || Date.now();
      const safeTitle = (item.title || "video").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

      // අපගේම Domain Gateway එකට අදාළ Host එක සහ Key එක ගැනීම
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // ── Dedicated Auto-Download Links සෑදීම ──
      // මෙම links open කළ සැණින් කෙලින්ම file එක Download වේ
      const autoDownloadHd = (rawHdVideo || rawStandardVideo)
        ? `${currentHost}/api/v1/media/tiktok/dl?stream=${encodeURIComponent(rawHdVideo || rawStandardVideo)}&filename=Apex_TikTok_HD_${safeTitle}_${videoId}.mp4${apiKeyParam}`
        : null;

      const autoDownloadStandard = rawStandardVideo
        ? `${currentHost}/api/v1/media/tiktok/dl?stream=${encodeURIComponent(rawStandardVideo)}&filename=Apex_TikTok_${safeTitle}_${videoId}.mp4${apiKeyParam}`
        : null;

      const autoDownloadAudio = rawAudio
        ? `${currentHost}/api/v1/media/tiktok/dl?stream=${encodeURIComponent(rawAudio)}&filename=Apex_TikTok_Audio_${videoId}.mp3${apiKeyParam}`
        : null;

      const images = Array.isArray(item.images) ? item.images : [];

      return res.json({
        success: true,
        id: item.id,
        title: item.title || "TikTok Video",
        duration: item.duration || 0,
        author: {
          id: item.author?.id,
          username: item.author?.unique_id,
          nickname: item.author?.nickname,
          avatar: item.author?.avatar
        },
        stats: {
          views: item.play_count || 0,
          likes: item.digg_count || 0,
          comments: item.comment_count || 0,
          shares: item.share_count || 0
        },
        cover: coverImage,
        isImagesPost: images.length > 0,
        images: images,
        downloads: {
          // Direct Auto-Download Gateway URLs (කෙලින්ම බාගත වන links)
          autoDownloadHd: autoDownloadHd,
          autoDownloadStandard: autoDownloadStandard,
          autoDownloadAudio: autoDownloadAudio,

          // CDN Raw Streams (වීඩියෝව player එකේ බැලීමට අවශ්‍ය නම්)
          rawHdStream: rawHdVideo || rawStandardVideo,
          rawStandardStream: rawStandardVideo,
          rawAudioStream: rawAudio
        }
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "TikTok Downloader Processing Failed: " + (err.response?.body?.msg || err.message)
      });
    }
  }
};
