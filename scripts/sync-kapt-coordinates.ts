import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import proj4 from 'proj4';

const rootDir = process.cwd();
const pageUrl = 'https://www.k-apt.go.kr/apiinfo/goApiSearchCompareMap.do';
const poiUrl = 'https://www.k-apt.go.kr/kaptinfo/getKaptInfo_poi.do';
const coordinatePath = resolve(rootDir, 'src/data/apartment-coordinates.json');
const adminCenterPath = resolve(rootDir, 'src/data/admin-centers.json');
const apartmentManifestPath = resolve(rootDir, 'public/data/apartments/manifest.json');
const delayMs = Number(process.env.KAPT_COORD_DELAY_MS || 180);

const katec = '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const wgs84 = '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs';

interface Poi {
  kaptCode: string;
  xCoord: number | null;
  yCoord: number | null;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

const wait = (milliseconds: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const headers = {
  'User-Agent': 'CJOURNAL-Kapt-Coordinate-Refresh/1.0 (sjongho@nate.com)',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  Referer: pageUrl,
  'X-Requested-With': 'XMLHttpRequest'
};

const pageResponse = await fetch(pageUrl, { headers });
if (!pageResponse.ok) throw new Error(`K-apt 지도 페이지 요청 실패: HTTP ${pageResponse.status}`);
const pageHtml = await pageResponse.text();
const csrf = pageHtml.match(/meta id="_csrf" name="_csrf" content="([^"]+)"/)?.[1];
if (!csrf) throw new Error('K-apt CSRF 토큰을 찾지 못했습니다.');
const cookie = pageResponse.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

const adminCenters = JSON.parse(await readFile(adminCenterPath, 'utf8')) as {
  districts: Array<{ districtCode: string }>;
};
const manifest = JSON.parse(await readFile(apartmentManifestPath, 'utf8')) as { latestMonth: string };
const districtCodes = [...new Set(adminCenters.districts.map((item) => item.districtCode).filter(Boolean))].sort();
const previous = JSON.parse(await readFile(coordinatePath, 'utf8')) as Record<string, Coordinate>;
const collected: Record<string, Coordinate> = { ...previous };
const searchDate = manifest.latestMonth.replace(/\D/g, '').slice(0, 6);
let failedDistricts = 0;
let receivedPois = 0;

for (const [index, districtCode] of districtCodes.entries()) {
  const body = new URLSearchParams({ bjdCode: districtCode, searchDate, _csrf: csrf });
  let result: { resultList?: Poi[] } | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(poiUrl, {
      method: 'POST',
      headers: {
        ...headers,
        Cookie: cookie,
        'X-CSRF-TOKEN': csrf,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body
    });
    const responseText = await response.text();
    if (response.ok && responseText.trim().startsWith('{')) {
      result = JSON.parse(responseText) as { resultList?: Poi[] };
      break;
    }
    if (attempt < 3) await wait(attempt * 1500);
  }

  if (!result) {
    failedDistricts += 1;
    console.warn(`[coordinates] ${districtCode} 조회 실패`);
    continue;
  }

  const pois = result.resultList ?? [];
  receivedPois += pois.length;
  for (const poi of pois) {
    if (!poi.kaptCode || !Number.isFinite(poi.xCoord) || !Number.isFinite(poi.yCoord)) continue;
    const [longitude, latitude] = proj4(katec, wgs84, [Number(poi.xCoord), Number(poi.yCoord)]);
    collected[poi.kaptCode] = {
      latitude: Number(latitude.toFixed(7)),
      longitude: Number(longitude.toFixed(7))
    };
  }

  if ((index + 1) % 20 === 0 || index + 1 === districtCodes.length) {
    console.log(`[coordinates] ${index + 1}/${districtCodes.length}개 시군구, ${Object.keys(collected).length.toLocaleString('ko-KR')}개 좌표`);
  }
  if (delayMs > 0) await wait(delayMs);
}

if (failedDistricts > 0) throw new Error(`${failedDistricts}개 시군구 좌표 조회 실패`);
const sorted = Object.fromEntries(Object.entries(collected).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(coordinatePath, `${JSON.stringify(sorted)}\n`, 'utf8');
console.log(`[coordinates] K-apt ${receivedPois.toLocaleString('ko-KR')}개 응답 중 ${Object.keys(sorted).length.toLocaleString('ko-KR')}개 단지 좌표 저장`);
