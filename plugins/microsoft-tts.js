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

async function fetchEdgeAudio(text, voice, pitch = "+0Hz", rate = "+0%") {
  // Method 1: Edge Audio Upstream REST Synthesizer
  const upstreamUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(
    `https://tts.msh.host/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}&pitch=${encodeURIComponent(pitch)}`
  )}`;

  try {
    const res = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
      }
    });

    if (res.ok) {
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > 100) return Buffer.from(buffer);
    }
  } catch (e) {}

  // Method 2: Direct High-Quality Neural Mirror
  const directEndpoint = `https://edge-tts.vercel.app/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;
  const res2 = await fetch(directEndpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
  });

  if (res2.ok) {
    const buffer = await res2.arrayBuffer();
    return Buffer.from(buffer);
  }

  throw new Error("Upstream synthesis gateway temporarily unavailable");
}

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

      // 1. Direct Voice Stream
      if (singleVoice && isStream) {
        const audioBuffer = await fetchEdgeAudio(text.trim(), singleVoice, pitch, rate);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audioBuffer.length);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(audioBuffer);
      }

      // 2. All Voices Multi-Option Listing
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
        error: "Microsoft Edge TTS Synthesis Failed: " + err.message
      });
    }
  }
};
