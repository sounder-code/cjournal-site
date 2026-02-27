import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const INAT_API = "https://api.inaturalist.org/v1/observations";
const PHOTO_LICENSES = "cc0,cc-by,cc-by-sa";

const CLASS_QUERIES = [
  { label: "레오파드 게코", query: "Eublepharis macularius" },
  { label: "크레스티드 게코", query: "Correlophus ciliatus" },
  { label: "가고일 게코", query: "Rhacodactylus auriculatus" },
  { label: "리키에너스 게코", query: "Rhacodactylus leachianus" },
  { label: "차화 게코", query: "Mniarogekko chahoua" },
  { label: "사라시노럼 게코", query: "Correlophus sarasinorum" },
  { label: "토케이 게코", query: "Gekko gecko" },
  { label: "비어디드 드래곤", query: "Pogona vitticeps" },
  { label: "아프리칸 팻테일 게코", query: "Hemitheconyx caudicinctus" },
  { label: "블루텅 스킨크", query: "Tiliqua scincoides" },
  { label: "유로마스틱스", query: "Uromastyx" },
  { label: "테구", query: "Salvator merianae" },
  { label: "그린 이구아나", query: "Iguana iguana" },
  { label: "예멘 카멜레온", query: "Chamaeleo calyptratus" },
  { label: "팬서 카멜레온", query: "Furcifer pardalis" },
  { label: "차이니즈 워터 드래곤", query: "Physignathus cocincinus" },
];

function buildUrl(query, page, perPage) {
  const url = new URL(INAT_API);
  url.searchParams.set("taxon_name", query);
  url.searchParams.set("quality_grade", "research");
  url.searchParams.set("photos", "true");
  url.searchParams.set("photo_license", PHOTO_LICENSES);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  url.searchParams.set("order_by", "created_at");
  url.searchParams.set("order", "desc");
  return url.toString();
}

function hiResPhotoUrl(url) {
  if (!url) return "";
  return url.replace("/square.", "/large.");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "kuru-lizard-match-dataset-builder/1.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`iNat API error ${res.status} for ${url}`);
  }
  return res.json();
}

async function collectForClass(item, options) {
  const records = [];
  const seenPhotoIds = new Set();
  let page = 1;
  while (records.length < options.targetPerClass && page <= options.maxPages) {
    const url = buildUrl(item.query, page, options.perPage);
    const data = await fetchJson(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) break;

    for (const obs of results) {
      const photos = Array.isArray(obs?.photos) ? obs.photos : [];
      for (const photo of photos) {
        const photoId = String(photo?.id ?? "");
        const photoUrl = hiResPhotoUrl(photo?.url);
        if (!photoId || !photoUrl || seenPhotoIds.has(photoId)) continue;
        seenPhotoIds.add(photoId);

        records.push({
          label: item.label,
          query: item.query,
          observation_id: obs.id,
          observed_on: obs.observed_on ?? null,
          photo_id: photo.id,
          photo_url: photoUrl,
          photo_license_code: photo.license_code ?? null,
          photo_attribution: photo.attribution ?? null,
          taxon_name: obs?.taxon?.name ?? null,
          taxon_rank: obs?.taxon?.rank ?? null,
          latitude: Array.isArray(obs?.location) ? obs.location[0] : null,
          longitude: Array.isArray(obs?.location) ? obs.location[1] : null,
        });
        if (records.length >= options.targetPerClass) break;
      }
      if (records.length >= options.targetPerClass) break;
    }

    page += 1;
  }

  return records;
}

function parseArgs(argv) {
  const opts = {
    targetPerClass: 120,
    maxPages: 6,
    perPage: 200,
    out: resolve(process.cwd(), "data", "inat_manifest.jsonl"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--target-per-class" && next) opts.targetPerClass = Math.max(20, Number(next) || 120);
    if (arg === "--max-pages" && next) opts.maxPages = Math.max(1, Number(next) || 6);
    if (arg === "--per-page" && next) opts.perPage = Math.max(30, Math.min(200, Number(next) || 200));
    if (arg === "--out" && next) opts.out = resolve(process.cwd(), next);
  }
  return opts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(options.out, "..");
  await mkdir(outDir, { recursive: true });

  const all = [];
  for (const item of CLASS_QUERIES) {
    const rows = await collectForClass(item, options);
    all.push(...rows);
    console.log(`[done] ${item.label}: ${rows.length}`);
  }

  const jsonl = all.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(options.out, jsonl, "utf8");
  console.log(`[saved] ${options.out}`);
  console.log(`[total] ${all.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
