import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SourceRow {
  code: string;
  name: string;
  address: string;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(rootDir, process.env.KAPT_API_OUTPUT || 'tmp/kapt-openapi.normalized.json');
const coordinatePath = resolve(rootDir, 'src/data/apartment-coordinates.json');
const delayMs = Math.max(1100, Number(process.env.GEOCODE_DELAY_MS || '1100'));
const limit = Math.max(0, Number(process.env.GEOCODE_LIMIT || '0'));

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const main = async () => {
  const rows = JSON.parse(await readFile(sourcePath, 'utf8')) as SourceRow[];
  const coordinates = JSON.parse(await readFile(coordinatePath, 'utf8')) as Record<string, Coordinate>;
  const unique = [...new Map(rows.map((row) => [row.code, row])).values()]
    .filter((row) => row.code && row.address && !coordinates[row.code]);
  const targets = limit > 0 ? unique.slice(0, limit) : unique;

  console.log(`[geocode] ${targets.length}개 신규 주소, ${Object.keys(coordinates).length}개 캐시됨`);
  for (const [index, row] of targets.entries()) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', row.address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'kr');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'CJOURNAL-Map-Geocoder/1.0 (+https://cjournal.kr/contact)' },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`지오코딩 실패: HTTP ${response.status}`);
    const [result] = await response.json() as Array<{ lat: string; lon: string }>;
    if (result) {
      coordinates[row.code] = { latitude: Number(result.lat), longitude: Number(result.lon) };
      await mkdir(dirname(coordinatePath), { recursive: true });
      await writeFile(coordinatePath, `${JSON.stringify(coordinates, null, 2)}\n`);
      console.log(`[${index + 1}/${targets.length}] ${row.name} OK`);
    } else {
      console.warn(`[${index + 1}/${targets.length}] ${row.name} 좌표 없음`);
    }
    if (index < targets.length - 1) await sleep(delayMs);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
