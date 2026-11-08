const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Directory & Limits Configuration ─────────────────────────────────────────
const TTS_TEMP_DIR = path.join(__dirname, "../temp/tts");
if (!fs.existsSync(TTS_TEMP_DIR)) {
  fs.mkdirSync(TTS_TEMP_DIR, { recursive: true });
}

const MAX_TOTAL_SIZE_BYTES = 150 * 1024 * 1024; // Max 150 MB Storage Guard
const EXPIRE_TIME_MS = 20 * 60 * 1000;          // 20 Minutes Expiry

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

// ── Storage Capacity & Expiry Cleaners ─────────────────────────────────────────
function getDirectorySizeBytes() {
  try {
    const files = fs.readdirSync(TTS_TEMP_DIR);
    let totalSize = 0;
    for (const file of files) {
      const filePath = path.join(TTS_TEMP_DIR, file);
      try {
        const stats = fs.statSync(filePath);
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
  } catch (err) {
    console.error("[TTS Cleaner Error]:", err.message);
  }
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

// ── Microsoft Edge Speech Engine ─────────────────────────────────────────────
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
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        return;
      }

      // Fallback Engine
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
  const fileName = `apex_tts_${voiceId}_${Date.now()}_${randomId}.mp3`;
  const fullPath = path.join(TTS_TEMP_DIR, fileName);

  fs.writeFileSync(fullPath, buffer);

  setTimeout(() => {
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (_) {}
  }, EXPIRE_TIME_MS);

  return fileName;
}

// ── Plugin Definition ────────────────────────────────────────────────────────
module.exports = {
  name: "Microsoft Neural TTS Multi-Voice",
  category: "media",
  method: "GET",
  path: "/api/v1/media/microsoft/tts",
  handler: async (req, res) => {
    try {
      // 1. Direct Auto-Download Endpoint (?download=filename හෝ ?token=filename)
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

        // Force Auto-Download Headers
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${targetFile}"`);
        res.setHeader("Content-Length", stat.size);
        res.setHeader("Cache-Control", "no-cache");

        return fs.createReadStream(filePath).pipe(res);
      }

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

      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
      const host = req.get("host");
      const currentHost = `${protocol}://${host}`;
      const apiKeyParam = req.query.api ? `&api=${encodeURIComponent(req.query.api)}` : "";

      // 2. තනි Voice එකක් සඳහා auto download link සැකසීම
      if (singleVoice) {
        const audioBuffer = await synthesizeEdgeRest(text.trim(), singleVoice, pitch, rate);

        if (isStream) {
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Length", audioBuffer.length);
          res.setHeader("Accept-Ranges", "bytes");
          return res.end(audioBuffer);
        }

        const fileName = saveTempAudio(audioBuffer, singleVoice);
        // Link එකට ගිය සැණින් Auto Download වේ
        const autoDownloadUrl = `${currentHost}/api/v1/media/microsoft/tts?download=${fileName}${apiKeyParam}`;

        return res.json({
          success: true,
          voice: singleVoice,
          text: text.trim(),
          fileSize: `${(audioBuffer.length / 1024).toFixed(1)} KB`,
          downloadUrl: autoDownloadUrl,
          expiresIn: "20 minutes"
        });
      }

      // 3. All Voices — Multi Auto-Download Links
      const voicePromises = AVAILABLE_VOICES.map(async (v) => {
        try {
          const audioBuffer = await synthesizeEdgeRest(text.trim(), v.id, pitch, rate);
          const fileName = saveTempAudio(audioBuffer, v.id);
          const autoDownloadUrl = `${currentHost}/api/v1/media/microsoft/tts?download=${fileName}${apiKeyParam}`;

          return {
            id: v.id,
            name: v.name,
            gender: v.gender,
            language: v.lang,
            flag: v.flag,
            size: `${(audioBuffer.length / 1024).toFixed(1)} KB`,
            autoDownloadUrl
          };
        } catch (voiceErr) {
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
