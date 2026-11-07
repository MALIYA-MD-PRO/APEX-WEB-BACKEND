const axios = require("axios");

module.exports = {
  name: "Apex AI Text-to-Speech",
  category: "media",
  method: "GET",
  path: "/api/v1/media/ai/tts",
  handler: async (req, res) => {
    try {
      const text = req.query.text;
      const voice = req.query.voice || "woman2";
      const language = req.query.language || "English";

      if (!text) {
        return res.status(400).json({ 
          success: false, 
          error: "Query parameter 'text' is required" 
        });
      }

      const upstreamUrl = `https://api.omegatech.app/api/ai/text2speech-v3?text=${encodeURIComponent(text.trim())}&voice=${encodeURIComponent(voice)}&language=${encodeURIComponent(language)}`;

      const response = await axios.get(upstreamUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json"
        },
        timeout: 25000
      });

      const data = response.data;

      if (!data || !data.audio) {
        return res.status(502).json({ 
          success: false, 
          error: "Failed to generate speech audio stream" 
        });
      }

      // External attributions ඉවත් කර Apex response එක සකස් කිරීම
      return res.json({
        success: true,
        text: data.text || text,
        voice: data.voice || voice,
        language: data.language || language,
        audioUrl: data.audio,
        format: "mp3",
        generatedAt: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ 
        success: false, 
        error: "AI Text-to-Speech generation failed: " + err.message 
      });
    }
  }
};
