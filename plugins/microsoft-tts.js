const WebSocket = require("ws");
const crypto = require("crypto");

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EA65408183E4CBA214552F60";

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

// 401 Bypass Token (Sec-MS-GEC Generation)
function generateSecMsGec() {
  const WIN_EPOCH = 116444736000000000n;
  const ticks = BigInt(Date.now()) * 10000n + WIN_EPOCH;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash("sha256").update(strToHash, "ascii").digest("hex").toUpperCase();
}

function synthesizeSpeech(text, voice, pitch = "+0Hz", rate = "+0%") {
  return new Promise((resolve, reject) => {
    const secMsGec = generateSecMsGec();
    const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68`;

    const ws = new WebSocket(wssUrl, {
      headers: {
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
        "Origin": "chrome-extension://jdiccldimpdaibmpdkgiklldnnnkddap",
        "Accept-Encoding": "gzip, deflate, br"
      }
    });

    const requestId = crypto.randomUUID().replace(/-/g, "");
    const audioBuffers = [];

    ws.on("open", () => {
      // 1. Handshake config
      const configMsg = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3"
              }
            }
          }
        });
      ws.send(configMsg);

      // 2. SSML XML Payload
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitch}' rate='${rate}'>${text}</prosody>` +
        `</voice></speak>`;

      const requestMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(requestMsg);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const separator = Buffer.from("Path:audio\r\n");
        const index = data.indexOf(separator);
        if (index !== -1) {
          const audioChunk = data.subarray(index + separator.length);
          audioBuffers.push(audioChunk);
        }
      } else {
        const textData = data.toString();
        if (textData.includes("Path:turn.end")) {
          ws.close();
          resolve(Buffer.concat(audioBuffers));
        }
      }
    });

    ws.on("error", (err) => {
      reject(err);
    });

    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        reject(new Error("Edge TTS synthesis timeout"));
      }
    }, 15000);
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

      // 1. Direct Voice Stream
      if (singleVoice && isStream) {
        const audioBuffer = await synthesizeSpeech(text.trim(), singleVoice, pitch, rate);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", audioBuffer.length);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(audioBuffer);
      }

      // 2. All Voice Options
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
