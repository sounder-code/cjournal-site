import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lizardProfiles } from "../lizardProfiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "../public/result-images");
const W = 1200;
const H = 630;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mixColor(rgb, ratio, target) {
  return rgb.map((v, i) => Math.round(v * (1 - ratio) + target[i] * ratio));
}

function rgbToHex(rgb) {
  return `#${rgb.map((v) => clamp(v, 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function makeSvg(profile, idx) {
  const base = profile.rgb || [120, 160, 140];
  const bg1 = rgbToHex(mixColor(base, 0.72, [255, 245, 235]));
  const bg2 = rgbToHex(mixColor(base, 0.35, [255, 255, 255]));
  const body = rgbToHex(mixColor(base, 0.2, [240, 255, 240]));
  const belly = rgbToHex(mixColor(base, 0.62, [255, 250, 230]));
  const spot = rgbToHex(mixColor(base, 0.1, [255, 140, 120]));
  const line = rgbToHex(mixColor(base, 0.5, [70, 80, 90]));
  const cheek = rgbToHex(mixColor(base, 0.2, [255, 165, 180]));
  const seed = idx + 1;

  const spots = Array.from({ length: 10 }).map((_, i) => {
    const x = 470 + ((i * 71 + seed * 23) % 310);
    const y = 220 + ((i * 53 + seed * 17) % 200);
    const r = 10 + ((i * 7 + seed * 3) % 12);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${spot}" opacity="0.78" />`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}" />
      <stop offset="100%" stop-color="${bg2}" />
    </linearGradient>
    <filter id="soft">
      <feGaussianBlur stdDeviation="12" />
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <ellipse cx="900" cy="520" rx="210" ry="70" fill="#ffffff" opacity="0.45" filter="url(#soft)" />

  <g transform="translate(80,38)">
    <path d="M220,450 C410,500 740,510 900,430 C980,390 980,320 900,290 C760,235 500,250 320,300 C210,330 170,405 220,450Z" fill="${body}" stroke="${line}" stroke-width="8" />
    <ellipse cx="560" cy="378" rx="250" ry="130" fill="${belly}" opacity="0.88" />
    ${spots.join("\n    ")}

    <ellipse cx="920" cy="282" rx="130" ry="105" fill="${body}" stroke="${line}" stroke-width="8" />
    <ellipse cx="875" cy="275" rx="34" ry="42" fill="#ffffff" />
    <ellipse cx="963" cy="278" rx="34" ry="42" fill="#ffffff" />
    <circle cx="878" cy="286" r="13" fill="#222831" />
    <circle cx="966" cy="288" r="13" fill="#222831" />
    <circle cx="883" cy="281" r="4.5" fill="#ffffff" />
    <circle cx="971" cy="283" r="4.5" fill="#ffffff" />
    <ellipse cx="850" cy="315" rx="20" ry="13" fill="${cheek}" opacity="0.75" />
    <ellipse cx="995" cy="318" rx="20" ry="13" fill="${cheek}" opacity="0.75" />
    <path d="M902,317 Q920,330 940,317" stroke="#554449" stroke-width="5.5" stroke-linecap="round" fill="none" />
    <path d="M910,237 q20,-18 42,-6" stroke="${line}" stroke-width="6" stroke-linecap="round" fill="none" />
    <path d="M834,237 q18,-18 40,-8" stroke="${line}" stroke-width="6" stroke-linecap="round" fill="none" />

    <path d="M225,446 C120,470 80,515 110,548 C130,570 180,566 250,528" fill="none" stroke="${line}" stroke-width="10" stroke-linecap="round" />
  </g>

  <text x="68" y="82" font-size="40" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" fill="#294332" font-weight="700">나와 닮은 도마뱀</text>
  <text x="68" y="138" font-size="56" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" fill="#16251d" font-weight="800">${esc(profile.name)}</text>
  <text x="70" y="190" font-size="30" font-family="Pretendard, Apple SD Gothic Neo, sans-serif" fill="#355949">${esc(profile.type)} · ${esc(profile.morph)}</text>
</svg>
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (let i = 0; i < lizardProfiles.length; i += 1) {
  const profile = lizardProfiles[i];
  const fileName = `lizard-${String(i + 1).padStart(2, "0")}.svg`;
  const svg = makeSvg(profile, i);
  await writeFile(path.join(OUT_DIR, fileName), svg, "utf8");
}

console.log(`generated ${lizardProfiles.length} cute images in ${OUT_DIR}`);
