const axios = require("axios");

const NEW_CINE_API = (process.env.CINESUBZ_API || "http://puka-cine-production.up.railway.app").replace(/\/+$/, "");

module.exports = {
  name: "CineSubz Resolver",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/dl",
  handler: async (req, res) => {
    try {
      let targetUrl = req.query.directUrl || req.query.driveUrl || req.query.ztUrl || req.query.url || req.query.pageUrl;

      if (!targetUrl) {
        return res.status(400).json({ success: false, error: "Parameter 'directUrl' or 'url' is required" });
      }

      try {
        targetUrl = decodeURIComponent(targetUrl).trim();
      } catch {
        targetUrl = String(targetUrl).trim();
      }

      const response = await axios.get(`${NEW_CINE_API}/download`, {
        params: { url: targetUrl },
        timeout: 60000 // Real Chrome R2 bypass සඳහා තරමක් වැඩි timeout එකක් තබා ඇත
      });

      const data = response.data;
      if (!data || !data.success || !data.downloadUrl) {
        return res.status(500).json({
          success: false,
          error: data?.error || "Failed to resolve direct R2 download link"
        });
      }

      const directDownloadUrl = data.downloadUrl;

      return res.json({
        success: true,
        inputType: data.inputType || "driveUrl",
        driveUrl: data.driveUrl || targetUrl,
        directDownloadUrl,
        allLinks: [directDownloadUrl],
        expiresIn: 3600
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Resolve error: " + (err.response?.data?.error || err.message)
      });
    }
  }
};
