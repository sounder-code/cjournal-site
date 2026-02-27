import { RNZ_CLASSIC_APTITUDE_DATA } from "./rnzClassicAptitudeData.js";

const pageRoot = document.body;
const appConfig = window.APP_CONFIG || {};

const GA_MEASUREMENT_ID = (appConfig.GA_MEASUREMENT_ID || "").trim();
const KAKAO_JS_KEY = (appConfig.KAKAO_JS_KEY || "").trim();
const ADSENSE_CLIENT_ID = (appConfig.ADSENSE_CLIENT_ID || "").trim();
const ADSENSE_SLOT_TOP = (appConfig.ADSENSE_SLOT_TOP || "").trim();
const ADSENSE_SLOT_RESULT = (appConfig.ADSENSE_SLOT_RESULT || "").trim();
const ADSENSE_SLOT_QUESTION = (appConfig.ADSENSE_SLOT_QUESTION || ADSENSE_SLOT_TOP).trim();
const ADSENSE_SLOT_RESULT_SECONDARY = (appConfig.ADSENSE_SLOT_RESULT_SECONDARY || ADSENSE_SLOT_RESULT).trim();

const TEST_ID = (pageRoot?.dataset.testId || "rnz_classic_aptitude").trim();
const TEST_TITLE = (pageRoot?.dataset.testTitle || RNZ_CLASSIC_APTITUDE_DATA.title).trim();
const SHARE_RESULT_TITLE = (pageRoot?.dataset.shareTitle || `${TEST_TITLE} 결과`).trim();
const STORAGE_KEY = `kuru:${TEST_ID}:state`;

const RESULT_IMAGE_MAP = {
  tourist: "/result-images/test-rnz-classic-aptitude-tourist.png",
  defender: "/result-images/test-rnz-classic-aptitude-defender.png",
  temptation: "/result-images/test-rnz-classic-aptitude-temptation.png",
  adapted: "/result-images/test-rnz-classic-aptitude-adapted.png",
  believer: "/result-images/test-rnz-classic-aptitude-believer.png",
  economy: "/result-images/test-rnz-classic-aptitude-economy.png",
  overlord: "/result-images/test-rnz-classic-aptitude-overlord.png",
};

const RESULT_THEME_MAP = {
  tourist: { accent: "#7fb2d7", soft: "#141d30", tint: "#0f1728" },
  defender: { accent: "#79be91", soft: "#13231f", tint: "#101b19" },
  temptation: { accent: "#e2b36c", soft: "#261c12", tint: "#1c1610" },
  adapted: { accent: "#a98ce9", soft: "#1d1930", tint: "#161426" },
  believer: { accent: "#e38ab4", soft: "#2a1623", tint: "#1e121a" },
  economy: { accent: "#63d0af", soft: "#122720", tint: "#0f1d18" },
  overlord: { accent: "#ef786a", soft: "#2a1718", tint: "#1f1113" },
};

const introLines = document.getElementById("introLines");
const startPanel = document.getElementById("startPanel");
const questionPanel = document.getElementById("questionPanel");
const resultPanel = document.getElementById("resultPanel");
const startTestBtn = document.getElementById("startTestBtn");
const questionText = document.getElementById("questionText");
const choiceList = document.getElementById("choiceList");
const backBtn = document.getElementById("backBtn");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressFill = document.getElementById("progressFill");
const resultImage = document.getElementById("resultImage");
const resultTitle = document.getElementById("resultTitle");
const resultSummary = document.getElementById("resultSummary");
const resultOneLiner = document.getElementById("resultOneLiner");
const resultBullets = document.getElementById("resultBullets");
const resultRecommend = document.getElementById("resultRecommend");
const shareHint = document.getElementById("shareHint");
const shareCommon = document.getElementById("shareCommon");
const shareKakao = document.getElementById("shareKakao");
const copyLink = document.getElementById("copyLink");
const saveImage = document.getElementById("saveImage");
const restartTest = document.getElementById("restartTest");
const stepStart = document.getElementById("stepStart");
const stepQuestion = document.getElementById("stepQuestion");
const stepResult = document.getElementById("stepResult");

const adStartSection = document.getElementById("adStartSection");
const adStartSlot = document.getElementById("adStartSlot");
const adQuestionSection = document.getElementById("adQuestionSection");
const adQuestionSlot = document.getElementById("adQuestionSlot");
const adResultDescSection = document.getElementById("adResultDescSection");
const adResultDescSlot = document.getElementById("adResultDescSlot");
const adResultRecommendSection = document.getElementById("adResultRecommendSection");
const adResultRecommendSlot = document.getElementById("adResultRecommendSlot");

let currentIndex = 0;
let answers = [];
let scores = {};
let currentResultId = "";
let answerSeq = 0;
let isAnalyticsReady = false;
const pendingEvents = [];

function trackEvent(eventName, params = {}) {
  if (!isAnalyticsReady || typeof window.gtag !== "function") {
    pendingEvents.push({ eventName, params });
    return;
  }
  window.gtag("event", eventName, params);
}

function setHint(text) {
  shareHint.textContent = text;
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === true) script.setAttribute(key, "");
      else script.setAttribute(key, String(value));
    });
    script.onload = () => resolve();
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
  window.gtag = window.gtag || function gtag() {
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
  await loadScript(
    `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT_ID)}`,
    { async: true, crossorigin: "anonymous" },
  );
  window.adsbygoogle = window.adsbygoogle || [];
}

function pushAd(section, slot, slotId) {
  if (!section || !slot || !slotId) return;
  window.adsbygoogle = window.adsbygoogle || [];
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
}

function toAbsolute(url) {
  return new URL(url, window.location.origin).toString();
}

function getResultImageUrl(resultId) {
  return RESULT_IMAGE_MAP[resultId] || "/result-images/test-rnz-classic-aptitude-main.png";
}

function saveState() {
  const payload = { currentIndex, answers, scores, currentResultId };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

function recomputeScores() {
  const fresh = {};
  for (const resultId of Object.keys(RNZ_CLASSIC_APTITUDE_DATA.results)) {
    fresh[resultId] = 0;
  }
  for (const answer of answers) {
    const choice = RNZ_CLASSIC_APTITUDE_DATA.questions[answer.qIndex]?.choices.find((item) => item.id === answer.choiceId);
    if (!choice) continue;
    for (const [type, value] of Object.entries(choice.score)) {
      fresh[type] = (fresh[type] || 0) + Number(value || 0);
    }
  }
  scores = fresh;
}

function tieBreakWithLastAnswer(tiedIds) {
  const ordered = [...answers].sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  for (const answer of ordered) {
    const choice = RNZ_CLASSIC_APTITUDE_DATA.questions[answer.qIndex]?.choices.find((item) => item.id === answer.choiceId);
    if (!choice) continue;
    const candidates = tiedIds.filter((id) => Number(choice.score[id] || 0) > 0);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      candidates.sort((a, b) => {
        const diff = Number(choice.score[b] || 0) - Number(choice.score[a] || 0);
        if (diff !== 0) return diff;
        return (
          RNZ_CLASSIC_APTITUDE_DATA.resultPriority.indexOf(a) -
          RNZ_CLASSIC_APTITUDE_DATA.resultPriority.indexOf(b)
        );
      });
      return candidates[0];
    }
  }
  return "";
}

function decideResultId() {
  let maxScore = -Infinity;
  for (const value of Object.values(scores)) {
    if (value > maxScore) maxScore = value;
  }
  const tied = Object.entries(scores)
    .filter(([, value]) => value === maxScore)
    .map(([id]) => id);
  if (tied.length === 1) return tied[0];
  const byLast = tieBreakWithLastAnswer(tied);
  if (byLast) return byLast;
  tied.sort((a, b) => RNZ_CLASSIC_APTITUDE_DATA.resultPriority.indexOf(a) - RNZ_CLASSIC_APTITUDE_DATA.resultPriority.indexOf(b));
  return tied[0];
}

function updateProgress() {
  const total = RNZ_CLASSIC_APTITUDE_DATA.questions.length;
  const current = Math.min(currentIndex + 1, total);
  const percent = Math.round((current / total) * 100);
  progressText.textContent = `${current} / ${total}`;
  progressPercent.textContent = `${percent}%`;
  progressFill.style.width = `${percent}%`;
}

function encodeResultToken(resultId) {
  const payload = { v: 1, resultId };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeResultToken(token) {
  const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  return JSON.parse(json);
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("r", encodeResultToken(currentResultId));
  return url.toString();
}

function updateMetaForResult(resultId) {
  const imageUrl = toAbsolute(getResultImageUrl(resultId));
  const metaOgImage = document.querySelector('meta[property="og:image"]');
  const metaTwImage = document.querySelector('meta[name="twitter:image"]');
  if (metaOgImage) metaOgImage.setAttribute("content", imageUrl);
  if (metaTwImage) metaTwImage.setAttribute("content", imageUrl);
}

function setStep(stage) {
  pageRoot.dataset.stage = stage;
  stepStart.classList.toggle("is-active", stage === "start");
  stepQuestion.classList.toggle("is-active", stage === "question");
  stepResult.classList.toggle("is-active", stage === "result");
}

function renderQuestion() {
  const question = RNZ_CLASSIC_APTITUDE_DATA.questions[currentIndex];
  if (!question) return;
  questionText.textContent = question.text;
  choiceList.innerHTML = "";
  for (const choice of question.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.textContent = choice.text;
    btn.addEventListener("click", () => {
      const found = answers.find((item) => item.qIndex === currentIndex);
      if (found) {
        found.choiceId = choice.id;
        found.seq = ++answerSeq;
      } else {
        answers.push({ qIndex: currentIndex, choiceId: choice.id, seq: ++answerSeq });
      }
      recomputeScores();
      saveState();
      trackEvent("question_answer", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, qIndex: currentIndex, choiceId: choice.id });
      currentIndex += 1;
      if (currentIndex >= RNZ_CLASSIC_APTITUDE_DATA.questions.length) {
        currentResultId = decideResultId();
        saveState();
        renderResult();
        trackEvent("test_complete", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, resultId: currentResultId });
        return;
      }
      renderQuestion();
    });
    choiceList.appendChild(btn);
  }
  backBtn.disabled = currentIndex === 0;
  updateProgress();
  adQuestionSection.hidden = currentIndex < 5;
  pushAd(adQuestionSection, adQuestionSlot, ADSENSE_SLOT_QUESTION);
}

function renderResult() {
  const result = RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId];
  if (!result) return;
  setStep("result");
  startPanel.hidden = true;
  questionPanel.hidden = true;
  resultPanel.hidden = false;
  adStartSection.hidden = true;
  adQuestionSection.hidden = true;

  resultImage.src = getResultImageUrl(result.id);
  resultImage.alt = `${result.name} 결과 이미지`;
  const theme = RESULT_THEME_MAP[result.id] || RESULT_THEME_MAP.tourist;
  resultPanel.style.setProperty("--result-accent", theme.accent);
  resultPanel.style.setProperty("--result-soft", theme.soft);
  resultPanel.style.setProperty("--result-tint", theme.tint);
  resultPanel.dataset.resultId = result.id;
  resultTitle.textContent = `${result.emoji} ${result.name}`;
  resultSummary.textContent = result.summary;
  resultOneLiner.textContent = result.oneLiner;
  resultBullets.innerHTML = result.bullets.map((line) => `<li>${line}</li>`).join("");
  resultRecommend.innerHTML = `추천 운영 포인트: <strong>${result.recommend[0]}</strong><br />체크 루틴: ${result.recommend[1]}`;

  updateMetaForResult(result.id);
  pushAd(adResultDescSection, adResultDescSlot, ADSENSE_SLOT_RESULT);
  pushAd(adResultRecommendSection, adResultRecommendSlot, ADSENSE_SLOT_RESULT_SECONDARY);
  setHint("결과를 공유해보세요!");
}

function showStart() {
  setStep("start");
  startPanel.hidden = false;
  questionPanel.hidden = true;
  resultPanel.hidden = true;
  adQuestionSection.hidden = true;
  adResultDescSection.hidden = true;
  adResultRecommendSection.hidden = true;
  pushAd(adStartSection, adStartSlot, ADSENSE_SLOT_TOP);
}

function showQuestion() {
  setStep("question");
  startPanel.hidden = true;
  questionPanel.hidden = false;
  resultPanel.hidden = true;
  adStartSection.hidden = true;
  adResultDescSection.hidden = true;
  adResultRecommendSection.hidden = true;
  renderQuestion();
}

function copyText(text) {
  return navigator.clipboard.writeText(text);
}

function sanitizeFileName(name) {
  return String(name || "rnz-classic-aptitude").replaceAll(/[^\w\-가-힣]/g, "_");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function isLikelyMobileDevice() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/i.test(ua) || window.matchMedia("(pointer: coarse)").matches;
}

async function shareImageFile(blob, fileName) {
  if (typeof navigator.share !== "function") return false;
  const file = new File([blob], fileName, { type: "image/png" });
  if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) return false;
  try {
    // iOS Safari는 files + title/text/url 조합에서 실패하는 경우가 있어 files만 전달한다.
    await navigator.share({ files: [file] });
    return true;
  } catch {
    return false;
  }
}

async function saveResultImage() {
  const result = RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId];
  if (!result) {
    setHint("먼저 결과를 확인해 주세요.");
    return;
  }

  const theme = RESULT_THEME_MAP[result.id] || RESULT_THEME_MAP.tourist;
  const canvas = document.createElement("canvas");
  const width = 1200;
  const height = 1200;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setHint("이미지 생성에 실패했어요.");
    return;
  }

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.soft);
  bg.addColorStop(1, theme.tint);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#101a2ce8";
  ctx.strokeStyle = `${theme.accent}66`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(56, 56, width - 112, height - 112, 34);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f3f7ff";
  ctx.font = "800 48px Pretendard, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ㄹㄴㅈ클래식 현질적성검사", width / 2, 126);

  const box = { x: 132, y: 170, w: 936, h: 600 };
  ctx.fillStyle = "#0d1626";
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 26);
  ctx.fill();
  ctx.strokeStyle = `${theme.accent}88`;
  ctx.stroke();

  try {
    const image = await loadImage(getResultImageUrl(result.id));
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const dx = box.x + (box.w - drawW) / 2;
    const dy = box.y + (box.h - drawH) / 2;
    ctx.drawImage(image, dx, dy, drawW, drawH);
  } catch {
    // fall through
  }

  ctx.fillStyle = theme.accent;
  ctx.font = "800 60px Pretendard, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${result.emoji} ${result.name}`, width / 2, 865);

  ctx.fillStyle = "#e8eefc";
  ctx.font = "600 38px Pretendard, sans-serif";
  ctx.fillText(result.summary, width / 2, 940);

  ctx.fillStyle = "#c5d2ed";
  ctx.font = "700 32px Pretendard, sans-serif";
  ctx.fillText(result.oneLiner, width / 2, 1002);

  ctx.fillStyle = "#afbdd8";
  ctx.font = "600 26px Pretendard, sans-serif";
  ctx.fillText("※ 본 테스트는 풍자 콘텐츠입니다.", width / 2, 1060);

  ctx.fillStyle = "#95a6c8";
  ctx.font = "600 28px Pretendard, sans-serif";
  ctx.fillText("kuru.co.kr/test/rnz-classic-aptitude", width / 2, 1112);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    setHint("이미지 생성에 실패했어요.");
    return;
  }

  const fileName = `rnz-classic-aptitude-${sanitizeFileName(result.id)}.png`;
  if (isLikelyMobileDevice()) {
    const shared = await shareImageFile(blob, fileName);
    if (shared) {
      trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "save_image_mobile_share" });
      setHint("공유 메뉴에서 '이미지 저장'을 선택해 주세요.");
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    const opened = window.open(previewUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(previewUrl), 60 * 1000);
    if (opened) {
      trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "save_image_mobile_preview" });
      setHint("새 탭에서 이미지를 길게 눌러 저장해 주세요.");
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "save_image_download" });
  setHint("결과 이미지를 저장했어요.");
}

async function handleWebShare() {
  const result = RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId];
  if (!result) return;
  const url = buildShareUrl();
  const text = `${result.shareText}\n${url}`;
  trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "web" });
  if (navigator.share) {
    try {
      await navigator.share({ title: SHARE_RESULT_TITLE, text: result.shareText, url });
      setHint("공유를 완료했어요.");
      return;
    } catch {
      setHint("공유가 취소되었거나 실패했어요.");
      return;
    }
  }
  await copyText(text);
  setHint("공유 문구를 복사했어요.");
}

async function handleCopyLink() {
  const result = RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId];
  if (!result) return;
  const url = buildShareUrl();
  trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "copy" });
  await copyText(`${result.shareText}\n${url}`);
  setHint("링크를 복사했어요.");
}

async function handleKakaoShare() {
  const result = RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId];
  if (!result) return;
  const url = buildShareUrl();
  trackEvent("share_click", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug, method: "kakao" });
  if (!window.Kakao || !KAKAO_JS_KEY) {
    await handleCopyLink();
    return;
  }
  try {
    if (!window.Kakao.isInitialized()) {
      window.Kakao.init(KAKAO_JS_KEY);
    }
    window.Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title: SHARE_RESULT_TITLE,
        description: result.shareText,
        imageUrl: toAbsolute(getResultImageUrl(result.id)),
        link: { mobileWebUrl: url, webUrl: url },
      },
      buttons: [{ title: "결과 확인하기", link: { mobileWebUrl: url, webUrl: url } }],
    });
    setHint("카카오톡 공유를 열었어요.");
  } catch {
    await handleCopyLink();
  }
}

function wireEvents() {
  startTestBtn.addEventListener("click", () => {
    currentIndex = 0;
    answers = [];
    scores = {};
    currentResultId = "";
    answerSeq = 0;
    saveState();
    trackEvent("test_start", { slug: RNZ_CLASSIC_APTITUDE_DATA.slug });
    showQuestion();
  });
  backBtn.addEventListener("click", () => {
    if (currentIndex <= 0) return;
    currentIndex -= 1;
    answers = answers.filter((item) => item.qIndex <= currentIndex);
    recomputeScores();
    saveState();
    renderQuestion();
  });
  shareCommon.addEventListener("click", () => {
    handleWebShare().catch(() => setHint("공유 중 오류가 발생했어요."));
  });
  copyLink.addEventListener("click", () => {
    handleCopyLink().catch(() => setHint("복사에 실패했어요."));
  });
  saveImage.addEventListener("click", () => {
    saveResultImage().catch(() => setHint("이미지 저장에 실패했어요."));
  });
  restartTest.addEventListener("click", () => {
    currentIndex = 0;
    answers = [];
    scores = {};
    currentResultId = "";
    answerSeq = 0;
    clearState();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("r");
    nextUrl.searchParams.delete("from");
    window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
    showStart();
    setHint("새 테스트를 시작해보세요!");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  shareKakao.addEventListener("click", () => {
    handleKakaoShare().catch(() => setHint("카카오 공유에 실패했어요."));
  });
}

function restoreState() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("r");
  if (token) {
    try {
      const decoded = decodeResultToken(token);
      if (decoded?.resultId && RNZ_CLASSIC_APTITUDE_DATA.results[decoded.resultId]) {
        currentResultId = decoded.resultId;
        renderResult();
        return true;
      }
    } catch {
      // noop
    }
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    currentIndex = Number(parsed.currentIndex || 0);
    answers = Array.isArray(parsed.answers) ? parsed.answers : [];
    scores = parsed.scores && typeof parsed.scores === "object" ? parsed.scores : {};
    currentResultId = typeof parsed.currentResultId === "string" ? parsed.currentResultId : "";
    answerSeq = answers.reduce((max, item) => Math.max(max, Number(item.seq || 0)), 0);
    if (currentResultId && RNZ_CLASSIC_APTITUDE_DATA.results[currentResultId]) {
      renderResult();
      return true;
    }
    if (answers.length > 0) {
      showQuestion();
      return true;
    }
  } catch {
    clearState();
  }
  return false;
}

function isEntryFromHub() {
  if (!document.referrer) return false;
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin && ref.pathname === "/";
  } catch {
    return false;
  }
}

function init() {
  introLines.innerHTML = RNZ_CLASSIC_APTITUDE_DATA.intro.map((line) => `<p>${line}</p>`).join("");
  wireEvents();
  showStart();
  const currentUrl = new URL(window.location.href);
  const shouldSkipRestore =
    (currentUrl.searchParams.get("from") === "hub" || isEntryFromHub()) && !currentUrl.searchParams.has("r");
  if (shouldSkipRestore) clearState();
  const restored = shouldSkipRestore ? false : restoreState();
  trackEvent("landing_view", {
    page_type: TEST_ID,
    test_id: TEST_ID,
    from_shared: new URL(window.location.href).searchParams.has("r") ? "true" : "false",
  });
  if (!restored) clearState();
}

initAnalytics().catch(() => {
  isAnalyticsReady = false;
});
initAds().catch(() => {
  adStartSection.hidden = true;
  adQuestionSection.hidden = true;
  adResultDescSection.hidden = true;
  adResultRecommendSection.hidden = true;
});
init();
