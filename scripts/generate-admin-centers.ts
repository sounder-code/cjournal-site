import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_DATE = '20260701';
const SOURCE_URL = `https://raw.githubusercontent.com/vuski/admdongkor/master/ver${SOURCE_DATE}/HangJeongDong_ver${SOURCE_DATE}.geojson`;

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];
type Geometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: Polygon | Polygon[] };
type Feature = {
  properties: { sidonm: string; sggnm: string; adm_nm: string; sgg: string };
  geometry: Geometry;
};

function ringCentroid(ring: Ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  const area = Math.abs(twiceArea / 2);
  if (!area || !Number.isFinite(area)) return null;
  return { longitude: x / (3 * twiceArea), latitude: y / (3 * twiceArea), area };
}

function geometryCentroid(geometry: Geometry) {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates as Polygon]
    : geometry.coordinates as Polygon[];
  const parts = polygons.map((polygon) => ringCentroid(polygon[0])).filter(Boolean);
  const area = parts.reduce((sum, part) => sum + part!.area, 0);
  return {
    latitude: parts.reduce((sum, part) => sum + part!.latitude * part!.area, 0) / area,
    longitude: parts.reduce((sum, part) => sum + part!.longitude * part!.area, 0) / area,
    area
  };
}

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`행정구역 파일 다운로드 실패: HTTP ${response.status}`);
const geojson = await response.json() as { features: Feature[] };

const districts = new Map<string, {
  province: string;
  district: string;
  districtCode: string;
  latitudeTotal: number;
  longitudeTotal: number;
  area: number;
  dongs: Array<{ name: string; latitude: number; longitude: number }>;
}>();

for (const feature of geojson.features) {
  const { sidonm: province, sggnm: district, sgg: districtCode } = feature.properties;
  const name = feature.properties.adm_nm.split(' ').slice(2).join(' ');
  const center = geometryCentroid(feature.geometry);
  const key = `${province}|${district}`;
  const entry = districts.get(key) ?? {
    province,
    district,
    districtCode,
    latitudeTotal: 0,
    longitudeTotal: 0,
    area: 0,
    dongs: []
  };
  entry.latitudeTotal += center.latitude * center.area;
  entry.longitudeTotal += center.longitude * center.area;
  entry.area += center.area;
  entry.dongs.push({
    name,
    latitude: Number(center.latitude.toFixed(6)),
    longitude: Number(center.longitude.toFixed(6))
  });
  districts.set(key, entry);
}

const output = {
  sourceDate: `${SOURCE_DATE.slice(0, 4)}-${SOURCE_DATE.slice(4, 6)}-${SOURCE_DATE.slice(6)}`,
  sourceVersion: SOURCE_DATE,
  sourceUrl: SOURCE_URL,
  license: 'CC-BY-4.0 / KOGL-Type-1',
  attribution: '통계청 통계지리정보서비스(SGIS) 행정동 경계, 가공 vuski/admdongkor',
  districts: [...districts.values()]
    .map((entry) => ({
      province: entry.province,
      district: entry.district,
      districtCode: entry.districtCode,
      latitude: Number((entry.latitudeTotal / entry.area).toFixed(6)),
      longitude: Number((entry.longitudeTotal / entry.area).toFixed(6)),
      dongs: entry.dongs.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    }))
    .sort((a, b) => a.province.localeCompare(b.province, 'ko') || a.district.localeCompare(b.district, 'ko'))
};

const destination = path.join(process.cwd(), 'src/data/admin-centers.json');
await writeFile(destination, `${JSON.stringify(output)}\n`, 'utf8');
console.log(`${output.districts.length}개 시군구, ${output.districts.reduce((sum, item) => sum + item.dongs.length, 0)}개 행정동 중심점 생성`);
