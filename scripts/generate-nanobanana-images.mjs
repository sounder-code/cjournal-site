import fs from "node:fs/promises";
import path from "node:path";

const CUSTOM_API_URL = (process.env.NANOBANANA_API_URL || "").trim();
const CUSTOM_API_KEY = (process.env.NANOBANANA_API_KEY || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = (process.env.NANO_BANANA_MODEL || process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image").trim();
const GEMINI_API_BASE = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
const OPENAI_IMAGE_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || "medium").trim();
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "auto").trim().toLowerCase();
const IMAGE_PARALLELISM = Math.max(1, Number(process.env.IMAGE_PARALLELISM || "3"));

function usage() {
  console.log("Usage: node scripts/generate-nanobanana-images.mjs <prompt-json> <output-dir>");
  console.log("Mode A (custom endpoint): NANOBANANA_API_URL + NANOBANANA_API_KEY");
  console.log("Mode B (Gemini direct): GEMINI_API_KEY (+ optional NANO_BANANA_MODEL)");
  console.log("Mode C (OpenAI direct): OPENAI_API_KEY (+ optional OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY)");
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
    const res = await fetch(imageRef.value);
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
      const inlineData = part?.inlineData;
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
  if (!size) return prompt;
  return `${prompt}\n\nTarget image size: ${size}.`;
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

async function generateOneViaCustomApi(item) {
  const body = {
    prompt: normalizePrompt(item),
    size: item.size || "1024x1024",
  };

  const res = await fetch(CUSTOM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CUSTOM_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Generation failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const payload = await res.json();
  const imageRef = pickImageFromResponse(payload);
  if (!imageRef) throw new Error("No image field found in API response");
  return fetchImageBuffer(imageRef);
}

async function generateOneViaGemini(item, apiKey) {
  const prompt = `${normalizePrompt(item)}\n\nOutput rule: Return image only. Do not return text.`;
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

  const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
  try {
    return await generateOneViaGemini(item, apiKey);
  } catch (firstError) {
    const fallbackItem = {
      ...item,
      prompt: `${String(item.prompt || "").trim()}\n\nSimple composition, no text, no logo, no watermark.`
    };
    try {
      return await generateOneViaGemini(fallbackItem, apiKey);
    } catch (secondError) {
      const firstMsg = firstError?.message || String(firstError);
      const secondMsg = secondError?.message || String(secondError);
      throw new Error(`Gemini image retry failed: ${firstMsg} / ${secondMsg}`);
    }
  }
}

async function generateOneViaOpenAI(item, apiKey) {
  const body = {
    model: OPENAI_IMAGE_MODEL,
    prompt: normalizePrompt(item),
    size: normalizeOpenAiSize(item.size),
    quality: OPENAI_IMAGE_QUALITY,
  };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

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
  const effectiveGeminiKey = GEMINI_API_KEY || (CUSTOM_API_URL ? "" : CUSTOM_API_KEY);
  const hasGeminiMode = Boolean(effectiveGeminiKey);
  const hasOpenAiMode = Boolean(OPENAI_API_KEY);
  if (!hasCustomMode && !hasGeminiMode && !hasOpenAiMode) {
    throw new Error(
      "Missing credentials: set NANOBANANA_API_URL+NANOBANANA_API_KEY OR GEMINI_API_KEY OR OPENAI_API_KEY.",
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
    let provider = IMAGE_PROVIDER;
    if (provider === "auto") {
      if (hasCustomMode) provider = "custom";
      else if (hasGeminiMode) provider = "gemini";
      else provider = "openai";
    }

    let buffer;
    if (provider === "custom") {
      if (!hasCustomMode) throw new Error("IMAGE_PROVIDER=custom but NANOBANANA_API_URL/NANOBANANA_API_KEY is missing");
      buffer = await generateOneViaCustomApi({ id, prompt, size: item.size });
    } else if (provider === "openai") {
      if (!hasOpenAiMode) throw new Error("IMAGE_PROVIDER=openai but OPENAI_API_KEY is missing");
      buffer = await generateOneViaOpenAI({ id, prompt, size: item.size }, OPENAI_API_KEY);
    } else if (provider === "gemini") {
      if (!hasGeminiMode) throw new Error("IMAGE_PROVIDER=gemini but GEMINI_API_KEY is missing");
      buffer = await generateOneViaGeminiWithRetry({ id, prompt, size: item.size }, effectiveGeminiKey);
    } else {
      throw new Error(`Unsupported IMAGE_PROVIDER: ${provider}`);
    }

    const filePath = path.join(outputDir, `${id}.png`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    console.log(`Saved: ${filePath}`);
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(IMAGE_PARALLELISM, prompts.length) }, async () => {
    while (cursor < prompts.length) {
      const index = cursor;
      cursor += 1;
      await runOne(prompts[index]);
    }
  });

  await Promise.all(workers);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
