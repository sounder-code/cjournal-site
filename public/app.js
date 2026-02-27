import { lizardProfiles } from "./lizardProfiles.js";
import { findClosestLizardsByFeatures, normalizeFeatures } from "./lizardMatcher.js";
import { RESULT_IMAGE_MAP } from "./resultImageMap.js";

const photoInput = document.getElementById("photoInput");
const namePanel = document.getElementById("namePanel");
const uploadPanel = document.getElementById("uploadPanel");
const userNameInput = document.getElementById("userNameInput");
const startTestBtn = document.getElementById("startTestBtn");
const uploadDrop = document.getElementById("uploadDrop");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const analyzeBtn = document.getElementById("analyzeBtn");
const retryBtn = document.getElementById("retryBtn");
const analyzeStatus = document.getElementById("analyzeStatus");
const resultPanel = document.getElementById("resultPanel");
const resultOwner = document.getElementById("resultOwner");
const lizardName = document.getElementById("lizardName");
const matchScore = document.getElementById("matchScore");
const lizardArtImage = document.getElementById("lizardArtImage");
const lizardTags = document.getElementById("lizardTags");
const lizardDesc = document.getElementById("lizardDesc");
const topMatches = document.getElementById("topMatches");
const shareHint = document.getElementById("shareHint");
const shareCommon = document.getElementById("shareCommon");
const shareCard = document.getElementById("shareCard");
const shareKakao = document.getElementById("shareKakao");
const shareInsta = document.getElementById("shareInsta");
const adTopSection = document.getElementById("adTopSection");
const adTopSlot = document.getElementById("adTopSlot");
const adResultSection = document.getElementById("adResultSection");
const adResultSlot = document.getElementById("adResultSlot");
const analysisCanvas = document.getElementById("analysisCanvas");
const pageRoot = document.body;

const appConfig = window.APP_CONFIG || {};
const KAKAO_JS_KEY = appConfig.KAKAO_JS_KEY || "";
const API_BASE_URL = (appConfig.API_BASE_URL || "/api").trim().replace(/\/+$/, "");
const SHARE_IMAGE_URL =
  appConfig.SHARE_IMAGE_URL ||
  "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1200&q=80";
const STATIC_RESULT_IMAGE_MAP = { ...RESULT_IMAGE_MAP, ...(appConfig.RESULT_IMAGE_MAP || {}) };
const GA_MEASUREMENT_ID = (appConfig.GA_MEASUREMENT_ID || "").trim();
const ADSENSE_CLIENT_ID = (appConfig.ADSENSE_CLIENT_ID || "").trim();
const ADSENSE_SLOT_TOP = (appConfig.ADSENSE_SLOT_TOP || "").trim();
const ADSENSE_SLOT_RESULT = (appConfig.ADSENSE_SLOT_RESULT || "").trim();
const TEST_ID = (pageRoot?.dataset.testId || "lizard_face_match").trim();
const PAGE_TYPE = (pageRoot?.dataset.pageType || TEST_ID).trim();
const TEST_TITLE = (pageRoot?.dataset.testTitle || document.title || "나와 닮은 도마뱀 찾기").trim();
const SHARE_RESULT_TITLE = (pageRoot?.dataset.shareTitle || `${TEST_TITLE} 결과`).trim();
const TEST_BRAND_LABEL = (pageRoot?.dataset.testBrand || "Lizard Face Match").trim();
const DOWNLOAD_PREFIX = (pageRoot?.dataset.downloadPrefix || "lizard-face-match").trim();
const profileByName = new Map(lizardProfiles.map((profile) => [profile.name, profile]));

let currentResultText = "";
let currentShareUrl = "";
let currentShareImageUrl = SHARE_IMAGE_URL;
let currentResult = null;
let currentUserName = "";
let isAnalyzing = false;
let canOpenFilePickerAt = 0;
let isAnalyticsReady = false;
const pendingEvents = [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setHint(text) {
  shareHint.textContent = text;
}

function trackEvent(eventName, params = {}) {
  if (!isAnalyticsReady || typeof window.gtag !== "function") {
    pendingEvents.push({ eventName, params });
    return;
  }
  window.gtag("event", eventName, params);
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`failed: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === true) script.setAttribute(key, "");
      else script.setAttribute(key, String(value));
    });
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`failed: ${src}`));
    document.head.appendChild(script);
  });
}

async function initAnalytics() {
  if (!GA_MEASUREMENT_ID) return;
  await loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`, {
    async: true,
  });

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { anonymize_ip: true, send_page_view: false });
  isAnalyticsReady = true;
  while (pendingEvents.length) {
    const evt = pendingEvents.shift();
    if (!evt) break;
    window.gtag("event", evt.eventName, evt.params);
  }
}

async function initAds() {
  if (!ADSENSE_CLIENT_ID) return;

  const slots = [
    { section: adTopSection, slot: adTopSlot, slotId: ADSENSE_SLOT_TOP },
    { section: adResultSection, slot: adResultSlot, slotId: ADSENSE_SLOT_RESULT },
  ].filter((item) => item.section && item.slot && item.slotId);

  if (!slots.length) return;

  await loadScript(
    `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT_ID)}`,
    { async: true, crossorigin: "anonymous" },
  );

  window.adsbygoogle = window.adsbygoogle || [];
  slots.forEach(({ section, slot, slotId }) => {
    section.hidden = false;
    slot.setAttribute("data-ad-client", ADSENSE_CLIENT_ID);
    slot.setAttribute("data-ad-slot", slotId);
    if (slot.dataset.loaded === "true") return;
    try {
      window.adsbygoogle.push({});
      slot.dataset.loaded = "true";
    } catch {
      section.hidden = true;
    }
  });
}

function setAnalyzeState(state, text) {
  analyzeStatus.textContent = text;
  if (state === "loading") {
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add("is-loading");
    analyzeBtn.textContent = "분석 중...";
    return;
  }

  analyzeBtn.disabled = false;
  analyzeBtn.classList.remove("is-loading");
  analyzeBtn.textContent = "닮은 도마뱀 분석하기";
}

function getBaseUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function encodeResultPayload(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeResultPayload(token) {
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

function getResultImageUrl(result) {
  return result.imageUrl || STATIC_RESULT_IMAGE_MAP[result.name] || SHARE_IMAGE_URL;
}

function toAbsoluteUrl(url) {
  if (!url) return "";
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return "";
  }
}

function getKakaoImageUrl() {
  const absoluteResultImage = toAbsoluteUrl(currentShareImageUrl);
  const absoluteFallbackImage = toAbsoluteUrl(SHARE_IMAGE_URL);

  // Kakao 미리보기는 SVG에서 누락될 수 있어 JPG/PNG fallback을 우선 보장합니다.
  if (!absoluteResultImage) return absoluteFallbackImage;
  if (absoluteResultImage.toLowerCase().endsWith(".svg")) return absoluteFallbackImage || absoluteResultImage;
  return absoluteResultImage;
}

function buildShareUrlFromResult(result) {
  const payload = {
    v: 2,
    userName: currentUserName,
    name: result.name,
    score: result.score,
    imageUrl: getResultImageUrl(result),
    top3: result.top3.map((item) => ({ name: item.name, score: item.score })),
  };
  const url = new URL(getBaseUrl());
  url.searchParams.set("r", encodeResultPayload(payload));
  return url.toString();
}

function validateSharedResult(payload) {
  if (!payload || (payload.v !== 1 && payload.v !== 2)) return false;
  if (payload.userName && typeof payload.userName !== "string") return false;
  if (typeof payload.name !== "string") return false;
  if (typeof payload.score !== "number") return false;
  if (payload.imageUrl && typeof payload.imageUrl !== "string") return false;
  if (payload.v === 1 && typeof payload.desc !== "string") return false;
  if (payload.tags && !Array.isArray(payload.tags)) return false;
  if (!Array.isArray(payload.top3) || payload.top3.length === 0) return false;
  return payload.top3.every(
    (item) =>
      item &&
      typeof item.name === "string" &&
      typeof item.score === "number" &&
      (!item.tags || Array.isArray(item.tags)),
  );
}

function tagsFromProfileName(name, fallbackTags = []) {
  const profile = profileByName.get(name);
  if (!profile) return fallbackTags;
  return [profile.type, profile.morph].filter(Boolean);
}

function descFromProfileName(name, fallbackDesc = "") {
  const profile = profileByName.get(name);
  return profile?.desc || fallbackDesc;
}

function renderResult(result, options = {}) {
  const imageUrl = getResultImageUrl(result);
  if (options.fromShared) {
    namePanel.hidden = true;
    uploadPanel.hidden = true;
  }
  previewWrap.hidden = true;
  previewImage.src = "";
  resultOwner.textContent = currentUserName ? `${currentUserName}님의 결과` : "분석 결과";
  lizardName.textContent = result.name;
  matchScore.textContent = `유사도 ${result.score}%`;
  lizardArtImage.onerror = () => {
    lizardArtImage.src = SHARE_IMAGE_URL;
  };
  lizardArtImage.src = imageUrl;
  lizardArtImage.alt = `${result.name} 결과 이미지`;
  const tags = result.tags || [];
  lizardTags.innerHTML = tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("");
  lizardDesc.textContent = result.desc;
  topMatches.innerHTML = result.top3
    .map((item) => {
      const itemTags = item.tags?.length ? ` (${item.tags.join(" · ")})` : "";
      return `<li>${escapeHtml(item.name)} - ${item.score}%${escapeHtml(itemTags)}</li>`;
    })
    .join("");
  resultPanel.hidden = false;

  currentResultText = currentUserName
    ? `${currentUserName}님의 닮은 도마뱀은 ${result.name}! (${result.score}% 일치)`
    : `내 닮은 도마뱀은 ${result.name}! (${result.score}% 일치)`;
  currentShareImageUrl = imageUrl;
  currentShareUrl = options.shareUrl || buildShareUrlFromResult(result);
  currentResult = {
    ...result,
    imageUrl,
  };

  if (options.fromShared) {
    setAnalyzeState("done", "공유 링크 결과 보기");
    setHint("공유 링크로 전달된 결과입니다. 다시 공유할 수 있어요.");
    return;
  }

  setAnalyzeState("done", "분석 완료");
  setHint("결과가 생성되었습니다. 아래 버튼으로 공유할 수 있어요.");
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hydrateResultFromUrl() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("r");
    if (!token) return false;

    const payload = decodeResultPayload(token);
    if (!validateSharedResult(payload)) return false;
    currentUserName = payload.userName || "";
    userNameInput.value = currentUserName;
    if (currentUserName) {
      namePanel.hidden = true;
      uploadPanel.hidden = false;
    }

    renderResult(
      {
        name: payload.name,
        score: payload.score,
        desc: descFromProfileName(payload.name, payload.desc || ""),
        imageUrl: payload.imageUrl || "",
        tags: tagsFromProfileName(payload.name, payload.tags || []),
        top3: payload.top3.map((item) => ({
          ...item,
          tags: tagsFromProfileName(item.name, item.tags || []),
        })),
      },
      { fromShared: true, shareUrl: window.location.href },
    );
    return true;
  } catch {
    return false;
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setHint("이미지 파일만 업로드할 수 있습니다.");
    setAnalyzeState("error", "이미지 파일을 선택해주세요.");
    return;
  }

  const dataUrl = await readFile(file);
  previewImage.src = dataUrl;
  previewWrap.hidden = false;
  resultPanel.hidden = true;
  topMatches.innerHTML = "";
  currentResultText = "";
  currentShareUrl = getBaseUrl();
  currentShareImageUrl = SHARE_IMAGE_URL;
  currentResult = null;
  setAnalyzeState("idle", "준비 완료. 분석 버튼을 눌러주세요.");
  setHint("사진이 준비되었습니다. 분석 버튼을 눌러주세요.");
}

function sanitizeUserName(value) {
  return String(value || "").trim().slice(0, 2);
}

function setupNameStep() {
  const start = () => {
    const name = sanitizeUserName(userNameInput.value);
    if (name.length !== 2) {
      setHint("이름은 2글자로 입력해주세요.");
      userNameInput.focus();
      return;
    }
    currentUserName = name;
    canOpenFilePickerAt = Date.now() + 700;
    namePanel.hidden = true;
    uploadPanel.hidden = false;
    setHint(`${currentUserName}님, 사진을 업로드해 주세요.`);
    trackEvent("start_test", {
      test_id: TEST_ID,
      user_name_len: currentUserName.length,
    });
    uploadDrop.focus();
  };

  startTestBtn.addEventListener("click", start);
  userNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      start();
    }
  });
}

function setupUploadInteractions() {
  const pickFile = () => {
    if (Date.now() < canOpenFilePickerAt) return;
    photoInput.value = "";
    photoInput.click();
  };

  uploadDrop.addEventListener("click", () => pickFile());
  uploadDrop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickFile();
    }
  });

  photoInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    handleFile(file).catch(() => setHint("이미지를 불러오지 못했습니다."));
  });

  // 브라우저 기본 동작(파일 열기)을 막아야 드래그앤드롭이 안정적으로 동작합니다.
  ["dragenter", "dragover", "dragleave", "drop"].forEach((type) => {
    window.addEventListener(type, (event) => {
      event.preventDefault();
    });
    document.addEventListener(type, (event) => {
      event.preventDefault();
    });
  });

  let dragDepth = 0;
  uploadDrop.addEventListener("dragenter", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    uploadDrop.classList.add("dragover");
  });

  uploadDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    uploadDrop.classList.add("dragover");
  });

  uploadDrop.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) uploadDrop.classList.remove("dragover");
  });

  uploadDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    uploadDrop.classList.remove("dragover");
    const dt = event.dataTransfer;
    let file = dt?.files?.[0] || null;
    if (!file && dt?.items?.length) {
      for (const item of dt.items) {
        if (item.kind === "file") {
          file = item.getAsFile();
          if (file) break;
        }
      }
    }
    if (!file) {
      setHint("드롭된 항목에서 이미지 파일을 찾지 못했습니다.");
      return;
    }
    handleFile(file).catch(() => setHint("이미지를 불러오지 못했습니다."));
  });
}

function extractImageFeatures(img, regionRatio = null) {
  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas를 사용할 수 없습니다.");

  const size = 160;
  analysisCanvas.width = size;
  analysisCanvas.height = size;
  ctx.drawImage(img, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const rx = regionRatio ? Math.max(0, Math.min(1, regionRatio.x)) : 0;
  const ry = regionRatio ? Math.max(0, Math.min(1, regionRatio.y)) : 0;
  const rw = regionRatio ? Math.max(0.05, Math.min(1 - rx, regionRatio.w)) : 1;
  const rh = regionRatio ? Math.max(0.05, Math.min(1 - ry, regionRatio.h)) : 1;

  const minX = Math.floor(rx * size);
  const minY = Math.floor(ry * size);
  const maxX = Math.min(size, Math.ceil((rx + rw) * size));
  const maxY = Math.min(size, Math.ceil((ry + rh) * size));

  const centerX = (minX + maxX - 1) / 2;
  const centerY = (minY + maxY - 1) / 2;
  const maxDist = Math.sqrt(((maxX - minX) / 2) ** 2 + ((maxY - minY) / 2) ** 2) || 1;

  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;

  let satSum = 0;
  let valSum = 0;
  const bucketMap = new Map();

  for (let i = 0, px = 0; i < data.length; i += 4, px += 1) {
    const alpha = data[i + 3];
    if (alpha < 32) continue;

    const x = px % size;
    const y = Math.floor(px / size);
    if (x < minX || x >= maxX || y < minY || y >= maxY) continue;

    const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
    const centerWeight = 1 - 0.55 * (dist / maxDist);
    const weight = Math.max(0.45, centerWeight);

    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];

    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    weightSum += weight;

    const max = Math.max(pr, pg, pb) / 255;
    const min = Math.min(pr, pg, pb) / 255;
    const delta = max - min;
    const sat = max === 0 ? 0 : delta / max;
    satSum += sat * weight;
    valSum += max * weight;

    const key = `${Math.floor(pr / 24)}-${Math.floor(pg / 24)}-${Math.floor(pb / 24)}`;
    bucketMap.set(key, (bucketMap.get(key) || 0) + weight);
  }

  if (!weightSum) return normalizeFeatures({ avgRgb: [128, 128, 128] });

  const avgRgb = [Math.round(r / weightSum), Math.round(g / weightSum), Math.round(b / weightSum)];
  const dominantColors = [...bucketMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, weight]) => {
      const [rb, gb, bb] = key.split("-").map(Number);
      return {
        rgb: [rb * 24 + 12, gb * 24 + 12, bb * 24 + 12],
        weight,
      };
    });

  return normalizeFeatures({
    avgRgb,
    dominantColors,
    saturation: satSum / weightSum,
    brightness: valSum / weightSum,
  });
}

function extractFacialPatternMetrics(img, regionRatio) {
  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { edgeDensity: 0.5, contrast: 0.5, symmetry: 0.5 };

  const size = 140;
  analysisCanvas.width = size;
  analysisCanvas.height = size;
  ctx.drawImage(img, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const rx = Math.max(0, Math.min(1, regionRatio?.x ?? 0.2));
  const ry = Math.max(0, Math.min(1, regionRatio?.y ?? 0.16));
  const rw = Math.max(0.05, Math.min(1 - rx, regionRatio?.w ?? 0.6));
  const rh = Math.max(0.05, Math.min(1 - ry, regionRatio?.h ?? 0.58));

  const minX = Math.floor(rx * size);
  const minY = Math.floor(ry * size);
  const maxX = Math.min(size, Math.ceil((rx + rw) * size));
  const maxY = Math.min(size, Math.ceil((ry + rh) * size));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 8 || height < 8) return { edgeDensity: 0.5, contrast: 0.5, symmetry: 0.5 };

  const luminance = new Float32Array(size * size);
  let mean = 0;
  let m2 = 0;
  let count = 0;

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const idx = (y * size + x) * 4;
      const l = data[idx] * 0.2126 + data[idx + 1] * 0.7152 + data[idx + 2] * 0.0722;
      luminance[y * size + x] = l;
      count += 1;
      const delta = l - mean;
      mean += delta / count;
      m2 += delta * (l - mean);
    }
  }

  if (!count) return { edgeDensity: 0.5, contrast: 0.5, symmetry: 0.5 };
  const stdev = Math.sqrt(m2 / count);

  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = minY; y < maxY - 1; y += 1) {
    for (let x = minX; x < maxX - 1; x += 1) {
      const p = luminance[y * size + x];
      const dx = Math.abs(p - luminance[y * size + (x + 1)]);
      const dy = Math.abs(p - luminance[(y + 1) * size + x]);
      edgeSum += dx + dy;
      edgeCount += 2;
    }
  }

  let symmetryDiff = 0;
  let symmetryCount = 0;
  const half = Math.floor(width / 2);
  for (let y = minY; y < maxY; y += 1) {
    for (let offset = 0; offset < half; offset += 1) {
      const leftX = minX + offset;
      const rightX = maxX - 1 - offset;
      const left = luminance[y * size + leftX];
      const right = luminance[y * size + rightX];
      symmetryDiff += Math.abs(left - right);
      symmetryCount += 1;
    }
  }

  const contrast = Math.max(0, Math.min(1, stdev / 62));
  const edgeDensity = Math.max(0, Math.min(1, (edgeSum / Math.max(1, edgeCount)) / 54));
  const symmetry = Math.max(0, Math.min(1, 1 - (symmetryDiff / Math.max(1, symmetryCount)) / 90));

  return { edgeDensity, contrast, symmetry };
}

function mergeFeatureSets(globalFeatures, facialFeatures, faceWeight = 0.4, facialPattern = null) {
  const globalWeight = 1 - faceWeight;
  const avgRgb = [0, 1, 2].map((i) =>
    Math.round(globalFeatures.avgRgb[i] * globalWeight + facialFeatures.avgRgb[i] * faceWeight),
  );

  const dominantColors = [
    ...globalFeatures.dominantColors.map((item) => ({
      rgb: item.rgb,
      weight: item.weight * globalWeight,
    })),
    ...facialFeatures.dominantColors.map((item) => ({
      rgb: item.rgb,
      weight: item.weight * faceWeight,
    })),
  ];

  return normalizeFeatures({
    avgRgb,
    dominantColors,
    saturation: globalFeatures.saturation * globalWeight + facialFeatures.saturation * faceWeight,
    brightness: globalFeatures.brightness * globalWeight + facialFeatures.brightness * faceWeight,
    facialPattern,
  });
}

async function detectFaceRegionRatio(img) {
  if (typeof window.FaceDetector !== "function") return null;

  try {
    const detector = new window.FaceDetector({ maxDetectedFaces: 1, fastMode: true });
    const faces = await detector.detect(img);
    if (!faces?.length) return null;

    const box = faces[0].boundingBox;
    if (!box || !img.naturalWidth || !img.naturalHeight) return null;

    return {
      x: box.x / img.naturalWidth,
      y: box.y / img.naturalHeight,
      w: box.width / img.naturalWidth,
      h: box.height / img.naturalHeight,
    };
  } catch {
    return null;
  }
}

function buildResultFromTop3(top3) {
  const best = top3[0];
  return {
    name: best.name,
    score: best.score,
    desc: best.desc,
    tags: best.tags || [],
    top3: top3.map((item) => ({ name: item.name, score: item.score, tags: item.tags || [] })),
  };
}

function isValidAnalyzeResponse(data) {
  if (!data || typeof data !== "object") return false;
  if (typeof data.name !== "string" || typeof data.desc !== "string") return false;
  if (typeof data.score !== "number") return false;
  if (data.tags && !Array.isArray(data.tags)) return false;
  if (!Array.isArray(data.top3) || data.top3.length === 0) return false;
  return data.top3.every(
    (item) =>
      item &&
      typeof item.name === "string" &&
      typeof item.score === "number" &&
      (!item.tags || Array.isArray(item.tags)),
  );
}

async function analyzeByApi(features) {
  if (!API_BASE_URL) return null;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(features),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!isValidAnalyzeResponse(data)) return null;
    return data;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function analyzeCurrentImage() {
  if (isAnalyzing) return;

  if (!previewImage.src) {
    setHint("먼저 사진을 업로드해주세요.");
    setAnalyzeState("error", "사진이 아직 없습니다.");
    return;
  }

  isAnalyzing = true;
  setAnalyzeState("loading", "이미지를 분석하고 있습니다...");

  const img = new Image();
  img.onload = () => {
    window.setTimeout(async () => {
      try {
        const globalFeatures = extractImageFeatures(img);
        const detectedFace = await detectFaceRegionRatio(img);
        const fallbackFace = { x: 0.2, y: 0.16, w: 0.6, h: 0.58 };
        const faceRegion = detectedFace || fallbackFace;
        const facialFeatures = extractImageFeatures(img, faceRegion);
        const facialPattern = extractFacialPatternMetrics(img, faceRegion);
        const features = mergeFeatureSets(globalFeatures, facialFeatures, 0.4, facialPattern);
        const apiResult = await analyzeByApi(features);
        if (apiResult) {
          renderResult(apiResult);
          trackEvent("analyze_success", { source: "api", lizard_name: apiResult.name });
          setHint("API 분석 결과입니다.");
          return;
        }

        const localTop3 = findClosestLizardsByFeatures(features, lizardProfiles);
        const localResult = buildResultFromTop3(localTop3);
        renderResult(localResult);
        trackEvent("analyze_success", { source: "local", lizard_name: localResult.name });
        setHint("API 연결 실패로 로컬 분석 결과를 표시했습니다.");
      } catch {
        trackEvent("analyze_error");
        setAnalyzeState("error", "분석 중 오류가 발생했습니다.");
        setHint("이미지 분석에 실패했습니다. 다른 사진으로 시도해주세요.");
      } finally {
        isAnalyzing = false;
      }
    }, 600);
  };
  img.onerror = () => {
    isAnalyzing = false;
    setAnalyzeState("error", "이미지를 읽을 수 없습니다.");
    setHint("이미지 분석에 실패했습니다. 다른 사진으로 시도해주세요.");
  };
  img.src = previewImage.src;
}

async function copyShareText() {
  const shareUrl = currentShareUrl || getBaseUrl();
  const text = `${currentResultText}\n${shareUrl}`;
  try {
    await navigator.clipboard.writeText(text);
    setHint("공유 문구가 복사되었습니다.");
  } catch {
    setHint("클립보드 복사에 실패했습니다.");
  }
}

function sanitizeFileName(name) {
  return String(name).replaceAll(/[^\w\-가-힣]/g, "_");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const source = String(text || "").trim();
  if (!source) return y;

  const words = source.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }

    if (line) {
      lines.push(line);
      line = word;
    } else {
      // 공백 없는 긴 문자열(예: 이모지/특수문)도 안전하게 자릅니다.
      let chunk = "";
      for (const ch of word) {
        const probe = `${chunk}${ch}`;
        if (ctx.measureText(probe).width <= maxWidth) chunk = probe;
        else {
          lines.push(chunk);
          chunk = ch;
          if (lines.length >= maxLines) break;
        }
      }
      line = chunk;
    }

    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;

  if (words.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (!last.endsWith("...")) {
      let trimmed = last;
      while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[maxLines - 1] = `${trimmed}...`;
    }
  }

  lines.forEach((row, index) => {
    ctx.fillText(row, x, y + index * lineHeight);
  });

  return y + (lines.length - 1) * lineHeight;
}

async function createShareCardBlob() {
  if (!currentResult) return null;

  const width = 1200;
  const height = 630;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#f3f7e8");
  bg.addColorStop(1, "#d8ecad");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ffffffd9";
  ctx.strokeStyle = "#cfe2c8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(36, 36, width - 72, height - 72, 24);
  ctx.fill();
  ctx.stroke();

  const imageBox = { x: 72, y: 96, w: 520, h: 438 };
  ctx.fillStyle = "#e9f4e2";
  ctx.beginPath();
  ctx.roundRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h, 18);
  ctx.fill();

  try {
    const image = await loadImage(currentShareImageUrl || SHARE_IMAGE_URL);
    const scale = Math.max(imageBox.w / image.width, imageBox.h / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const dx = imageBox.x + (imageBox.w - drawW) / 2;
    const dy = imageBox.y + (imageBox.h - drawH) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(imageBox.x, imageBox.y, imageBox.w, imageBox.h, 18);
    ctx.clip();
    ctx.drawImage(image, dx, dy, drawW, drawH);
    ctx.restore();
  } catch {
    ctx.fillStyle = "#6f9d73";
    ctx.font = "700 34px Pretendard, sans-serif";
    ctx.fillText(TEST_BRAND_LABEL, imageBox.x + 36, imageBox.y + 68);
  }

  const textX = 640;
  ctx.fillStyle = "#2d4630";
  ctx.font = "700 28px Pretendard, sans-serif";
  const ownerText = currentUserName ? `${currentUserName}님의 도마뱀 테스트` : "나와 닮은 도마뱀";
  ctx.fillText(ownerText, textX, 130);

  ctx.fillStyle = "#15251b";
  ctx.font = "800 52px Pretendard, sans-serif";
  ctx.fillText(currentResult.name, textX, 210);

  ctx.fillStyle = "#356243";
  ctx.font = "700 34px Pretendard, sans-serif";
  ctx.fillText(`유사도 ${currentResult.score}%`, textX, 270);

  const tags = (currentResult.tags || []).slice(0, 3).join(" · ");
  if (tags) {
    ctx.fillStyle = "#4e6a50";
    ctx.font = "600 24px Pretendard, sans-serif";
    ctx.fillText(tags, textX, 315);
  }

  ctx.fillStyle = "#2f4a34";
  ctx.font = "500 21px Pretendard, sans-serif";
  drawWrappedText(ctx, currentResult.desc, textX, 360, 490, 30, 5);

  ctx.fillStyle = "#3e5f42";
  ctx.font = "500 22px Pretendard, sans-serif";
  const topLine = (currentResult.top3 || [])
    .slice(0, 3)
    .map((item) => `${item.name} ${item.score}%`)
    .join("   |   ");
  ctx.fillText(topLine, 72, 578);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function saveShareCardImage() {
  if (!currentResult) {
    setHint("먼저 분석 결과를 만들어주세요.");
    return;
  }

  const blob = await createShareCardBlob();
  if (!blob) {
    setHint("공유 카드 생성에 실패했습니다.");
    return;
  }

  const name = sanitizeFileName(currentResult.name);
  const fileName = `${DOWNLOAD_PREFIX}-${name}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  trackEvent("save_share_card", { lizard_name: currentResult.name });
  setHint("결과 카드 이미지가 저장되었습니다.");
}

async function handleWebShare() {
  if (!currentResultText) {
    setHint("먼저 분석 결과를 만들어주세요.");
    return;
  }

  const data = {
    title: TEST_TITLE,
    text: currentResultText,
    url: currentShareUrl || getBaseUrl(),
  };

  if (navigator.share) {
    trackEvent("share_click", {
      test_id: TEST_ID,
      channel: "web",
      lizard_name: currentResult?.name || "",
    });
    try {
      await navigator.share(data);
      trackEvent("share_web_success");
      setHint("공유를 완료했습니다.");
    } catch {
      trackEvent("share_web_cancel");
      setHint("공유가 취소되었거나 실패했습니다.");
    }
  } else {
    trackEvent("share_click", {
      test_id: TEST_ID,
      channel: "copy",
      lizard_name: currentResult?.name || "",
    });
    await copyShareText();
  }
}

async function handleKakaoShare() {
  if (!currentResultText) {
    setHint("먼저 분석 결과를 만들어주세요.");
    return;
  }
  trackEvent("share_click", {
    test_id: TEST_ID,
    channel: "kakao",
    lizard_name: currentResult?.name || "",
  });

  if (!window.Kakao || !KAKAO_JS_KEY) {
    await copyShareText();
    setHint("카카오 설정이 없어 공유 문구를 복사했습니다.");
    return;
  }

  try {
    if (!window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }

    if (!window.Kakao.Share) {
      throw new Error("Kakao.Share API를 찾을 수 없습니다.");
    }

    window.Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title: SHARE_RESULT_TITLE,
        description: currentResultText,
        imageUrl: getKakaoImageUrl(),
        link: {
          mobileWebUrl: currentShareUrl || getBaseUrl(),
          webUrl: currentShareUrl || getBaseUrl(),
        },
      },
      buttons: [
        {
          title: "결과 확인하기",
          link: {
            mobileWebUrl: currentShareUrl || getBaseUrl(),
            webUrl: currentShareUrl || getBaseUrl(),
          },
        },
      ],
    });
    trackEvent("share_kakao_success");
    setHint("카카오톡으로 공유를 열었습니다.");
  } catch {
    trackEvent("share_kakao_error");
    await copyShareText();
    setHint("카카오 공유에 실패해 문구를 복사했습니다.");
  }
}

function handleInstagramShareGuide() {
  if (!currentResultText) {
    setHint("먼저 분석 결과를 만들어주세요.");
    return;
  }
  trackEvent("share_click", {
    test_id: TEST_ID,
    channel: "insta",
    lizard_name: currentResult?.name || "",
  });

  copyShareText().then(() => {
    setHint("인스타는 직접 텍스트 공유 API가 없어 문구를 복사했어요. 스토리/게시물에 붙여넣어 주세요.");
  });
}

function wireEvents() {
  analyzeBtn.addEventListener("click", analyzeCurrentImage);
  retryBtn.addEventListener("click", () => photoInput.click());
  shareCommon.addEventListener("click", handleWebShare);
  shareCard.addEventListener("click", saveShareCardImage);
  shareKakao.addEventListener("click", handleKakaoShare);
  shareInsta.addEventListener("click", handleInstagramShareGuide);
}

setupNameStep();
setupUploadInteractions();
wireEvents();
initAnalytics().catch(() => {
  isAnalyticsReady = false;
});
initAds().catch(() => {
  if (adTopSection) adTopSection.hidden = true;
  if (adResultSection) adResultSection.hidden = true;
});
currentShareUrl = getBaseUrl();
setAnalyzeState("idle", "대기 중");
const isSharedResult = hydrateResultFromUrl();
trackEvent("landing_view", {
  page_type: PAGE_TYPE,
  test_id: TEST_ID,
  from_shared: isSharedResult ? "true" : "false",
});
if (!isSharedResult) {
  namePanel.hidden = false;
  uploadPanel.hidden = true;
  resultPanel.hidden = true;
}
