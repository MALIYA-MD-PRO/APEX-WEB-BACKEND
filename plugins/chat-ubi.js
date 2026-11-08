const axios = require("axios");

const CHAT_BASE = "https://ch.at";

// 'Q:' සහ 'A:' ආදී අනවශ්‍ය tags ඉවත් කර පිරිසිදු පිළිතුර ලබාගැනීමේ helper ශ්‍රිතය
function cleanAiReply(rawText = "") {
  return String(rawText || "")
    .replace(/^Q:\s*[\s\S]*?\nA:\s*/i, "") // මුලින් එන Q: ... A: කොටස ඉවත් කිරීම
    .replace(/^A:\s*/i, "")                // තනිව එන 'A:' prefix එක ඉවත් කිරීම
    .trim();
}

module.exports = {
  name: "Gemini Mini ",
  category: "ai",
  method: "GET",
  path: "/api/v1/ai/chat/ubi",
  handler: async (req, res) => {
    try {
      const query = req.query.q || req.query.prompt || req.query.text;
      const transcript = req.query.transcript || "";

      if (!query && !transcript) {
        return res.status(400).json({
          success: false,
          error: "Parameter 'q' (or 'transcript') is required."
        });
      }

      // 1. Single-shot query (curl ch.at/?q=...)
      if (!transcript) {
        const targetUrl = `${CHAT_BASE}/?q=${encodeURIComponent(query.trim())}`;
        const response = await axios.get(targetUrl, {
          headers: {
            "User-Agent": "curl/8.5.0",
            "Accept": "text/plain, */*"
          },
          timeout: 25000
        });

        const rawReply = typeof response.data === "string" ? response.data.trim() : JSON.stringify(response.data);
        const finalReply = cleanAiReply(rawReply);

        return res.json({
          success: true,
          query: query.trim(),
          reply: finalReply,
          provider: "Gemini Mini"
        });
      }

      // 2. Multi-turn conversation / Transcript continuation
      const postPayload = new URLSearchParams();
      const fullTranscript = transcript.includes("Q:") 
        ? `${transcript}\n\nQ: ${query || ""}`.trim() 
        : `Q: ${query || transcript}`.trim();

      postPayload.append("transcript", fullTranscript);

      const postRes = await axios.post(`${CHAT_BASE}/`, postPayload.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,text/plain"
        },
        timeout: 30000
      });

      const html = String(postRes.data || "");
      let parsedReply = "";

      const aMatches = [...html.matchAll(/(?:<div[^>]*class=["'][^"']*answer[^"']*["'][^>]*>|A:\s*)([\s\S]*?)(?:<\/div>|Q:|$)/gi)];
      if (aMatches.length > 0) {
        const lastAnswer = aMatches[aMatches.length - 1][1];
        parsedReply = lastAnswer.replace(/<[^>]*>/g, "").trim();
      } else {
        parsedReply = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }

      const finalReply = cleanAiReply(parsedReply);

      return res.json({
        success: true,
        query: query || null,
        reply: finalReply,
        provider: "Gemini Mini"
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Gemini Mini Query Failed: " + (err.response?.data || err.message)
      });
    }
  }
};
