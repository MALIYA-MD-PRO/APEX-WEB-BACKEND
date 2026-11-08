const https = require("https");

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

// Direct Microsoft Edge REST Endpoint Synthesis
function synthesizeEdgeRest(text, voice, pitch = "+0Hz", rate = "+0%") {
  return new Promise((resolve, reject) => {
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
      `<voice name='${voice}'>` +
      `<prosody pitch='${pitch}' rate='${rate}'>${text}</prosody>` +
      `</voice></speak>`;

    const options = {
      hostname: "speech.platform.bing.com",
      path: "/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EA65408183E4CBA214552F60",
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        "Content-Length": Buffer.byteLength(ssml)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        return;
      }

      // Fallback: Google Translate TTS audio buffer if Microsoft blocks direct IP
      const fallbackLang = voice.startsWith("si") ? "si" : voice.startsWith("ta") ? "ta" : "en";
      const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${fallbackLang}&client=tw-ob`;
      
      https.get(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (fbRes) => {
        if (fbRes.statusCode === 200) {
          const fbChunks = [];
          fbRes.on("data", (chunk) => fbChunks.push(chunk));
          fbRes.on("end", () => resolve(Buffer.concat(fbChunks)));
        } else {
          reject(new Error(`Synthesis returned status ${res.statusCode}`));
        }
      }).on("error", reject);
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.write(ssml);
    req.end();
  });
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

      // 1. Direct playable MP3 audio stream
      if (singleVoice && isStream) {
        const audioBuffer = await synthesizeEdgeRest(text.trim(), singleVoice, pitch, rate);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audioBuffer.length);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.end(audioBuffer);
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
