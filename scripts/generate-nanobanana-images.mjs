import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const CUSTOM_API_URL = (process.env.NANOBANANA_API_URL || "").trim();
const CUSTOM_API_KEY = (process.env.NANOBANANA_API_KEY || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = (process.env.NANO_BANANA_MODEL || process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image").trim();
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
const OPENAI_IMAGE_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || "medium").trim();
const FLUX_LOCAL_API_URL = (process.env.FLUX_LOCAL_API_URL || "").trim();
const FLUX_LOCAL_API_KEY = (process.env.FLUX_LOCAL_API_KEY || "").trim();
const FLUX_LOCAL_MODEL = (process.env.FLUX_LOCAL_MODEL || "flux.2").trim();
const FLUX_LOCAL_NEGATIVE_PROMPT = (
  process.env.FLUX_LOCAL_NEGATIVE_PROMPT ||
  "text, letters, words, logo, watermark, caption, subtitle, infographic, banner, poster, ui, symbols, numbers, typography, label, signage, title, headline, callout, chart, diagram, monitor, tv screen, smartphone screen, laptop screen, billboard, road sign, storefront sign, package label, jersey number, keyboard legends, document, newspaper, magazine"
).trim();
const FLUX_LOCAL_STEPS = Math.max(8, Number(process.env.FLUX_LOCAL_STEPS || "24"));
const FLUX_LOCAL_CFG = Math.max(1, Number(process.env.FLUX_LOCAL_CFG || "2.2"));
const FLUX_LOCAL_TEXT_FREE_RETRIES = Math.max(1, Number(process.env.FLUX_LOCAL_TEXT_FREE_RETRIES || "8"));
const TEXT_DETECT_ENABLED = String(process.env.TEXT_DETECT_ENABLED || "true").trim().toLowerCase() !== "false";
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "flux-local").trim().toLowerCase();
const IMAGE_PARALLELISM = Math.max(1, Number(process.env.IMAGE_PARALLELISM || "3"));
const IMAGE_TIMEOUT_MS = Math.max(5000, Number(process.env.IMAGE_TIMEOUT_MS || "30000"));

function isLikelyRealOpenAiKey(key) {
  if (!key) return false;
  if (key.includes("OPENAI") || key.includes("YOUR_") || key.includes("***")) return false;
  return /^sk-[A-Za-z0-9_\-]{20,}$/.test(key);
}

function usage() {
  console.log("Usage: node scripts/generate-nanobanana-images.mjs <prompt-json> <output-dir>");
  console.log("Mode A (custom endpoint): NANOBANANA_API_URL + NANOBANANA_API_KEY");
  console.log("Mode B (Gemini direct): GEMINI_API_KEY (+ optional NANO_BANANA_MODEL)");
  console.log("Mode C (OpenAI direct): OPENAI_API_KEY (+ optional OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY)");
  console.log("Mode D (FLUX local API): FLUX_LOCAL_API_URL (+ optional FLUX_LOCAL_API_KEY)");
}

async function readPromptFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Prompt file must be a non-empty array");
  }
  return parsed;
}

function toBufferFromBase64(base64) {
  const clean = String(base64 || "").replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(clean, "base64");
}

function pickImageFromResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.image_url === "string") return { type: "url", value: payload.image_url };
  if (typeof payload.url === "string") return { type: "url", value: payload.url };
  if (typeof payload.b64_json === "string") return { type: "b64", value: payload.b64_json };
  if (Array.isArray(payload.data) && payload.data[0]) {
    const first = payload.data[0];
    if (typeof first.url === "string") return { type: "url", value: first.url };
    if (typeof first.b64_json === "string") return { type: "b64", value: first.b64_json };
  }
  return null;
}

async function fetchImageBuffer(imageRef) {
  if (imageRef.type === "b64") return toBufferFromBase64(imageRef.value);
  if (imageRef.type === "url") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    const res = await fetch(imageRef.value, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
  throw new Error("Unsupported image reference");
}

function pickGeminiInlineImage(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      if (inlineData?.data) {
        return {
          mimeType: inlineData.mimeType || "image/png",
          data: inlineData.data,
        };
      }
    }
  }
  return null;
}

function normalizePrompt(item) {
  const prompt = String(item.prompt || "").trim();
  const size = String(item.size || "").trim();
  const textSafeComposition =
    "Text-safe composition: avoid monitors/phones/TV/laptops, posters, signage, books/newspapers/documents, packaging, jerseys with numbers, storefronts, dashboards, and any object likely to contain writing. Prefer nature, food, product close-up, or plain interior surfaces without printed marks.";
  const hardRule =
    "Hard output constraints: image only; absolutely no visible text/letters/numbers/symbols in any language; no logos; no watermarks; no captions; no poster/title-card/banner/infographic layout; no signage; no labels; no UI screens; no document/paper text.";
  if (!size) return `${prompt}\n\n${textSafeComposition}\n${hardRule}`;
  return `${prompt}\n\nTarget image size: ${size}.\n${textSafeComposition}\n${hardRule}`;
}

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process timeout: ${cmd}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

async function hasLikelyVisibleText(buffer) {
  if (!TEXT_DETECT_ENABLED) return false;
  const tempBase = path.join(os.tmpdir(), `flux-text-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputPath = `${tempBase}.png`;
  const outputBase = `${tempBase}-ocr`;
  try {
    await fs.writeFile(inputPath, buffer);
    // OCR the whole image. Keep it short to avoid slowing generation too much.
    const { stdout = "" } = await runProcess(
      "tesseract",
      [inputPath, outputBase, "--psm", "6", "-l", "eng", "quiet"],
      12000,
    ).catch(() => ({ stdout: "" }));

    let text = stdout;
    try {
      text += await fs.readFile(`${outputBase}.txt`, "utf8");
    } catch {
      // ignore
    }

    // Accept tiny OCR noise, reject meaningful alnum sequences.
    const normalized = text.replace(/[^a-zA-Z0-9가-힣]/g, "");
    return normalized.length >= 3;
  } finally {
    await fs.rm(inputPath, { force: true }).catch(() => {});
    await fs.rm(`${outputBase}.txt`, { force: true }).catch(() => {});
  }
}

function normalizeOpenAiSize(inputSize) {
  const value = String(inputSize || "").trim();
  if (!value) return "1024x1024";
  if (value === "1024x1024" || value === "1536x1024" || value === "1024x1536") return value;
  const match = value.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return "1024x1024";
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "1024x1024";
  if (w > h) return "1536x1024";
  if (h > w) return "1024x1536";
  return "1024x1024";
}

function parseSize(inputSize) {
  const normalized = normalizeOpenAiSize(inputSize);
  const [w, h] = normalized.split("x").map((v) => Number(v));
  return { width: w || 1024, height: h || 1024 };
}

async function generateOneViaCustomApi(item) {
  const body = {
    prompt: normalizePrompt(item),
    size: item.size || "1024x1024",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const res = await fetch(CUSTOM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CUSTOM_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generation failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const payload = await res.json();
  const imageRef = pickImageFromResponse(payload);
  if (!imageRef) throw new Error("No image field found in API response");
  return fetchImageBuffer(imageRef);
}

async function generateOneViaFluxLocal(item) {
  if (!FLUX_LOCAL_API_URL) {
    throw new Error("FLUX_LOCAL_API_URL is required for flux-local provider");
  }

  const apiUrl = FLUX_LOCAL_API_URL.replace(/\/$/, "");
  const { width, height } = parseSize(item.size);
  const promptBase = normalizePrompt(item);

  // Stable Diffusion WebUI compatible endpoint.
  if (apiUrl.includes("/sdapi/v1/txt2img")) {
    for (let attempt = 1; attempt <= FLUX_LOCAL_TEXT_FREE_RETRIES; attempt += 1) {
      const prompt = `${promptBase}\n\nABSOLUTE RULE: Produce a clean photo scene with zero typography.`;
      const body = {
        prompt,
        negative_prompt: FLUX_LOCAL_NEGATIVE_PROMPT,
        steps: FLUX_LOCAL_STEPS,
        cfg_scale: FLUX_LOCAL_CFG,
        width,
        height,
        sampler_name: "Euler"
      };

      const headers = { "Content-Type": "application/json" };
      if (FLUX_LOCAL_API_KEY) headers.Authorization = `Bearer ${FLUX_LOCAL_API_KEY}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

      const res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`FLUX local (sdapi) failed (${res.status}): ${text.slice(0, 400)}`);
      }

      const payload = await res.json();
      const b64 = Array.isArray(payload?.images) ? payload.images[0] : null;
      if (!b64) throw new Error("FLUX local (sdapi) returned no image");
      const buffer = toBufferFromBase64(b64);

      if (!(await hasLikelyVisibleText(buffer))) return buffer;
      console.warn(`retry text-free image: ${item.id} (attempt ${attempt}/${FLUX_LOCAL_TEXT_FREE_RETRIES})`);
    }
    throw new Error(`FLUX local (sdapi) OCR text detected after ${FLUX_LOCAL_TEXT_FREE_RETRIES} attempts`);
  }

  // Gradio queue endpoint from local flux_ui.py
  if (apiUrl.includes("/gradio_api/call/generate")) {
    for (let attempt = 1; attempt <= FLUX_LOCAL_TEXT_FREE_RETRIES; attempt += 1) {
      const headers = { "Content-Type": "application/json" };
      if (FLUX_LOCAL_API_KEY) headers.Authorization = `Bearer ${FLUX_LOCAL_API_KEY}`;

      // flux_ui.py gradio sliders currently allow max 1024 for each side.
      const gWidth = Math.min(width, 1024);
      const gHeight = Math.min(height, 1024);
      const seed = Math.floor(Math.random() * 1_000_000_000);
      const prompt = `${promptBase}\n\nABSOLUTE RULE: produce a realistic photo only, with zero text/letters/numbers anywhere.`;
      const body = {
        data: [
          prompt,
          FLUX_LOCAL_NEGATIVE_PROMPT,
          FLUX_LOCAL_STEPS,
          FLUX_LOCAL_CFG,
          seed,
          gWidth,
          gHeight,
        ],
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
      const startRes = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!startRes.ok) {
        const text = await startRes.text();
        throw new Error(`FLUX local (gradio) start failed (${startRes.status}): ${text.slice(0, 400)}`);
      }

      const startPayload = await startRes.json();
      const eventId = String(startPayload?.event_id || "").trim();
      if (!eventId) throw new Error("FLUX local (gradio) returned no event_id");

      const eventUrl = `${apiUrl}/${eventId}`;
      const eventController = new AbortController();
      const eventTimer = setTimeout(() => eventController.abort(), Math.max(IMAGE_TIMEOUT_MS, 120000));
      const eventRes = await fetch(eventUrl, {
        method: "GET",
        headers,
        signal: eventController.signal,
      }).finally(() => clearTimeout(eventTimer));

      if (!eventRes.ok) {
        const text = await eventRes.text();
        throw new Error(`FLUX local (gradio) event failed (${eventRes.status}): ${text.slice(0, 400)}`);
      }

      const stream = await eventRes.text();
      const lines = stream.split(/\r?\n/).filter((line) => line.startsWith("data:"));
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const raw = lines[i].slice(5).trim();
        if (!raw || raw === "null") continue;
        try {
          const parsed = JSON.parse(raw);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const entry of arr) {
            if (entry && typeof entry === "object" && typeof entry.path === "string") {
              const filePath = entry.path;
              const buf = await fs.readFile(filePath);
              if (!(await hasLikelyVisibleText(buf))) return buf;
              console.warn(`retry text-free image: ${item.id} (attempt ${attempt}/${FLUX_LOCAL_TEXT_FREE_RETRIES})`);
              i = -1; // break outer loop and retry
              break;
            }
          }
        } catch {
          // Ignore malformed chunks and continue scanning.
        }
      }
    }
    throw new Error(`FLUX local (gradio) OCR text detected or no image after ${FLUX_LOCAL_TEXT_FREE_RETRIES} attempts`);
  }

  // OpenAI-compatible local endpoint.
  const prompt = `${promptBase}\n\nABSOLUTE RULE: Produce a clean photo scene with zero typography.`;
  const headers = { "Content-Type": "application/json" };
  if (FLUX_LOCAL_API_KEY) headers.Authorization = `Bearer ${FLUX_LOCAL_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: FLUX_LOCAL_MODEL,
      prompt,
      size: `${width}x${height}`
    }),
    signal: controller.signal
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FLUX local API failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const payload = await res.json();
  const imageRef = pickImageFromResponse(payload);
  if (!imageRef) throw new Error("FLUX local API returned no image");
  return fetchImageBuffer(imageRef);
}

async function generateOneViaGemini(item, apiKey) {
  const prompt = `${normalizePrompt(item)}\n\nOutput rule: Return image only.`;
  const endpoint = `${GEMINI_API_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini generation failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const payload = await res.json();
  const inline = pickGeminiInlineImage(payload);
  if (!inline?.data) throw new Error("No inline image returned by Gemini API");
  return toBufferFromBase64(inline.data);
}

async function generateOneViaGeminiWithRetry(item, apiKey) {
  const variants = [
    `${String(item.prompt || "").trim()}\n\nSimple photojournalistic composition. Absolutely no text, no logo, no watermark.`,
    `${String(item.prompt || "").trim()}\n\nNatural camera scene, not a poster. Avoid typography, signs, labels, UI, and overlays.`,
    `${String(item.prompt || "").trim()}\n\nObject/people scene only. No written characters (Korean/English/number), no symbols, no branding.`
  ];
  let lastError = null;
  for (const variant of variants) {
    try {
      return await generateOneViaGemini({ ...item, prompt: variant }, apiKey);
    } catch (error) {
      lastError = error;
    }
  }
  const msg = lastError?.message || String(lastError);
  throw new Error(`Gemini image retry failed: ${msg}`);
}

async function generateOneViaOpenAI(item, apiKey) {
  const body = {
    model: OPENAI_IMAGE_MODEL,
    prompt: normalizePrompt(item),
    size: normalizeOpenAiSize(item.size),
    quality: OPENAI_IMAGE_QUALITY,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI generation failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const payload = await res.json();
  const imageRef = pickImageFromResponse(payload);
  if (!imageRef) throw new Error("No image field found in OpenAI response");
  return fetchImageBuffer(imageRef);
}

async function main() {
  const [promptPathArg, outputDirArg] = process.argv.slice(2);
  if (!promptPathArg || !outputDirArg) {
    usage();
    process.exit(1);
  }

  const hasCustomMode = Boolean(CUSTOM_API_URL && CUSTOM_API_KEY);
  const hasFluxLocalMode = Boolean(FLUX_LOCAL_API_URL);
  const effectiveGeminiKey = GEMINI_API_KEY || (CUSTOM_API_URL ? "" : CUSTOM_API_KEY);
  const hasGeminiMode = Boolean(effectiveGeminiKey);
  const hasOpenAiMode = isLikelyRealOpenAiKey(OPENAI_API_KEY);
  if (!hasCustomMode && !hasGeminiMode && !hasOpenAiMode && !hasFluxLocalMode) {
    throw new Error(
      "Missing credentials: set FLUX_LOCAL_API_URL OR NANOBANANA_API_URL+NANOBANANA_API_KEY OR GEMINI_API_KEY OR OPENAI_API_KEY.",
    );
  }

  const promptPath = path.resolve(process.cwd(), promptPathArg);
  const outputDir = path.resolve(process.cwd(), outputDirArg);
  const prompts = await readPromptFile(promptPath);

  await fs.mkdir(outputDir, { recursive: true });

async function runOne(item) {
    const id = String(item.id || "").trim();
    const prompt = String(item.prompt || "").trim();
    if (!id || !prompt) throw new Error("Each prompt item needs id and prompt");
    console.log(`Generating ${id}...`);
    const provider = IMAGE_PROVIDER;
    let providerOrder;
    if (provider === "auto") {
      providerOrder = ["flux-local", "gemini", "openai", "custom"];
    } else if (provider === "flux-local" || provider === "flux") {
      providerOrder = ["flux-local"];
    } else if (provider === "gemini") {
      providerOrder = ["gemini"];
    } else if (provider === "openai") {
      providerOrder = ["openai"];
    } else if (provider === "custom") {
      providerOrder = ["custom"];
    } else {
      throw new Error(`Unsupported IMAGE_PROVIDER: ${provider}`);
    }
    const errors = [];
    let buffer = null;
    for (const current of providerOrder) {
      try {
        if (current === "flux-local") {
          if (!hasFluxLocalMode) {
            errors.push("flux-local: missing FLUX_LOCAL_API_URL");
            continue;
          }
          buffer = await generateOneViaFluxLocal({ id, prompt, size: item.size });
          if (await hasLikelyVisibleText(buffer)) {
            throw new Error("OCR detected visible text");
          }
          break;
        }
        if (current === "gemini") {
          if (!hasGeminiMode) {
            errors.push("gemini: missing GEMINI_API_KEY");
            continue;
          }
          buffer = await generateOneViaGeminiWithRetry({ id, prompt, size: item.size }, effectiveGeminiKey);
          if (await hasLikelyVisibleText(buffer)) {
            throw new Error("OCR detected visible text");
          }
          break;
        }
        if (current === "openai") {
          if (!hasOpenAiMode) {
            errors.push("openai: missing OPENAI_API_KEY");
            continue;
          }
          buffer = await generateOneViaOpenAI({ id, prompt, size: item.size }, OPENAI_API_KEY);
          if (await hasLikelyVisibleText(buffer)) {
            throw new Error("OCR detected visible text");
          }
          break;
        }
        if (current === "custom") {
          if (!hasCustomMode) {
            errors.push("custom: missing NANOBANANA_API_URL/NANOBANANA_API_KEY");
            continue;
          }
          buffer = await generateOneViaCustomApi({ id, prompt, size: item.size });
          if (await hasLikelyVisibleText(buffer)) {
            throw new Error("OCR detected visible text");
          }
          break;
        }
      } catch (error) {
        errors.push(`${current}: ${error?.message || String(error)}`);
      }
    }
    if (!buffer) throw new Error(`all providers failed for ${id} -> ${errors.join(" / ")}`);

    const filePath = path.join(outputDir, `${id}.png`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    console.log(`Saved: ${filePath}`);
  }

  const failures = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(IMAGE_PARALLELISM, prompts.length) }, async () => {
    while (cursor < prompts.length) {
      const index = cursor;
      cursor += 1;
      try {
        await runOne(prompts[index]);
      } catch (error) {
        const id = String(prompts[index]?.id || `index-${index}`);
        const message = error?.message || String(error);
        failures.push({ id, message });
        console.error(`skip image (error): ${id} (${message})`);
      }
    }
  });

  await Promise.all(workers);
  if (failures.length > 0) {
    const sample = failures.slice(0, 5).map((row) => `${row.id}: ${row.message}`).join(" | ");
    throw new Error(`image generation failed for ${failures.length} prompts. sample=${sample}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
