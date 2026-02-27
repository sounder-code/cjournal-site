import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TMP_DIR = resolve("/tmp", "kuru-inat-tune");
const OUT_FILE = resolve(process.cwd(), "lizardTunedTypeDb.js");

const CLASS_QUERIES = [
  { type: "레오파드 게코", query: "Eublepharis macularius" },
  { type: "크레스티드 게코", query: "Correlophus ciliatus" },
  { type: "가고일 게코", query: "Rhacodactylus auriculatus" },
  { type: "리키에너스 게코", query: "Rhacodactylus leachianus" },
  { type: "차화 게코", query: "Mniarogekko chahoua" },
  { type: "사라시노럼 게코", query: "Correlophus sarasinorum" },
  { type: "토케이 게코", query: "Gekko gecko" },
  { type: "비어디드 드래곤", query: "Pogona vitticeps" },
  { type: "아프리칸 팻테일 게코", query: "Hemitheconyx caudicinctus" },
  { type: "블루텅 스킨크", query: "Tiliqua scincoides" },
  { type: "유로마스틱스", query: "Uromastyx" },
  { type: "테구", query: "Salvator merianae" },
  { type: "이구아나", query: "Iguana iguana" },
  { type: "카멜레온", query: "Chamaeleo calyptratus" },
  { type: "워터 드래곤", query: "Physignathus cocincinus" },
];

async function curlGetStdout(args, retries = 3) {
  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      const out = await execFileAsync("curl", args, { maxBuffer: 20 * 1024 * 1024 });
      return out.stdout;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw lastErr;
}

async function curlDownload(url, outPath, retries = 3) {
  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await execFileAsync("curl", ["-A", "Mozilla/5.0", "-sL", "-o", outPath, url], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
  throw lastErr;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function rgbToHsv(rgb) {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function obsUrl(query, page, perPage = 50) {
  const url = new URL("https://api.inaturalist.org/v1/observations");
  url.searchParams.set("taxon_name", query);
  url.searchParams.set("quality_grade", "research");
  url.searchParams.set("photos", "true");
  url.searchParams.set("photo_license", "cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-sa-nc");
  url.searchParams.set("order", "desc");
  url.searchParams.set("order_by", "created_at");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  return url.toString();
}

function photoUrl(photoUrlSquare) {
  if (!photoUrlSquare) return "";
  return photoUrlSquare.replace("/square.", "/medium.");
}

async function fetchPhotoUrls(query, target = 18) {
  const urls = [];
  const seen = new Set();
  for (let page = 1; page <= 4 && urls.length < target; page += 1) {
    const stdout = await curlGetStdout(["-A", "Mozilla/5.0", "-sL", obsUrl(query, page)], 4);
    let data = null;
    try {
      data = JSON.parse(stdout);
    } catch {
      data = null;
    }
    if (!data) break;
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const row of results) {
      const photos = Array.isArray(row?.photos) ? row.photos : [];
      for (const p of photos) {
        const u = photoUrl(p?.url);
        if (!u || seen.has(u)) continue;
        seen.add(u);
        urls.push(u);
        if (urls.length >= target) break;
      }
      if (urls.length >= target) break;
    }
  }
  return urls;
}

async function download(url, outPath) {
  await curlDownload(url, outPath, 3);
}

async function convertToBmp(src, dest) {
  await execFileAsync("/usr/bin/sips", ["-s", "format", "bmp", src, "--out", dest], {
    timeout: 30_000,
  });
}

function parseBmp24(buffer) {
  if (buffer.toString("ascii", 0, 2) !== "BM") throw new Error("not bmp");
  const offset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  if (bpp !== 24) throw new Error(`unsupported bpp ${bpp}`);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  return { width, height, offset, rowStride, topDown };
}

function pixelAt(buffer, meta, x, y) {
  const yy = meta.topDown ? y : meta.height - 1 - y;
  const i = meta.offset + yy * meta.rowStride + x * 3;
  return [buffer[i + 2], buffer[i + 1], buffer[i]]; // RGB
}

function extractStatsFromBmp(buffer) {
  const meta = parseBmp24(buffer);
  const minX = Math.floor(meta.width * 0.18);
  const maxX = Math.ceil(meta.width * 0.82);
  const minY = Math.floor(meta.height * 0.14);
  const maxY = Math.ceil(meta.height * 0.86);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const maxDist = Math.hypot((maxX - minX) / 2, (maxY - minY) / 2) || 1;

  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  let val = 0;
  let wSum = 0;
  const buckets = new Map();
  const lum = [];

  const step = Math.max(1, Math.floor(Math.min(meta.width, meta.height) / 180));
  for (let y = minY; y < maxY; y += step) {
    const row = [];
    for (let x = minX; x < maxX; x += step) {
      const rgb = pixelAt(buffer, meta, x, y);
      const d = Math.hypot(x - cx, y - cy);
      const w = Math.max(0.45, 1 - 0.55 * (d / maxDist));
      r += rgb[0] * w;
      g += rgb[1] * w;
      b += rgb[2] * w;
      wSum += w;

      const hsv = rgbToHsv(rgb);
      sat += hsv.s * w;
      val += hsv.v * w;
      const key = `${Math.floor(rgb[0] / 24)}-${Math.floor(rgb[1] / 24)}-${Math.floor(rgb[2] / 24)}`;
      buckets.set(key, (buckets.get(key) || 0) + w);
      row.push(rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722);
    }
    lum.push(row);
  }

  const avgRgb = [Math.round(r / wSum), Math.round(g / wSum), Math.round(b / wSum)];
  const dominant = [...buckets.entries()]
    .sort((a, b0) => b0[1] - a[1])
    .slice(0, 4)
    .map(([key, weight]) => {
      const [rb, gb, bb] = key.split("-").map(Number);
      return { rgb: [rb * 24 + 12, gb * 24 + 12, bb * 24 + 12], weight };
    });
  const total = dominant.reduce((s, i) => s + i.weight, 0) || 1;

  let edge = 0;
  let edgeCount = 0;
  let mean = 0;
  let m2 = 0;
  let n = 0;
  let symDiff = 0;
  let symCount = 0;

  for (let y = 0; y < lum.length; y += 1) {
    for (let x = 0; x < lum[y].length; x += 1) {
      const p = lum[y][x];
      n += 1;
      const d = p - mean;
      mean += d / n;
      m2 += d * (p - mean);
      if (x + 1 < lum[y].length) {
        edge += Math.abs(p - lum[y][x + 1]);
        edgeCount += 1;
      }
      if (y + 1 < lum.length) {
        edge += Math.abs(p - lum[y + 1][x]);
        edgeCount += 1;
      }
    }

    const half = Math.floor(lum[y].length / 2);
    for (let x = 0; x < half; x += 1) {
      symDiff += Math.abs(lum[y][x] - lum[y][lum[y].length - 1 - x]);
      symCount += 1;
    }
  }

  return {
    avgRgb,
    dominantColors: dominant.map((i) => ({ rgb: i.rgb, weight: i.weight / total })),
    saturation: sat / wSum,
    brightness: val / wSum,
    facialPattern: {
      edgeDensity: clamp01((edge / Math.max(1, edgeCount)) / 54),
      contrast: clamp01(Math.sqrt(m2 / Math.max(1, n)) / 62),
      symmetry: clamp01(1 - (symDiff / Math.max(1, symCount)) / 90),
    },
  };
}

function mergeStats(items) {
  if (!items.length) return null;

  const avgRgb = [0, 0, 0];
  let sat = 0;
  let val = 0;
  const pattern = { edgeDensity: 0, contrast: 0, symmetry: 0 };
  const bucketMap = new Map();

  for (const it of items) {
    avgRgb[0] += it.avgRgb[0];
    avgRgb[1] += it.avgRgb[1];
    avgRgb[2] += it.avgRgb[2];
    sat += it.saturation;
    val += it.brightness;
    pattern.edgeDensity += it.facialPattern.edgeDensity;
    pattern.contrast += it.facialPattern.contrast;
    pattern.symmetry += it.facialPattern.symmetry;
    for (const c of it.dominantColors) {
      const key = c.rgb.join("-");
      bucketMap.set(key, (bucketMap.get(key) || 0) + c.weight);
    }
  }

  const n = items.length;
  const palette = [...bucketMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key]) => key.split("-").map((v) => Number(v)));

  return {
    palette: [
      [Math.round(avgRgb[0] / n), Math.round(avgRgb[1] / n), Math.round(avgRgb[2] / n)],
      ...palette,
    ].slice(0, 4),
    pattern: {
      edgeDensity: Number((pattern.edgeDensity / n).toFixed(3)),
      contrast: Number((pattern.contrast / n).toFixed(3)),
      symmetry: Number((pattern.symmetry / n).toFixed(3)),
    },
  };
}

async function buildTypeStats() {
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const result = {};

  for (const entry of CLASS_QUERIES) {
    const urls = await fetchPhotoUrls(entry.query, 14);
    const stats = [];

    for (let i = 0; i < urls.length; i += 1) {
      const src = resolve(TMP_DIR, `${entry.type}-${i}.img`);
      const bmp = resolve(TMP_DIR, `${entry.type}-${i}.bmp`);
      try {
        await download(urls[i], src);
        await convertToBmp(src, bmp);
        const buf = await readFile(bmp);
        stats.push(extractStatsFromBmp(buf));
      } catch {
        // 일부 이미지는 다운로드/변환 실패 가능성이 있어 스킵합니다.
      }
    }

    const merged = mergeStats(stats);
    if (merged) {
      result[`__TYPE__:${entry.type}`] = merged;
      console.log(`[done] ${entry.type}: ${stats.length}`);
    } else {
      console.log(`[skip] ${entry.type}: no valid images`);
    }
  }

  return result;
}

async function main() {
  const db = await buildTypeStats();
  const code = `export const TUNED_TYPE_DB = ${JSON.stringify(db, null, 2)};\n`;
  await writeFile(OUT_FILE, code, "utf8");
  console.log(`[saved] ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
