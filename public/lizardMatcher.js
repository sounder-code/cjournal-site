import { TUNED_FEATURE_DB } from "./lizardTunedDb.js";
import { TUNED_TYPE_DB } from "./lizardTunedTypeDb.js";

function clampRgb(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function clamp01(value, fallback = 0.5) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function normalizeRgb(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3) return [128, 128, 128];
  return [clampRgb(rgb[0]), clampRgb(rgb[1]), clampRgb(rgb[2])];
}

function rgbDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbToHsv(rgb) {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 360 - d) / 180;
}

function normalizeDominantColors(list) {
  if (!Array.isArray(list) || list.length === 0) return [];

  const cleaned = list
    .map((item) => ({
      rgb: normalizeRgb(item?.rgb),
      weight: Number(item?.weight) || 0,
    }))
    .filter((item) => item.weight > 0);

  const total = cleaned.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return [];

  return cleaned.map((item) => ({
    rgb: item.rgb,
    weight: item.weight / total,
  }));
}

function normalizeFacialPattern(value) {
  return {
    edgeDensity: clamp01(value?.edgeDensity),
    contrast: clamp01(value?.contrast),
    symmetry: clamp01(value?.symmetry),
  };
}

export function normalizeFeatures(input) {
  const avgRgb = normalizeRgb(input?.avgRgb);
  const dominantColors = normalizeDominantColors(input?.dominantColors);
  const saturation = clamp01(input?.saturation, rgbToHsv(avgRgb).s);
  const brightness = clamp01(input?.brightness, rgbToHsv(avgRgb).v);
  const facialPattern = normalizeFacialPattern(input?.facialPattern);

  return {
    avgRgb,
    dominantColors,
    saturation,
    brightness,
    facialPattern,
  };
}

const TYPE_PATTERN_HINTS = {
  "레오파드 게코": { edgeDensity: 0.62, contrast: 0.66, symmetry: 0.64 },
  "크레스티드 게코": { edgeDensity: 0.48, contrast: 0.52, symmetry: 0.72 },
  "가고일 게코": { edgeDensity: 0.57, contrast: 0.58, symmetry: 0.68 },
  "리키에너스 게코": { edgeDensity: 0.44, contrast: 0.46, symmetry: 0.78 },
  "차화 게코": { edgeDensity: 0.46, contrast: 0.49, symmetry: 0.75 },
  "사라시노럼 게코": { edgeDensity: 0.5, contrast: 0.51, symmetry: 0.73 },
  "토케이 게코": { edgeDensity: 0.63, contrast: 0.61, symmetry: 0.6 },
  카멜레온: { edgeDensity: 0.45, contrast: 0.48, symmetry: 0.57 },
  이구아나: { edgeDensity: 0.42, contrast: 0.44, symmetry: 0.63 },
  "비어디드 드래곤": { edgeDensity: 0.55, contrast: 0.56, symmetry: 0.62 },
  "블루텅 스킨크": { edgeDensity: 0.34, contrast: 0.39, symmetry: 0.74 },
  테구: { edgeDensity: 0.58, contrast: 0.63, symmetry: 0.66 },
};

function inferredPatternFor(profile) {
  const tuned = TUNED_FEATURE_DB[profile.name] || TUNED_TYPE_DB[`__TYPE__:${profile.type}`];
  if (tuned?.pattern) return normalizeFacialPattern(tuned.pattern);

  const base = TYPE_PATTERN_HINTS[profile.type] || { edgeDensity: 0.5, contrast: 0.5, symmetry: 0.68 };
  const morph = String(profile.morph || "");

  let edgeDensity = base.edgeDensity;
  let contrast = base.contrast;
  let symmetry = base.symmetry;

  if (morph.includes("달마시안")) edgeDensity += 0.08;
  if (morph.includes("핀스트라이프")) symmetry += 0.06;
  if (morph.includes("익스트림 할리퀸")) contrast += 0.08;
  if (morph.includes("릴리화이트")) contrast -= 0.07;
  if (morph.includes("아잔틱")) contrast -= 0.05;
  if (morph.includes("블리자드")) edgeDensity -= 0.06;

  return {
    edgeDensity: clamp01(edgeDensity),
    contrast: clamp01(contrast),
    symmetry: clamp01(symmetry),
  };
}

function isRedHue(h) {
  return h <= 22 || h >= 338;
}

function nearestPaletteColorDistance(rgb, palette) {
  let min = Infinity;
  for (const color of palette) {
    const d = rgbDistance(rgb, color);
    if (d < min) min = d;
  }
  return min;
}

function nearestPaletteHsvDistance(hsv, palette) {
  let min = Infinity;
  for (const color of palette) {
    const target = rgbToHsv(color);
    const d = hueDistance(hsv.h, target.h) * 60 + Math.abs(hsv.s - target.s) * 40 + Math.abs(hsv.v - target.v) * 32;
    if (d < min) min = d;
  }
  return min;
}

function inferPaletteFor(profile) {
  const tuned = TUNED_FEATURE_DB[profile.name] || TUNED_TYPE_DB[`__TYPE__:${profile.type}`];
  if (Array.isArray(tuned?.palette) && tuned.palette.length) {
    return tuned.palette.map((rgb) => normalizeRgb(rgb));
  }

  const palette = [normalizeRgb(profile.rgb)];
  const type = String(profile.type || "");
  const morph = String(profile.morph || "");

  if (type === "토케이 게코") {
    palette.push([95, 126, 160], [214, 106, 70], [178, 74, 58]);
  } else if (type === "레오파드 게코") {
    palette.push([233, 191, 92], [201, 143, 74], [95, 78, 58]);
    if (morph.includes("맥 스노우")) palette.push([187, 190, 194], [120, 118, 116]);
    if (morph.includes("블리자드")) palette.push([206, 198, 190], [168, 160, 149]);
    if (morph.includes("랩터")) palette.push([201, 112, 96], [227, 154, 112]);
  } else if (type === "크레스티드 게코") {
    palette.push([151, 118, 88], [95, 78, 61], [212, 193, 162]);
    if (morph.includes("릴리화이트")) palette.push([236, 228, 210], [181, 165, 139]);
    if (morph.includes("아잔틱")) palette.push([168, 167, 166], [112, 112, 111]);
    if (morph.includes("달마시안")) palette.push([48, 44, 43]);
    if (morph.includes("핀스트라이프")) palette.push([214, 190, 150]);
    if (morph.includes("초초")) palette.push([81, 72, 65], [62, 58, 55]);
    if (morph.includes("세이블")) palette.push([133, 104, 77], [94, 76, 56]);
    if (morph.includes("익스트림 할리퀸")) palette.push([224, 175, 118], [97, 73, 52]);
  } else if (type === "가고일 게코") {
    palette.push([163, 123, 98], [90, 75, 62], [126, 102, 86]);
  } else if (type === "리키에너스 게코") {
    palette.push([112, 132, 94], [88, 108, 73], [154, 169, 131]);
  } else if (type === "차화 게코" || type === "사라시노럼 게코") {
    palette.push([119, 152, 104], [92, 121, 80], [147, 168, 123]);
  } else if (type === "비어디드 드래곤" || type === "아프리칸 팻테일 게코") {
    palette.push([186, 154, 105], [146, 111, 78], [102, 82, 66]);
  } else if (type === "테구") {
    palette.push([225, 225, 221], [58, 57, 55], [146, 144, 138]);
  } else if (type === "블루텅 스킨크") {
    palette.push([130, 132, 139], [92, 94, 102], [167, 153, 127]);
  } else if (type === "이구아나" || type === "차이니즈 워터 드래곤") {
    palette.push([86, 145, 101], [59, 108, 72], [142, 174, 96]);
    if (morph.includes("레드")) palette.push([172, 99, 76], [137, 79, 61]);
  } else if (type === "카멜레온") {
    palette.push([92, 145, 116], [84, 118, 156], [132, 168, 86]);
  } else if (type === "유로마스틱스") {
    palette.push([183, 157, 83], [132, 105, 55], [88, 77, 58]);
  }

  const seen = new Set();
  return palette.filter((rgb) => {
    const key = rgb.join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDevilAura(features) {
  const hsv = rgbToHsv(features.avgRgb);
  const fp = features.facialPattern;

  const crimsonAura = isRedHue(hsv.h) && hsv.s >= 0.46 && hsv.v <= 0.6;
  const ominousContrast = hsv.v <= 0.38 && fp.contrast >= 0.6 && fp.edgeDensity >= 0.58;
  const sharpImpression = fp.edgeDensity >= 0.72 && fp.contrast >= 0.68;
  const asymmetryShock = fp.symmetry <= 0.5 && fp.edgeDensity >= 0.64 && fp.contrast >= 0.62;

  const darkDominantAura = features.dominantColors.some((item) => {
    const d = rgbToHsv(item.rgb);
    return item.weight >= 0.22 && d.v <= 0.5 && (isRedHue(d.h) || (d.h >= 200 && d.h <= 255));
  });

  return crimsonAura || ominousContrast || sharpImpression || asymmetryShock || darkDominantAura;
}

function tokayAffinity(features) {
  const avg = rgbToHsv(features.avgRgb);
  const fp = features.facialPattern;

  const coolBaseSignal =
    avg.h >= 165 && avg.h <= 245 && avg.s >= 0.08 && avg.s <= 0.6 && avg.v >= 0.2 && avg.v <= 0.78 ? 1 : 0.35;
  const roughPattern = fp.edgeDensity >= 0.5 && fp.contrast >= 0.46 ? 1 : 0.45;

  let warmSpots = 0;
  let coolSpots = 0;
  for (const item of features.dominantColors) {
    const hsv = rgbToHsv(item.rgb);
    if (hsv.h >= 12 && hsv.h <= 45 && hsv.s >= 0.45 && hsv.v >= 0.4) warmSpots += item.weight;
    if (hsv.h >= 180 && hsv.h <= 240 && hsv.s >= 0.08 && hsv.s <= 0.55 && hsv.v >= 0.2 && hsv.v <= 0.72)
      coolSpots += item.weight;
  }

  const warmSpotSignal = Math.min(1, warmSpots / 0.14);
  const coolSpotSignal = Math.min(1, coolSpots / 0.26);
  const pairedSpotSignal = Math.min(warmSpotSignal, coolSpotSignal);

  return (
    coolBaseSignal * 0.2 +
    roughPattern * 0.2 +
    warmSpotSignal * 0.2 +
    coolSpotSignal * 0.18 +
    pairedSpotSignal * 0.22
  );
}

function leopardAffinity(features) {
  const hsv = rgbToHsv(features.avgRgb);
  const fp = features.facialPattern;

  let warmSpots = 0;
  let darkSpots = 0;
  for (const item of features.dominantColors) {
    const c = rgbToHsv(item.rgb);
    if (c.h >= 28 && c.h <= 62 && c.s >= 0.3 && c.v >= 0.45) warmSpots += item.weight;
    if (c.v <= 0.3) darkSpots += item.weight;
  }

  const warmSignal = Math.min(1, warmSpots / 0.32);
  const darkSignal = Math.min(1, darkSpots / 0.18);
  const patternSignal = Math.min(1, (fp.edgeDensity * 0.55 + fp.contrast * 0.45) / 0.65);
  const baseSignal = hsv.h >= 25 && hsv.h <= 70 ? 1 : 0.45;
  return baseSignal * 0.25 + warmSignal * 0.3 + darkSignal * 0.2 + patternSignal * 0.25;
}

function crestedAffinity(features) {
  const hsv = rgbToHsv(features.avgRgb);
  const fp = features.facialPattern;
  const earthTone = hsv.h >= 18 && hsv.h <= 48 ? 1 : 0.52;
  const symmetryTone = Math.min(1, fp.symmetry / 0.74);
  const softPattern = Math.min(1, (1 - Math.abs(fp.edgeDensity - 0.5)) / 0.7);
  return earthTone * 0.4 + symmetryTone * 0.35 + softPattern * 0.25;
}

function greenArborealAffinity(features) {
  const avg = rgbToHsv(features.avgRgb);
  const fp = features.facialPattern;
  const greenHue = avg.h >= 85 && avg.h <= 165 ? 1 : 0.35;
  const sat = Math.min(1, avg.s / 0.56);
  const calmPattern = Math.min(1, (1 - Math.abs(fp.edgeDensity - 0.46)) / 0.62);
  return greenHue * 0.45 + sat * 0.25 + calmPattern * 0.3;
}

function profileDistance(features, profile) {
  const palette = inferPaletteFor(profile);
  const avgDist = nearestPaletteColorDistance(features.avgRgb, palette);
  const featuresHsv = rgbToHsv(features.avgRgb);
  const hsvPenalty = nearestPaletteHsvDistance(featuresHsv, palette);

  let dominantDist = avgDist;
  if (features.dominantColors.length > 0) {
    dominantDist = features.dominantColors.reduce((sum, item) => {
      return sum + nearestPaletteColorDistance(item.rgb, palette) * item.weight;
    }, 0);
  }

  const hint = inferredPatternFor(profile);
  const fp = features.facialPattern;
  const patternPenalty =
    Math.abs(fp.edgeDensity - hint.edgeDensity) * 52 +
    Math.abs(fp.contrast - hint.contrast) * 46 +
    Math.abs(fp.symmetry - hint.symmetry) * 40;

  return avgDist * 0.34 + dominantDist * 0.4 + hsvPenalty * 0.12 + patternPenalty * 0.14;
}

function tagsFor(profile) {
  return [profile.type, profile.morph].filter(Boolean);
}

export function findClosestLizardsByFeatures(featuresInput, profiles) {
  const features = normalizeFeatures(featuresInput);
  const tokaySignal = tokayAffinity(features);
  const leopardSignal = leopardAffinity(features);
  const crestedSignal = crestedAffinity(features);
  const arborealSignal = greenArborealAffinity(features);

  const scored = profiles.map((profile) => ({
    profile,
    distance:
      profileDistance(features, profile) -
      (profile.type === "토케이 게코" ? Math.max(0, tokaySignal - 0.28) * 92 : 0) -
      (profile.type === "레오파드 게코" ? Math.max(0, leopardSignal - 0.34) * 42 : 0) -
      (profile.type === "크레스티드 게코" ? Math.max(0, crestedSignal - 0.34) * 38 : 0) -
      ((profile.type === "카멜레온" || profile.type === "이구아나" || profile.type === "워터 드래곤") &&
      arborealSignal > 0.32
        ? (arborealSignal - 0.32) * 34
        : 0),
  }));

  scored.sort((a, b) => a.distance - b.distance);

  const top3 = scored.slice(0, 3).map((item) => {
    const normalized = Math.max(0, 100 - (item.distance / 160) * 100);
    return {
      ...item.profile,
      tags: tagsFor(item.profile),
      score: Math.round(normalized),
    };
  });

  const forceTokay = isDevilAura(features) || tokaySignal >= 0.58;
  if (!forceTokay) return top3;

  const tokay = profiles.find((profile) => profile.type === "토케이 게코");
  if (!tokay) return top3;

  const forcedTokay = {
    ...tokay,
    desc:
      tokaySignal >= 0.5
        ? "토케이 특유의 청회색 베이스와 스팟 패턴이 강하게 감지됐습니다. 이건 토케이 게코 시그니처가 맞아요."
        : "악마 아우라 감지 완료. 이건 토케이 게코 에너지입니다. 한 번 물리면 기억에 남는 그 텐션 그대로예요.",
    tags: [...tagsFor(tokay), tokaySignal >= 0.5 ? "토케이 시그니처" : "악마 모드", "강제 매칭"],
    score: tokaySignal >= 0.5 ? 96 : 99,
  };

  const shifted = top3
    .filter((item) => item.type !== "토케이 게코")
    .map((item) => ({
      ...item,
      score: Math.max(55, item.score - 9),
    }));

  return [forcedTokay, ...shifted].slice(0, 3);
}
