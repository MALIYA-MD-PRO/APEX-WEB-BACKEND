const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TTS_TEMP_DIR = path.join(__dirname, "../temp/tts");
if (!fs.existsSync(TTS_TEMP_DIR)) {
  fs.mkdirSync(TTS_TEMP_DIR, { recursive: true });
}

const MAX_TOTAL_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB Max
const EXPIRE_TIME_MS = 20 * 60 * 1000;          // 20 Minutes Expiry

// 🌸 Curated Cute, Modern, Realistic & Expressive Neural Voices
const AVAILABLE_VOICES = [
  { 
    id: "en-US-AnaNeural", 
    name: "Ana (Cute & Sweet)", 
    gender: "Female", 
    style: "cheerful",
    lang: "English (US)", 
    flag: "✨",
    desc: "Childlike, extremely cute and lively voice"
  },
  { 
    id: "en-US-AvaNeural", 
    name: "Ava (Soft & Expressive)", 
    gender: "Female", 
    style: "gentle",
    lang: "English (US)", 
    flag: "🎀",
    desc: "Ultra-realistic, soft and beautiful modern voice"
  },
  { 
    id: "en-US-EmmaNeural", 
    name: "Emma (Cheerful / Sweet)", 
    gender: "Female", 
    style: "cheerful",
    lang: "English (US)", 
    flag: "🌸",
    desc: "Friendly, cheerful and enthusiastic girl voice"
  },
  { 
    id: "en-US-JennyNeural", 
    name: "Jenny (Cute Assistant)", 
    gender: "Female", 
    style: "friendly",
    lang: "English (US)", 
    flag: "💖",
    desc: "Sweet, conversational and modern voice"
  },
  { 
    id: "en-US-AndrewNeural", 
    name: "Andrew (Warm & Gentle)", 
    gender: "Male", 
    style: "warm",
    lang: "English (US)", 
    flag: "🎧",
    desc: "Warm, friendly and youthful male voice"
  },
  { 
    id: "en-US-BrianNeural", 
    name: "Brian (Lively & Deep)", 
    gender: "Male", 
    style: "friendly",
    lang: "English (US)", 
    flag: "🎙️",
    desc: "Casual, clean and natural boy voice"
  },
  { 
    id: "si-LK-ThiliniNeural", 
    name: "Thilini (Sinhala Expressive)", 
    gender: "Female", 
    style: "chat",
    lang: "Sinhala (Sri Lanka)", 
    flag: "🇱🇰",
    desc: "Natural Sinhala female voice"
  },
  { 
    id: "si-LK-SameeraNeural", 
    name: "Sameera (Sinhala Natural)", 
    gender: "Male", 
    style: "chat",
    lang: "Sinhala (Sri Lanka)", 
    flag: "🇱🇰",
    desc: "Smooth Sinhala male voice"
  },
  { 
    id: "ta-IN-PallaviNeural", 
    name: "Pallavi (Tamil Melody)", 
    gender: "Female", 
    style: "friendly",
    lang: "Tamil (India)", 
    flag: "🇮🇳",
    desc: "Sweet and melodic Tamil female voice"
  }
];

function getDirectorySizeBytes() {
  try {
    const files = fs.readdirSync(TTS_TEMP_DIR);
    let totalSize = 0;
    for (const file of files) {
      try {
        const stats = fs.statSync(path.join(TTS_TEMP_DIR, file));
        totalSize += stats.size;
      } catch (_) {}
    }
    return totalSize;
  } catch (_) {
    return 0;
  }
}

function ensureStorageLimit(incomingBytes = 0) {
  try {
    let currentTotal = getDirectorySizeBytes();
    if (currentTotal + incomingBytes <= MAX_TOTAL_SIZE_BYTES) return;

    const files = fs.readdirSync(TTS_TEMP_DIR)
      .map((f) => {
        const filePath = path.join(TTS_TEMP_DIR, f);
        try {
          return { name: f, path: filePath, ...fs.statSync(filePath) };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const file of files) {
      try {
        fs.unlinkSync(file.path);
        currentTotal -= file.size;
        if (currentTotal + incomingBytes <= MAX_TOTAL_SIZE_BYTES) break;
      } catch (_) {}
    }
  } catch (_) {}
}

setInterval(() => {
  try {
    const files = fs.readdirSync(TTS_TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TTS_TEMP_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > EXPIRE_TIME_MS) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
    }
  } catch (_) {}
}, 2 * 60 * 1000);

// SSML generator with Expressive Style & Pitch Boosting
function buildSsml(text, voice, pitch = "+0Hz", rate = "+0%", style = "friendly") {
  // Ana, Emma, Jenny සඳහා cheerful style එක support කරයි
  const useExpressive = ["en-US-AnaNeural", "en-US-EmmaNeural", "en-US-JennyNeural", "en-US-AvaNeural"].includes(voice);
  
  if (useExpressive) {
    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>` +
      `<voice name='${voice}'>` +
      `<mstts:express-as style='${style || "cheerful"}'>` +
      `<prosody pitch='${pitch}' rate='${rate}'>${text}</prosody>` +
      `</mstts:express-as>` +
      `</voice></speak>`;
  }

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}'>${text}</prosody>` +
    `</voice></speak>`;
}

function synthesizeEdgeRest(text, voice, pitch = "+0Hz", rate = "+0%", style = "friendly") {
  return new Promise((resolve, reject) => {
    const ssml = buildSsml(text, voice, pitch, rate, style);

    const options = {
      hostname: "speech.platform.bing.com",
      path: "/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EA65408183E4CBA214552F60",
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        "Content-Length": Buffer.byteLength(ssml)
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        return;
      }

      // Fallback
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
      reject(new Error("Synthesis request timed out"));
    });

    req.write(ssml);
    req.end();
  });
}

function saveTempAudio(buffer, voiceId) {
  ensureStorageLimit(buffer.length);
  const randomId = crypto.randomBytes(6).toString("hex");
  const fileName = `apex_${voiceId}_${Date.now()}_${randomId}.mp3`;
  const fullPath = path.join(TTS_TEMP_DIR, fileName);

  fs.writeFileSync(fullPath, buffer);

  setTimeout(() => {
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (_) {}
  }, EXPIRE_TIME_MS);

  return fileName;
}

module.exports = {
  name: "Microsoft Neural TTS Multi-Voice",
  category: "media",
  method: "GET",
  path: "/api/v1/media/microsoft/tts",
  handler: async (req, res) => {
    try {
      // 1. Direct Auto-Download Binary Stream Router
      const downloadTarget = req.query.download || req.query.token || req.query.file;
      if (downloadTarget) {
        const targetFile = path.basename(downloadTarget);
        const filePath = path.join(TTS_TEMP_DIR, targetFile);

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({
            success: false,
            error: "The download link has expired or the file no longer exists (20-minute limit reached)."
          });
        }

        const stat = fs.statSync(filePath);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", `attachment; filename="${targetFile}"`);
        res.setHeader("Content-Length", stat.size);
        return fs.createReadStream(filePath).pipe(res);
      }

      const text = req.query.text || req.query.prompt || req.query.q;
      const singleVoice = req.query.voice;
      let pitch = req.query.pitch || "+2Hz"; // මදක් pitch වැඩි කර හඬ වඩාත් cute & clear කර ඇත
      let rate = req.query.rate || "+2%";   // මදක් tempo එක වැඩි කර කම්මැලි නැති natural rhythm එකක් ලබා දී ඇත
      const isStream = req.query.stream === "true";

      if (!text) {
        return res.status(400).json({
          success: false,
          error: "Query parameter 'text' is required"
        });
      }

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // 2. තනි voice එකක් ඉල්ලූ විට
      if (singleVoice) {
        const matchedVoice = AVAILABLE_VOICES.find(v => v.id.toLowerCase() === singleVoice.toLowerCase()) || { id: singleVoice, style: "friendly" };
        const audioBuffer = await synthesizeEdgeRest(text.trim(), matchedVoice.id, pitch, rate, matchedVoice.style);

        if (isStream) {
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Length", audioBuffer.length);
          return res.end(audioBuffer);
        }

        const fileName = saveTempAudio(audioBuffer, matchedVoice.id);
        const downloadUrl = `${currentHost}/api/v1/media/microsoft/tts?download=${fileName}${apiKeyParam}`;

        return res.json({
          success: true,
          voice: matchedVoice.id,
          name: matchedVoice.name || matchedVoice.id,
          text: text.trim(),
          fileSize: `${(audioBuffer.length / 1024).toFixed(1)} KB`,
          autoDownloadUrl: downloadUrl,
          expiresIn: "20 minutes"
        });
      }

      // 3. Multi-Voice Selection — Default JSON Response
      const voicePromises = AVAILABLE_VOICES.map(async (v) => {
        try {
          const audioBuffer = await synthesizeEdgeRest(text.trim(), v.id, pitch, rate, v.style);
          const fileName = saveTempAudio(audioBuffer, v.id);
          const downloadUrl = `${currentHost}/api/v1/media/microsoft/tts?download=${fileName}${apiKeyParam}`;

          return {
            id: v.id,
            name: v.name,
            gender: v.gender,
            language: v.lang,
            flag: v.flag,
            style: v.style,
            description: v.desc,
            size: `${(audioBuffer.length / 1024).toFixed(1)} KB`,
            autoDownloadUrl: downloadUrl
          };
        } catch (_) {
          return {
            id: v.id,
            name: v.name,
            gender: v.gender,
            language: v.lang,
            flag: v.flag,
            error: "Failed to generate audio"
          };
        }
      });

      const voicesResult = await Promise.all(voicePromises);

      return res.json({
        success: true,
        text: text.trim(),
        expiresIn: "20 minutes",
        totalVoices: voicesResult.length,
        voices: voicesResult
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Microsoft Edge TTS Processing Failed: " + err.message
      });
    }
  }
};
