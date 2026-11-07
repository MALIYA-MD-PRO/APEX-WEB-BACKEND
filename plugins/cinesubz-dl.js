const axios = require("axios");

const CINESUBZ_API = process.env.CINESUBZ_API || "https://feeling-higher-defense-certain.trycloudflare.com";
const SECRET_PARAM = "own";
const SECRET_VALUE = "maliya";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiStartResolve(directUrl, pageUrl) {
  const targetEndpoint = `${CINESUBZ_API}/start-resolve?${SECRET_PARAM}=${SECRET_VALUE}`;
  const cleanPageUrl = String(pageUrl || "").replace(/cinesubz\.net/gi, "cinesubz.co");
  const cleanDirectUrl = String(directUrl || pageUrl || "").replace(/cinesubz\.net/gi, "cinesubz.co");

  try {
    const res = await axios.post(targetEndpoint, { directUrl: cleanDirectUrl, pageUrl: cleanPageUrl }, {
      headers: { "Content-Type": "application/json" },
      timeout: 25000,
    });
    const { jobId, success } = res.data || {};
    if (!success || !jobId) return null;
    return jobId;
  } catch (e) {
    return null;
  }
}

async function apiPollStatus(jobId, maxAttempts = 35, intervalMs = 2000) {
  const pollUrl = `${CINESUBZ_API}/check-status/${jobId}?${SECRET_PARAM}=${SECRET_VALUE}`;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    try {
      const res = await axios.get(pollUrl, { timeout: 10000 });
      const data = res.data;

      if (data?.status === "done") {
        return { success: true, links: data.links || [] };
      }
      if (data?.status === "failed") {
        return { success: false, error: data.error || "Resolve failed" };
      }
    } catch (e) {
      if (e?.response?.status === 404) {
        return { success: false, error: "Job expired or not found" };
      }
    }
  }

  return { success: false, error: "Timeout while resolving download link" };
}

module.exports = {
  name: "CineSubz Resolver",
  category: "movie",
  method: "GET",
  path: "/api/v1/movies/cinesubz/dl",
  handler: async (req, res) => {
    try {
      const { directUrl, pageUrl } = req.query;
      const targetDirect = directUrl || pageUrl;
      const targetPage = pageUrl || directUrl;

      if (!targetDirect) {
        return res.status(400).json({ success: false, error: "Parameter 'directUrl' or 'pageUrl' is required" });
      }

      const jobId = await apiStartResolve(targetDirect, targetPage);
      if (!jobId) {
        return res.status(502).json({ success: false, error: "Failed to connect to resolve server" });
      }

      const finalResult = await apiPollStatus(jobId);
      if (!finalResult.success || !finalResult.links || finalResult.links.length === 0) {
        return res.status(500).json({ success: false, error: finalResult.error || "Failed to resolve direct download link" });
      }

      const allLinks = finalResult.links;
      const directDownloadUrl =
        allLinks.find((l) => l.includes("terracloud") || l.includes("skylines")) ||
        allLinks.find((l) => l.includes("pixeldrain")) ||
        allLinks.find((l) => l.includes("supercloud")) ||
        allLinks.find((l) => !l.includes("telegram.me") && !l.includes("t.me")) ||
        allLinks[0];

      return res.json({
        success: true,
        directDownloadUrl,
        allLinks,
        expiresIn: 3600
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: "Resolve error: " + err.message });
    }
  }
};
