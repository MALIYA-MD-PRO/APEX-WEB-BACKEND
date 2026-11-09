module.exports = {
  name: "TikTok No-Watermark Downloader",
  category: "media",
  method: "GET",
  path: "/api/v1/media/tiktok/dl",
  handler: async (req, res) => {
    try {
      const url = req.query.url || req.query.link || req.query.q;

      if (!url) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'url' is required (e.g. https://www.tiktok.com/@user/video/123456789)"
        });
      }

      // Dynamic ESM import to bypass CommonJS require restriction
      const { gotScraping } = await import("got-scraping");

      const targetApi = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}&hd=1`;

      const response = await gotScraping.get(targetApi, {
        responseType: "json",
        headerGeneratorOptions: {
          browsers: [{ name: "chrome", minVersion: 120 }],
          devices: ["desktop"],
          locales: ["en-US", "en"],
          operatingSystems: ["windows"]
        },
        timeout: {
          request: 15000
        }
      });

      const data = response.body;

      if (!data || data.code !== 0 || !data.data) {
        return res.status(404).json({
          success: false,
          error: data?.msg || "Could not resolve TikTok video. Please check if the video is public and the link is correct."
        });
      }

      const item = data.data;

      // Extract high-speed CDN direct streams
      const directHdVideo = item.hdplay 
        ? (item.hdplay.startsWith("http") ? item.hdplay : `https://www.tikwm.com${item.hdplay}`) 
        : null;

      const directStandardVideo = item.play 
        ? (item.play.startsWith("http") ? item.play : `https://www.tikwm.com${item.play}`) 
        : null;

      const directAudio = item.music 
        ? (item.music.startsWith("http") ? item.music : `https://www.tikwm.com${item.music}`) 
        : null;

      const coverImage = item.cover 
        ? (item.cover.startsWith("http") ? item.cover : `https://www.tikwm.com${item.cover}`) 
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
          hdVideo: directHdVideo || directStandardVideo,
          standardVideo: directStandardVideo,
          audio: directAudio
        }
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "TikTok Scraping Failed: " + (err.response?.body?.msg || err.message)
      });
    }
  }
};
