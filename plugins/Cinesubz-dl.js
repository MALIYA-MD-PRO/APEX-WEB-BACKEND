const axios = require("axios");

const CINESUBZ_API = (process.env.CINESUBZ_API || "https://software-proceeding-tba-bench.trycloudflare.com").replace(/\/+$/, "");
const SECRET_PARAM = "own";
const SECRET_VALUE = "maliya";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REQUEST_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "x-own": SECRET_VALUE,
  "Accept": "application/json"
};

async function apiStartResolve(directUrl, pageUrl) {
  const targetEndpoint = `${CINESUBZ_API}/start-resolve?${SECRET_PARAM}=${SECRET_VALUE}`;
  
  // URL safely decode කර cinesubz domain එක නිවැරදි කිරීම
  let cleanDirectUrl = directUrl || pageUrl || "";
  let cleanPageUrl = pageUrl || directUrl || "";

  try { cleanDirectUrl = decodeURIComponent(cleanDirectUrl); } catch {}
  try { cleanPageUrl = decodeURIComponent(cleanPageUrl); } catch {}

  cleanDirectUrl = cleanDirectUrl.replace(/cinesubz\.net/gi, "cinesubz.co").trim();
  cleanPageUrl = cleanPageUrl.replace(/cinesubz\.net/gi, "cinesubz.co").trim();

  try {
    const res = await axios.post(
      targetEndpoint,
      { directUrl: cleanDirectUrl, pageUrl: cleanPageUrl },
      {
        headers: REQUEST_HEADERS,
        timeout: 30000,
        validateStatus: (status) => status < 500
      }
    );

    const { jobId, success, id } = res.data || {};
    const finalJobId = jobId || id;

    if (!finalJobId) {
      console.error("[CineSubz Resolve API Error]:", res.status, res.data);
      return null;
    }

    return finalJobId;
  } catch (e) {
    console.error("[CineSubz Start Resolve Network Error]:", e.response ? `${e.response.status} - ${JSON.stringify(e.response.data)}` : e.message);
    return null;
  }
}

async function apiPollStatus(jobId, maxAttempts = 35, intervalMs = 2500) {
  const pollUrl = `${CINESUBZ_API}/check-status/${encodeURIComponent(jobId)}?${SECRET_PARAM}=${SECRET_VALUE}`;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    try {
      const res = await axios.get(pollUrl, {
        headers: REQUEST_HEADERS,
        timeout: 15000,
      });
      const data = res.data;

      if (data?.status === "done" || data?.success === true && data?.links) {
        return { success: true, links: data.links || [] };
      }
      if (data?.status === "failed") {
        return { success: false, error: data.error || "Resolve failed on upstream" };
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
      const rawDirect = req.query.directUrl || req.query.url;
      const rawPage = req.query.pageUrl || req.query.directUrl || req.query.url;

      if (!rawDirect) {
        return res.status(400).json({ success: false, error: "Parameter 'directUrl' or 'url' is required" });
      }

      const jobId = await apiStartResolve(rawDirect, rawPage);
      if (!jobId) {
        return res.status(502).json({ 
          success: false, 
          error: "Failed to connect to resolve server. Upstream tunnel might be rejecting requests." 
        });
      }

      const finalResult = await apiPollStatus(jobId);
      if (!finalResult.success || !finalResult.links || finalResult.links.length === 0) {
        return res.status(500).json({ 
          success: false, 
          error: finalResult.error || "Failed to resolve direct download link" 
        });
      }

      const allLinks = finalResult.links;
      const directDownloadUrl =
        allLinks.find((l) => typeof l === "string" && (l.includes("terracloud") || l.includes("skylines"))) ||
        allLinks.find((l) => typeof l === "string" && l.includes("pixeldrain")) ||
        allLinks.find((l) => typeof l === "string" && l.includes("supercloud")) ||
        allLinks.find((l) => typeof l === "string" && !l.includes("telegram.me") && !l.includes("t.me")) ||
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
