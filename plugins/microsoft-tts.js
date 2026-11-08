const { MsEdgeTTS, OUTPUT_FORMAT } = require("ms-edge-tts");

// පරිශීලකයාට තෝරාගැනීම සඳහා ලබා දෙන Microsoft Neural Voices ලැයිස්තුව
const AVAILABLE_VOICES = [
  { id: "en-US-AriaNeural", name: "Aria", gender: "Female", lang: "English (US)", flag: "🇺🇸" },
  { id: "en-US-GuyNeural", name: "Guy", gender: "Male", lang: "English (US)", flag: "🇺🇸" },
  { id: "en-US-JennyNeural", name: "Jenny", gender: "Female", lang: "English (US)", flag: "🇺🇸" },
  { id: "en-GB-SoniaNeural", name: "Sonia", gender: "Female", lang: "English (UK)", flag: "🇬🇧" },
  { id: "en-GB-RyanNeural", name: "Ryan", gender: "Male", lang: "English (UK)", flag: "🇬🇧" },
  { id: "si-LK-ThiliniNeural", name: "Thilini", gender: "Female", lang: "Sinhala (Sri Lanka)", flag: "🇱🇰" },
  { id: "si-LK-SameeraNeural", name: "Sameera", gender: "Male", lang: "Sinhala (Sri Lanka)", flag: "🇱🇰" },
  { id: "ta-IN-PallaviNeural", name: "Pallavi", gender: "Female", lang: "Tamil (India)", flag: "🇮🇳" },
  { id: "ta-IN-ValluvarNeural", name: "Valluvar", gender: "Male", lang: "Tamil (India)", flag: "🇮🇳" }
];

module.exports = {
  name: "Microsoft Neural TTS Multi-Voice",
  category: "media",
  method: "GET",
  path: "/api/v1/media/microsoft/tts",
  handler: async (req, res) => {
    try {
      const text = req.query.text || req.query.prompt || req.query.q;
      const singleVoice = req.query.voice;
      const pitch = req.query.pitch || "+0Hz";
      const rate = req.query.rate || "+0%";
      const isStream = req.query.stream === "true";

      if (!text) {
        return res.status(400).json({
          success: false,
          error: "Query parameter 'text' is required"
        });
      }

      // 1. යම් කිසි නිශ්චිත voice එකක් stream කිරීමට ඉල්ලා ඇත්නම් කෙලින්ම MP3 stream කිරීම
      if (singleVoice && isStream) {
        const tts = new MsEdgeTTS();
        await tts.setMetadata(singleVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const readableStream = tts.toStream(text.trim(), { rate, pitch });

        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-cache");
        return readableStream.pipe(res);
      }

      // 2. Default ක්‍රියාවලිය: සියලුම voices සඳහා direct playable streaming links ජනනය කර ලබා දීම
      const currentHost = req.protocol + "://" + req.get("host");
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      const voiceOptions = AVAILABLE_VOICES.map((v) => {
        const streamUrl = `${currentHost}/api/v1/media/microsoft/tts?text=${encodeURIComponent(text.trim())}&voice=${v.id}&pitch=${encodeURIComponent(pitch)}&rate=${encodeURIComponent(rate)}&stream=true${apiKeyParam}`;
        
        return {
          id: v.id,
          name: v.name,
          gender: v.gender,
          language: v.lang,
          flag: v.flag,
          audioUrl: streamUrl
        };
      });

      return res.json({
        success: true,
        text: text.trim(),
        totalVoices: voiceOptions.length,
        voices: voiceOptions
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Microsoft Edge TTS Multi-Voice Failed: " + err.message
      });
    }
  }
};
